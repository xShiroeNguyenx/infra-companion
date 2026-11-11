import { describe, expect, test } from 'vitest'
import {
  DEFAULT_HIGHLIGHT_RULES,
  MAX_HIGHLIGHT_RULES,
  MAX_MATCH_CHARS,
  MAX_SPANS_PER_LINE,
  TRIGGER_COOLDOWN_MS,
  checkHighlightPattern,
  cleanHighlightRules,
  compileHighlightRules,
  decideTrigger,
  hasNestedQuantifier,
  highlightColors,
  highlightLine,
  indexCells,
  spansToSegments,
  triggerExcerpt,
  HIGHLIGHT_COLORS,
  type CellLike,
  type HighlightRule
} from '@infra/shared'

/** F25 — tô màu + báo động theo mẫu trong terminal. Thực thi ở `packages/shared`. */

const rule = (pattern: string, patch: Partial<HighlightRule> = {}): HighlightRule => ({
  id: pattern,
  pattern,
  color: 'red',
  scope: 'match',
  notify: false,
  enabled: true,
  ...patch
})

const cells = (s: string): CellLike[] => [...s].map((chars) => ({ chars, width: 1 }))

describe('checkHighlightPattern', () => {
  test('chuỗi thường và regex hợp lệ', () => {
    expect(checkHighlightPattern('ERROR')).toBeNull()
    expect(checkHighlightPattern('/\\bOOM\\b/i')).toBeNull()
    expect(checkHighlightPattern('/timeout after \\d+ms/')).toBeNull()
  })

  test('mẫu rỗng / quá dài', () => {
    expect(checkHighlightPattern('   ')).toBe('empty')
    expect(checkHighlightPattern('x'.repeat(301))).toBe('too-long')
  })

  test('regex hỏng và cờ lạ', () => {
    expect(checkHighlightPattern('/[abc/')).toBe('invalid')
    expect(checkHighlightPattern('/abc/x')).toBe('invalid')
    // `g` vô hại (app tự thêm) — không bắt user hiểu cờ nào app dùng
    expect(checkHighlightPattern('/abc/g')).toBeNull()
  })

  test('mẫu khớp chuỗi rỗng bị từ chối — nó khớp ở mọi vị trí của mọi dòng', () => {
    expect(checkHighlightPattern('/x*/')).toBe('matches-empty')
    expect(checkHighlightPattern('/a|/')).toBe('matches-empty')
  })

  test('nhóm lồng lặp (backtracking bùng nổ) bị chặn từ lúc lưu', () => {
    expect(checkHighlightPattern('/(a+)+$/')).toBe('risky')
    expect(checkHighlightPattern('/(\\w*)*x/')).toBe('risky')
  })

  test('chuỗi thường có ký tự đặc biệt của regex vẫn là chuỗi thường', () => {
    const [c] = compileHighlightRules([rule('a.b(c)+')])
    expect(highlightLine('xx a.b(c)+ yy', [c!])?.spans).toEqual([{ start: 3, end: 10, color: 'red' }])
    expect(highlightLine('aXb(c)', [c!])).toBeNull()
  })
})

describe('hasNestedQuantifier', () => {
  test('bắt các dạng kinh điển', () => {
    expect(hasNestedQuantifier('(a+)+')).toBe(true)
    expect(hasNestedQuantifier('(\\w*)*')).toBe(true)
    expect(hasNestedQuantifier('(x{2,})+')).toBe(true)
    expect(hasNestedQuantifier('((ab)+)+')).toBe(true)
    expect(hasNestedQuantifier('(?:a+){2,}')).toBe(true)
  })

  test('không bắt nhầm', () => {
    expect(hasNestedQuantifier('(a|b)+')).toBe(false)
    expect(hasNestedQuantifier('(a+)')).toBe(false)
    expect(hasNestedQuantifier('a+b*')).toBe(false)
    // `+` trong lớp ký tự là chữ thường; ngoặc bị escape không phải nhóm
    expect(hasNestedQuantifier('([a+])+')).toBe(false)
    expect(hasNestedQuantifier('\\(a+\\)+')).toBe(false)
    expect(hasNestedQuantifier('(a+){3}')).toBe(false)
  })
})

