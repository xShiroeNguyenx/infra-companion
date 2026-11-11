/**
 * F25 — tô màu + báo động theo mẫu ngay trong terminal.
 *
 * Người ta `tail -f` một log rồi sang tab khác làm việc. Dòng `ERROR` hay `Out of memory` trôi
 * qua mà không ai thấy, vì terminal chỉ in chữ và không biết chữ nào quan trọng. Module này cho
 * terminal biết điều đó: dòng nào khớp mẫu thì được tô màu, và mẫu có bật "báo động" thì báo khi
 * pane đang khuất.
 *
 * Hàm thuần ở `packages/shared` vì renderer làm việc này (nó giữ `Terminal`) mà renderer KHÔNG
 * import được `@infra/core` (CLAUDE.md §5); test nằm ở `packages/core`.
 *
 * Ba cái bẫy quyết định cách viết:
 *  · **Một dòng log có thể tới thành hai khúc dữ liệu.** Khớp trên khúc thì lúc bắt được lúc
 *    không. Nên renderer chỉ khớp trên DÒNG ĐÃ HOÀN CHỈNH trong buffer (con trỏ đã xuống dòng),
 *    và nối các hàng bị wrap thành một dòng logic trước khi khớp ({@link indexCells}).
 *  · **Regex do người dùng viết có thể treo renderer.** JS không có timeout cho regex, nên chặn
 *    từ lúc lưu ({@link checkHighlightPattern} bắt dạng lồng lặp kiểu `(a+)+`) và chỉ đưa tối đa
 *    {@link MAX_MATCH_CHARS} ký tự mỗi dòng vào regex.
 *  · **Một lỗi lặp 500 lần không được thành 500 thông báo.** {@link decideTrigger} cho mỗi mẫu
 *    một lần báo mỗi phút trên mỗi pane, và lần báo sau nói số dòng đã gộp.
 */

export type HighlightColor = 'red' | 'yellow' | 'green' | 'blue' | 'purple'
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['red', 'yellow', 'green', 'blue', 'purple']

/** `match` = chỉ tô chữ khớp; `line` = tô nền cả dòng (giữ nguyên màu chữ gốc). */
export type HighlightScope = 'match' | 'line'

export interface HighlightRule {
  id: string
  /** Chuỗi thường (không phân biệt hoa thường) hoặc regex dạng `/…/flags`. */
  pattern: string
  color: HighlightColor
  scope: HighlightScope
  /** Báo khi pane đang khuất (toast + trung tâm thông báo + nhân vật). */
  notify: boolean
  enabled: boolean
}

/** Trần số mẫu: mỗi dòng output chạy qua TỪNG mẫu, nên số mẫu là chi phí trên mọi dòng. */
export const MAX_HIGHLIGHT_RULES = 30
export const MAX_PATTERN_LENGTH = 300
/**
 * Số ký tự đầu của một dòng logic đưa vào regex. Chặn trên chi phí của một mẫu chậm, và một
 * dòng JSON 200 KB (log minify) không làm khựng terminal. Phần sau mốc này không được tô.
 */
export const MAX_MATCH_CHARS = 2000
/** Số đoạn tô tối đa trên một dòng — một mẫu khớp từng ký tự không được đẻ ra hàng nghìn decoration. */
export const MAX_SPANS_PER_LINE = 64

/**
 * Mẫu mặc định: chỉ TÔ MÀU, không báo động. Báo động là thứ user tự bật cho đúng log mình đang
 * canh; bật sẵn thì mỗi lần `grep error` cũng thành một thông báo và người ta tắt luôn cả tính năng.
 *
 * `exception\b` không có `\b` phía trước vì tên lớp Java dính liền: `NullPointerException`.
 */
export const DEFAULT_HIGHLIGHT_RULES: readonly HighlightRule[] = [
  {
    id: 'default-error',
    pattern: '/\\b(err|error|errors|fatal|crit|critical|panic|emerg|failed|failure)\\b|exception\\b/i',
    color: 'red',
    scope: 'match',
    notify: false,
    enabled: true
  },
  {
    id: 'default-warn',
    pattern: '/\\b(warn|warning|warnings|deprecated)\\b/i',
    color: 'yellow',
    scope: 'match',
    notify: false,
    enabled: true
  }
]

export type PatternProblem = 'empty' | 'too-long' | 'invalid' | 'matches-empty' | 'risky'

