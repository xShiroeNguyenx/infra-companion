/**
 * F70 — thư viện chuyển động `.vrma` tải theo yêu cầu.
 *
 * Cùng lý do với model mẫu (`vrmSample.ts`): 13 file là ~4 MB, không đáng nhét vào bản cài của
 * mọi người khi phần lớn không bật nhân vật. Tải một lần rồi nằm trong `userData`.
 *
 * ⚠️ **Chỉ đưa vào đây clip có giấy phép cho PHÂN PHỐI LẠI.** Bộ "VRMA_MotionPack" chính thức
 * của pixiv **KHÔNG** đủ điều kiện: điều khoản của nó cấm *"distributing these motions or their
 * alterations without permission in a way that can be rigged or extracted"* — đặt file vào repo
 * hay release công khai là đúng hành vi đó. User tự tải về rồi dùng nút "Nạp file .vrma" thì hợp
 * lệ, đó là chuyện giữa họ và pixiv.
 *
 * Clip của **người khác** dưới đây đều là **CC0 1.0** từ ba tác giả trên BOOTH (đã đối chiếu điều
 * khoản ở trang gốc, không chỉ tin nơi phân phối lại). CC0 không bắt ghi công; vẫn ghi vì nó là hồ
 * sơ nguồn gốc.
 *
 * Từ v0.5.0 có thêm clip **riêng của dự án** (`OWN`, tên `pastel-*`): tác giả repo tự làm và tự
 * phát hành, giữ bản quyền. Chúng thay dần clip CC0 — vai nào đã có clip riêng thì clip CC0 của vai
 * đó bị gỡ khỏi danh mục; vai chưa có thì clip CC0 ở lại cho nhân vật khỏi đứng im.
 */

/** Vai trò của clip trong app — quyết định nó tự chạy lúc nào. */
export type VrmMotionRole =
  /** Nền lúc rảnh: nhiều clip **luân phiên** nhau, xem `motionsForRole`. */
  | 'idle'
  /** Khi mở khung chat. */
  | 'chat'
  /** Khi user chạm vào nhân vật. */
  | 'poke'
  /** Khi hệ thống có cảnh báo. */
  | 'alert'
  /** Khi mọi thứ trở lại bình thường. */
  | 'recover'
  /**
   * Khi mở công cụ theo LOẠI VIỆC — xem `VrmActivity` ở `vrmActivity.ts`.
   *
   * `inspect` có từ đầu (so config, replication); năm cái còn lại thêm sau vì 43/45 công cụ mở ra
   * mà nhân vật đứng im — mà "có ai đó ở cạnh trong lúc làm việc" mới là điểm của cả tính năng.
   * Tên trùng khớp `VrmActivity` để một loại việc chỉ có một tên duy nhất trong cả hệ thống.
   */
  | 'inspect'
  | 'bulk'
  | 'transfer'
  | 'logs'
  | 'security'
  | 'monitor'
  /** Không tự chạy — chỉ khi user chọn trong menu 🎬. */
  | 'manual'

export interface VrmMotionClip {
  id: string
  /** Tên hiện trên UI. */
  label: string
  role: VrmMotionRole
  /** Dài bao lâu (giây) — đo từ chính file, dùng để đặt hẹn giờ và hiện trên UI. */
  durationSec: number
  author: string
  license: string
  licenseUrl: string
  /** Trang gốc của tác giả — nguồn đáng tin hơn nơi phân phối lại. */
  sourceUrl: string
  /** Nơi tải. Trỏ vào GitHub Release của chính repo này — xem `RELEASE`. */
  url: string
  /** Dự phòng khi link chính hỏng. */
  mirrors?: readonly string[]
  sha256: string
  sizeBytes: number
  fileName: string
  /**
   * Clip làm nhân vật RỜI khỏi chỗ đứng (đi, chạy, nhảy).
   *
   * App neo nhân vật ở một góc màn hình cố định, nên clip loại này làm nó trôi ra khỏi khung hoặc
   * lún qua mép — đo được: `walk` lún 11 cm, `run-slow` nhấc chân 34 cm. Không bao giờ tự chạy;
   * chỉ user chủ động chọn.
   */
  locomotion?: boolean
}