describe('cleanHighlightRules', () => {
  test('dữ liệu rác → rỗng', () => {
    expect(cleanHighlightRules(null)).toEqual([])
    expect(cleanHighlightRules('x')).toEqual([])
    expect(cleanHighlightRules([1, null, { color: 'red' }])).toEqual([])
  })

  test('chuẩn hoá từng trường, giữ cả mẫu đang gõ dở', () => {
    const out = cleanHighlightRules([{ id: 'a', pattern: '/[', color: 'pink', scope: 'weird', notify: 'yes' }])
    expect(out).toEqual([{ id: 'a', pattern: '/[', color: 'red', scope: 'match', notify: false, enabled: true }])
  })

  test('id trùng hoặc thiếu được làm cho duy nhất', () => {
    const out = cleanHighlightRules([{ id: 'x', pattern: 'a' }, { id: 'x', pattern: 'b' }, { pattern: 'c' }])
    expect(new Set(out.map((r) => r.id)).size).toBe(3)
  })

  test('trần số mẫu', () => {
    const many = Array.from({ length: MAX_HIGHLIGHT_RULES + 5 }, (_, i) => ({ id: `r${i}`, pattern: `p${i}` }))
    expect(cleanHighlightRules(many)).toHaveLength(MAX_HIGHLIGHT_RULES)
  })

  test('mẫu mặc định qua được bước làm sạch y nguyên', () => {
    expect(cleanHighlightRules(DEFAULT_HIGHLIGHT_RULES)).toEqual(DEFAULT_HIGHLIGHT_RULES)
  })
})

describe('compileHighlightRules', () => {
  test('bỏ mẫu tắt và mẫu lỗi', () => {
    const compiled = compileHighlightRules([rule('ok'), rule('/[/'), rule('off', { enabled: false }), rule('/(a+)+/')])
    expect(compiled.map((c) => c.rule.pattern)).toEqual(['ok'])
  })

  test('mẫu mặc định đều biên dịch được', () => {
    expect(compileHighlightRules(DEFAULT_HIGHLIGHT_RULES)).toHaveLength(DEFAULT_HIGHLIGHT_RULES.length)
  })
})

