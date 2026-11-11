import { describe, expect, it } from 'vitest'
import {
  cleanMonitorAutoStart,
  MONITOR_AUTOSTART_MAX,
  monitorAutoStartState,
  resolveMonitorAutoStart
} from '@infra/shared'

describe('cleanMonitorAutoStart', () => {
  it('giữ danh sách id hợp lệ theo đúng thứ tự đã lưu', () => {
    expect(cleanMonitorAutoStart(['h3', 'h1', 'h2'])).toEqual(['h3', 'h1', 'h2'])
  })

  it('bỏ trùng, bỏ chuỗi rỗng và giá trị không phải chuỗi', () => {
    expect(cleanMonitorAutoStart(['h1', '', 'h1', 7, null, { id: 'x' }, 'h2'])).toEqual(['h1', 'h2'])
  })

  it('giá trị rác trong localStorage (không phải mảng) → coi như chưa lưu gì', () => {
    expect(cleanMonitorAutoStart(null)).toEqual([])
    expect(cleanMonitorAutoStart('h1')).toEqual([])
    expect(cleanMonitorAutoStart({ 0: 'h1' })).toEqual([])
  })

  it('chặn ở trần số lượng', () => {
    const many = Array.from({ length: MONITOR_AUTOSTART_MAX + 50 }, (_, i) => `h${i}`)
    expect(cleanMonitorAutoStart(many)).toHaveLength(MONITOR_AUTOSTART_MAX)
  })
})

describe('resolveMonitorAutoStart', () => {
  const hosts = [
    { id: 'h1', label: 'app-01', protocol: 'ssh' },
    { id: 'h2', label: 'app-02', protocol: 'ssh' },
    { id: 'h3', label: 'web-01', protocol: 'rdp' }
  ]

  it('trả host kèm nhãn theo THỨ TỰ đã lưu, không theo thứ tự danh bạ', () => {
    expect(resolveMonitorAutoStart(['h2', 'h1'], hosts)).toEqual({
      start: [
        { id: 'h2', label: 'app-02' },
        { id: 'h1', label: 'app-01' }
      ],
      missing: 0
    })
  })

  it('host đã bị xoá → đếm vào missing để nơi gọi nói ra, không lặng lẽ bỏ qua', () => {
    expect(resolveMonitorAutoStart(['h1', 'gone'], hosts)).toEqual({
      start: [{ id: 'h1', label: 'app-01' }],
      missing: 1
    })
  })

  it('host nay không còn là SSH thì không theo dõi được → cũng là missing', () => {
    expect(resolveMonitorAutoStart(['h3'], hosts)).toEqual({ start: [], missing: 1 })
  })

  it('nhãn lấy từ danh bạ HIỆN TẠI — user đổi tên host thì card mang tên mới', () => {
    const renamed = [{ id: 'h1', label: 'app-09', protocol: 'ssh' }]
    expect(resolveMonitorAutoStart(['h1'], renamed).start).toEqual([{ id: 'h1', label: 'app-09' }])
  })

  it('chưa lưu gì → không có gì để bật', () => {
    expect(resolveMonitorAutoStart([], hosts)).toEqual({ start: [], missing: 0 })
  })
})

describe('monitorAutoStartState', () => {
  it('chưa lưu gì → off, kể cả khi đang theo dõi', () => {
    expect(monitorAutoStartState([], ['h1'])).toBe('off')
  })

  it('đúng tập đang theo dõi → same, thứ tự không quan trọng', () => {
    expect(monitorAutoStartState(['h1', 'h2'], ['h2', 'h1'])).toBe('same')
  })

  it('đã lưu một tập khác (thêm, bớt hoặc đổi host) → different', () => {
    expect(monitorAutoStartState(['h1', 'h2'], ['h1'])).toBe('different')
    expect(monitorAutoStartState(['h1'], ['h1', 'h2'])).toBe('different')
    expect(monitorAutoStartState(['h1', 'h2'], ['h1', 'h3'])).toBe('different')
  })

  it('đã lưu nhưng hiện không theo dõi gì → different (nút không được trông như "đang khớp")', () => {
    expect(monitorAutoStartState(['h1'], [])).toBe('different')
  })
})