/**
 * Nơi tải chính: **Release của chính repo này**, cùng lý do như model mẫu (`vrmSample.ts`).
 *
 * Trước đây trỏ thẳng vào `raw.githubusercontent.com` của một repo bên thứ ba. Đó đúng là điều
 * `vrmSample.ts` đã cảnh báo: repo đó đổi tên, xoá file, đổi branch hay chuyển private là **cả 13
 * clip chết ngay** với mọi bản đã cài, mà mình không làm được gì. Giấy phép CC0 cho phép host lại,
 * nên host lại.
 *
 * Tag `vrm-motions-v1` **tách khỏi tag phát hành app**: bộ clip không đổi theo phiên bản app, gắn
 * vào tag app thì mỗi lần phát hành lại phải đính kèm 4 MB đó thêm một lần.
 */
const RELEASE = 'https://github.com/xShiroeNguyenx/infra-companion/releases/download/vrm-motions-v1'

/** Mirror: nguồn cũ, giữ làm dự phòng — `sha256` ghim nên nội dung vẫn được bảo đảm. */
const MIRROR = 'https://raw.githubusercontent.com/SanHsien/voxavatar/main/public/assets/animations'
const CC0 = 'CC0 1.0'
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'
const REROFUMI = { author: 'へすい / rerofumi', sourceUrl: 'https://booth.pm/ja/items/5527394' }
const SASHII = { author: 'sashii', sourceUrl: 'https://booth.pm/ja/items/6412084' }
const SASHII_RT = { author: 'sashii (retarget) · JenJell (gốc)', sourceUrl: 'https://booth.pm/ja/items/7861818' }

/**
 * Clip riêng của dự án: tag `vrm-motions-v2`, KHÔNG có mirror (không tồn tại bản nào ở nơi khác).
 * `vrm-motions-v1` vẫn phải GIỮ: clip CC0 còn lại và mọi bản app ≤ 0.4.12 tải từ đó.
 */
const RELEASE_OWN = 'https://github.com/xShiroeNguyenx/infra-companion/releases/download/vrm-motions-v2'
export const OWN_MOTION_AUTHOR = 'xShiroeNguyenx'
export const OWN_MOTION_LICENSE = 'Giữ bản quyền — chỉ dùng trong Infra Companion'

function ownClip(
  id: string,
  label: string,
  role: VrmMotionRole,
  durationSec: number,
  sha256: string,
  sizeBytes: number
): VrmMotionClip {
  return {
    id,
    label,
    role,
    durationSec,
    author: OWN_MOTION_AUTHOR,
    license: OWN_MOTION_LICENSE,
    licenseUrl: 'https://github.com/xShiroeNguyenx/infra-companion',
    sourceUrl: 'https://github.com/xShiroeNguyenx/infra-companion',
    url: `${RELEASE_OWN}/${id}.vrma`,
    sha256,
    sizeBytes,
    fileName: `${id}.vrma`
  }
}

/** Dựng một mục CC0 cho gọn — cùng nơi host, cùng mirror. */
function clip(
  id: string,
  label: string,
  role: VrmMotionRole,
  durationSec: number,
  sha256: string,
  sizeBytes: number,
  src: { author: string; sourceUrl: string },
  locomotion?: boolean
): VrmMotionClip {
  return {
    id,
    label,
    role,
    durationSec,
    author: src.author,
    license: CC0,
    licenseUrl: CC0_URL,
    sourceUrl: src.sourceUrl,
    url: `${RELEASE}/${id}.vrma`,
    mirrors: [`${MIRROR}/${id}.vrma`],
    sha256,
    sizeBytes,
    fileName: `${id}.vrma`,
    ...(locomotion ? { locomotion: true } : {})
  }
}

/**
 * Thư viện clip. Thời lượng và sha256 **đo từ chính file đã tải**, không chép từ mô tả.
 *
 * Bốn clip cuối là loại di chuyển — xem `locomotion`.
 */
