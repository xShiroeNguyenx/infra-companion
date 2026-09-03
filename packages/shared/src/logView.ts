/**
 * F30 — lệnh `tail` và bộ lọc cho panel xem log.
 *
 * Hàm thuần ở `packages/shared` (không phải `core`) vì renderer lọc/tô màu tại chỗ mà renderer
 * KHÔNG import được `@infra/core` (CLAUDE.md §5).
 */

/** Bọc chuỗi trong nháy đơn cho shell. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/** Số dòng lịch sử kéo về lúc mở panel — đủ để thấy bối cảnh, không đủ để nghẽn UI. */
export const TAIL_INITIAL_LINES = 200

/**
 * Lệnh theo dõi một file log.
 *
 * **`-F` chứ không phải `-f`**: logrotate đổi tên file rồi tạo file mới lúc nửa đêm; `-f` bám
 * theo inode cũ nên từ đó im lặng vĩnh viễn — panel trông vẫn "đang chạy" mà không bao giờ có
 * dòng nào nữa. `-F` mở lại theo tên. `-n` để có sẵn bối cảnh thay vì màn hình trắng chờ dòng
 * kế tiếp. Không `$(...)`/heredoc — mỗi hop login-script bóc mất một lớp quote (§4).
 */
export function tailCommand(path: string, lines = TAIL_INITIAL_LINES): string {
  return `tail -n ${Math.max(0, Math.floor(lines))} -F ${shq(path)}`
}

/** Một dòng log đã nhận. */
export interface LogLine {
  /** Số thứ tự tăng dần — khoá React ổn định, và dòng trùng nội dung vẫn phân biệt được. */
  seq: number
  text: string
  source: 'stdout' | 'stderr'
}

export interface LogFilter {
  /** Chuỗi tìm, hoặc regex khi bọc trong /…/. Rỗng = không lọc. */
  query: string
  /** Đảo kết quả: giữ những dòng KHÔNG khớp (đuổi tiếng ồn ra khỏi log ồn). */
  invert: boolean
  caseSensitive: boolean
}

/**
 * Phân loại query. Phải tách `broken` khỏi `literal`: query gõ dở như `/[` VẪN có hình dạng
 * regex, nếu chỉ trả null rồi rơi xuống tìm chuỗi thì app đi tìm literal `"/[/"` — không dòng
 * nào chứa nên panel trắng bong giữa lúc user đang gõ, mất cả bối cảnh vừa đọc.
 */
type Matcher = { kind: 'regex'; re: RegExp } | { kind: 'literal' } | { kind: 'broken' }

function classify(query: string, caseSensitive: boolean): Matcher {
  const m = query.match(/^\/(.+)\/([a-z]*)$/i)
  if (!m) return { kind: 'literal' }
  try {
    const flags = m[2]!.includes('i') || caseSensitive ? m[2]! : `${m[2]!}i`
    return { kind: 'regex', re: new RegExp(m[1]!, flags) }
  } catch {
    return { kind: 'broken' }
  }
}

/**
 * Dòng có qua được bộ lọc không.
 *
 * Query rỗng luôn cho qua. Regex hỏng (đang gõ dở `/[`) cũng cho qua: làm trắng panel giữa
 * lúc user đang gõ là mất cả bối cảnh vừa đọc.
 */
export function lineMatches(text: string, filter: LogFilter): boolean {
  const query = filter.query.trim()
  if (query === '') return true

  const matcher = classify(query, filter.caseSensitive)
  // Regex hỏng = coi như CHƯA lọc. Trả về trước cả `invert`: đảo của "không lọc" vẫn phải là
  // "hiện tất cả", không phải "giấu tất cả".
  if (matcher.kind === 'broken') return true

  const hit =
    matcher.kind === 'regex'
      ? matcher.re.test(text)
      : filter.caseSensitive
        ? text.includes(query)
        : text.toLowerCase().includes(query.toLowerCase())

  return filter.invert ? !hit : hit
}

/** Một đoạn của dòng khi tách để tô màu. */
export interface LogSegment {
  text: string
  hit: boolean
}

/**
 * Tách dòng thành các đoạn khớp / không khớp để tô màu.
 *
 * Không tô khi đang ở chế độ đảo (`invert`): những dòng còn lại là dòng KHÔNG chứa query, tô
 * cái gì cũng vô nghĩa.
 */
export function highlightSegments(text: string, filter: LogFilter): LogSegment[] {
  const query = filter.query.trim()
  if (query === '' || filter.invert) return [{ text, hit: false }]

  const matcher = classify(query, filter.caseSensitive)
  if (matcher.kind === 'broken') return [{ text, hit: false }]
  const pattern =
    matcher.kind === 'regex'
      ? new RegExp(matcher.re.source, matcher.re.flags.includes('g') ? matcher.re.flags : `${matcher.re.flags}g`)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), filter.caseSensitive ? 'g' : 'gi')

  const out: LogSegment[] = []
  let last = 0
  for (const m of text.matchAll(pattern)) {
    // Mẫu khớp chuỗi RỖNG sẽ lặp vô hạn ở matchAll — bỏ qua để panel không treo
    if (m[0] === '' || m.index === undefined) continue
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out.length > 0 ? out : [{ text, hit: false }]
}
