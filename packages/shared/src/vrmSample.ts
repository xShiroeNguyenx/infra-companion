/**
 * F70 — model mẫu tải theo yêu cầu.
 *
 * Vì sao **không nhúng thẳng vào app**: model 14 MB sẽ vào mọi bản cài của mọi người, kể cả phần
 * lớn không bao giờ bật nhân vật lên. Tải khi cần thì cài đặt nhẹ nguyên vẹn, còn ai muốn dùng thì
 * bấm một nút.
 *
 * Vì sao **tự host trên GitHub Release của chính repo** chứ không trỏ thẳng sang trang gốc: link
 * của bên thứ ba chắc chắn sẽ chết theo thời gian (đã dính với runtime của local dev), và tải từ
 * một domain mình không kiểm soát thì không bảo đảm được nội dung. Giấy phép CC0 cho phép mình
 * host lại.
 */

/** Một model mẫu app có thể tải về hộ user. */
export interface VrmSampleModel {
  id: string
  /** Tên hiện trên UI. */
  label: string
  /** Mô tả ngắn: nhân vật thế nào, ai làm. */
  note: string
  /** Tác giả gốc — CC0 không bắt ghi công, nhưng ghi là chuyện nên làm. */
  author: string
  license: string
  /** Trang giấy phép, để user tự kiểm nếu muốn. */
  licenseUrl: string
  /** Nơi tải. Trỏ vào GitHub Release của chính repo này. */
  url: string
  /** Dự phòng khi link chính hỏng. */
  mirrors?: readonly string[]
  /** sha256 của file `.vrm` — bắt buộc khớp, lệch là vứt file đi. */
  sha256: string
  sizeBytes: number
  /** Tên file lưu vào máy user. */
  fileName: string
}

/**
 * Danh sách model mẫu. UI hiện mỗi model chưa tải thành một thẻ "Tải về và dùng"; màn hình cài
 * đặt lần đầu chỉ dùng phần tử **đầu tiên**.
 *
 * Từ v0.5.0 model chính là **nhân vật riêng của dự án** (Pink Pastel), thay cho model CC0 lấy từ
 * bên ngoài. Vì là của chính tác giả repo nên nó KHÔNG cần giấy phép "cho phân phối lại": tác giả
 * tự phát hành và giữ bản quyền. Metadata trong file vì thế vẫn ghi cấm phân phối lại / cấm chỉnh
 * sửa, và `scripts/vrm-license.cjs` sẽ báo ❌ với nó — đúng như mong đợi, vì công cụ đó trả lời
 * câu "NGƯỜI KHÁC có được đăng lại file này không".
 *
 * ⚠️ **Model của NGƯỜI KHÁC thì chỉ thêm khi giấy phép cho PHÂN PHỐI LẠI.** Kiểm bằng
 * `scripts/vrm-license.cjs` trước, và với nhân vật game thương mại thì metadata trong file KHÔNG
 * đủ — người chuyển đổi sang VRM tự điền trường đó, họ không sở hữu bản quyền nhân vật.
 */
export const VRM_SAMPLE_MODELS: readonly VrmSampleModel[] = [
  {
    id: 'pink-pastel',
    label: 'Pink Pastel',
    note: 'Cô mèo tóc hồng, váy xoè — nhân vật riêng của Infra Companion',
    author: 'xShiroeNguyenx',
    license: 'Giữ bản quyền — chỉ dùng trong Infra Companion',
    licenseUrl: 'https://vrm.dev/licenses/1.0/',
    // Release của chính repo này — xem docs/vrm-nhan-vat.md mục 10.2 để biết cách đăng lên.
    // Tag `vrm-sample-v2` cố ý TÁCH khỏi tag phát hành app: model không đổi theo phiên bản app,
    // và gắn vào tag app thì mỗi lần phát hành lại phải đính kèm file đó một lần nữa.
    // (`vrm-sample-v1` là model CC0 cũ — GIỮ release đó: các bản app ≤ 0.4.12 vẫn tải từ nó.)
    url: 'https://github.com/xShiroeNguyenx/infra-companion/releases/download/vrm-sample-v2/pink-pastel.vrm',
    sha256: '4a7657acfddf05944a164af391702eef1a27f080244f9b711bdc5e41dece6433',
    sizeBytes: 5_636_424,
    fileName: 'pink-pastel.vrm'
  },
  {
    // Nhân vật riêng thứ hai — đứng SAU Pink Pastel: màn hình cài đặt lần đầu (`StartScreen`) lấy
    // phần tử đầu, nên người mới vẫn nhận Pink Pastel; Lavender Cat mời tải trong cài đặt nhân vật.
    // Cùng release `vrm-sample-v2` (đính kèm thêm file, không tạo tag mới).
    // ⚠️ Thêm model vào đây là AN TOÀN với `retireOldSamples`, nhưng BỎ một model khỏi danh sách
    // thì app sẽ xoá file đó trên máy mọi người ở lần mở kế tiếp.
    id: 'lavender-cat',
    label: 'Lavender Cat',
    note: 'Cô mèo tóc oải hương mùa đông — nhân vật riêng của Infra Companion',
    author: 'xShiroeNguyenx',
    license: 'Giữ bản quyền — chỉ dùng trong Infra Companion',
    licenseUrl: 'https://vrm.dev/licenses/1.0/',
    url: 'https://github.com/xShiroeNguyenx/infra-companion/releases/download/vrm-sample-v2/lavender-cat.vrm',
    sha256: '217a3b1a6c66e42e95fe0098148e9cdd0f5077eee7bb60bbfc5f9db9d3e6b3c1',
    sizeBytes: 8_284_168,
    fileName: 'lavender-cat.vrm'
  }
]