export const VRM_MOTIONS: readonly VrmMotionClip[] = [
  // ── Tự chạy theo trạng thái ────────────────────────────────────────────────
  /**
   * Hai clip idle LUÂN PHIÊN — một tư thế lặp mãi thì 15 phút sau thành tật máy móc.
   *
   * ⚠️ Clip idle phải **vừa khung hình**: đo bề ngang thật thì "máy bay" dang tay rộng **3,55×**
   * thân người lúc đứng, vượt xa lề `WIDTH_MARGIN` (2,2×) nên hai bàn tay bị cắt cụt. Nó nằm ở
   * nhóm chọn tay. "Uống nước" (1,3×) thay chỗ: đủ hẹp, và là cử chỉ đời thường hợp lúc rảnh.
   */
  // Clip riêng (thay 'idle-01' CC0). ⚠️ CHƯA đo bề ngang trên model thật — xem cảnh báo ngay trên.
  ownClip('pastel-idle', 'Đứng thư giãn', 'idle', 15.38, 'f0af4db043c1acc2fd8b182e4efd6afd20e3cfcf44fff9e49b66088e3c4d49f5', 337304),
  // Idle thứ hai để luân phiên (clip riêng, thay 'drink-water' CC0). ⚠️ CHƯA đo bề ngang.
  ownClip('pink-idle', 'Thư giãn', 'idle', 4.96, '2a65ec50aad1813cd34f46efa6c219e48f6c09d467669042c225a3042dcf8e03', 79056),
  // Mở khung chat → gật đầu đón (clip riêng, thay 'speaking-01' CC0)
  ownClip('pastel-agree', 'Gật đầu', 'chat', 4.04, 'abe10c2e8a55c4a3dbb3d644eb03864d64f9b48ec3507bc7418aaacd74db83f5', 109404),
  // Chạm vào người → TẠO DÁNG (CC0). Clip nhảy riêng đã thử ở v0.5.1 nhưng chân không bám đất
  // kể cả khi phát nguyên bản — lỗi nằm trong clip, user gỡ ra để làm lại.
  clip('pose-motion', 'Tạo dáng', 'poke', 20.0, 'e3b06f78b21df2fe1f26d80dd1826fd47941a891d44b46a6197f8a87de05ff2c', 521156, REROFUMI),
  // Có cảnh báo → sợ hãi (clip riêng, thay 'failed-apology' CC0)
  ownClip('pastel-afraid', 'Sợ hãi', 'alert', 2.63, 'ef5e159356576426d67ba43291395cd32e547e41de14fdf2f27016befe9e6d67', 83432),
  // Hết cảnh báo → ăn mừng (clip riêng, thay 'success-cheer' CC0)
  ownClip('pink-celebrate', 'Ăn mừng', 'recover', 4.96, 'aa8b8e5e3c1da7047dde3b662ef73a520a3bde8f6a41de47d78226f4c6d93a30', 79056),
  /**
   * Năm loại việc trước đây KHÔNG có clip nào (nhân vật đứng im khi mở công cụ). Clip riêng, mỗi
   * cái đúng 4,96 giây. `pink-reading` gán cho `logs` chứ không cho `inspect`: nhóm xem log có 5
   * công cụ và chưa có gì, còn `inspect` (2 công cụ) vẫn còn clip CC0 bên dưới chờ thay.
   */
  ownClip('pink-command', 'Ra hiệu chỉ huy', 'bulk', 4.96, '85f0c5262b7f1d072b799555d2f46ff6c83a8ea985d75f33a7edaacb08e32763', 79056),
  ownClip('pink-pickup', 'Nhặt đồ', 'transfer', 4.96, '747c96ac0bcc9c54b6aedd6cd83cd2098a8a637f36bb4f06f7896a58dfbaa496', 79056),
  ownClip('pink-reading', 'Đọc chăm chú', 'logs', 4.96, '29e0e1ffd83a286c55688b21d4babe24bc5c26d44b99ced1e7b1316c7cf79902', 79056),
  ownClip('pink-guard', 'Đứng gác', 'security', 4.96, '0e702500e195884bfc2140331152bcf1ec4629a41c7fcb00d8d123db5b24c26a', 79056),
  ownClip('pink-lookout', 'Nhìn xa', 'monitor', 4.96, '0dc58f3331c305dd3f2e4970cb1c1cc4638e7216a3e88af1f46fc01677a19f41', 79056),
  // Mở công cụ ngồi đọc lâu → nhân vật cũng ngồi xem điện thoại cho hợp cảnh
  clip('review-phone', 'Xem điện thoại', 'inspect', 10.43, '54a37ca48a1d4ffb60cfc539013f59fecd48d93375b2069c6c35b5e9f416b726', 281528, REROFUMI),
  // ── Chỉ chạy khi user chọn ─────────────────────────────────────────────────
  clip('reaction-startle', 'Giật mình', 'manual', 11.43, 'ad2a5118837bfa6789cb89383d4e0bd98bed7685158b692bbfb6662ee42ae6c9', 307340, REROFUMI),
  // Dang tay rộng 3,55× thân người — vượt khung nếu tự chạy, nên chỉ khi user chủ động chọn
  clip('airplane-02', 'Máy bay', 'manual', 7.5, '6a8dd04f6a0b4f071d881df1fce68e116dc4c5c1d651f5a5585a91cfa4037ccd', 235656, SASHII),
  // Bước tại chỗ (hông không dời ngang: đo biên độ x/z = 0) nên không gắn cờ `locomotion`.
  // Đi dạo ưu tiên clip này, 'walk' CC0 bên dưới là dự phòng — xem `STROLL_WALK_CLIPS`.
  ownClip('pastel-walk', 'Bước tại chỗ', 'manual', 2.38, '2669f8202920de057cbb15646bf286fdf94aa3cca168db69230d6aa76e65eeb0', 51960),
  // ── Di chuyển: KHÔNG tự chạy (nhân vật rời khỏi chỗ đứng) ──────────────────
  clip('walk', 'Đi bộ', 'manual', 0.83, '51c4158488a86a6bb99b978fb4d269e1798f9749bceaf0420473bae413fc3271', 66604, SASHII_RT, true),
  clip('run-slow', 'Chạy chậm', 'manual', 0.73, '54fff21bbbbbe6364dc812f39dd849eadb61de3888b556580143d386592d17e5', 48864, SASHII_RT, true),
  clip('exercise-step', 'Bước thể dục', 'manual', 2.33, '62c3f543c0386feadf475d81f5d6a77f7dd21cd638892d1e0fed811cd9dedd5f', 79256, REROFUMI, true),
  clip('airplane-05', 'Máy bay (dài)', 'manual', 43.7, 'efcb583b0548cdf76e4c4a623f10875204dcba8a2d06f978321b5b4d4a1221b8', 1155048, SASHII, true)
]

