import { describe, expect, test } from 'vitest'
import { nextDelayMs, pruneHistory, shouldGiveUp } from './backoff'

describe('nextDelayMs', () => {
  test('tăng gấp đôi theo lần thử (jitter=0.5 → đúng giá trị nền)', () => {
    expect(nextDelayMs(0, 0.5)).toBe(500)
    expect(nextDelayMs(1, 0.5)).toBe(1000)
    expect(nextDelayMs(2, 0.5)).toBe(2000)
    expect(nextDelayMs(3, 0.5)).toBe(4000)
  })

  test('chặn trần 30s', () => {
    expect(nextDelayMs(20, 0.5)).toBe(30_000)
    expect(nextDelayMs(100, 1)).toBeLessThanOrEqual(36_000)
  })

  test('jitter ±20% quanh giá trị nền', () => {
    expect(nextDelayMs(1, 0)).toBe(800)
    expect(nextDelayMs(1, 1)).toBe(1200)
  })

  test('jitter ngoài 0..1 bị kẹp, attempt âm coi như 0', () => {
    expect(nextDelayMs(0, -5)).toBe(400)
    expect(nextDelayMs(0, 99)).toBe(600)
    expect(nextDelayMs(-3, 0.5)).toBe(500)
  })
})

describe('shouldGiveUp', () => {
  const now = 1_000_000

  test('dưới ngưỡng thì còn restart', () => {
    expect(shouldGiveUp([now - 1000, now - 2000], now, 5, 60_000)).toBe(false)
  })

  test('đạt ngưỡng trong cửa sổ thì bỏ cuộc (crash loop tệ hơn service chết hẳn)', () => {
    const h = [now - 100, now - 200, now - 300, now - 400, now - 500]
    expect(shouldGiveUp(h, now, 5, 60_000)).toBe(true)
  })

  test('CỬA SỔ TRƯỢT: crash cũ ngoài cửa sổ không tính — service chạy ổn cả ngày rồi crash 1 lần vẫn được restart', () => {
    const old = [now - 600_000, now - 500_000, now - 400_000, now - 300_000, now - 200_000]
    expect(shouldGiveUp(old, now, 5, 60_000)).toBe(false)
    expect(shouldGiveUp([...old, now - 1000], now, 5, 60_000)).toBe(false)
  })

  test('mốc đúng biên cửa sổ vẫn được tính', () => {
    expect(shouldGiveUp([now - 60_000], now, 1, 60_000)).toBe(true)
    expect(shouldGiveUp([now - 60_001], now, 1, 60_000)).toBe(false)
  })

  test('history rỗng', () => {
    expect(shouldGiveUp([], now, 5, 60_000)).toBe(false)
  })
})

describe('pruneHistory', () => {
  const now = 1_000_000

  test('bỏ mốc ngoài cửa sổ để history không phình vô hạn', () => {
    const h = [now - 120_000, now - 30_000, now - 1000]
    expect(pruneHistory(h, now, 60_000)).toEqual([now - 30_000, now - 1000])
  })

  test('giữ nguyên khi mọi mốc còn trong cửa sổ', () => {
    const h = [now - 1000, now - 2000]
    expect(pruneHistory(h, now, 60_000)).toEqual(h)
  })
})
