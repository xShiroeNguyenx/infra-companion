/**
 * F70 — nhân vật VRM: DTO giữa main và renderer.
 *
 * Mức 1 (mức đang làm): user tự chọn file `.vrm` trong máy, app nạp lên và hiển thị.
 * App **không tải model từ mạng** và **không copy file vào `userData`** — khác hẳn cách làm
 * của font tự thêm. Hai lý do: một model thật là 40–60 MB nên nhân bản là vô ích, và file
 * vẫn thuộc quyền quản lý của user (họ xoá/đổi chỗ thì app báo mất, không giữ bản sao ngầm).
 */

import type { VrmMeta, VrmSpec } from './vrmTypes'

/** Trần dung lượng một model. Model VRM thật thường 15–60 MB; hơn 200 MB là bất thường. */
export const VRM_MAX_BYTES = 200 * 1024 * 1024

/** Số model tối đa trong danh sách — đây là danh bạ đường dẫn, không phải kho file. */
export const VRM_MAX_MODELS = 12

export interface VrmModelDto {
  id: string
  /** Đường dẫn tuyệt đối tới file trong máy user. */
  path: string
  /** Tên hiện trên UI: lấy từ meta trong file, không có thì lấy tên file. */
  label: string
  spec: VrmSpec
  meta: VrmMeta
  sizeBytes: number
  addedAt: number
  /**
   * File còn ở chỗ cũ không (kiểm lúc trả danh sách). File biến mất là chuyện thường —
   * user dọn ổ đĩa — nên phải nói rõ trên UI thay vì để việc nạp thất bại lúc bấm.
   */
  missing: boolean
}

export type VrmPickResult =
  | { ok: true; model: VrmModelDto }
  | { ok: false; reason: 'canceled' | 'tooLarge' | 'notVrm' | 'badFile' | 'full' | 'io'; detail?: string }

export type VrmReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'missing' | 'tooLarge' | 'io'; detail?: string }

/** Trần cho file animation `.vrma` — chỉ là dữ liệu xương, vài trăm KB là cùng. */
export const VRMA_MAX_BYTES = 32 * 1024 * 1024

export type VrmAnimationPickResult =
  | { ok: true; name: string; bytes: Uint8Array }
  | { ok: false; reason: 'canceled' | 'tooLarge' | 'io'; detail?: string }

/**
 * Trần số file khi nạp CẢ THƯ MỤC.
 *
 * Người ta trỏ nhầm vào `D:\` hay thư mục Downloads là chuyện thường; không có trần thì app
 * ngồi đọc hàng nghìn file vào RAM. Bộ `.vrma` thật chỉ vài chục file là cùng.
 */
export const VRMA_DIR_MAX_FILES = 60

/** Một clip đọc được từ thư mục user chọn — chưa nạp vào sân khấu, chỉ để hiện ra cho chọn. */
export interface VrmAnimationFile {
  /** Tên file kèm đuôi, dùng làm nhãn trên UI. */
  name: string
  bytes: Uint8Array
}

/**
 * Kết quả nạp cả thư mục `.vrma`.
 *
 * `empty` tách riêng khỏi `io`: trỏ vào thư mục không có clip nào là **thao tác đúng cú pháp
 * nhưng sai chỗ**, và câu trả lời hữu ích là "thư mục này không có file .vrma nào" chứ không
 * phải một lỗi đọc đĩa.
 *
 * `skipped` = file `.vrma` bị bỏ vì quá lớn hoặc đọc hỏng. Báo ra chứ không nuốt: nạp 7 file mà
 * chỉ thấy 6 thì user cần biết vì sao, không thì tưởng app đếm sai.
 */
export type VrmAnimationDirResult =
  | { ok: true; dir: string; files: VrmAnimationFile[]; skipped: string[]; truncated: boolean }
  | { ok: false; reason: 'canceled' | 'empty' | 'io'; detail?: string }

/**
 * Lọc tên file `.vrma` trong một thư mục rồi xếp theo tên.
 *
 * Tách ra khỏi handler IPC để **test được** — code trong `apps/**` không được vitest quét.
 *
 * `.toLowerCase()` chứ không so đuôi trần: Windows không phân biệt hoa thường nên bộ tải về hay
 * có `.VRMA`, mà so trần thì chúng biến mất lặng lẽ và user chỉ thấy "thư mục này không có file
 * .vrma nào" trong khi nhìn vào thì rõ ràng là có.
 *
 * `localeCompare` cho `VRMA_02` đứng trước `VRMA_10` theo cảm nhận thông thường của người đọc.
 */
export function pickVrmaNames(entries: readonly string[]): string[] {
  return entries.filter((n) => n.toLowerCase().endsWith('.vrma')).sort((a, b) => a.localeCompare(b))
}

