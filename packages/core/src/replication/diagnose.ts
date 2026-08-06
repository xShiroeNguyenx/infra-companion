import { parseServerVersion, type ReplSample, type ReplVars, type ReplicaStatus } from './status'

/**
 * F55 — Bảng luật chẩn đoán replication: từ một lần đo ra danh sách vấn đề + runbook xử lý.
 *
 * THUẦN, không I/O. App KHÔNG tự chạy bất cứ lệnh nào — mọi thứ trả về đây chỉ để hiển thị
 * kèm nút copy. Nhãn `danger` quyết định màu sắc và việc có bắt xác nhận trước khi copy hay không.
 *
 * Nguyên tắc viết luật:
 *  - Lệnh phải COPY-PASTE CHẠY ĐƯỢC NGAY: nội suy sẵn tên bảng, tên file binlog, vị trí… lấy từ
 *    chính sample. Runbook chung chung kiểu "kiểm tra lại kết nối" thì vô dụng lúc 3 giờ sáng.
 *  - `checks` (đọc, an toàn tuyệt đối) luôn đứng trước `fixes`. Không bao giờ đề xuất sửa mù.
 *  - Lệnh làm MẤT DỮ LIỆU (skip counter, RESET SLAVE, re-seed) phải là `destructive`/`caution`
 *    và `note` phải nói thẳng mất cái gì.
 *  - Server khoẻ và không có gì bất thường → trả về MẢNG RỖNG. Không đẻ ra cảnh báo cho vui.
 */

export type Severity = 'critical' | 'warn' | 'info'
/** safe = đọc/đảo ngược được · caution = đổi trạng thái, cân nhắc · destructive = mất dữ liệu hoặc downtime. */
export type Danger = 'safe' | 'caution' | 'destructive'

export interface Cmd {
  label: string
  kind: 'sql' | 'shell'
  /** Chạy trên máy nào — hiện thành nhãn để khỏi chạy nhầm bên. */
  on: 'master' | 'replica'
  text: string
  danger: Danger
  note?: string
}

export interface Diagnosis {
  id: string
  severity: Severity
  title: string
  /** Giải thích nguyên nhân bằng tiếng Việt, có kèm số đo thực tế. */
  why: string
  checks: Cmd[]
  fixes: Cmd[]
}

export interface DiagnoseOptions {
  /** Trễ (giây) coi là đáng báo. Mặc định 60. */
  lagWarnSec?: number
  /** Byte SQL thread chưa apply coi là đáng báo. Mặc định 64 MiB. */
  applyGapWarnBytes?: number
  /** Binlog giữ dưới mức này (giây) là quá ngắn — nguồn gốc của lỗi 1236. Mặc định 3 ngày. */
  binlogRetentionMinSec?: number
}

const DEFAULTS: Required<DiagnoseOptions> = {
  lagWarnSec: 60,
  applyGapWarnBytes: 64 * 1024 * 1024,
  binlogRetentionMinSec: 3 * 86_400
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warn: 1, info: 2 }

// ---------------------------------------------------------------------------
// Tiện ích hiển thị
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60 ? ` ${sec % 60}s` : ''}`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h${m ? ` ${m}m` : ''}`
}

/**
 * Moi tên bảng gây lỗi ra khỏi message của MySQL/MariaDB. Đây là thứ biến runbook từ
 * "kiểm tra dữ liệu" thành một câu SELECT copy-paste được.
 *
 * Hai dạng message:
 *  - ROW-based:       `Could not execute Write_rows_v1 event on table app.orders; Duplicate entry…`
 *  - STATEMENT-based: `Error '…' on query. Default database: 'app'. Query: 'INSERT INTO orders …'`
 */
