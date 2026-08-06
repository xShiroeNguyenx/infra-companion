/**
 * Máy trạng thái hysteresis dùng chung cho mọi loại cảnh báo ngưỡng.
 *
 * Tách ra từ `AlertEngine` (F04) khi F55 cần đúng logic này cho cảnh báo replication. Nếu để
 * mỗi nơi một bản, hai bộ cảnh báo sẽ trôi lệch nhau về ngữ nghĩa (số mẫu để breach, vùng chết,
 * cooldown nhắc lại) — thứ mà không ai phát hiện ra cho tới lúc một bên spam còn bên kia câm.
 *
 * THUẦN: không I/O, không Date.now() — mốc thời gian do caller truyền vào từ sample nên test
 * hoàn toàn deterministic.
 *
 * Ba vùng thay vì hai, và VÙNG CHẾT là điểm mấu chốt: giá trị dao động sát ngưỡng (89.9 / 90.1
 * / 89.8…) mà chỉ có over/under thì sẽ breach-recover-breach liên tục. Khoảng [T−margin, T)
 * không tính về bên nào, reset cả hai bộ đếm.
 */

export type HysteresisZone = 'over' | 'dead' | 'under'
export type HysteresisOutcome = 'breach' | 'recover' | null

export interface HysteresisState {
  breached: boolean
  overCount: number
  underCount: number
  lastNotifiedAt: number
}

export interface HysteresisOptions {
  /** Số mẫu vượt ngưỡng LIÊN TIẾP mới báo breach. */
  breachSamples: number
  /** Số mẫu dưới (ngưỡng − margin) liên tiếp mới báo recover. */
  recoverSamples: number
  /** Đang breach kéo dài thì nhắc lại sau mỗi khoảng này. */
  realertCooldownMs: number
}

export const newHysteresisState = (): HysteresisState => ({
  breached: false,
  overCount: 0,
  underCount: 0,
  lastNotifiedAt: 0
})

/** Phân vùng cho metric SỐ. Trả 'dead' cho khoảng [threshold − margin, threshold). */
export function numericZone(value: number, threshold: number, margin: number): HysteresisZone {
  if (value >= threshold) return 'over'
  if (value < threshold - margin) return 'under'
  return 'dead'
}

/** Phân vùng cho metric NHỊ PHÂN (offline, thread chết, có lỗi…) — không có vùng chết. */
export const binaryZone = (bad: boolean): HysteresisZone => (bad ? 'over' : 'under')

/**
 * Đưa một mẫu vào máy trạng thái. MUTATE `state` và trả về sự kiện cần phát (nếu có).
 *
 * - `over`  : tăng chuỗi vượt; đủ `breachSamples` → 'breach'. Đang breach mà quá cooldown → 'breach' lần nữa (nhắc lại).
 * - `under` : tăng chuỗi hồi; đang breach và đủ `recoverSamples` → 'recover'.
 * - `dead`  : reset cả hai bộ đếm, KHÔNG đổi cờ breached.
 */
export function feedHysteresis(
  state: HysteresisState,
  zone: HysteresisZone,
  ts: number,
  opts: HysteresisOptions
): HysteresisOutcome {
  if (zone === 'over') {
    state.overCount += 1
    state.underCount = 0
    if (!state.breached && state.overCount >= opts.breachSamples) {
      state.breached = true
      state.lastNotifiedAt = ts
      return 'breach'
    }
    if (state.breached && ts - state.lastNotifiedAt >= opts.realertCooldownMs) {
      state.lastNotifiedAt = ts
      return 'breach'
    }
    return null
  }

  if (zone === 'under') {
    state.underCount += 1
    state.overCount = 0
    if (state.breached && state.underCount >= opts.recoverSamples) {
      state.breached = false
      state.underCount = 0
      return 'recover'
    }
    return null
  }

  // Vùng chết — diệt flapping quanh ngưỡng
  state.overCount = 0
  state.underCount = 0
  return null
}

/** Kho state theo khoá `${đốiTượng}:${metric}`, tự tạo state khi chưa có. */
export class HysteresisStates {
  private readonly states = new Map<string, HysteresisState>()

  get(key: string): HysteresisState {
    let state = this.states.get(key)
    if (!state) {
      state = newHysteresisState()
      this.states.set(key, state)
    }
    return state
  }

  delete(key: string): void {
    this.states.delete(key)
  }

  /** Xoá mọi state của một nhóm khoá — vd bỏ theo dõi cả cụm gồm nhiều slave. */
  deleteByPrefix(prefix: string): void {
    for (const key of [...this.states.keys()]) {
      if (key.startsWith(prefix)) this.states.delete(key)
    }
  }

  clear(): void {
    this.states.clear()
  }
}
