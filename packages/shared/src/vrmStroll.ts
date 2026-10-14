/**
 * Nhân vật đi dạo qua lại trong lúc rảnh — phần TÍNH TOÁN, không đụng DOM hay three.js.
 *
 * Cách làm là "cách A": clip `walk` chạy **tại chỗ** (neo hông), còn cả khung nhân vật trượt
 * ngang bằng CSS `translate`. Không mở canvas rộng ra: số pixel phải vẽ giữ nguyên như lúc đứng,
 * và trượt bằng `translate` chỉ là việc của compositor, không tính lại layout.
 *
 * Thứ quyết định trông có tự nhiên hay không là **tốc độ trượt khớp với bước chân** — lệch là chân
 * trượt như đi trên băng. Tốc độ đó không đoán, mà đo từ chính clip: xem `gaitGroundSpeed`.
 */

/** Một mẫu tư thế: vị trí hai bàn chân **so với hông**, trong khung model (mét). */
export interface GaitSample {
  /** Giây, tính từ đầu clip. */
  t: number
  left: { x: number; y: number; z: number }
  right: { x: number; y: number; z: number }
}

/**
 * Tốc độ đi trên mặt đất (m/s) suy từ chuyển động của bàn chân trong clip.
 *
 * Bàn chân đang **chạm đất** thì đứng yên so với mặt đất, nên so với hông nó lùi về sau đúng bằng
 * tốc độ người tiến lên. Đo vận tốc của bàn chân THẤP hơn giữa hai mẫu liên tiếp là ra tốc độ đi,
 * kể cả khi clip đã bị tác giả "đi tại chỗ" (bỏ dịch chuyển gốc) — trường hợp mà đọc track vị trí
 * hông sẽ ra 0.
 *
 * Lấy **trung vị** chứ không trung bình: lúc đổi chân, bàn chân thấp hơn có thể là chân vừa nhấc
 * khỏi đất, vận tốc ở mẫu đó vọt lên. Vài mẫu như vậy kéo trung bình đi xa, trung vị thì không.
 *
 * Trả `0` khi không đủ mẫu — nơi gọi tự chọn số dự phòng.
 */
export function gaitGroundSpeed(samples: readonly GaitSample[]): number {
  const speeds: number[] = []
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i]!
    const b = samples[i + 1]!
    const dt = b.t - a.t
    if (!(dt > 0)) continue
    // Chân chạm đất = chân thấp hơn ở CẢ hai mẫu; đổi chân giữa hai mẫu thì bỏ cặp đó
    const leftDown = a.left.y <= a.right.y
    if (leftDown !== b.left.y <= b.right.y) continue
    const p = leftDown ? a.left : a.right
    const q = leftDown ? b.left : b.right
    speeds.push(Math.hypot(q.x - p.x, q.z - p.z) / dt)
  }
  if (speeds.length === 0) return 0
  speeds.sort((x, y) => x - y)
  const mid = speeds.length >> 1
  return speeds.length % 2 ? speeds[mid]! : (speeds[mid - 1]! + speeds[mid]!) / 2
}

/**
 * Tốc độ dùng thật: số đo được nếu hợp lý, không thì số dự phòng.
 *
 * Kẹp vào khoảng người đi bộ: clip lạ (đi tại chỗ mà chân không lùi, hoặc track hỏng) có thể ra 0
 * hay vài chục m/s, mà trượt khung theo số đó là nhân vật đứng im hoặc vụt qua màn hình.
 */
export const STROLL_FALLBACK_SPEED = 0.8
export const STROLL_MIN_SPEED = 0.3
export const STROLL_MAX_SPEED = 2

export function strollSpeed(measured: number): number {
  if (!Number.isFinite(measured) || measured < STROLL_MIN_SPEED || measured > STROLL_MAX_SPEED) {
    return STROLL_FALLBACK_SPEED
  }
  return measured
}

/**
 * Khoảng được phép trượt (px, tính từ chỗ đứng gốc), `min ≤ 0 ≤ max`.
 *
 * Giới hạn theo **thân người**, không theo mép thẻ: thẻ rộng hơn người (lề trong suốt cho clip
 * giang tay), dùng mép thẻ thì nhân vật dừng khi người còn cách mép cửa sổ cả trăm pixel.
 *
 * @param home vị trí thẻ lúc offset = 0
 * @param sideMargin lề trong suốt mỗi bên thẻ (`vrmSideMargin`)
 * @param gap khoảng chừa giữa thân người và mép cửa sổ
 */
export function strollRange(
  home: { left: number; width: number },
  viewportWidth: number,
  sideMargin: number,
  gap = 16
): { min: number; max: number } {
  const min = gap - sideMargin - home.left
  const max = viewportWidth - gap + sideMargin - (home.left + home.width)
  // Cửa sổ hẹp hơn người thì không có chỗ đi — đứng yên, đừng trả khoảng ngược
  return { min: Math.min(0, min), max: Math.max(0, max) }
}

