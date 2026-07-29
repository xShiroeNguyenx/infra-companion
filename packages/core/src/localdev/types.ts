/**
 * Type nội bộ của module local dev (Laragon/LocalWP-style). KHÔNG import electron ở đây —
 * cả thư mục `localdev/` phải chạy được dưới vitest thuần (xem docs/TIEP-TUC-PHIEN-SAU.md).
 *
 * DTO đi qua IPC nằm ở `packages/shared/src/types.ts`; type ở file này là chi tiết cài đặt
 * của main process (spec process, trạng thái supervisor…) mà renderer không cần biết.
 */

/** Loại runtime mà app tự tải về và tự quản (không nhúng vào installer). */
export type RuntimeKind = 'php' | 'mariadb' | 'nginx' | 'tool'

/** Trạng thái vòng đời 1 service do ProcessSupervisor quản. */
export type ServiceState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  /** Đang chờ backoff để start lại sau khi crash. */
  | 'restarting'
  /** Process còn sống nhưng health probe fail liên tiếp (mysqld deadlock, php-cgi kẹt). */
  | 'unhealthy'
  /** Thiếu binary — runtime bị gỡ tay khỏi đĩa. */
  | 'missing-runtime'

/**
 * Một process daemon cần supervise. Mỗi spec = ĐÚNG 1 process con.
 * Pool php-cgi gồm N spec cùng `groupId` (Windows không có php-fpm — xem plan §quyết-định 2).
 */
export interface ServiceSpec {
  /** Định danh 1 process: 'nginx' | 'mariadb' | 'php-8.3#0'. */
  id: string
  /** Nhóm để start/stop cả pool: 'nginx' | 'mariadb' | 'php-8.3'. */
  groupId: string
  label: string
  /** Đường dẫn tuyệt đối trong runtimes/ — không bao giờ chạy qua shell. */
  exe: string
  args: string[]
  cwd: string
  /** env TRẮNG có kiểm soát, KHÔNG kế thừa process.env (tránh rò token AI/AWS vào process con). */
  env: Record<string, string>
  logFile: string
  /** Cổng để health probe; null = không probe. */
  healthPort: number | null
  /** Thoát code 0 có phải hành vi BÌNH THƯỜNG? php-cgi hết PHP_FCGI_MAX_REQUESTS: có. nginx master: không. */
  restartOnCleanExit: boolean
  /** Số lần restart tối đa trong cửa sổ `restartWindowMs` trước khi bỏ cuộc. */
  maxRestarts: number
  restartWindowMs: number
  /**
   * Cách dừng ĐÀNG HOÀNG, riêng cho từng service (nginx `-s quit`, mariadb-admin shutdown).
   * Trả true = đã dừng xong. KHÔNG dùng process.kill: trên Windows nó chỉ TerminateProcess
   * đúng 1 PID → worker con thành orphan VẪN GIỮ CỔNG, và với mariadbd thì tương đương mất
   * điện giữa transaction (InnoDB crash recovery lần sau).
   */
  gracefulStop?: (pid: number) => Promise<boolean>
  /** Thời gian chờ gracefulStop trước khi hạ cấp sang killTree. */
  graceMs?: number
  /** Chạy 1 lần trước lần start ĐẦU TIÊN (vd mariadb-install-db). Phải idempotent. */
  bootstrap?: () => Promise<void>
}

/** Trạng thái runtime của 1 service (nguồn sự thật ở RAM của main, đẩy sang renderer qua event). */
export interface ServiceStatus {
  id: string
  groupId: string
  label: string
  state: ServiceState
  pid: number | null
  /** Cổng service đang giữ (để UI đối chiếu khi trùng port). */
  ports: number[]
  /** Thời điểm chuyển sang 'running'. */
  since: number | null
  restarts: number
  /** 20 dòng cuối stderr khi crash — để hiện được lý do thật, không chỉ "đã dừng". */
  lastError: string | null
  runtimeId: string | null
}