const REGEX_FORM = /^\/(.+)\/([a-z]*)$/i
const ALLOWED_FLAGS = new Set(['i', 'm', 's', 'u'])

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Dạng lồng lặp gây backtracking bùng nổ: một NHÓM có lượng từ `+`/`*`/`{n,}` ở bên trong, và
 * chính nhóm đó lại bị lặp — `(a+)+`, `(\w*)*`, `(x{2,})+`. Đây là dạng kinh điển làm một
 * dòng 40 ký tự chạy hàng phút.
 *
 * Là heuristic: có thể chặn nhầm vài mẫu vô hại như `(x+y)+`, nhưng cái giá của chặn nhầm là
 * user viết lại mẫu, còn cái giá của bỏ lọt là treo cả cửa sổ app. Dấu `\` và lớp ký tự `[…]`
 * được bỏ qua đúng cách nên `\(a+\)+` hay `([a+])+` không bị coi là lồng.
 */
export function hasNestedQuantifier(source: string): boolean {
  const stack: boolean[] = []
  let inClass = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!
    if (ch === '\\') {
      i++ // bỏ qua ký tự bị escape
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    if (ch === '(') {
      stack.push(false)
      continue
    }
    if (ch === ')') {
      const innerQuantified = stack.pop() ?? false
      const next = source[i + 1]
      const groupRepeated = next === '+' || next === '*' || (next === '{' && /^\{\d*,\d*\}/.test(source.slice(i + 1)))
      if (innerQuantified && groupRepeated) return true
      // Nhóm có lặp bên trong làm nhóm cha cũng "có lặp bên trong"
      if (innerQuantified || groupRepeated) {
        if (stack.length > 0) stack[stack.length - 1] = true
      }
      continue
    }
    if (ch === '+' || ch === '*' || (ch === '{' && /^\{\d*,\d*\}/.test(source.slice(i)))) {
      if (stack.length > 0) stack[stack.length - 1] = true
    }
  }
  return false
}

interface Built {
  re: RegExp | null
  problem: PatternProblem | null
}

function build(pattern: string): Built {
  const raw = pattern.trim()
  if (raw === '') return { re: null, problem: 'empty' }
  if (raw.length > MAX_PATTERN_LENGTH) return { re: null, problem: 'too-long' }
  const m = raw.match(REGEX_FORM)
  let re: RegExp
  if (m) {
    const source = m[1]!
    const flags = [...new Set(m[2]!.toLowerCase().replace(/g/g, ''))]
    if (flags.some((f) => !ALLOWED_FLAGS.has(f))) return { re: null, problem: 'invalid' }
    if (hasNestedQuantifier(source)) return { re: null, problem: 'risky' }
    try {
      re = new RegExp(source, `${flags.join('')}g`)
    } catch {
      return { re: null, problem: 'invalid' }
    }
  } else {
    re = new RegExp(escapeRegex(raw), 'gi')
  }
  // Mẫu khớp chuỗi rỗng (`/x*/`, `/a|/`) khớp ở MỌI vị trí của mọi dòng — vô dụng, và ở chế độ
  // "cả dòng" thì tô nền toàn bộ terminal. Từ chối luôn thay vì để user tự đoán vì sao.
  re.lastIndex = 0
  const emptyHit = re.test('')
  re.lastIndex = 0
  if (emptyHit) return { re: null, problem: 'matches-empty' }
  return { re, problem: null }
}

/** Vấn đề của một mẫu (để hiện ngay dưới ô nhập), hoặc null nếu dùng được. */
export function checkHighlightPattern(pattern: string): PatternProblem | null {
  return build(pattern).problem
}

/**
 * Đọc danh sách mẫu đã lưu (localStorage) — dữ liệu ngoài tầm kiểm soát nên kiểm từng trường.
 * GIỮ mẫu đang lỗi (user có thể đang gõ dở); bước biên dịch mới bỏ chúng.
 */
export function cleanHighlightRules(raw: unknown): HighlightRule[] {
  if (!Array.isArray(raw)) return []
  const out: HighlightRule[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (out.length >= MAX_HIGHLIGHT_RULES) break
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.pattern !== 'string') continue
    let id = typeof r.id === 'string' && r.id.trim() !== '' ? r.id : `rule-${out.length + 1}`
    while (seen.has(id)) id = `${id}-dup`
    seen.add(id)
    out.push({
      id,
      pattern: r.pattern.slice(0, MAX_PATTERN_LENGTH),
      color: HIGHLIGHT_COLORS.includes(r.color as HighlightColor) ? (r.color as HighlightColor) : 'red',
      scope: r.scope === 'line' ? 'line' : 'match',
      notify: r.notify === true,
      enabled: r.enabled !== false
    })
  }
  return out
}

export interface CompiledRule {
  rule: HighlightRule
  /** Luôn có cờ `g`; nơi dùng phải tự đặt `lastIndex = 0`. */
  re: RegExp
}

/** Biên dịch MỘT lần mỗi khi danh sách đổi — không biên dịch lại trên từng dòng output. */
export function compileHighlightRules(rules: readonly HighlightRule[]): CompiledRule[] {
  const out: CompiledRule[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    const { re } = build(rule.pattern)
    if (re) out.push({ rule, re })
  }
  return out
}

export interface HighlightSpan {
  start: number
  end: number
  color: HighlightColor
}

export interface LineHighlight {
  /** Màu nền cả dòng (mẫu `line` đầu tiên khớp), hoặc null. */
  lineColor: HighlightColor | null
  /** Các đoạn tô của mẫu `match`, không chồng nhau, theo thứ tự xuất hiện. */
  spans: HighlightSpan[]
  /** Mẫu có bật báo động đã khớp dòng này (mỗi mẫu một lần, theo thứ tự trong danh sách). */
  triggered: HighlightRule[]
}

/**
 * Khớp một dòng logic với các mẫu. Trả null khi không mẫu nào khớp — đường nhanh cho phần lớn
 * output, để renderer không phải đọc từng ô của dòng đó.
 *
 * Mẫu đứng TRƯỚC trong danh sách thắng khi hai mẫu chồng lên cùng một đoạn: user sắp thứ tự
 * được, và "mẫu trên cùng là ưu tiên nhất" là quy ước dễ đoán nhất.
 */
export function highlightLine(text: string, compiled: readonly CompiledRule[]): LineHighlight | null {
  const subject = text.length > MAX_MATCH_CHARS ? text.slice(0, MAX_MATCH_CHARS) : text
  if (subject.trim() === '' || compiled.length === 0) return null

  let lineColor: HighlightColor | null = null
  const spans: HighlightSpan[] = []
  const triggered: HighlightRule[] = []

  for (const { rule, re } of compiled) {
    re.lastIndex = 0
    let hit = false
    if (rule.scope === 'line') {
      hit = re.test(subject)
      re.lastIndex = 0
      if (hit && lineColor === null) lineColor = rule.color
    } else {
      for (const m of subject.matchAll(re)) {
        if (m[0] === '' || m.index === undefined) continue
        hit = true
        if (spans.length >= MAX_SPANS_PER_LINE) break
        const start = m.index
        const end = start + m[0].length
        if (!spans.some((s) => start < s.end && s.start < end)) spans.push({ start, end, color: rule.color })
      }
      re.lastIndex = 0
    }
    if (hit && rule.notify) triggered.push(rule)
  }

  if (lineColor === null && spans.length === 0 && triggered.length === 0) return null
  spans.sort((a, b) => a.start - b.start)
  return { lineColor, spans, triggered }
}

/** Một ô của buffer terminal, đủ để dựng lại văn bản và biết nó nằm ở cột nào. */
export interface CellLike {
  /** Ký tự trong ô; '' với ô trống. Có thể dài hơn 1 (cặp surrogate, dấu kết hợp). */
  chars: string
  /** 1 bình thường, 2 với ký tự rộng (CJK, emoji), 0 với nửa sau của ký tự rộng. */
  width: number
}

export interface CellPos {
  /** Chỉ số hàng TRONG dòng logic (0 = hàng đầu), không phải số dòng của buffer. */
  row: number
  col: number
  width: number
}

export interface CellIndex {
  text: string
  /** `pos[i]` = ô chứa code unit thứ i của `text`. */
  pos: CellPos[]
}

/**
 * Dựng văn bản của một dòng logic (các hàng bị wrap nối lại) kèm vị trí ô của từng ký tự.
 *
 * Không dùng thẳng chỉ số chuỗi làm số cột: ký tự rộng chiếm 2 ô nhưng 1 (hoặc 2) code unit,
 * và dấu kết hợp nằm chung ô với chữ cái. Tô theo chỉ số chuỗi thì chỉ cần một chữ Nhật hay
 * một emoji đứng trước là đoạn tô lệch khỏi chữ khớp.
 */
export function indexCells(rows: ReadonlyArray<ReadonlyArray<CellLike>>): CellIndex {
  let text = ''
  const pos: CellPos[] = []
  rows.forEach((cells, row) => {
    cells.forEach((cell, col) => {
      if (cell.width === 0) return // nửa sau của ký tự rộng — đã tính ở ô trước
      const chars = cell.chars === '' ? ' ' : cell.chars
      for (let k = 0; k < chars.length; k++) {
        text += chars[k]
        pos.push({ row, col, width: Math.max(1, cell.width) })
      }
    })
  })
  // Ô trống cuối dòng không phải nội dung
  let end = text.length
  while (end > 0 && text[end - 1] === ' ') end--
  return { text: text.slice(0, end), pos: pos.slice(0, end) }
}

export interface RowSegment {
  /** Hàng trong dòng logic (0 = hàng đầu). */
  row: number
  col: number
  width: number
  color: HighlightColor
}

/** Đổi các đoạn tô (theo chỉ số chuỗi) thành đoạn theo ô trên từng hàng — một đoạn có thể vắt qua chỗ wrap. */
export function spansToSegments(spans: readonly HighlightSpan[], index: CellIndex): RowSegment[] {
  const out: RowSegment[] = []
  for (const span of spans) {
    const end = Math.min(span.end, index.pos.length)
    let cur: RowSegment | null = null
    for (let i = span.start; i < end; i++) {
      const p = index.pos[i]!
      const cellEnd = p.col + p.width
      if (cur && cur.row === p.row) {
        cur.width = Math.max(cur.width, cellEnd - cur.col)
      } else {
        if (cur) out.push(cur)
        cur = { row: p.row, col: p.col, width: p.width, color: span.color }
      }
    }
    if (cur) out.push(cur)
  }
  return out
}

export interface HighlightColors {
  /** Nền + chữ cho đoạn khớp. */
  bg: string
  fg: string
  /** Nền nhạt hơn cho chế độ cả dòng (giữ màu chữ gốc). */
  lineBg: string
}

/**
 * Bảng màu theo nền terminal. Decoration của xterm chỉ nhận `#RRGGBB` (không alpha), nên mỗi
 * màu có bản cho nền tối và nền sáng, chọn sao cho chữ vẫn đọc được.
 */
