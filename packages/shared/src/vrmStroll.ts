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
 * KHÔNG có "nhịp đi": clip đi bộ luôn phát đúng tốc độ gốc, và khung trượt theo tốc độ đo từ chính
 * clip (`gaitGroundSpeed`).
 *
 * Tới v0.4.12 có cài đặt Chậm/Vừa/Nhanh (0,55 / 0,7 / 0,9) để hãm clip `walk` CC0 — dáng đi vội,
 * một vòng bước 0,83 giây. Clip `pastel-walk` của dự án (2,38 giây một vòng) đã có nhịp của riêng
 * nó; user yêu cầu bỏ hẳn cài đặt và đi đúng theo clip. Khoá `strollPace` còn sót trong file cấu
 * hình cũ thì bị bỏ qua.
 */

/**
 * Có cảnh báo lúc đang lệch khỏi chỗ gốc → diễn phản ứng xong thì **chạy** về (clip `run-slow`).
 *
 * Về chỗ quen là để lần sau user tìm nhân vật ở đúng chỗ họ đặt — cảnh báo là lúc họ sẽ nhìn
 * sang. Chạy chứ không đi: chậm rãi đi về giữa lúc có sự cố trông như không quan tâm.
 */
export const STROLL_HOME_CLIP = 'run-slow'

/**
 * Clip dùng khi ĐI dạo, theo thứ tự ưu tiên: clip riêng của dự án trước, clip CC0 cũ làm dự phòng.
 *
 * Phải có dự phòng: clip riêng thêm vào ở v0.5.0, người đã tải bộ cũ chưa có nó cho tới khi bấm
 * "tải clip còn thiếu". Chỉ gọi cứng clip mới thì đi dạo của họ tắt im lặng sau khi cập nhật app.
 *
 * Tốc độ trượt trên màn hình đo từ chính clip đang phát (`measureGait`), nên đổi clip không cần
 * chỉnh lại số nào ở đây.
 */
export const STROLL_WALK_CLIPS: readonly string[] = ['pastel-walk', 'walk']

/** Clip đi bộ đầu tiên ĐÃ CÓ trên máy; `null` = chưa có cái nào, không đi dạo được. */
export function strollWalkClip(installed: readonly string[]): string | null {
  return STROLL_WALK_CLIPS.find((id) => installed.includes(id)) ?? null
}

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
 *
 * Đi CHÉO 45°, không đi ngang (từ v0.5.0, user yêu cầu): chặng đi ra thì tiến chéo VỀ PHÍA NGƯỜI
 * XEM — mặt hướng ra, người to dần; chặng về thì quay lưng đi chéo vào trong — nhỏ dần về cỡ cũ.
 * Đi ngang 90° chỉ cho thấy một nửa mặt và thân dẹt như tờ giấy.
 *
 * @param dir hướng trượt trên màn hình: 1 = sang phải, −1 = sang trái
 * @param approaching `true` = đang tiến lại gần người xem (rời chỗ đứng gốc)
 */
export const STROLL_DIAGONAL_RAD = Math.PI / 4

export function strollFacing(dir: 1 | -1, approaching = true): number {
  return dir * (approaching ? STROLL_DIAGONAL_RAD : Math.PI - STROLL_DIAGONAL_RAD)
}

/**
 * ==== Chiều sâu của đường đi chéo ====
 *
 * Khung nhân vật là một thẻ 2D, không có trục Z thật — "lại gần" được diễn bằng cách PHÓNG TO thẻ
 * (thuộc tính CSS `scale`, neo ở bàn chân) cùng lúc trượt ngang. Đi chéo 45° thì quãng tiến về
 * phía trước bằng quãng trượt ngang, và phép chiếu phối cảnh cho độ phóng `D / (D − z)` với `D` là
 * khoảng cách camera giả định.
 *
 * Chỗ đứng gốc là điểm XA nhất (cỡ 1): nhân vật neo sát đáy cửa sổ, lùi ra xa hơn nữa thì bàn chân
 * phải dâng lên giữa màn hình, còn tiến lại gần thì chỉ cần to ra tại chỗ.
 */
export const STROLL_CAMERA_M = 4
/** Trần độ phóng: CSS `scale` chỉ kéo giãn ảnh canvas đã vẽ, quá mức này là thấy nhoè. */
export const STROLL_MAX_SCALE = 1.4

/** Độ phóng của thẻ khi đã trượt `offsetPx` khỏi chỗ gốc. Luôn trong `[1, maxScale]`. */
export function strollDepthScale(offsetPx: number, pxPerMeter: number, maxScale = STROLL_MAX_SCALE): number {
  if (!(pxPerMeter > 0) || !Number.isFinite(offsetPx)) return 1
  const z = (Math.abs(offsetPx) / pxPerMeter) * Math.tan(STROLL_DIAGONAL_RAD)
  if (z >= STROLL_CAMERA_M) return Math.max(1, maxScale)
  return Math.min(Math.max(1, maxScale), Math.max(1, STROLL_CAMERA_M / (STROLL_CAMERA_M - z)))
}

/**
 * Trượt xa nhất được bao nhiêu (px) trước khi độ phóng chạm trần.
 *
 * Đích phải nằm TRONG khoảng này: đi quá thì độ phóng đứng yên ở trần trong khi người vẫn trượt,
 * tức là đoạn cuối lại thành đi ngang với cái mặt quay chéo.
 */
export function strollMaxOffset(pxPerMeter: number, maxScale = STROLL_MAX_SCALE): number {
  if (!(pxPerMeter > 0) || !(maxScale > 1)) return 0
  return (STROLL_CAMERA_M * (1 - 1 / maxScale) * pxPerMeter) / Math.tan(STROLL_DIAGONAL_RAD)
}