/**
 * 1 process lạ đang chạy TỪ BÊN TRONG thư mục runtimes của ta (orphan sót lại sau khi
 * app crash/bị kill cứng). Tiêu chí nhận diện là executable path, KHÔNG phải PID —
 * Windows tái dùng PID rất nhanh, so PID sẽ diệt oan process vô can của user.
 */
export interface StrayProcess {
  pid: number
  parentPid: number | null
  exePath: string
  startedAt: number | null
}

/**
 * 1 site local. Type nằm ở ĐÂY (không phải trong LocalDevStore.ts) để module nào cần cũng
 * dùng được mà không kéo theo `node:sqlite`.
 * `createdByApp=false` ⇒ user trỏ vào folder có sẵn ⇒ app TUYỆT ĐỐI không xoá file của họ.
 */
export interface SiteRow {
  id: string
  name: string
  slug: string
  domain: string
  rootPath: string
  docRoot: string
  phpVersion: string | null
  httpPort: number
  https: boolean
  kind: 'static' | 'php' | 'wordpress'
  status: 'creating' | 'ready' | 'error'
  createdByApp: boolean
  lastError: string | null
  /**
   * Database riêng của site (null = site chưa cấp DB, vd site static/PHP thuần).
   *
   * `dbPass` để PLAINTEXT là CÓ Ý: `wp-config.php` trên đĩa vốn đã chứa đúng password này ở
   * dạng thô, nên mã hoá bản copy trong DB chỉ là an ninh giả tạo. Phòng thủ thật là mysqld
   * chỉ bind 127.0.0.1 và mỗi site chỉ được grant trên DB của chính nó.
   */
  dbName: string | null
  dbUser: string | null
  dbPass: string | null
  createdAt: number
  updatedAt: number
}

export interface SiteInsert {
  name: string
  slug: string
  domain: string
  rootPath: string
  docRoot: string
  phpVersion: string | null
  httpPort: number
  https: boolean
  kind: SiteRow['kind']
  status: SiteRow['status']
  createdByApp: boolean
}

/** Field cho phép cập nhật — `undefined` = giữ nguyên (semantics giống VaultService). */
export interface SiteUpdate {
  name?: string
  domain?: string
  docRoot?: string
  phpVersion?: string | null
  httpPort?: number
  https?: boolean
  kind?: SiteRow['kind']
  status?: SiteRow['status']
  lastError?: string | null
  dbName?: string | null
  dbUser?: string | null
  dbPass?: string | null
}

/** Mọi thư mục của module, dẫn xuất từ 1 gốc duy nhất (xem paths.ts). */
export interface LocalDevPaths {
  /** Gốc cấu hình được (mặc định <userData>, cho đổi sang ổ khác — migrate về sau rất đau). */
  root: string
  /** Runtime đã cài — COI NHƯ READ-ONLY sau khi cài xong. */
  runtimes: string
  /** Chỗ tải/giải nén tạm; xoá sạch lúc app khởi động. */
  runtimesTmp: string
  /** State của USER, độc lập version runtime → nâng runtime không mất config. */
  localdev: string
  db: string
  conf: string
  confNginx: string
  confNginxSites: string
  /** User sửa tay ở đây, app KHÔNG BAO GIỜ ghi đè (nginx include sau sites/). */
  confNginxExtra: string
  confPhp: string
  confMariadb: string
  /** datadir MariaDB — TUYỆT ĐỐI không nằm trong runtimes/. */
  dataMariadb: string
  logs: string
  certs: string
  /** pid journal + nginx prefix (logs/temp writable cho nginx). */
  run: string
  tmp: string
  /** Cache file đã tải + verify (wordpress.zip…) → tạo site thứ 2 không cần mạng. */
  cache: string
  /** wp-cli.phar, adminer.php, shim wp.cmd. */
  bin: string
  /** Thư mục chứa các site do app tạo. */
  sites: string
  /** Thùng rác — xoá site chuyển vào đây thay vì unlink thẳng. */
  trash: string
}