/**
 * Thư mục clip user đã nạp + vai trò họ gán cho từng file — nhớ qua các phiên.
 *
 * ⚠️ **Chỉ lưu ĐƯỜNG DẪN, không lưu nội dung file.** Chép `.vrma` vào `userData` là tạo thêm một
 * bản trong thư mục app, đúng cái giấy phép bộ pixiv cấm (xem `vrmMotion.ts`). Mở app lần sau thì
 * đọc lại từ thư mục gốc; file bị xoá hay dời thì báo rõ thay vì im lặng bỏ qua.
 *
 * File riêng `vrm-folder-motions.json`, **không** nhét vào `VrmSettingsDto`: đây là dữ liệu khác
 * loại (một danh sách có thể dài), và `readSettings()` có quy tắc chuẩn hoá từng trường mà một
 * map lồng nhau không hợp với khuôn đó.
 */
export interface VrmFolderMotionsDto {
  /** Thư mục user đã chọn; `null` = chưa nạp lần nào. */
  dir: string | null
  /**
   * `tên file` → vai trò tự chạy. Thiếu khoá = clip đó chỉ chạy khi user tự bấm.
   *
   * Khoá là TÊN FILE chứ không phải chỉ số: user thêm/bớt file trong thư mục thì chỉ số trượt
   * hết, còn tên thì vẫn trỏ đúng clip.
   */
  roles: Record<string, VrmMotionRoleName>
  /**
   * `id clip CC0` → vai trò user GÁN ĐÈ lên mặc định. Thiếu khoá = dùng vai trò trong danh mục.
   *
   * Khoá là `id` (`idle-01`, `pose-motion`…) chứ không phải tên file: danh mục ở `vrmMotion.ts`
   * định danh bằng id, và id không đổi kể cả khi đổi tên file hay nơi tải.
   *
   * ⚠️ Chỉ ghi khoá cho clip user **thật sự đổi**. Ghi cả 13 khoá "cho đủ" thì lần sau sửa vai
   * trò mặc định trong code sẽ không tới được ai — họ đã bị đóng băng ở giá trị cũ mà không hề
   * chọn gì.
   */
  builtinRoles: Record<string, VrmMotionRoleName | 'manual'>
}

/**
 * Vai trò gán được cho clip tự nạp.
 *
 * Cố ý **không** có `manual`: không gán gì đã là "chỉ chạy khi bấm" rồi. Cũng không dùng lại
 * `VrmMotionRole` của `vrmMotion.ts` để tránh vòng import giữa hai file cùng tầng — hai bộ giá
 * trị trùng nhau và có test chốt điều đó.
 */
export type VrmMotionRoleName =
  | 'idle'
  | 'chat'
  | 'poke'
  | 'alert'
  | 'recover'
  // Sáu loại việc — trùng tên với `VrmActivity` ở `vrmActivity.ts`
  | 'inspect'
  | 'bulk'
  | 'transfer'
  | 'logs'
  | 'security'
  | 'monitor'

/** Nhãn tiếng Việt cho dropdown chọn vai trò. Thứ tự này là thứ tự hiện trên UI. */
export const VRM_ROLE_LABELS: readonly { value: VrmMotionRoleName; label: string }[] = [
  { value: 'idle', label: 'Lúc rảnh' },
  { value: 'chat', label: 'Khi mở chat' },
  { value: 'poke', label: 'Khi chạm vào' },
  { value: 'alert', label: 'Khi có cảnh báo' },
  { value: 'recover', label: 'Khi hết cảnh báo' },
  // Sáu loại việc — nhãn phải khớp `ACTIVITY_LABELS`, có test chốt điều đó
  { value: 'inspect', label: 'Khi đọc lâu' },
  { value: 'bulk', label: 'Khi chạy hàng loạt' },
  { value: 'transfer', label: 'Khi truyền file' },
  { value: 'logs', label: 'Khi xem log' },
  { value: 'security', label: 'Khi làm bảo mật' },
  { value: 'monitor', label: 'Khi xem giám sát' }
]

export const DEFAULT_VRM_FOLDER_MOTIONS: VrmFolderMotionsDto = { dir: null, roles: {}, builtinRoles: {} }

/**
 * Chuẩn hoá dữ liệu đọc từ đĩa — file JSON ngoài vault, ai cũng sửa được bằng tay.
 *
 * Bỏ khoá có vai trò lạ thay vì giữ nguyên: một chuỗi không thuộc `VrmMotionRoleName` lọt vào
 * `nextFolderClipForRole` sẽ không khớp vai trò nào và clip đó im lặng không bao giờ chạy — user
 * thấy "gán rồi mà không chạy" và không có cách nào biết vì sao.
 */