const PALETTE: Record<'dark' | 'light', Record<HighlightColor, HighlightColors>> = {
  dark: {
    // lineBg đã chụp ảnh đối chiếu trên nền #0b0e14: nhạt hơn thế này thì cả dòng gần như không đổi màu
    red: { bg: '#5c1d24', fg: '#ffc2c8', lineBg: '#4a1b22' },
    yellow: { bg: '#4d3b0a', fg: '#ffe29a', lineBg: '#3d300e' },
    green: { bg: '#15432b', fg: '#b4f2cb', lineBg: '#173826' },
    blue: { bg: '#1a3560', fg: '#b6d0ff', lineBg: '#1a2e50' },
    purple: { bg: '#3d2463', fg: '#dcc4ff', lineBg: '#33224f' }
  },
  light: {
    red: { bg: '#fbd5d8', fg: '#8f1622', lineBg: '#fce1e3' },
    yellow: { bg: '#fbe8b0', fg: '#6b4a00', lineBg: '#fcefc8' },
    green: { bg: '#cdeedb', fg: '#14532d', lineBg: '#dcf3e5' },
    blue: { bg: '#d4e3fb', fg: '#1e3a8a', lineBg: '#e0eafc' },
    purple: { bg: '#e6dafb', fg: '#5b21b6', lineBg: '#ece3fc' }
  }
}

