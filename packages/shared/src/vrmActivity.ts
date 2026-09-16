/**
 * F70 — **nhân vật phản ứng theo VIỆC user đang làm**, không chỉ theo sự cố.
 *
 * Trước đây chỉ có `inspect` cho đúng hai công cụ (so config, replication); 43 công cụ còn lại mở
 * ra thì nhân vật đứng im. Mà "có ai đó ở cạnh trong lúc làm việc" mới là lý do người ta bật tính
 * năng này lên — im lặng suốt 43/45 lần là hỏng đúng cái điểm ấy.
 *
 * Gộp theo **loại công việc** chứ không phải từng công cụ: 45 vai trò là một dropdown không ai
 * đọc hết, mà phản ứng cũng chẳng khác nhau — mở "Xem log" hay "Tail log" thì nhân vật đều nên
 * làm cùng một việc.
 */

/** Loại việc user đang làm — quyết định clip, biểu cảm và câu nói. */
export type VrmActivity =
  /** Chạy lệnh lên nhiều máy cùng lúc — việc nặng tay, dễ sai. */
  | 'bulk'
  /** Truyền file, đồng bộ thư mục. */
  | 'transfer'
  /** Đọc log, tiến trình, dịch vụ — ngồi nhìn chữ chạy. */
  | 'logs'
  /** Khoá, key, fingerprint, kiểm an ninh — việc cần cẩn thận. */
  | 'security'
  /** Biểu đồ, giám sát, kiểm kê — nhìn số liệu. */
  | 'monitor'
  /** So sánh, replication — ngồi đọc lâu (vai trò `inspect` cũ). */
  | 'inspect'

/**
 * Công cụ nào thuộc loại việc nào. Khoá là `id` trong `toolCatalog.ts`.
 *
 * Công cụ KHÔNG có trong bảng này thì nhân vật không phản ứng — cố ý: mở Cài đặt hay Trợ giúp mà
 * nhân vật cũng diễn một màn thì thành nhiễu. Chỉ những việc **kéo dài** mới đáng có bạn đồng hành.
 */
export const TOOL_ACTIVITY: Readonly<Record<string, VrmActivity>> = {
  bulk: 'bulk',
  'key-rotate': 'bulk',
  jobs: 'bulk',
  cron: 'bulk',
  runbooks: 'bulk',

  sftp: 'transfer',
  'folder-sync': 'transfer',
  sync: 'transfer',
  'export-hosts': 'transfer',
  'do-import': 'transfer',
  'client-import': 'transfer',

  'log-tail': 'logs',
  recordings: 'logs',
  processes: 'logs',
  services: 'logs',
  'cmd-history': 'logs',

  keys: 'security',
  'known-hosts': 'security',
  security: 'security',
  'pkg-updates': 'security',

  monitor: 'monitor',
  'http-checks': 'monitor',
  inventory: 'monitor',
  'disk-usage': 'monitor',
  notifications: 'monitor',

  compare: 'inspect',
  replication: 'inspect'
}

/**
 * Biểu cảm ưu tiên cho từng loại việc — thử lần lượt, model có cái nào thì dùng cái đó.
 *
 * Danh sách chứ không phải một giá trị: model VRM khai biểu cảm rất khác nhau, có model không có
 * `happy`, có model không có `relaxed`. `neutral` đứng cuối vì mọi model đều có.
 */
export const ACTIVITY_EXPRESSION: Readonly<Record<VrmActivity, readonly string[]>> = {
  bulk: ['surprised', 'neutral'],
  transfer: ['happy', 'relaxed', 'neutral'],
  logs: ['neutral'],
  security: ['angry', 'sad', 'neutral'],
  monitor: ['happy', 'relaxed', 'neutral'],
  inspect: ['neutral']
}

/**
 * Câu nhân vật nói khi user mở một loại việc. Nhiều mẫu, bốc ngẫu nhiên.
 *
 * Cùng lý do với `OPENED_LINES`: một câu cố định nghe như thông báo hệ thống ngay lần thứ ba, mà
 * điểm của tính năng là *có ai đó đang ngồi cạnh*.
 */
export const ACTIVITY_LINES: Readonly<Record<VrmActivity, readonly string[]>> = {
  bulk: [
    'Chạy lên nhiều máy đó nha, Onii~ xem kỹ danh sách nhé!',
    'Onii~ nhớ kiểm lại lệnh trước khi bấm nha ~',
    'Cẩn thận chút nha Onii~, lệnh này đi tới nhiều máy đó!'
  ],
  transfer: [
    'Đang chuyển file nè Onii~, để tôi trông chừng cho ~:)',
    'Onii~ cứ làm việc khác đi, xong tôi báo nha!',
    'Truyền file rồi đó Onii~ ~'
  ],
  logs: [
    'Cùng đọc log với Onii~ nào ~',
    'Onii~ tìm gì trong đống log này thế?',
    'Tôi ngồi đây xem cùng Onii~ nha ~:)'
  ],
  security: [
    'Phần này quan trọng đó Onii~, làm từ từ nha!',
    'Onii~ cẩn thận nha, đụng tới khoá rồi đó ~',
    'Tôi im lặng để Onii~ tập trung nha ~'
  ],
  monitor: [
    'Số liệu đây Onii~, có gì lạ tôi báo ngay ~:)',
    'Onii~ xem biểu đồ nha, tôi canh giúp!',
    'Đang theo dõi cùng Onii~ nè ~'
  ],
  inspect: [
    'Cái này đọc hơi lâu đó Onii~, cứ từ từ nha ~',
    'Onii~ so kỹ nha, tôi ngồi đợi ~:)',
    'Để tôi ngồi cạnh Onii~ cho đỡ buồn nha!'
  ]
}

/** Một câu ngẫu nhiên cho loại việc. `rng` truyền vào để test cố định được. */
export function activityLine(activity: VrmActivity, rng: () => number = Math.random): string {
  const lines = ACTIVITY_LINES[activity]
  const i = Math.min(lines.length - 1, Math.floor(rng() * lines.length))
  return lines[i]!
}

/** Loại việc của một công cụ; `null` = công cụ này không đáng để nhân vật phản ứng. */
export function activityForTool(toolId: string): VrmActivity | null {
  return TOOL_ACTIVITY[toolId] ?? null
}

/**
 * Nhãn tiếng Việt cho dropdown chọn vai trò — **thứ tự này là thứ tự hiện trên UI**.
 *
 * Đặt cạnh nhau ở đây thay vì rải trong component: thêm một loại việc mà quên nhãn thì nó hiện ra
 * dưới dạng mã (`bulk`) và không ai hiểu đó là gì.
 */
export const ACTIVITY_LABELS: readonly { value: VrmActivity; label: string }[] = [
  { value: 'bulk', label: 'Khi chạy hàng loạt' },
  { value: 'transfer', label: 'Khi truyền file' },
  { value: 'logs', label: 'Khi xem log' },
  { value: 'security', label: 'Khi làm bảo mật' },
  { value: 'monitor', label: 'Khi xem giám sát' },
  { value: 'inspect', label: 'Khi đọc lâu' }
]