export function cleanFolderMotions(raw: unknown): VrmFolderMotionsDto {
  const o = (raw ?? {}) as Partial<VrmFolderMotionsDto>
  const valid = new Set<string>(VRM_ROLE_LABELS.map((r) => r.value))
  const roles: Record<string, VrmMotionRoleName> = {}
  if (o.roles && typeof o.roles === 'object') {
    for (const [name, role] of Object.entries(o.roles as Record<string, unknown>)) {
      if (typeof role === 'string' && valid.has(role)) roles[name] = role as VrmMotionRoleName
    }
  }
  /**
   * Override cho clip CC0 — nhận thêm `'manual'`, khác `roles` của clip tự nạp.
   *
   * Clip tự nạp không gán gì đã là "chỉ chạy khi bấm", nên `manual` ở đó là thừa. Clip CC0 thì
   * ngược lại: chúng CÓ vai trò sẵn, nên phải có cách nói "đừng tự chạy nữa".
   */
  const builtinValid = new Set<string>([...valid, 'manual'])
  const builtinRoles: Record<string, VrmMotionRoleName | 'manual'> = {}
  if (o.builtinRoles && typeof o.builtinRoles === 'object') {
    for (const [id, role] of Object.entries(o.builtinRoles as Record<string, unknown>)) {
      if (typeof role === 'string' && builtinValid.has(role)) {
        builtinRoles[id] = role as VrmMotionRoleName | 'manual'
      }
    }
  }
  return { dir: typeof o.dir === 'string' && o.dir.length > 0 ? o.dir : null, roles, builtinRoles }
}

/**
 * Clip kế tiếp cho một vai trò trong nhóm clip tự nạp — **xoay vòng**, cùng lẽ với
 * `nextMotionForRole` của danh mục CC0: bốc ngẫu nhiên thì có lúc ra cùng một clip hai ba lần
 * liền, mà ở nhịp 90–180 giây user sẽ thấy đúng cái đó lặp lại và nghĩ tính năng hỏng.
 */
export function nextFolderClipForRole(
  roles: Record<string, VrmMotionRoleName>,
  available: readonly string[],
  role: VrmMotionRoleName,
  lastName: string | null
): string | null {
  const pool = available.filter((n) => roles[n] === role)
  if (pool.length === 0) return null
  if (pool.length === 1 || lastName === null) return pool[0]!
  const i = pool.findIndex((n) => n === lastName)
  return pool[i < 0 ? 0 : (i + 1) % pool.length]!
}

export interface VrmSettingsDto {
  /** Model đang chọn. `null` = chưa chọn gì, panel hiện màn hình mời chọn file. */
  activeId: string | null
  /** Hiện nhân vật lúc mở app. Mặc định tắt: 3D chạy liên tục là tốn pin. */
  autoShow: boolean
  /** Cho tóc/váy đu đưa (springBone). Tắt được vì đây là phần tốn CPU nhất. */
  springBones: boolean
  /** Giới hạn FPS. 30 đủ mượt cho một nhân vật đứng yên và tiết kiệm rõ rệt so với 60. */
  fpsCap: 30 | 60
  /** Hệ số phóng to (Ctrl + lăn chuột). Xem `VRM_ZOOM_MIN`/`MAX`. */
  zoom: number
  /** Đầu/mắt dõi theo con trỏ chuột. */
  lookAtCursor: boolean
  /** Đổi biểu cảm khi app có cảnh báo (nối vào trung tâm thông báo). */
  reactToEvents: boolean
  /** Góc xoay quanh trục đứng, radian (Shift + kéo chuột). */
  rotationY: number
  /**
   * Vị trí user đã kéo nhân vật tới, theo **tỉ lệ** cửa sổ (0..1), `null` = chưa kéo lần nào.
   *
   * Lưu tỉ lệ chứ không pixel: user đổi cỡ cửa sổ hoặc cắm màn hình khác thì toạ độ pixel cũ trỏ
   * ra ngoài màn hình và nhân vật biến mất. Tỉ lệ thì luôn nằm trong khung.
   */
  posX: number | null
  posY: number | null
  /**
   * Hiện nhân vật NGOÀI desktop khi có thông báo mà app đang ở khay / thu nhỏ.
   *
   * Mặc định bật: thu vào khay là lúc duy nhất user KHÔNG nhìn app, cũng là lúc cảnh báo dễ trôi
   * nhất — mà "có đứa báo cho tôi" chính là lý do người ta bật nhân vật lên. Chỉ có tác dụng khi
   * `reactToEvents` cũng bật.
   */
  desktopOverlay: boolean
}

export const DEFAULT_VRM_SETTINGS: VrmSettingsDto = {
  activeId: null,
  autoShow: false,
  springBones: true,
  fpsCap: 30,
  zoom: 1,
  lookAtCursor: true,
  reactToEvents: true,
  rotationY: 0,
  posX: null,
  posY: null,
  desktopOverlay: true
}

/** Đọc một toạ độ tỉ lệ đã lưu: phải là số trong [0,1], ngoài ra coi như chưa có. */
export function cleanPos(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null
}