/**
 * Một đường dẫn trong danh bạ có phải **model mẫu đã bị thu hồi** không.
 *
 * Thu hồi = file nằm trong thư mục model mẫu của app (`userData/vrm-samples/`) mà tên không còn
 * trong `VRM_SAMPLE_MODELS`. Từ v0.5.0 model mẫu CC0 cũ bị gỡ khỏi app: máy nào còn giữ thì app xoá
 * bản đó và mời tải nhân vật mới — tác giả muốn mọi người dùng chung một nhân vật của dự án.
 *
 * ⚠️ Chỉ khớp file **trong thư mục của app**. File `.vrm` user tự chọn từ chỗ khác trên máy KHÔNG
 * BAO GIỜ bị coi là thu hồi, kể cả khi trùng tên: đó là file của họ, app không có quyền xoá.
 *
 * So không phân biệt hoa/thường và dấu gạch chéo: Windows trả `C:\\…` lẫn `c:/…` cho cùng một chỗ.
 */
export function isRetiredSamplePath(path: string, samplesDir: string, currentFileNames: readonly string[]): boolean {
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const dir = norm(samplesDir)
  const p = norm(path)
  if (dir === '' || !p.startsWith(dir + '/')) return false
  const name = p.slice(dir.length + 1)
  // File nằm sâu hơn một cấp không phải thứ app tự tải về — để yên
  if (name === '' || name.includes('/')) return false
  return !currentFileNames.some((f) => f.toLowerCase() === name)
}

/**
 * Trần dung lượng khi tải: dừng sớm nếu nhận vượt xa mức dự kiến.
 *
 * Không có nó thì một link bị chuyển hướng sai (trang đăng nhập, trang lỗi, file khác) sẽ được tải
 * về cho tới khi đầy đĩa. Nới 30% cho chênh lệch nén/đóng gói.
 */
export function sampleDownloadCap(sizeBytes: number): number {
  return Math.max(Math.round(sizeBytes * 1.3), 1_000_000)
}

/** Tiến độ tải, main bắn sang renderer. */
export interface VrmSampleProgress {
  id: string
  /** `download` đang tải · `verify` đang kiểm sha256 · `done` xong · `error` hỏng. */
  phase: 'download' | 'verify' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number | null
  percent: number
  message?: string
}

export type VrmSampleFailReason = 'network' | 'checksum' | 'canceled' | 'io' | 'unknown'

export type VrmSampleResult =
  | { ok: true; modelId: string }
  | { ok: false; reason: VrmSampleFailReason; detail?: string }

/**
 * Câu báo lỗi cho user — **nói được nguyên nhân**, không phải mã lỗi.
 *
 * `checksum` đáng nói riêng: file tải về không khớp mã băm nghĩa là nội dung khác với cái đã kiểm,
 * có thể do mạng hỏng hoặc do bị chặn/thay thế. Cả hai đều phải vứt file đi, và user cần biết vì
 * sao app từ chối một file "đã tải xong".
 */
export function sampleErrorMessage(reason: VrmSampleFailReason): string {
  switch (reason) {
    case 'network':
      return 'Không tải được — kiểm tra kết nối mạng rồi thử lại.'
    case 'checksum':
      return 'File tải về không khớp mã kiểm tra nên đã bị bỏ. Thử lại; nếu vẫn vậy thì mạng đang chèn nội dung lạ.'
    case 'canceled':
      return 'Đã huỷ tải.'
    case 'io':
      return 'Không ghi được file xuống đĩa — kiểm tra dung lượng trống.'
    default:
      return 'Tải thất bại.'
  }
}