/** Clip đầu tiên của một vai trò; `null` nếu vai trò đó không có clip nào. */
export function motionForRole(role: VrmMotionRole): VrmMotionClip | null {
  return VRM_MOTIONS.find((m) => m.role === role) ?? null
}

/**
 * Vai trò THẬT SỰ đang dùng của một clip: user gán đè nếu có, không thì lấy mặc định trong danh mục.
 *
 * Một chỗ duy nhất quyết định điều này — `motionsForRole` và UI đều gọi vào đây. Để hai nơi tự
 * đọc `overrides` là chờ chúng lệch nhau, mà lệch ở đây nghĩa là dropdown hiện một đằng còn clip
 * chạy một nẻo.
 */
export function effectiveRole(
  clip: VrmMotionClip,
  overrides?: Record<string, VrmMotionRole>
): VrmMotionRole {
  return overrides?.[clip.id] ?? clip.role
}

/**
 * Tất cả clip của một vai trò — vai trò `idle` có nhiều clip luân phiên.
 *
 * `overrides` là bảng user gán đè (`VrmFolderMotionsDto.builtinRoles`). Không truyền = dùng vai
 * trò mặc định của danh mục.
 */
export function motionsForRole(
  role: VrmMotionRole,
  overrides?: Record<string, VrmMotionRole>
): VrmMotionClip[] {
  return VRM_MOTIONS.filter((m) => effectiveRole(m, overrides) === role)
}

/**
 * Clip kế tiếp cho một vai trò: **xoay vòng, không bốc ngẫu nhiên**.
 *
 * Ngẫu nhiên thì có lúc ra cùng một clip hai ba lần liền, mà ở nhịp 90–180 giây một lần thì user
 * sẽ thấy đúng cái đó lặp lại và nghĩ tính năng hỏng. Xoay vòng thì luôn đổi, và với hai clip
 * là đúng nghĩa "luân phiên".
 *
 * @param lastId clip vừa chạy (`null` nếu chưa chạy lần nào)
 * @param available chỉ xét clip đã tải về máy — chưa tải mà chọn thì không có gì để phát
 */
