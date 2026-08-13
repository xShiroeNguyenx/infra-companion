import { describe, expect, test } from 'vitest'
import { extractChangelogSection } from './changelog'

const DOC = `# Changelog

Preamble line.

---

## [0.2.6] — 2026-08-13

### Added

- Mục mới nhất.

---

## [0.2.5] — 2026-08-11

### Added

- Mục cũ hơn.

---

## [0.2.4] — 2026-08-06

- Mục cuối file.
`

describe('extractChangelogSection', () => {
  test('lấy đúng thân mục, bỏ heading và đường kẻ ngăn cách', () => {
    expect(extractChangelogSection(DOC, '0.2.6')).toBe('### Added\n\n- Mục mới nhất.')
  })

  test('mục ở giữa không nuốt sang mục sau', () => {
    const body = extractChangelogSection(DOC, '0.2.5')
    expect(body).toBe('### Added\n\n- Mục cũ hơn.')
    expect(body).not.toContain('0.2.4')
  })

  test('mục cuối file (không có heading nào sau) vẫn lấy được', () => {
    expect(extractChangelogSection(DOC, '0.2.4')).toBe('- Mục cuối file.')
  })

  test('preamble trước heading đầu tiên không bị coi là một mục', () => {
    expect(extractChangelogSection(DOC, '0.2.6')).not.toContain('Preamble')
  })

  test('version không có trong file → rỗng', () => {
    expect(extractChangelogSection(DOC, '9.9.9')).toBe('')
  })

  test('so khớp version là CHÍNH XÁC, không phải tiền tố', () => {
    // '0.2' không được khớp nhầm '0.2.6' — nếu khớp tiền tố thì UI sẽ hiện ghi chú của bản khác
    expect(extractChangelogSection(DOC, '0.2')).toBe('')
  })

  test('đầu vào rỗng → rỗng, không ném', () => {
    expect(extractChangelogSection('', '0.2.6')).toBe('')
    expect(extractChangelogSection(DOC, '')).toBe('')
  })

  test('gọi nhiều lần cho cùng kết quả (regex global không giữ lastIndex)', () => {
    const first = extractChangelogSection(DOC, '0.2.5')
    expect(extractChangelogSection(DOC, '0.2.5')).toBe(first)
    expect(extractChangelogSection(DOC, '0.2.5')).toBe(first)
  })
})