describe('highlightLine', () => {
  test('không khớp → null (đường nhanh)', () => {
    expect(highlightLine('all good', compileHighlightRules([rule('ERROR')]))).toBeNull()
    expect(highlightLine('   ', compileHighlightRules([rule('/\\s/')]))).toBeNull()
  })

  test('chuỗi thường không phân biệt hoa thường, tô mọi chỗ khớp', () => {
    const out = highlightLine('Error: error again', compileHighlightRules([rule('error')]))
    expect(out?.spans).toEqual([
      { start: 0, end: 5, color: 'red' },
      { start: 7, end: 12, color: 'red' }
    ])
  })

  test('regex tôn trọng cờ như user viết', () => {
    expect(highlightLine('Error', compileHighlightRules([rule('/error/')]))).toBeNull()
    expect(highlightLine('Error', compileHighlightRules([rule('/error/i')]))?.spans).toHaveLength(1)
  })

  test('mẫu đứng trước thắng khi hai mẫu chồng nhau', () => {
    const compiled = compileHighlightRules([rule('fatal error', { color: 'purple' }), rule('error', { color: 'red' })])
    const out = highlightLine('fatal error and error', compiled)
    expect(out?.spans).toEqual([
      { start: 0, end: 11, color: 'purple' },
      { start: 16, end: 21, color: 'red' }
    ])
  })

  test('chế độ cả dòng lấy màu của mẫu cả-dòng ĐẦU TIÊN', () => {
    const compiled = compileHighlightRules([
      rule('timeout', { scope: 'line', color: 'yellow' }),
      rule('/\\d+ms/', { scope: 'line', color: 'blue' })
    ])
    expect(highlightLine('timeout after 300ms', compiled)).toEqual({ lineColor: 'yellow', spans: [], triggered: [] })
  })

  test('báo động: mỗi mẫu một lần dù khớp nhiều chỗ, theo thứ tự danh sách', () => {
    const a = rule('oom', { notify: true })
    const b = rule('killed', { notify: true })
    const out = highlightLine('killed: oom oom', compileHighlightRules([a, b, rule('x')]))
    expect(out?.triggered.map((r) => r.pattern)).toEqual(['oom', 'killed'])
  })

  test('mẫu bị mẫu khác che hết vẫn báo động được', () => {
    const out = highlightLine('fatal error', compileHighlightRules([rule('fatal error'), rule('error', { notify: true })]))
    expect(out?.spans).toHaveLength(1)
    expect(out?.triggered.map((r) => r.pattern)).toEqual(['error'])
  })

  test('chỉ khớp trong MAX_MATCH_CHARS ký tự đầu', () => {
    const compiled = compileHighlightRules([rule('needle')])
    expect(highlightLine(`${'x'.repeat(MAX_MATCH_CHARS)}needle`, compiled)).toBeNull()
    expect(highlightLine(`${'x'.repeat(MAX_MATCH_CHARS - 6)}needle`, compiled)?.spans).toHaveLength(1)
  })

  test('trần số đoạn tô trên một dòng', () => {
    const out = highlightLine('a '.repeat(500), compileHighlightRules([rule('a')]))
    expect(out?.spans).toHaveLength(MAX_SPANS_PER_LINE)
  })

  test('biên dịch một lần, dùng nhiều dòng: lastIndex không rò sang dòng sau', () => {
    const compiled = compileHighlightRules([rule('/err/g'), rule('warn', { scope: 'line' })])
    for (let i = 0; i < 3; i++) {
      expect(highlightLine('err', compiled)?.spans).toHaveLength(1)
      expect(highlightLine('warn', compiled)?.lineColor).toBe('red')
    }
  })

  test('mẫu mặc định: bắt lỗi thường gặp, không bắt chữ thường', () => {
    const compiled = compileHighlightRules(DEFAULT_HIGHLIGHT_RULES)
    expect(highlightLine('2026-11-11 [error] upstream timed out', compiled)?.spans[0]?.color).toBe('red')
    expect(highlightLine('java.lang.NullPointerException at Foo', compiled)?.spans[0]?.color).toBe('red')
    expect(highlightLine('Failed to start nginx.service', compiled)?.spans[0]?.color).toBe('red')
    expect(highlightLine('PHP Deprecated: foo()', compiled)?.spans[0]?.color).toBe('yellow')
    expect(highlightLine('terrorist mirrors interrupt', compiled)).toBeNull()
    expect(highlightLine('done in 3s', compiled)).toBeNull()
  })
})