/**
 * Điểm đến kế tiếp, hoặc `null` nếu không còn chỗ nào đủ xa để đáng đi.
 *
 * Bước quá ngắn (vài chục pixel) trông như giật cục chứ không phải đi dạo, nên điểm đến luôn cách
 * chỗ hiện tại ít nhất `minDist`.
 */
export function pickStrollTarget(
  rng: () => number,
  current: number,
  range: { min: number; max: number },
  minDist = 160
): number | null {
  const leftRoom = current - minDist - range.min
  const rightRoom = range.max - (current + minDist)
  const total = Math.max(0, leftRoom) + Math.max(0, rightRoom)
  if (total <= 0) return null
  const r = rng() * total
  return r < Math.max(0, leftRoom) ? range.min + r : current + minDist + (r - Math.max(0, leftRoom))
}

/**
 * Nhịp đi so với clip gốc: clip phát chậm lại bằng tỉ lệ này VÀ khung trượt chậm đúng tỉ lệ đó.
 *
 * Phải giảm cả hai cùng lúc: chỉ giảm tốc độ trượt thì chân bước nhanh mà người tiến chậm — lại
 * thành trượt chân, chỉ là ngược chiều. Clip gốc là dáng đi vội (~1 bước/0,4 giây), user muốn
 * "thong thả hơn".
 */
export const STROLL_PACE = 0.7

/** Ba nhịp user chọn trong cài đặt. Rời rạc chứ không thanh trượt liền: khác nhau 0,05 thì mắt không phân biệt nổi. */
export const STROLL_PACES = [0.55, 0.7, 0.9] as const

/** Đọc nhịp đã lưu: chỉ nhận đúng một trong `STROLL_PACES`, còn lại về mặc định. */
export function cleanStrollPace(v: unknown): number {
  return STROLL_PACES.find((p) => p === v) ?? STROLL_PACE
}

/**
 * Có cảnh báo lúc đang lệch khỏi chỗ gốc → diễn phản ứng xong thì **chạy** về (clip `run-slow`).
 *
 * Về chỗ quen là để lần sau user tìm nhân vật ở đúng chỗ họ đặt — cảnh báo là lúc họ sẽ nhìn
 * sang. Chạy chứ không đi: chậm rãi đi về giữa lúc có sự cố trông như không quan tâm.
 */
export const STROLL_HOME_CLIP = 'run-slow'

/**
 * Điểm đến của chặng kế tiếp: chặng CUỐI của một lượt luôn là **chỗ đứng gốc** (offset 0).
 *
 * Không có luật này thì lượt đi dạo kết thúc ở một điểm ngẫu nhiên, và nhân vật cứ thế đứng lệch
 * khỏi chỗ user đã đặt nó. Về gốc không cần cách xa `minDist` — lệch 30px cũng phải về.
 *
 * Trả `null` = không có chặng nào để đi (đã ở gốc và không còn chỗ đủ xa).
 */
export function nextStrollTarget(
  rng: () => number,
  current: number,
  range: { min: number; max: number },
  legsLeft: number,
  minDist = 160
): number | null {
  const away = Math.abs(current) >= 1
  if (legsLeft <= 1 && away) return 0
  return pickStrollTarget(rng, current, range, minDist) ?? (away ? 0 : null)
}

/** Tiến về đích với tốc độ `speed` (px/s); không vượt quá đích. */
export function stepToward(
  current: number,
  target: number,
  speed: number,
  dtSec: number
): { offset: number; arrived: boolean } {
  const d = target - current
  const step = speed * dtSec
  if (Math.abs(d) <= step) return { offset: target, arrived: true }
  return { offset: current + Math.sign(d) * step, arrived: false }
}

/**
 * Góc xoay (radian) để nhân vật nhìn theo hướng đi.
 *
 * Ở góc 0 model nhìn về +Z (thẳng ra camera); xoay `+π/2` quanh trục đứng đưa +Z sang +X, tức
 * bên PHẢI màn hình.
 */
export function strollFacing(dir: 1 | -1): number {
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2
}

/** Phải rảnh bao lâu (không gõ phím, không di chuột) mới bắt đầu đi. */
export const STROLL_IDLE_AFTER_MS = 30_000
/** Một lượt đi dạo gồm mấy chặng trước khi nghỉ dài. */
export const STROLL_LEGS_MIN = 2
export const STROLL_LEGS_MAX = 4

/** Dừng giữa hai chặng: đứng lại, quay ra nhìn, rồi mới đi tiếp. */
export function strollPauseMs(rng: () => number): number {
  return 3_000 + rng() * 6_000
}

/**
 * Nghỉ dài sau một lượt đi dạo.
 *
 * Đi liên tục suốt lúc rảnh thì vừa tốn pin vừa thành một thứ chuyển động không ngừng ở rìa mắt.
 * Thỉnh thoảng mới đi thì mới giống "đang sống" chứ không giống màn hình chờ.
 */
export function strollRestMs(rng: () => number): number {
  return 60_000 + rng() * 120_000
}

/** Số chặng của một lượt. */
export function strollLegs(rng: () => number): number {
  return STROLL_LEGS_MIN + Math.floor(rng() * (STROLL_LEGS_MAX - STROLL_LEGS_MIN + 1))
}
