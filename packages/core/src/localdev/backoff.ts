/**
 * Backoff cho auto-restart service đã crash. Thuần → test trực tiếp.
 *
 * Vì sao cần giới hạn: crash loop 500 lần/phút còn TỆ HƠN một service chết hẳn (ngốn CPU,
 * spam log, che mất lỗi gốc). Quá ngưỡng thì đứng ở 'crashed' và để user bấm "Thử lại".
 */

export const DEFAULT_MAX_RESTARTS = 5
export const DEFAULT_RESTART_WINDOW_MS = 60_000

/**
 * Delay trước lần restart thứ `attempt` (attempt bắt đầu từ 0): 500ms, 1s, 2s, 4s… trần `max`.
 * `jitter` (0..1) do caller cấp (Math.random ở chỗ gọi) để hàm này THUẦN, test được.
 */
export function nextDelayMs(attempt: number, jitter = 0.5, base = 500, max = 30_000): number {
  const n = Math.max(0, Math.floor(attempt))
  const raw = Math.min(max, base * 2 ** n)
  // ±20% quanh giá trị nền — tránh nhiều service cùng restart đúng một nhịp
  const factor = 0.8 + 0.4 * Math.min(1, Math.max(0, jitter))
  return Math.round(raw * factor)
}

/**
 * Đã restart quá nhiều trong cửa sổ thời gian chưa? `history` = timestamp các lần restart.
 * So sánh theo cửa sổ trượt nên service chạy ổn định vài giờ rồi crash 1 lần vẫn được restart.
 */
export function shouldGiveUp(
  history: readonly number[],
  now: number,
  maxRestarts = DEFAULT_MAX_RESTARTS,
  windowMs = DEFAULT_RESTART_WINDOW_MS
): boolean {
  const from = now - windowMs
  let count = 0
  for (const ts of history) if (ts >= from) count++
  return count >= maxRestarts
}

/** Bỏ các mốc đã ra khỏi cửa sổ (giữ history không phình vô hạn). */
export function pruneHistory(history: readonly number[], now: number, windowMs = DEFAULT_RESTART_WINDOW_MS): number[] {
  const from = now - windowMs
  return history.filter((ts) => ts >= from)
}
