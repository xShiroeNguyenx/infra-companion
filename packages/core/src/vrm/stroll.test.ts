import { describe, expect, it } from 'vitest'
import {
  cleanStrollPace,
  gaitGroundSpeed,
  nextStrollTarget,
  pickStrollTarget,
  stepToward,
  strollFacing,
  strollLegs,
  strollRange,
  strollSpeed,
  STROLL_FALLBACK_SPEED,
  STROLL_PACE,
  STROLL_PACES,
  STROLL_LEGS_MAX,
  STROLL_LEGS_MIN,
  type GaitSample
} from '@infra/shared'

/**
 * Dáng đi giả: người tiến với tốc độ `v`, mỗi bước dài `step`. Chân chạm đất đứng yên trên mặt
 * đất nên so với hông nó lùi đúng `v`; chân kia vung lên trước nhanh gấp đôi và cao hơn.
 */
function syntheticGait(v: number, step: number, n = 60): GaitSample[] {
  const period = (2 * step) / v
  const out: GaitSample[] = []
  for (let i = 0; i <= n; i++) {
    const t = (period * i) / n
    const ph = (t % period) / period // 0..1 cả chu kỳ
    const leftStance = ph < 0.5
    const s = (ph % 0.5) / 0.5 // 0..1 trong nửa chu kỳ
    const stanceZ = step / 2 - s * step // lùi từ +step/2 về -step/2
    const swingZ = -step / 2 + s * step
    const swingY = -0.9 + 0.1 * Math.sin(Math.PI * s)
    out.push({
      t,
      left: { x: 0.1, y: leftStance ? -0.9 : swingY, z: leftStance ? stanceZ : swingZ },
      right: { x: -0.1, y: leftStance ? swingY : -0.9, z: leftStance ? swingZ : stanceZ }
    })
  }
  return out
}

describe('đi dạo — đo tốc độ đi từ bàn chân', () => {
  it('ra đúng tốc độ tiến của người (chân chạm đất lùi bằng tốc độ đó)', () => {
    expect(gaitGroundSpeed(syntheticGait(1.2, 0.6))).toBeCloseTo(1.2, 5)
    expect(gaitGroundSpeed(syntheticGait(0.7, 0.4))).toBeCloseTo(0.7, 5)
  })

  it('không đủ mẫu thì trả 0 để nơi gọi dùng số dự phòng', () => {
    expect(gaitGroundSpeed([])).toBe(0)
    expect(gaitGroundSpeed(syntheticGait(1, 0.5).slice(0, 1))).toBe(0)
  })

  it('số đo vô lý thì dùng tốc độ dự phòng — không đứng im, không vụt qua màn hình', () => {
    expect(strollSpeed(0)).toBe(STROLL_FALLBACK_SPEED)
    expect(strollSpeed(Number.NaN)).toBe(STROLL_FALLBACK_SPEED)
    expect(strollSpeed(40)).toBe(STROLL_FALLBACK_SPEED)
    expect(strollSpeed(1.1)).toBe(1.1)
  })
})

describe('đi dạo — khoảng được đi', () => {
  it('giới hạn theo thân người: lề trong suốt của thẻ được phép tràn ra ngoài cửa sổ', () => {
    // Thẻ 300px ở mép phải, lề trong suốt mỗi bên 80px
    const r = strollRange({ left: 1500, width: 300 }, 1820, 80, 16)
    expect(r.max).toBe(1820 - 16 + 80 - 1800)
    expect(r.min).toBe(16 - 80 - 1500)
  })

  it('cửa sổ hẹp hơn người thì không đi đâu cả, không trả khoảng ngược', () => {
    const r = strollRange({ left: 0, width: 500 }, 300, 0, 16)
    expect(r.min).toBeLessThanOrEqual(0)
    expect(r.max).toBe(0)
  })
})

describe('đi dạo — chọn điểm đến', () => {
  const range = { min: -1000, max: 0 }

  it('luôn cách chỗ hiện tại ít nhất minDist và nằm trong khoảng', () => {
    for (const x of [0, 0.25, 0.5, 0.75, 0.999]) {
      const t = pickStrollTarget(() => x, -300, range, 160)!
      expect(t).not.toBeNull()
      expect(Math.abs(t - -300)).toBeGreaterThanOrEqual(160)
      expect(t).toBeGreaterThanOrEqual(range.min)
      expect(t).toBeLessThanOrEqual(range.max)
    }
  })

  it('không còn chỗ đủ xa thì trả null', () => {
    expect(pickStrollTarget(() => 0.5, -50, { min: -100, max: 0 }, 160)).toBeNull()
  })

  it('đứng ở mép phải thì chỉ có thể đi sang trái', () => {
    for (const x of [0, 0.5, 0.999]) expect(pickStrollTarget(() => x, 0, range)!).toBeLessThan(0)
  })
})

describe('đi dạo — bước và hướng', () => {
  it('tiến đều về đích và dừng đúng đích, không vượt', () => {
    expect(stepToward(0, -100, 50, 1)).toEqual({ offset: -50, arrived: false })
    expect(stepToward(-90, -100, 50, 1)).toEqual({ offset: -100, arrived: true })
  })

  it('đi sang phải thì xoay +90°, sang trái −90°', () => {
    expect(strollFacing(1)).toBeCloseTo(Math.PI / 2)
    expect(strollFacing(-1)).toBeCloseTo(-Math.PI / 2)
  })

  it('số chặng nằm trong khoảng khai báo', () => {
    expect(strollLegs(() => 0)).toBe(STROLL_LEGS_MIN)
    expect(strollLegs(() => 0.9999)).toBe(STROLL_LEGS_MAX)
  })
})

describe('đi dạo — về đúng chỗ cũ', () => {
  const range = { min: -1000, max: 0 }

  it('chặng cuối của lượt luôn về chỗ đứng gốc, kể cả khi chỉ lệch ít', () => {
    expect(nextStrollTarget(() => 0.3, -640, range, 1)).toBe(0)
    expect(nextStrollTarget(() => 0.3, -30, range, 1)).toBe(0)
  })

  it('chưa phải chặng cuối thì đi điểm ngẫu nhiên', () => {
    const t = nextStrollTarget(() => 0.3, -640, range, 3)!
    expect(t).not.toBe(0)
    expect(Math.abs(t + 640)).toBeGreaterThanOrEqual(160)
  })

  it('không còn chỗ đủ xa mà đang lệch thì về gốc; đang ở gốc thì đứng yên', () => {
    expect(nextStrollTarget(() => 0.5, -50, { min: -100, max: 0 }, 3)).toBe(0)
    expect(nextStrollTarget(() => 0.5, 0, { min: -100, max: 0 }, 3)).toBeNull()
  })
})

describe('đi dạo — nhịp đi đã lưu', () => {
  it('chỉ nhận đúng ba nhịp cho chọn, giá trị lạ về mặc định', () => {
    for (const p of STROLL_PACES) expect(cleanStrollPace(p)).toBe(p)
    expect(cleanStrollPace(0.3)).toBe(STROLL_PACE)
    expect(cleanStrollPace('0.55')).toBe(STROLL_PACE)
    expect(cleanStrollPace(undefined)).toBe(STROLL_PACE)
  })

  it('nhịp mặc định là một trong các nhịp cho chọn — dropdown không bao giờ trống', () => {
    expect(STROLL_PACES).toContain(STROLL_PACE)
  })
})