export function highlightColors(theme: 'dark' | 'light', color: HighlightColor): HighlightColors {
  return PALETTE[theme][color]
}

// ── Báo động ───────────────────────────────────────────────────────────────

/** Mỗi mẫu báo tối đa một lần trong khoảng này, trên mỗi pane. */
export const TRIGGER_COOLDOWN_MS = 60_000

export interface TriggerState {
  lastAt: number
  /** Số dòng khớp đã nuốt từ lần báo trước. */
  suppressed: number
}

export interface TriggerDecision {
  notify: boolean
  /** Khi `notify`: số dòng đã gộp trước lần này (để nói "+N dòng"). */
  suppressed: number
  next: TriggerState | undefined
  reason?: 'pane-visible' | 'cooldown'
}

/**
 * Có báo cho lần khớp này không.
 *
 * "Pane đang hiện" đứng đầu, giống F26: đang nhìn thì màu tô đã đủ, thông báo chỉ là tiếng ồn.
 * Lúc đó KHÔNG đụng vào trạng thái hạ nhiệt — người ta nhìn đi chỗ khác thì lần khớp kế tiếp
 * phải được báo ngay, không bị một lần khớp lúc đang nhìn chặn mất.
 */
export function decideTrigger(input: {
  prev: TriggerState | undefined
  now: number
  paneVisible: boolean
  cooldownMs?: number
}): TriggerDecision {
  const { prev, now } = input
  if (input.paneVisible) return { notify: false, suppressed: 0, next: prev, reason: 'pane-visible' }
  const cooldown = input.cooldownMs ?? TRIGGER_COOLDOWN_MS
  if (prev && now - prev.lastAt < cooldown) {
    return { notify: false, suppressed: 0, next: { lastAt: prev.lastAt, suppressed: prev.suppressed + 1 }, reason: 'cooldown' }
  }
  return { notify: true, suppressed: prev?.suppressed ?? 0, next: { lastAt: now, suppressed: 0 } }
}

/**
 * Trích dòng log cho toast: bỏ ký tự điều khiển, gộp khoảng trắng, cắt ngắn. Chỉ dùng cho toast
 * (bộ nhớ), KHÔNG ghi vào trung tâm thông báo: `events.db` không mã hoá, mà một dòng log có thể
 * chứa token hay mật khẩu.
 */
export function triggerExcerpt(text: string, max = 140): string {
  // eslint-disable-next-line no-control-regex
  const one = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}