export function nextMotionForRole(
  role: VrmMotionRole,
  lastId: string | null,
  available: readonly string[],
  overrides?: Record<string, VrmMotionRole>
): VrmMotionClip | null {
  const pool = motionsForRole(role, overrides).filter((m) => available.includes(m.id))
  if (pool.length === 0) return null
  if (pool.length === 1 || lastId === null) return pool[0]!
  const i = pool.findIndex((m) => m.id === lastId)
  // Không thấy clip cũ trong nhóm (vừa đổi vai trò) → bắt đầu lại từ đầu
  return pool[i < 0 ? 0 : (i + 1) % pool.length]!
}

/**
 * ==== Hông của clip: ghim cứng hay cho chuyển động TƯƠNG ĐỐI ====
 *
 * Clip tự chạy được "neo" để nhân vật không đi ra khỏi khung hình hẹp. Bản đầu neo bằng cách ghim
 * cứng hông về chỗ đứng ở MỌI frame. Sai với mọi clip mà hông vốn phải dịch trong khi bàn chân
 * đứng yên — dồn trọng tâm, nhún, bước nhảy: ghim hông thì chính hai bàn chân trượt và bay quanh
 * cái hông bất động. User thấy rõ nhất ở hai clip nhảy ("chân bay lung tung, không chân nào chạm
 * đất"), nhưng `pink-lookout`, `pink-pickup`, `drink-water` cũng trượt chân 13–20 cm vì cùng lý do.
 *
 * Cách đúng: giữ nguyên chuyển động của hông **so với frame đầu của clip**, chỉ bỏ phần lệch tuyệt
 * đối (clip đặt hông ở đâu trong không gian của nó không liên quan tới chỗ nhân vật đang đứng).
 * Bàn chân nhờ vậy đứng đúng chỗ clip muốn.
 *
 * Chỉ ghim cứng khi clip thật sự ĐI XA khỏi chỗ bắt đầu — vượt các ngưỡng dưới đây thì nhân vật ra
 * khỏi khung. Đo trên 19 clip đang dùng: lệch ngang lớn nhất 0,20 m, trước-sau 0,36 m; cả 19 đều
 * dưới ngưỡng.
 */
/** Lệch ngang tối đa so với frame đầu (m). Lề trong suốt mỗi bên thẻ là ~0,6 lần bề ngang thân. */
export const HIPS_FREE_MAX_SIDE_M = 0.3
/** Lệch trước-sau tối đa (m). Rộng hơn chiều ngang: tiến/lùi chỉ làm người to/nhỏ đi một chút. */
export const HIPS_FREE_MAX_DEPTH_M = 0.5

/**
 * `true` = clip đi quá xa, phải ghim cứng hông. `false` = cho hông chuyển động tương đối.
 *
 * Số đo hỏng (NaN, clip không có track vị trí hông) → ghim: đó là hành vi cũ, an toàn với khung hình.
 */
export function shouldPinHips(maxSideM: number, maxDepthM: number): boolean {
  if (!Number.isFinite(maxSideM) || !Number.isFinite(maxDepthM)) return true
  return maxSideM > HIPS_FREE_MAX_SIDE_M || maxDepthM > HIPS_FREE_MAX_DEPTH_M
}

/** Tổng dung lượng phải tải (byte) — hiện trên nút để user biết trước. */
export function motionPackBytes(): number {
  return VRM_MOTIONS.reduce((s, m) => s + m.sizeBytes, 0)
}

/**
 * Khoảng cách giữa hai lần chạy clip idle (ms).
 *
 * Thưa là chủ ý: clip idle chạy thì **tắt toàn bộ lớp tự sinh** (nhìn theo chuột, kéo níu, tay đu
 * theo quán tính), nên để nó chạy liên tục là đánh đổi cả phần tương tác lấy một vòng lặp cố định.
 * Chạy thỉnh thoảng thì được cái hay của cả hai.
 */
export const MOTION_IDLE_EVERY_MIN_MS = 90_000
export const MOTION_IDLE_EVERY_MAX_MS = 180_000

export function motionIdleDelayMs(rng: () => number): number {
  return MOTION_IDLE_EVERY_MIN_MS + rng() * (MOTION_IDLE_EVERY_MAX_MS - MOTION_IDLE_EVERY_MIN_MS)
}
