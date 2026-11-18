import { describe, expect, it } from 'vitest'
import {
  strollWalkClip,
  STROLL_WALK_CLIPS,
  VRM_MOTIONS,
  smoothFactor,
  WALK_LEG_BONES,
  WALK_STYLES,
  gaitGroundSpeed,
  nextStrollTarget,
  pickStrollTarget,
  stepToward,
  strollFacing,
  strollDepthScale,
  strollMaxOffset,
  STROLL_MAX_SCALE,
  strollLegs,
  strollRange,
  strollSpeed,
  STROLL_FALLBACK_SPEED,
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

  it('đi ra: mặt hướng chéo 45° về phía người xem, đúng bên đang trượt tới', () => {
    expect(strollFacing(1, true)).toBeCloseTo(Math.PI / 4)
    expect(strollFacing(-1, true)).toBeCloseTo(-Math.PI / 4)
  })

  it('đi về: quay LƯNG chéo 135° — không đi giật lùi', () => {
    expect(strollFacing(1, false)).toBeCloseTo((3 * Math.PI) / 4)
    expect(strollFacing(-1, false)).toBeCloseTo((-3 * Math.PI) / 4)
  })

  it('càng xa chỗ gốc càng to, hai bên như nhau, ở gốc đúng cỡ 1', () => {
    expect(strollDepthScale(0, 250)).toBe(1)
    const near = strollDepthScale(100, 250)
    const far = strollDepthScale(200, 250)
    expect(near).toBeGreaterThan(1)
    expect(far).toBeGreaterThan(near)
    expect(strollDepthScale(-200, 250)).toBeCloseTo(far, 9)
  })

  it('độ phóng có trần, kể cả khi trượt quá cả khoảng cách camera', () => {
    expect(strollDepthScale(99_999, 250)).toBe(STROLL_MAX_SCALE)
    expect(strollDepthScale(99_999, 250, 1.2)).toBe(1.2)
  })

  it('số đo hỏng thì không phóng — thẻ không nhảy cỡ', () => {
    expect(strollDepthScale(100, 0)).toBe(1)
    expect(strollDepthScale(Number.NaN, 250)).toBe(1)
  })

  it('quãng trượt xa nhất là đúng chỗ độ phóng chạm trần', () => {
    const max = strollMaxOffset(250)
    expect(max).toBeGreaterThan(0)
    expect(strollDepthScale(max, 250)).toBeCloseTo(STROLL_MAX_SCALE, 6)
    expect(strollDepthScale(max * 0.5, 250)).toBeLessThan(STROLL_MAX_SCALE)
    expect(strollMaxOffset(0)).toBe(0)
    expect(strollMaxOffset(250, 1)).toBe(0)
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


describe('dáng đi', () => {
  it('dáng gốc không chỉnh gì; dáng mềm mại có cấu hình', () => {
    expect(WALK_STYLES.natural).toBeNull()
    expect(WALK_STYLES.graceful).not.toBeNull()
  })

  it('mềm mại = tay vung hẹp lại, đầu giữ yên, hông lắc rõ hơn, bớt nảy', () => {
    const g = WALK_STYLES.graceful!
    for (const b of ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'head', 'neck']) {
      expect(g.amplitude[b]).toBeGreaterThan(0)
      expect(g.amplitude[b]).toBeLessThan(1)
    }
    // Hai tay đối xứng — lệch nhau là một bên vung khác bên kia
    expect(g.amplitude.leftUpperArm).toBe(g.amplitude.rightUpperArm)
    expect(g.amplitude.leftLowerArm).toBe(g.amplitude.rightLowerArm)
    expect(g.amplitude.hips).toBeGreaterThan(1)
    expect(g.bob).toBeLessThan(1)
  })

  it('bước ngắn lại vừa phải và hai chân đối xứng — co quá là đi lết', () => {
    const g = WALK_STYLES.graceful!
    for (const k of WALK_LEG_BONES) {
      expect(g.amplitude[k]).toBeGreaterThanOrEqual(0.8)
      expect(g.amplitude[k]).toBeLessThanOrEqual(1)
      expect(g.amplitude[k]).toBe(g.amplitude[k.replace(/^left|^right/, (m) => (m === 'left' ? 'right' : 'left'))])
    }
  })

  it('khuỷu DUỖI ra (clip gốc đã gập ~43°) nhưng không duỗi thẳng tưng', () => {
    const g = WALK_STYLES.graceful!
    expect(g.elbowDeg).toBeLessThan(0)
    expect(g.elbowMinDeg).toBeGreaterThan(0)
  })

  it('hệ số lọc thấp: 0 ms là không lọc, frame càng dài càng theo kịp', () => {
    expect(smoothFactor(1 / 30, 0)).toBe(1)
    const a = smoothFactor(1 / 60, 70)
    const b = smoothFactor(1 / 30, 70)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThan(1)
  })
})

describe('chọn clip đi bộ cho đi dạo', () => {
  it('ưu tiên clip riêng của dự án khi đã có trên máy', () => {
    expect(strollWalkClip(['walk', 'pastel-walk', 'idle-x'])).toBe('pastel-walk')
  })

  it('chưa tải clip riêng thì vẫn đi bằng clip cũ — cập nhật app không được làm tắt đi dạo', () => {
    expect(strollWalkClip(['walk', 'drink-water'])).toBe('walk')
  })

  it('không có clip đi bộ nào → null, không đi dạo', () => {
    expect(strollWalkClip([])).toBeNull()
    expect(strollWalkClip(['drink-water'])).toBeNull()
  })

  it('mọi id trong danh sách đều có thật trong danh mục', () => {
    // Gõ sai một id là nhánh đó im lặng không bao giờ khớp
    for (const id of STROLL_WALK_CLIPS) expect(VRM_MOTIONS.some((c) => c.id === id), id).toBe(true)
  })
})