export function extractTableFromError(error: string | null): string | null {
  if (!error) return null
  const onTable = /on table ([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)/i.exec(error)
  if (onTable) return `\`${onTable[1]}\`.\`${onTable[2]}\``

  const db = /Default database: '([A-Za-z0-9_$]+)'/i.exec(error)
  const query = /(?:INSERT INTO|UPDATE|DELETE FROM|REPLACE INTO)\s+`?([A-Za-z0-9_$]+)`?/i.exec(error)
  if (db && query) return `\`${db[1]}\`.\`${query[1]}\``
  if (query) return `\`${query[1]}\``
  return null
}

/** MariaDB và MySQL 8 đặt tên biến tuning khác nhau → phải sinh đúng lệnh cho từng bên. */
function flavorOf(vars: ReplVars | null): 'mariadb' | 'mysql' | 'unknown' {
  return vars?.version ? parseServerVersion(vars.version).flavor : 'unknown'
}

// ---------------------------------------------------------------------------
// Bảng luật
// ---------------------------------------------------------------------------

/** Lỗi IO thread thuộc nhóm "không nối được tới master". */
const IO_NETWORK_ERRNOS = new Set([2002, 2003, 2013, 1040, 1053])

export function diagnose(sample: ReplSample, options: DiagnoseOptions = {}): Diagnosis[] {
  const opts = { ...DEFAULTS, ...options }
  const out: Diagnosis[] = []
  const push = (d: Diagnosis): void => {
    out.push(d)
  }

  // --- Không đo được -------------------------------------------------------
  if (!sample.ok) {
    push({
      id: 'probe-failed',
      severity: 'critical',
      title: 'Không đọc được trạng thái replication',
      why:
        sample.error ??
        'Không rõ nguyên nhân. Thường là mất kết nối SSH/MySQL, hoặc user không đủ quyền đọc trạng thái.',
      checks: [
        {
          label: 'Kiểm tra user hiện tại có quyền đọc trạng thái replication không',
          kind: 'sql',
          on: 'replica',
          text: 'SHOW GRANTS FOR CURRENT_USER();',
          danger: 'safe',
          note: 'Cần REPLICATION CLIENT (MariaDB / MySQL 5.7) hoặc REPLICATION_SLAVE_ADMIN + REPLICATION CLIENT (MySQL 8). User chỉ có SELECT sẽ không đọc được SHOW SLAVE STATUS.'
        },
        { label: 'MySQL còn sống không', kind: 'shell', on: 'replica', text: 'systemctl status mariadb mysql 2>/dev/null | head -20', danger: 'safe' }
      ],
      fixes: [
        {
          label: 'Cấp quyền đọc trạng thái cho user giám sát (chạy bằng tài khoản admin)',
          kind: 'sql',
          on: 'replica',
          text: "GRANT REPLICATION CLIENT ON *.* TO 'monitor'@'%';\nFLUSH PRIVILEGES;",
          danger: 'caution',
          note: 'Quyền này chỉ cho đọc trạng thái, không cho đọc dữ liệu bảng.'
        }
      ]
    })
    return out
  }

  const replica = sample.replica
  if (!replica) {
    push({
      id: 'not-a-replica',
      severity: 'critical',
      title: 'Server này chưa được cấu hình làm replica',
      why: 'SHOW SLAVE STATUS trả về rỗng — nghĩa là replication chưa từng được thiết lập, hoặc đã bị RESET SLAVE ALL xoá sạch cấu hình.',
      checks: [
        { label: 'Xác nhận trạng thái rỗng', kind: 'sql', on: 'replica', text: 'SHOW SLAVE STATUS\\G', danger: 'safe' },
        { label: 'Xem cấu hình còn sót trong file config', kind: 'shell', on: 'replica', text: "grep -rEi 'master_host|server[-_]id|read_only' /etc/my.cnf /etc/my.cnf.d/ /etc/mysql/ 2>/dev/null", danger: 'safe' }
      ],
      fixes: [
        {
          label: 'Thiết lập lại replication (điền thông tin master rồi chạy)',
          kind: 'sql',
          on: 'replica',
          text:
            "CHANGE MASTER TO\n" +
            "  MASTER_HOST='<ip-master>',\n" +
            "  MASTER_USER='repl',\n" +
            "  MASTER_PASSWORD='<mật-khẩu>',\n" +
            "  MASTER_LOG_FILE='<file từ SHOW MASTER STATUS>',\n" +
            "  MASTER_LOG_POS=<pos từ SHOW MASTER STATUS>;\n" +
            'START SLAVE;',
          danger: 'caution',
          note: 'Chỉ đúng khi dữ liệu 2 bên đang khớp nhau tại đúng vị trí binlog đó. Nếu không chắc, phải nạp lại dump từ master trước.'
        }
      ]
    })
    return out
  }

  const drift = sample.drift
  const masterVars = sample.masterVars
  const replicaVars = sample.replicaVars

  // --- IO thread -----------------------------------------------------------
  if (replica.ioRunning !== 'yes') {
    const errno = replica.lastIoErrno
    const detail = replica.lastIoError ? `\n\nLỗi gốc: ${replica.lastIoError}` : ''

    if (errno === 1236) {
      const dumpFile = '/tmp/master-seed.sql'
      push({
        id: 'io-1236-binlog-purged',
        severity: 'critical',
        title: 'Master đã xoá mất binlog mà replica cần đọc (lỗi 1236)',
        why:
          `Replica đang cần đọc tiếp từ ${replica.readFile ?? '?'} nhưng file đó không còn trên master — binlog đã bị xoá (hết hạn giữ, PURGE, hoặc đầy ổ). ` +
          `START SLAVE bao nhiêu lần cũng vô ích: dữ liệu cần thiết đã biến mất, replica BẮT BUỘC phải nạp lại từ master.${detail}`,
        checks: [
          { label: 'Master còn giữ những file binlog nào', kind: 'sql', on: 'master', text: 'SHOW BINARY LOGS;', danger: 'safe', note: `Nếu ${replica.readFile ?? 'file replica cần'} không có trong danh sách này thì đúng là đã mất.` },
          { label: 'Binlog đang được giữ bao lâu', kind: 'sql', on: 'master', text: "SHOW GLOBAL VARIABLES LIKE '%expire_logs%';", danger: 'safe' }
        ],
        fixes: [
          {
            label: 'Bước 1 — Tạo dump từ master kèm vị trí binlog',
            kind: 'shell',
            on: 'master',
            text: `mysqldump --single-transaction --master-data=2 --routines --triggers --events \\\n  --all-databases > ${dumpFile}`,
            danger: 'caution',
            note: '--single-transaction để không khoá bảng InnoDB. --master-data=2 ghi sẵn dòng CHANGE MASTER TO (dạng comment) vào đầu file dump — đó chính là vị trí cần dùng ở bước 3.'
          },
          {
            label: 'Bước 2 — Đọc vị trí binlog trong dump',
            kind: 'shell',
            on: 'master',
            text: `head -50 ${dumpFile} | grep -i 'CHANGE MASTER'`,
            danger: 'safe'
          },
          {
            label: 'Bước 3 — Nạp lại replica từ đầu',
            kind: 'sql',
            on: 'replica',
            text:
              'STOP SLAVE;\nRESET SLAVE ALL;\n' +
              `-- Nạp dump: mysql < ${dumpFile}\n` +
              "CHANGE MASTER TO\n  MASTER_HOST='<ip-master>',\n  MASTER_USER='repl',\n  MASTER_PASSWORD='<mật-khẩu>',\n  MASTER_LOG_FILE='<file ở bước 2>',\n  MASTER_LOG_POS=<pos ở bước 2>;\nSTART SLAVE;",
            danger: 'destructive',
            note: 'XOÁ TOÀN BỘ dữ liệu replica hiện tại và nạp lại. Replica không phục vụ đọc được trong suốt quá trình (vài phút tới vài giờ tuỳ kích thước DB).'
          },
          {
            label: 'Phòng lần sau — tăng thời gian giữ binlog trên master',
            kind: 'sql',
            on: 'master',
            text: 'SET GLOBAL binlog_expire_logs_seconds = 604800;  -- 7 ngày (MySQL 8 / MariaDB 10.6+)\n-- MariaDB cũ hơn: SET GLOBAL expire_logs_days = 7;',
            danger: 'safe',
            note: 'Nhớ ghi cả vào my.cnf, nếu không sẽ mất khi restart. Đổi lại phải theo dõi dung lượng ổ chứa binlog.'
          }
        ]
      })
    } else if (IO_NETWORK_ERRNOS.has(errno)) {
      push({
        id: 'io-network',
        severity: 'critical',
        title: 'Replica không nối được tới master',
        why: `IO thread dừng với lỗi ${errno} — không mở được kết nối tới ${replica.masterHost ?? 'master'}:${replica.masterPort ?? 3306}. Nguyên nhân thường gặp: master đang tắt, firewall chặn, hoặc master quá tải (hết max_connections).${detail}`,
        checks: [
          { label: 'Cổng master có thông không', kind: 'shell', on: 'replica', text: `timeout 5 bash -c '</dev/tcp/${replica.masterHost ?? '<ip-master>'}/${replica.masterPort ?? 3306}' && echo THONG || echo TAC`, danger: 'safe' },
          { label: 'Master còn sống và còn chỗ nhận kết nối không', kind: 'sql', on: 'master', text: "SHOW GLOBAL STATUS LIKE 'Threads_connected';\nSHOW GLOBAL VARIABLES LIKE 'max_connections';", danger: 'safe' }
        ],
        fixes: [
          { label: 'Cho IO thread chạy lại (sau khi đã thông mạng)', kind: 'sql', on: 'replica', text: 'START SLAVE IO_THREAD;', danger: 'safe', note: 'An toàn: chỉ nối lại và đọc tiếp từ đúng vị trí cũ, không đụng dữ liệu.' }
        ]
      })
    } else if (errno === 1045 || errno === 1130 || errno === 1044) {
      push({
        id: 'io-auth',
        severity: 'critical',
        title: 'Tài khoản replication bị master từ chối',
        why: `IO thread dừng với lỗi ${errno} — master không chấp nhận user replication (sai mật khẩu, user chưa được cấp quyền, hoặc IP của replica chưa được cho phép).${detail}`,
        checks: [
          { label: 'Quyền của user replication trên master', kind: 'sql', on: 'master', text: "SELECT user, host FROM mysql.user WHERE Repl_slave_priv = 'Y';", danger: 'safe' },
          { label: 'Replica đang dùng user nào', kind: 'sql', on: 'replica', text: 'SHOW SLAVE STATUS\\G', danger: 'safe', note: 'Xem trường Master_User.' }
        ],
        fixes: [
          { label: 'Cấp lại quyền cho user replication trên master', kind: 'sql', on: 'master', text: "CREATE USER IF NOT EXISTS 'repl'@'<ip-replica>' IDENTIFIED BY '<mật-khẩu>';\nGRANT REPLICATION SLAVE ON *.* TO 'repl'@'<ip-replica>';\nFLUSH PRIVILEGES;", danger: 'caution' },
          { label: 'Đặt lại mật khẩu phía replica rồi chạy tiếp', kind: 'sql', on: 'replica', text: "STOP SLAVE;\nCHANGE MASTER TO MASTER_PASSWORD='<mật-khẩu>';\nSTART SLAVE;", danger: 'caution' }
        ]
      })
    } else if (errno === 1593) {
      push({
        id: 'io-1593-fatal',
        severity: 'critical',
        title: 'Lỗi nghiêm trọng khi khởi động IO thread (1593)',
        why: `Thường là server_id hoặc server_uuid của replica trùng với master/replica khác. Hai server cùng id sẽ đá nhau ra khỏi kết nối replication một cách ngẫu nhiên.${detail}`,
        checks: [
          { label: 'So server_id hai bên', kind: 'sql', on: 'replica', text: "SHOW GLOBAL VARIABLES LIKE 'server%id';", danger: 'safe' }
        ],
        fixes: [
          { label: 'Đổi server_id của replica cho khác master', kind: 'sql', on: 'replica', text: 'SET GLOBAL server_id = <số khác>;\nSTOP SLAVE; START SLAVE;', danger: 'caution', note: 'Phải ghi cả vào my.cnf, nếu không sẽ quay lại giá trị cũ khi restart. MySQL trùng server_uuid thì phải xoá auto.cnf rồi restart.' }
        ]
      })
    } else if (errno !== 0) {
      push({
        id: 'io-error',
        severity: 'critical',
        title: `IO thread dừng vì lỗi ${errno}`,
        why: `Replica không tải được binlog từ master.${detail}`,
        checks: [{ label: 'Xem toàn bộ trạng thái replica', kind: 'sql', on: 'replica', text: 'SHOW SLAVE STATUS\\G', danger: 'safe' }],
        fixes: [{ label: 'Thử cho IO thread chạy lại', kind: 'sql', on: 'replica', text: 'START SLAVE IO_THREAD;', danger: 'safe' }]
      })
    } else if (replica.ioRunning === 'connecting') {
      push({
        id: 'io-connecting',
        severity: 'warn',
        title: 'IO thread đang thử kết nối lại tới master',
        why: 'Trạng thái trung gian — chưa phải lỗi. Nếu kẹt ở đây quá lâu (trên 1 phút) thì mạng tới master đang có vấn đề.',
        checks: [{ label: 'Cổng master có thông không', kind: 'shell', on: 'replica', text: `timeout 5 bash -c '</dev/tcp/${replica.masterHost ?? '<ip-master>'}/${replica.masterPort ?? 3306}' && echo THONG || echo TAC`, danger: 'safe' }],
        fixes: []
      })
    } else {
      push({
        id: 'io-stopped-manual',
        severity: 'warn',
        title: 'IO thread đang tắt (không có lỗi)',
        why: 'Không ghi nhận lỗi nào — nhiều khả năng ai đó đã chạy STOP SLAVE và quên bật lại.',
        checks: [],
        fixes: [{ label: 'Bật lại IO thread', kind: 'sql', on: 'replica', text: 'START SLAVE IO_THREAD;', danger: 'safe' }]
      })
    }
  }

  // --- SQL thread ----------------------------------------------------------
  if (replica.sqlRunning !== 'yes') {
    const errno = replica.lastSqlErrno || replica.lastErrno
    const errorText = replica.lastSqlError || replica.lastError
    const table = extractTableFromError(errorText)
    const detail = errorText ? `\n\nLỗi gốc: ${errorText}` : ''
    const skipFix: Cmd = {
      label: '⚠ Bỏ qua sự kiện đang kẹt (chỉ khi đã xem và chấp nhận mất nó)',
      kind: 'sql',
      on: 'replica',
      text: 'STOP SLAVE;\nSET GLOBAL sql_slave_skip_counter = 1;\nSTART SLAVE;',
      danger: 'destructive',
      note: 'Bỏ qua = CHẤP NHẬN replica VĨNH VIỄN thiếu/khác master ở bản ghi đó. Nếu chưa xem bản ghi bằng các lệnh phía trên thì đừng chạy — sẽ giấu luôn dấu vết lệch dữ liệu và lần sau lỗi sẽ khó truy hơn.'
    }
    const inspect = (extra?: string): Cmd[] =>
      table
        ? [
            { label: `So bản ghi trong ${table} ở REPLICA`, kind: 'sql', on: 'replica', text: `SELECT * FROM ${table} WHERE <điều kiện khoá trong thông báo lỗi>\\G`, danger: 'safe', note: extra },
            { label: `So bản ghi đó ở MASTER`, kind: 'sql', on: 'master', text: `SELECT * FROM ${table} WHERE <cùng điều kiện>\\G`, danger: 'safe' }
          ]
        : [{ label: 'Xem chi tiết lỗi để biết bảng/bản ghi nào kẹt', kind: 'sql', on: 'replica', text: 'SHOW SLAVE STATUS\\G', danger: 'safe' }]

    if (errno === 1062) {
      push({
        id: 'sql-1062-duplicate',
        severity: 'critical',
        title: 'SQL thread chết vì trùng khoá (1062)',
        why:
          `Replica nhận lệnh ghi một bản ghi đã tồn tại sẵn ở đó${table ? ` trong bảng ${table}` : ''}. ` +
          'Nghĩa là dữ liệu hai bên ĐÃ lệch từ trước: có ai đó ghi thẳng vào replica, hoặc một lần skip trước đây đã để lại hậu quả.' +
          detail,
        checks: inspect('Nếu hai bên GIỐNG HỆT nhau thì bỏ qua sự kiện là an toàn. Nếu KHÁC nhau thì phải sửa dữ liệu replica cho khớp master trước.'),
        fixes: [
          { label: 'Chặn nguồn gốc: khoá không cho ghi vào replica nữa', kind: 'sql', on: 'replica', text: 'SET GLOBAL read_only = ON;\nSET GLOBAL super_read_only = ON;', danger: 'safe', note: 'Nên làm ngay, kể cả trước khi xử lý xong lỗi này.' },
          skipFix
        ]
      })
    } else if (errno === 1032) {
      push({
        id: 'sql-1032-missing-row',
        severity: 'critical',
        title: 'SQL thread chết vì không tìm thấy bản ghi cần sửa/xoá (1032)',
        why:
          `Master gửi lệnh UPDATE/DELETE cho một bản ghi mà replica KHÔNG CÓ${table ? ` trong bảng ${table}` : ''}. ` +
          'Đây là dấu hiệu dữ liệu đã lệch từ trước — thường do một sự kiện trước đó bị bỏ qua, hoặc dữ liệu replica bị xoá tay.' +
          detail,
        checks: inspect('Bản ghi thiếu hẳn ở replica thì việc bỏ qua UPDATE/DELETE là vô hại. Nhưng phải kiểm xem còn bao nhiêu bản ghi khác cũng thiếu (xem tab So lệch dữ liệu).'),
        fixes: [
          { label: 'Chép lại bảng lệch từ master (an toàn hơn skip khi lệch nhiều)', kind: 'shell', on: 'master', text: `mysqldump --single-transaction <database> <bảng> > /tmp/fix-table.sql\n# rồi nạp vào replica: mysql <database> < /tmp/fix-table.sql`, danger: 'caution', note: 'Phải STOP SLAVE trước khi nạp và START SLAVE sau khi xong.' },
          skipFix
        ]
      })
    } else if (errno === 1050 || errno === 1051 || errno === 1146 || errno === 1054 || errno === 1091 || errno === 1060) {
      push({
        id: 'sql-ddl-mismatch',
        severity: 'critical',
        title: `SQL thread chết vì cấu trúc bảng hai bên khác nhau (${errno})`,
        why:
          `Lỗi ${errno} nghĩa là bảng/cột mà master nhắc tới không khớp với những gì đang có trên replica ` +
          '(bảng đã tồn tại, không tồn tại, hoặc thiếu cột). Gần như luôn do có người chạy DDL thẳng trên replica, hoặc một lần ALTER trước đây chạy dở.' +
          detail,
        checks: [
          ...(table
            ? [
                { label: `Cấu trúc ${table} ở REPLICA`, kind: 'sql' as const, on: 'replica' as const, text: `SHOW CREATE TABLE ${table}\\G`, danger: 'safe' as const },
                { label: `Cấu trúc ${table} ở MASTER`, kind: 'sql' as const, on: 'master' as const, text: `SHOW CREATE TABLE ${table}\\G`, danger: 'safe' as const }
              ]
            : []),
          { label: 'Quét toàn bộ chênh lệch cấu trúc', kind: 'sql', on: 'replica', text: 'SHOW SLAVE STATUS\\G', danger: 'safe', note: 'Dùng tab "So lệch cấu trúc" để đối chiếu cả schema thay vì soi từng bảng.' }
        ],
        fixes: [
          { label: 'Sửa cấu trúc replica cho khớp master rồi chạy tiếp', kind: 'sql', on: 'replica', text: '-- Áp đúng câu DDL mà master đã chạy, ví dụ:\n-- ALTER TABLE <bảng> ADD COLUMN <cột> ...;\nSTART SLAVE;', danger: 'caution', note: 'Sửa cho KHỚP master, đừng sáng tạo thêm — lệch cấu trúc sẽ tiếp tục gây lỗi ở các sự kiện sau.' },
          skipFix
        ]
      })
    } else if (errno === 1594 || errno === 1595) {
      push({
        id: 'sql-relay-corrupt',
        severity: 'critical',
        title: `Relay log hỏng (${errno})`,
        why: `Replica không đọc tiếp được relay log của chính nó (thường do máy tắt đột ngột hoặc đầy ổ). Dữ liệu trong relay log tải lại từ master được nên KHÔNG mất gì — chỉ cần bảo replica tải lại từ vị trí đã apply xong.${detail}`,
        checks: [
          { label: 'Ổ chứa dữ liệu còn trống không', kind: 'shell', on: 'replica', text: 'df -h', danger: 'safe' },
          { label: 'Lỗi trong log MySQL', kind: 'shell', on: 'replica', text: "tail -100 /var/log/mysql/error.log 2>/dev/null || journalctl -u mariadb -n 100 --no-pager", danger: 'safe' }
        ],
        fixes: [
          {
            label: 'Vứt relay log hỏng và tải lại từ vị trí đã apply xong',
            kind: 'sql',
            on: 'replica',
            text:
              'STOP SLAVE;\nCHANGE MASTER TO\n' +
              `  MASTER_LOG_FILE='${replica.execFile ?? '<Relay_Master_Log_File>'}',\n` +
              `  MASTER_LOG_POS=${replica.execPos ?? '<Exec_Master_Log_Pos>'};\nSTART SLAVE;`,
            danger: 'caution',
            note: 'Vị trí ở trên là Exec_Master_Log_Pos hiện tại (phần đã apply xong) — an toàn vì mọi thứ sau đó sẽ được tải lại từ master. Chỉ đúng khi master vẫn còn giữ file binlog đó.'
          }
        ]
      })
    } else if (errno !== 0) {
      push({
        id: 'sql-error',
        severity: 'critical',
        title: `SQL thread dừng vì lỗi ${errno}`,
        why: `Replica không apply được sự kiện từ master.${detail}`,
        checks: inspect(),
        fixes: [{ label: 'Thử chạy lại SQL thread (nếu lỗi chỉ là tạm thời)', kind: 'sql', on: 'replica', text: 'START SLAVE SQL_THREAD;', danger: 'caution' }, skipFix]
      })
    } else {
      push({
        id: 'sql-stopped-manual',
        severity: 'warn',
        title: 'SQL thread đang tắt (không có lỗi)',
        why: 'Không ghi nhận lỗi nào — nhiều khả năng ai đó đã chạy STOP SLAVE hoặc STOP SLAVE SQL_THREAD và quên bật lại. Replica vẫn tải binlog về nhưng không apply, nên sẽ tụt dần.',
        checks: [],
        fixes: [{ label: 'Bật lại SQL thread', kind: 'sql', on: 'replica', text: 'START SLAVE SQL_THREAD;', danger: 'safe' }]
      })
    }
  }

  // --- Trễ khi replication vẫn đang chạy ------------------------------------
  if (drift?.healthy) {
    const lag = drift.effectiveLagSec
    if (lag !== null && lag >= opts.lagWarnSec) {
      push(lagDiagnosis(lag, replica, replicaVars, masterVars))
    }
    if (drift.applyGapBytes !== null && drift.applyGapBytes >= opts.applyGapWarnBytes) {
      push({
        id: 'apply-backlog',
        severity: 'warn',
        title: 'SQL thread apply không kịp',
        why: `Replica đã tải về ${formatBytes(drift.applyGapBytes)} binlog nhưng chưa apply xong. Binlog đã nằm sẵn trên đĩa replica nên đây KHÔNG phải vấn đề mạng — nút thắt nằm ở tốc độ ghi của replica.`,
        checks: [
          { label: 'SQL thread đang mắc ở đâu', kind: 'sql', on: 'replica', text: 'SHOW SLAVE STATUS\\G', danger: 'safe', note: `Xem Slave_SQL_Running_State — hiện tại: ${replica.sqlRunningState ?? 'không rõ'}` },
          { label: 'Truy vấn nào đang chạy lâu trên replica', kind: 'sql', on: 'replica', text: 'SHOW FULL PROCESSLIST;', danger: 'safe' }
        ],
        fixes: parallelApplyFixes(replicaVars)
      })
    }
    if (drift.fetchFilesBehind !== null && drift.fetchFilesBehind > 0) {
      push({
        id: 'fetch-backlog',
        severity: 'warn',
        title: `IO thread còn cách master ${drift.fetchFilesBehind} file binlog`,
        why: 'Replica tải binlog về không kịp tốc độ master ghi ra. Thường do băng thông giữa hai máy, hoặc master vừa chạy một thao tác ghi rất lớn (ALTER, import).',
        checks: [
          { label: 'Master có đang ghi ồ ạt không', kind: 'sql', on: 'master', text: 'SHOW FULL PROCESSLIST;', danger: 'safe' },
          { label: 'Băng thông giữa replica và master', kind: 'shell', on: 'replica', text: `ping -c 5 ${replica.masterHost ?? '<ip-master>'}`, danger: 'safe' }
        ],
        fixes: [
          { label: 'Bật nén binlog trên đường truyền (nếu master ở xa)', kind: 'sql', on: 'replica', text: 'STOP SLAVE;\nSET GLOBAL slave_compressed_protocol = ON;\nSTART SLAVE;', danger: 'caution', note: 'Đổi CPU lấy băng thông — chỉ đáng khi master ở khác datacenter. MySQL 8 dùng CHANGE REPLICATION SOURCE TO SOURCE_COMPRESSION_ALGORITHMS=...' }
        ]
      })
    }
  }

  // --- Cấu hình nguy hiểm ---------------------------------------------------
  if (replicaVars?.readOnly === false) {
    push({
      id: 'replica-writable',
      severity: 'warn',
      title: 'Replica đang cho phép GHI',
      why: 'read_only đang OFF. Bất kỳ ứng dụng nào trỏ nhầm vào replica đều ghi được, và những bản ghi đó sẽ không bao giờ có trên master — đây chính là nguồn gốc của lỗi 1062/1032 về sau.',
      checks: [{ label: 'Ai đang kết nối vào replica', kind: 'sql', on: 'replica', text: 'SHOW FULL PROCESSLIST;', danger: 'safe' }],
      fixes: [
        { label: 'Khoá ghi ngay', kind: 'sql', on: 'replica', text: 'SET GLOBAL read_only = ON;\nSET GLOBAL super_read_only = ON;', danger: 'safe', note: 'Không ảnh hưởng replication — SQL thread vẫn ghi được vì nó chạy với quyền hệ thống. Chỉ chặn client thường.' },
        { label: 'Giữ nguyên sau khi restart', kind: 'shell', on: 'replica', text: "printf '[mysqld]\\nread_only=ON\\nsuper_read_only=ON\\n' | sudo tee /etc/my.cnf.d/99-readonly.cnf", danger: 'caution', note: 'Đường dẫn thư mục config có thể là /etc/mysql/conf.d/ tuỳ distro.' }
      ]
    })
  }

  if (
    masterVars?.serverId !== null &&
    masterVars?.serverId !== undefined &&
    replicaVars?.serverId !== null &&
    replicaVars?.serverId !== undefined &&
    masterVars.serverId === replicaVars.serverId
  ) {
    push({
      id: 'server-id-conflict',
      severity: 'critical',
      title: `Master và replica trùng server_id (${masterVars.serverId})`,
      why: 'Hai server cùng server_id sẽ liên tục đá nhau ra khỏi kết nối replication, gây đứt ngẫu nhiên rất khó truy. Mỗi server trong cùng một topology bắt buộc phải có id riêng.',
      checks: [{ label: 'Xác nhận id hai bên', kind: 'sql', on: 'replica', text: "SHOW GLOBAL VARIABLES LIKE 'server_id';", danger: 'safe' }],
      fixes: [
        { label: 'Đổi server_id của replica', kind: 'sql', on: 'replica', text: `SET GLOBAL server_id = ${(masterVars.serverId ?? 1) + 1};`, danger: 'caution', note: 'Phải ghi cả vào my.cnf rồi restart, nếu không sẽ mất khi khởi động lại.' }
      ]
    })
  }

  if (masterVars?.logBin === false) {
    push({
      id: 'master-binlog-off',
      severity: 'critical',
      title: 'Master không bật binary log',
      why: 'log_bin đang OFF — master không ghi binlog thì không có gì để replica đọc. Replication không thể hoạt động cho tới khi bật lại (cần restart MySQL).',
      checks: [{ label: 'Xác nhận', kind: 'sql', on: 'master', text: "SHOW GLOBAL VARIABLES LIKE 'log_bin';", danger: 'safe' }],
      fixes: [
        { label: 'Bật binlog rồi restart master', kind: 'shell', on: 'master', text: "printf '[mysqld]\\nlog_bin=mysql-bin\\nbinlog_format=ROW\\n' | sudo tee /etc/my.cnf.d/99-binlog.cnf\nsudo systemctl restart mariadb", danger: 'destructive', note: 'CÓ DOWNTIME — restart master. Sau khi bật, replica phải được nạp lại từ dump mới.' }
      ]
    })
  }

  if (masterVars?.binlogFormat && masterVars.binlogFormat.toUpperCase() === 'STATEMENT') {
    push({
      id: 'binlog-format-statement',
      severity: 'warn',
      title: 'Master đang dùng binlog_format = STATEMENT',
      why: 'Chế độ STATEMENT chép lại CÂU LỆNH chứ không chép KẾT QUẢ. Những câu có yếu tố không xác định (NOW(), UUID(), RAND(), UPDATE ... LIMIT không ORDER BY) sẽ cho kết quả KHÁC NHAU ở hai bên mà replication vẫn báo OK. Đây là kiểu lệch dữ liệu âm thầm khó phát hiện nhất.',
      checks: [{ label: 'Xác nhận chế độ hiện tại', kind: 'sql', on: 'master', text: "SHOW GLOBAL VARIABLES LIKE 'binlog_format';", danger: 'safe' }],
      fixes: [
        { label: 'Chuyển sang ROW', kind: 'sql', on: 'master', text: "SET GLOBAL binlog_format = 'ROW';", danger: 'caution', note: 'Chỉ áp dụng cho kết nối mới. Ghi thêm binlog_format=ROW vào my.cnf để giữ sau restart. Binlog sẽ to hơn đáng kể — kiểm tra dung lượng ổ trước.' }
      ]
    })
  }

  if (masterVars?.binlogExpireSeconds !== null && masterVars?.binlogExpireSeconds !== undefined && masterVars.binlogExpireSeconds < opts.binlogRetentionMinSec) {
    push({
      id: 'binlog-retention-short',
      severity: 'warn',
      title: `Master chỉ giữ binlog ${formatDuration(masterVars.binlogExpireSeconds)}`,
      why: `Nếu replica chết hoặc tụt lâu hơn khoảng này, binlog cần thiết sẽ bị xoá mất và replica chỉ còn cách nạp lại toàn bộ từ đầu (lỗi 1236). Nên giữ ít nhất ${formatDuration(opts.binlogRetentionMinSec)} để có thời gian xử lý sự cố.`,
      checks: [{ label: 'Binlog đang chiếm bao nhiêu dung lượng', kind: 'sql', on: 'master', text: 'SHOW BINARY LOGS;', danger: 'safe' }],
      fixes: [
        { label: 'Tăng thời gian giữ binlog', kind: 'sql', on: 'master', text: 'SET GLOBAL binlog_expire_logs_seconds = 604800;  -- 7 ngày', danger: 'safe', note: 'Kiểm tra ổ đủ chỗ trước. Nhớ ghi vào my.cnf.' }
      ]
    })
  }

  // --- Thông tin (không phải lỗi, nhưng cần biết để khỏi hiểu nhầm) ---------
  if (replica.filters.any) {
    const list = [
      replica.filters.doDb && `Do_DB=${replica.filters.doDb}`,
      replica.filters.ignoreDb && `Ignore_DB=${replica.filters.ignoreDb}`,
      replica.filters.doTable && `Do_Table=${replica.filters.doTable}`,
      replica.filters.ignoreTable && `Ignore_Table=${replica.filters.ignoreTable}`,
      replica.filters.wildDoTable && `Wild_Do_Table=${replica.filters.wildDoTable}`,
      replica.filters.wildIgnoreTable && `Wild_Ignore_Table=${replica.filters.wildIgnoreTable}`
    ]
      .filter(Boolean)
      .join(' · ')
    push({
      id: 'repl-filters',
      severity: 'info',
      title: 'Replication đang có bộ lọc',
      why: `${list}. Nghĩa là dữ liệu hai bên lệch nhau ở phạm vi bị lọc là CỐ Ý, không phải sự cố — đừng coi chênh lệch ở các bảng đó là lỗi khi so dữ liệu.`,
      checks: [],
      fixes: []
    })
  }

  if (replica.sqlDelaySec > 0) {
    push({
      id: 'delayed-replica',
      severity: 'info',
      title: `Replica được cấu hình trễ cố ý ${formatDuration(replica.sqlDelaySec)}`,
      why: `MASTER_DELAY = ${replica.sqlDelaySec}s. Seconds_Behind_Master lớn ở đây là BÌNH THƯỜNG (đây thường là replica dự phòng để cứu dữ liệu khi lỡ tay DROP trên master). Ngưỡng cảnh báo được tính trên phần trễ ngoài dự kiến, không tính phần cố ý này.`,
      checks: [],
      fixes: []
    })
  }

  if (replica.ioRunning === 'yes' && replica.sqlRunning === 'yes' && replica.secondsBehind === null) {
    push({
      id: 'sbm-null',
      severity: 'info',
      title: 'Chưa đo được độ trễ',
      why: 'Cả hai thread đang chạy nhưng Seconds_Behind_Master là NULL — thường xảy ra ngay sau khi START SLAVE hoặc khi IO thread vừa kết nối lại. Theo dõi thêm vài chu kỳ; nếu vẫn NULL thì xem khoảng cách binlog theo byte thay vì tin vào chỉ số này.',
      checks: [],
      fixes: []
    })
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** Luật "trễ cao" tách riêng vì phần gợi ý phụ thuộc nhiều thứ. */
function lagDiagnosis(
  lagSec: number,
  replica: ReplicaStatus,
  replicaVars: ReplVars | null,
  masterVars: ReplVars | null
): Diagnosis {
  const workers = replicaVars?.slaveParallelWorkers ?? null
  const singleThreaded = workers !== null && workers <= 1
  return {
    id: 'lag-high',
    severity: 'warn',
    title: `Replica trễ ${formatDuration(lagSec)} so với master`,
    why:
      'Replication vẫn chạy, không có lỗi — chỉ là apply không kịp. ' +
      (singleThreaded
        ? 'Replica đang apply bằng MỘT luồng duy nhất, trong khi master nhận ghi từ nhiều kết nối song song. Đây là nguyên nhân phổ biến nhất. '
        : '') +
      (replica.sqlRunningState ? `Trạng thái SQL thread: "${replica.sqlRunningState}". ` : '') +
      'Ba nguyên nhân hay gặp: bảng thiếu PRIMARY KEY (mỗi dòng phải quét toàn bảng khi apply ROW event), transaction dài trên master, hoặc đĩa replica chậm hơn master.',
    checks: [
      {
        label: 'Tìm bảng THIẾU PRIMARY KEY — nguyên nhân số 1 gây trễ với binlog ROW',
        kind: 'sql',
        on: 'replica',
        text:
          'SELECT t.table_schema, t.table_name, t.table_rows\n' +
          'FROM information_schema.tables t\n' +
          'LEFT JOIN information_schema.table_constraints c\n' +
          "  ON c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.constraint_type = 'PRIMARY KEY'\n" +
          "WHERE t.table_type = 'BASE TABLE'\n" +
          "  AND t.table_schema NOT IN ('mysql','information_schema','performance_schema','sys')\n" +
          '  AND c.constraint_name IS NULL\n' +
          'ORDER BY t.table_rows DESC;',
        danger: 'safe',
        note: 'Bảng lớn không có PRIMARY KEY: mỗi UPDATE/DELETE một dòng trên master sẽ khiến replica quét TOÀN BỘ bảng. Thêm PK thường giảm trễ từ hàng giờ xuống vài giây.'
      },
      { label: 'Transaction dài đang chạy trên master', kind: 'sql', on: 'master', text: 'SELECT * FROM information_schema.innodb_trx ORDER BY trx_started\\G', danger: 'safe' },
      { label: 'Đĩa replica có đang nghẽn không', kind: 'shell', on: 'replica', text: 'iostat -x 1 3 2>/dev/null || vmstat 1 3', danger: 'safe' }
    ],
    fixes: [
      ...(singleThreaded ? parallelApplyFixes(replicaVars) : []),
      ...(masterVars && flavorOf(masterVars) === 'mysql'
        ? [
            {
              label: 'Cho phép replica song song hoá tốt hơn (đặt trên MASTER)',
              kind: 'sql' as const,
              on: 'master' as const,
              text: "SET GLOBAL binlog_transaction_dependency_tracking = 'WRITESET';",
              danger: 'caution' as const,
              note: 'Master đánh dấu transaction nào độc lập với nhau để replica apply song song được nhiều hơn. Chỉ có trên MySQL 8.'
            }
          ]
        : [])
    ]
  }
}

/** Lệnh tăng số luồng apply — tên biến khác nhau giữa MariaDB và MySQL 8. */
function parallelApplyFixes(replicaVars: ReplVars | null): Cmd[] {
  if (flavorOf(replicaVars) === 'mysql') {
    return [
      {
        label: 'Tăng số luồng apply song song (MySQL 8)',
        kind: 'sql',
        on: 'replica',
        text:
          'STOP REPLICA SQL_THREAD;\n' +
          'SET GLOBAL replica_parallel_workers = 4;\n' +
          "SET GLOBAL replica_parallel_type = 'LOGICAL_CLOCK';\n" +
          'SET GLOBAL replica_preserve_commit_order = ON;\n' +
          'START REPLICA SQL_THREAD;',
        danger: 'caution',
        note: 'Ghi vào my.cnf để giữ sau restart. Giữ replica_preserve_commit_order = ON nếu ứng dụng đọc từ replica và cần thứ tự commit giống master.'
      }
    ]
  }
  return [
    {
      label: 'Tăng số luồng apply song song (MariaDB)',
      kind: 'sql',
      on: 'replica',
      text:
        'STOP SLAVE SQL_THREAD;\n' +
        'SET GLOBAL slave_parallel_threads = 4;\n' +
        "SET GLOBAL slave_parallel_mode = 'optimistic';\n" +
        'START SLAVE SQL_THREAD;',
      danger: 'caution',
      note: "Ghi vào my.cnf để giữ sau restart. Chế độ 'optimistic' cho song song cao nhất nhưng sẽ rollback-retry khi có xung đột; nếu thấy nhiều retry thì hạ về 'conservative'."
    }
  ]
}