describe('indexCells + spansToSegments', () => {
  test('ASCII một hàng: chỉ số chuỗi = cột', () => {
    const index = indexCells([cells('hello error')])
    expect(index.text).toBe('hello error')
    expect(spansToSegments([{ start: 6, end: 11, color: 'red' }], index)).toEqual([{ row: 0, col: 6, width: 5, color: 'red' }])
  })

  test('ký tự rộng đứng trước: đoạn tô không bị lệch cột', () => {
    // "日本 ERR" — mỗi chữ Hán chiếm 2 ô, ô thứ hai có width 0
    const row: CellLike[] = [
      { chars: '日', width: 2 },
      { chars: '', width: 0 },
      { chars: '本', width: 2 },
      { chars: '', width: 0 },
      ...cells(' ERR')
    ]
    const index = indexCells([row])
    expect(index.text).toBe('日本 ERR')
    expect(spansToSegments([{ start: 3, end: 6, color: 'red' }], index)).toEqual([{ row: 0, col: 5, width: 3, color: 'red' }])
    // Tô chính chữ rộng thì phủ đủ 2 ô
    expect(spansToSegments([{ start: 0, end: 1, color: 'red' }], index)).toEqual([{ row: 0, col: 0, width: 2, color: 'red' }])
  })

  test('dấu kết hợp nằm chung ô với chữ cái', () => {
    const row: CellLike[] = [{ chars: 'e\u0301', width: 1 }, ...cells(' err')]
    const index = indexCells([row])
    expect(index.text).toBe('e\u0301 err')
    expect(spansToSegments([{ start: 3, end: 6, color: 'red' }], index)).toEqual([{ row: 0, col: 2, width: 3, color: 'red' }])
  })

  test('đoạn khớp vắt qua chỗ wrap tách thành 2 đoạn trên 2 hàng', () => {
    // cols = 8: "abc ERRO" | "R done"
    const index = indexCells([cells('abc ERRO'), cells('R done  ')])
    expect(index.text).toBe('abc ERROR done')
    expect(spansToSegments([{ start: 4, end: 9, color: 'yellow' }], index)).toEqual([
      { row: 0, col: 4, width: 4, color: 'yellow' },
      { row: 1, col: 0, width: 1, color: 'yellow' }
    ])
  })

  test('ô trống giữa dòng là khoảng trắng, ô trống cuối dòng bị bỏ', () => {
    const row: CellLike[] = [...cells('a'), { chars: '', width: 1 }, ...cells('b'), { chars: '', width: 1 }, { chars: '', width: 1 }]
    expect(indexCells([row]).text).toBe('a b')
  })

  test('dòng khớp được trên văn bản nối từ nhiều hàng', () => {
    const index = indexCells([cells('Out of me'), cells('mory')])
    expect(highlightLine(index.text, compileHighlightRules([rule('out of memory')]))?.spans).toEqual([
      { start: 0, end: 13, color: 'red' }
    ])
  })
})

describe('highlightColors', () => {
  test('mọi màu, cả hai nền, đều là #RRGGBB (decoration của xterm chỉ nhận dạng này)', () => {
    for (const theme of ['dark', 'light'] as const) {
      for (const color of HIGHLIGHT_COLORS) {
        const c = highlightColors(theme, color)
        for (const v of [c.bg, c.fg, c.lineBg]) expect(v).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})

describe('decideTrigger', () => {
  test('lần đầu báo ngay', () => {
    expect(decideTrigger({ prev: undefined, now: 1000, paneVisible: false })).toEqual({
      notify: true,
      suppressed: 0,
      next: { lastAt: 1000, suppressed: 0 }
    })
  })

  test('trong lúc hạ nhiệt: nuốt và đếm', () => {
    const d = decideTrigger({ prev: { lastAt: 1000, suppressed: 2 }, now: 1000 + TRIGGER_COOLDOWN_MS - 1, paneVisible: false })
    expect(d).toEqual({ notify: false, suppressed: 0, next: { lastAt: 1000, suppressed: 3 }, reason: 'cooldown' })
  })

  test('hết hạ nhiệt: báo, kèm số dòng đã gộp, rồi đếm lại từ 0', () => {
    const d = decideTrigger({ prev: { lastAt: 1000, suppressed: 7 }, now: 1000 + TRIGGER_COOLDOWN_MS, paneVisible: false })
    expect(d).toEqual({ notify: true, suppressed: 7, next: { lastAt: 1000 + TRIGGER_COOLDOWN_MS, suppressed: 0 } })
  })

  test('pane đang hiện: không báo và KHÔNG đụng trạng thái hạ nhiệt', () => {
    const prev = { lastAt: 5, suppressed: 1 }
    expect(decideTrigger({ prev, now: 10, paneVisible: true })).toEqual({ notify: false, suppressed: 0, next: prev, reason: 'pane-visible' })
    expect(decideTrigger({ prev: undefined, now: 10, paneVisible: true }).next).toBeUndefined()
  })
})

describe('triggerExcerpt', () => {
  test('bỏ ký tự điều khiển, gộp khoảng trắng, cắt ngắn', () => {
    expect(triggerExcerpt('  a\tb\u001b[0m  c  ')).toBe('a b [0m c')
    expect(triggerExcerpt('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