/** Một lượt đi chéo luôn là 2 chặng: đi ra (to dần) rồi về chỗ gốc (nhỏ dần). */
export const STROLL_DIAGONAL_LEGS = 2

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

/**
 * Dáng đi: chỉnh clip `walk` LÚC CHẠY, không tạo file clip mới.
 *
 * Clip CC0 duy nhất có dáng đi là dáng sải bước dứt khoát — hợp nhân vật nam, nhưng với nhân vật
 * nữ thì thô: tay vung rộng và cứng, đầu nảy theo từng bước. Sửa ở lúc chạy thay vì xuất file mới
 * vì chỉnh được ngay bằng một con số, áp cho mọi model, và không phải lo giấy phép phát hành lại.
 *
 * VRM không khai giới tính nhân vật, nên đây là lựa chọn của user chứ không tự đoán.
 */
export type WalkStyle = 'natural' | 'graceful'
/**
 * ⚠️ Từ v0.5.0 **không còn cài đặt dáng đi**: đi dạo luôn phát nguyên clip (`natural`).
 *
 * `graceful` sinh ra để làm dịu clip `walk` CC0 — dáng sải bước thể thao, khuỷu gập sẵn ~43°. Nay
 * đi dạo dùng clip `pastel-walk` của chính dự án, vốn đã là dáng đi của nhân vật; user xem rồi yêu
 * cầu bỏ hẳn lựa chọn, chỉ giữ một kiểu. Khoá `walkStyle` còn sót trong file cấu hình cũ bị bỏ qua.
 *
 * Bảng số `WALK_STYLES` và phần áp nó trong `vrmStage.ts` (`playAnimation({ style })`) VẪN CÒN
 * nhưng không nơi nào gọi tới: gỡ chúng là sửa đường đo bước chân của sân khấu mà không nhìn được
 * kết quả. Muốn dọn thì dọn cùng một lượt có thử GUI.
 */

export interface WalkStyleSpec {
  /**
   * Hệ số biên độ của từng xương **quanh tư thế trung bình của cả vòng bước**: `< 1` là dịu lại,
   * `> 1` là rõ hơn. Tính quanh trung bình (không quanh 0) nên tư thế nền của clip giữ nguyên,
   * chỉ độ vung đổi — tay vẫn buông xuôi, chỉ vung hẹp hơn.
   */
  amplitude: Readonly<Record<string, number>>
  /** Hệ số độ nảy lên xuống của hông mỗi bước. */
  bob: number
  /** Khép cánh tay vào sát thân (độ, quanh trục trước-sau). */
  armInDeg: number
  /**
   * Đổi độ gập khuỷu (độ, cộng vào góc của clip): âm = DUỖI ra.
   *
   * Clip gốc gập khuỷu sẵn ~43° (dáng sải bước thể thao) — đo được. Bản đầu cộng thêm 14° vì
   * tưởng tay "duỗi thẳng tưng", kết quả tay gập lên ngang hông, trông gồng chứ không thả lỏng.
   * Tay thả lỏng khi đi là gần duỗi, khuỷu chỉ chùng nhẹ.
   */
  elbowDeg: number
  /** Khuỷu không duỗi quá góc này (độ) — duỗi thẳng 0° là khoá khớp, cũng cứng. */
  elbowMinDeg: number
  /**
   * Làm mượt phần thân trên theo thời gian (ms, hằng số thời gian lọc thấp). Không lọc chân: chân
   * trễ nhịp là bàn chân trượt khỏi chỗ chạm đất.
   */
  smoothMs: number
}

/**
 * Xương CHÂN được co biên độ: bước ngắn lại. Không lọc theo thời gian (xem `smoothMs`), và tốc độ
 * trượt phải đo lại SAU khi co — sải ngắn hơn mà khung vẫn trượt theo sải cũ là chân trượt.
 */
export const WALK_LEG_BONES: readonly string[] = [
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot'
]

/**
 * `natural` = clip gốc, không chỉnh. `graceful` = mềm mại, thướt tha:
 * - tay vung vừa (~55%), khuỷu duỗi ra còn chùng nhẹ, cánh tay khép vào thân → tay thả lỏng;
 * - bước ngắn lại (chân 0,85×), hông lắc rõ hơn (1,2×) → dáng uyển chuyển;
 * - cổ/đầu giữ yên (0,35–0,45×), hông bớt nảy (0,65×) → bước êm, không nhún nhảy.
 *
 * Số đã chỉnh theo ảnh chụp + số đo trên model thật (harness), không phải đoán.
 */
export const WALK_STYLES: Readonly<Record<WalkStyle, WalkStyleSpec | null>> = {
  natural: null,
  graceful: {
    amplitude: {
      hips: 1.2,
      spine: 0.8,
      chest: 0.7,
      upperChest: 0.7,
      neck: 0.45,
      head: 0.35,
      leftShoulder: 0.6,
      rightShoulder: 0.6,
      leftUpperArm: 0.55,
      rightUpperArm: 0.55,
      leftLowerArm: 0.6,
      rightLowerArm: 0.6,
      leftHand: 0.6,
      rightHand: 0.6,
      leftUpperLeg: 0.85,
      rightUpperLeg: 0.85,
      leftLowerLeg: 0.85,
      rightLowerLeg: 0.85,
      leftFoot: 0.9,
      rightFoot: 0.9
    },
    bob: 0.65,
    armInDeg: 5,
    elbowDeg: -18,
    elbowMinDeg: 12,
    smoothMs: 70
  }
}


/** Hệ số lọc thấp cho một frame dài `dtSec` với hằng số thời gian `tauMs` (0 = không lọc). */
export function smoothFactor(dtSec: number, tauMs: number): number {
  if (!(tauMs > 0)) return 1
  return 1 - Math.exp(-(dtSec * 1000) / tauMs)
}
