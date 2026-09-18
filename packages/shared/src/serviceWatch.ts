/**
 * F71 — cảnh báo "service chết".
 *
 * Vì sao cần: monitoring theo host chỉ bắt được máy mất kết nối. Apache hay Tomcat tắt thì máy
 * vẫn ping được, load vẫn đẹp (thậm chí đẹp HƠN vì hết việc) — nhìn màn theo dõi không thấy gì
 * bất thường, chỉ có dòng uptime service lặng lẽ mất một mục. Không ai ngồi đếm dòng đó cả.
 *
 * Phần "quyết định khi nào kêu" nằm ở đây dưới dạng hàm thuần → có test, không cần Electron.
 *
 * ⚠ Ngữ nghĩa cố ý: chỉ báo khi service đi từ **CÓ → KHÔNG** trên chính host đó (xem
 * `nextSeenServices`). Host chưa bao giờ chạy service đã chọn thì im lặng — bật "dõi java" cho
 * cả nhóm mà máy DB không có Tomcat là chuyện thường, kêu ở đó chỉ dạy người ta bỏ qua cảnh báo.
 */

/** Một mục trong danh sách dựng sẵn. `match` = các tên tiến trình đều được tính là "đang chạy". */
export interface ServiceCatalogItem {
  id: string
  /** Nhãn hiện trên Settings (tên người đọc, không phải tên tiến trình). */
  label: string
  /**
   * Tên tiến trình khớp — CÓ MỘT trong số này là đạt. Hai họ distro gọi khác nhau cho cùng một
   * phần mềm (`httpd` của RHEL vs `apache2` của Debian; `mysqld` vs `mariadbd`), gộp vào một mục
   * để fleet trộn distro không báo nhầm.
   */
  match: readonly string[]
}

/**
 * Danh sách dựng sẵn cho Settings. KHÔNG mục nào bật mặc định — user tự tick cái mình cần,
 * vì "bắt buộc phải chạy" là quyết định của người vận hành chứ không đoán được từ tên tiến trình.
 *
 * Chỉ gồm tên mà lệnh đo thật sự đọc được (`METRIC_CMD` lọc sẵn theo danh sách này); thêm tên
 * ngoài danh sách thì dùng ô "tự thêm" và tên đó phải nằm trong bộ lọc của lệnh đo.
 */
export const SERVICE_CATALOG: readonly ServiceCatalogItem[] = [
  { id: 'apache', label: 'Apache (httpd / apache2)', match: ['httpd', 'apache2'] },
  { id: 'nginx', label: 'Nginx', match: ['nginx'] },
  { id: 'java', label: 'Tomcat / app JVM (java)', match: ['java'] },
  { id: 'php-fpm', label: 'PHP-FPM', match: ['php-fpm'] },
  { id: 'mysql', label: 'MySQL / MariaDB (mysqld / mariadbd)', match: ['mysqld', 'mariadbd'] },
  { id: 'postgres', label: 'PostgreSQL', match: ['postgres'] },
  { id: 'redis', label: 'Redis', match: ['redis-server'] },
  { id: 'node', label: 'Node.js', match: ['node'] }
] as const

/** Tên tiến trình mà lệnh đo đọc được — ô "tự thêm" ngoài bộ này sẽ không bao giờ thấy chạy. */
export const WATCHABLE_PROCESS_NAMES: readonly string[] = [
  'httpd',
  'apache2',
  'nginx',
  'java',
  'node',
  'php-fpm',
  'mysqld',
  'mariadbd',
  'postgres',
  'redis-server'
] as const

/** Cấu hình dõi service, dùng CHUNG cho mọi host đang theo dõi. */
export interface ServiceWatchConfig {
  /** id trong `SERVICE_CATALOG` đang bật. */
  enabledIds: string[]
  /** Tên tiến trình user tự thêm (mỗi tên là một mục độc lập). */
  customNames: string[]
}

export const emptyServiceWatch = (): ServiceWatchConfig => ({ enabledIds: [], customNames: [] })

/** Một mục đang được dõi, đã quy về tập tên tiến trình cần tìm. */
export interface WatchedService {
  /** Khoá ổn định để lưu state + gộp sự kiện: id catalog, hoặc `custom:<tên>`. */
  key: string
  label: string
  match: readonly string[]
}

/**
 * Cấu hình → danh sách mục cần dõi. Bỏ id lạ (catalog đổi giữa các bản) và tên tự thêm rỗng;
 * trùng lặp bị loại theo `key` để một service không sinh hai dòng cảnh báo.
 */
export function resolveWatchedServices(cfg: ServiceWatchConfig): WatchedService[] {
  const out: WatchedService[] = []
  const seen = new Set<string>()
  for (const id of cfg.enabledIds) {
    const item = SERVICE_CATALOG.find((c) => c.id === id)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push({ key: item.id, label: item.label, match: item.match })
  }
  for (const raw of cfg.customNames) {
    const name = raw.trim()
    if (!name) continue
    const key = `custom:${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, label: name, match: [name] })
  }
  return out
}

/** Mục này có đang chạy trên host không — theo danh sách service của sample. */
export function isServiceRunning(svc: WatchedService, running: readonly { name: string }[]): boolean {
  return running.some((r) => svc.match.includes(r.name))
}

/**
 * Tập "đã từng thấy chạy" MỚI cho một host = cũ ∪ đang chạy.
 *
 * Chỉ thêm, không bớt: mất đi chính là cái ta muốn báo, nên không được tự xoá khỏi tập này khi
 * service tắt. Quên một host (dừng theo dõi) thì xoá cả entry ở tầng gọi.
 */
export function nextSeenServices(
  prevSeen: readonly string[],
  watched: readonly WatchedService[],
  running: readonly { name: string }[]
): string[] {
  const next = new Set(prevSeen)
  for (const svc of watched) if (isServiceRunning(svc, running)) next.add(svc.key)
  return [...next].sort()
}

/** Mục cần đánh giá cảnh báo trên một host ở một lần poll. */
export interface ServiceProbe {
  key: string
  label: string
  /** false = đang tắt → ứng viên cảnh báo. */
  running: boolean
}

/**
 * Các mục ĐÁNG đánh giá cho host này: chỉ những service host đã từng chạy (kể cả vừa thấy ở
 * chính lần poll này). Host chưa từng có service đó → không sinh probe → máy trạng thái không
 * bao giờ tích luỹ → im lặng tuyệt đối.
 *
 * `running` rỗng nghĩa là KHÔNG ĐO ĐƯỢC (parser trả null), khác hẳn "đo được và không có gì
 * chạy" — caller phải chặn trước, xem `serviceProbes` không tự phân biệt được.
 */
export function serviceProbes(
  watched: readonly WatchedService[],
  running: readonly { name: string }[],
  seen: readonly string[]
): ServiceProbe[] {
  const seenSet = new Set(seen)
  const probes: ServiceProbe[] = []
  for (const svc of watched) {
    const isUp = isServiceRunning(svc, running)
    if (!isUp && !seenSet.has(svc.key)) continue // chưa từng thấy trên host này → không phải việc của ta
    probes.push({ key: svc.key, label: svc.label, running: isUp })
  }
  return probes
}
