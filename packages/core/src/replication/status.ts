/**
 * F55 — Đọc trạng thái replication MySQL/MariaDB và tính độ lệch master ↔ slave.
 *
 * TOÀN BỘ FILE LÀ HÀM THUẦN: không SSH, không driver, không Date.now(). Đầu vào là
 * row đã lấy được (từ driver mysql2 hoặc từ output `\G` của CLI), đầu ra là DTO chuẩn.
 * Nhờ vậy mọi trường hợp khó (MySQL 8.4, replica đứt 1236, SBM NULL…) test được bằng
 * fixture, không cần dựng server thật.
 *
 * BA CÁI BẪY mà file này tồn tại để xử lý:
 *  1. MySQL 8.0.22 đổi hết tên trường (`Slave_*`→`Replica_*`, `Master_*`→`Source_*`) và
 *     MySQL 8.4 XOÁ HẲN `SHOW SLAVE STATUS`/`SHOW MASTER STATUS`. MariaDB thì giữ tên cũ
 *     mãi mãi. → `readField` tra theo bảng alias, `replicaStatusSqlFor` chọn đúng câu lệnh.
 *  2. `Seconds_Behind_Master` LÀ CHỈ SỐ NÓI DỐI: IO thread chết thì nó vẫn báo 0 (SQL thread
 *     đã apply hết những gì đã tải về), còn replica cố ý trễ (MASTER_DELAY) thì nó báo số to
 *     mà hoàn toàn bình thường. → luôn tính thêm khoảng cách binlog theo byte và trừ SQL_Delay.
 *  3. Trạng thái master và replica đọc ở 2 thời điểm khác nhau trên 2 máy khác nhau → hiệu vị
 *     trí có thể ÂM một cách hợp lệ. → kẹp về 0 thay vì trả số vô nghĩa.
 */

/** Trạng thái 1 thread replication. `connecting` là trạng thái trung gian, chưa phải lỗi. */
export type ThreadState = 'yes' | 'no' | 'connecting' | 'unknown'

/** Dòng lệnh SQL đọc trạng thái — thử theo thứ tự, câu đầu lỗi cú pháp thì rơi xuống câu sau. */
export type StatusSql = string

export interface ServerVersion {
  raw: string
  flavor: 'mariadb' | 'mysql' | 'unknown'
  major: number
  minor: number
  patch: number
}

/** Bộ lọc replication. Có bất kỳ filter nào → dữ liệu 2 bên lệch nhau là CỐ Ý, đừng báo động. */
export interface ReplFilters {
  doDb: string
  ignoreDb: string
  doTable: string
  ignoreTable: string
  wildDoTable: string
  wildIgnoreTable: string
  /** true nếu có ít nhất một filter khác rỗng. */
  any: boolean
}

export interface ReplicaStatus {
  ioState: string | null
  masterHost: string | null
  masterPort: number | null
  masterServerId: number | null
  ioRunning: ThreadState
  sqlRunning: ThreadState
  /** Vị trí binlog MASTER mà IO thread đã TẢI VỀ tới. */
  readFile: string | null
  readPos: number | null
  /** Vị trí binlog MASTER mà SQL thread đã APPLY XONG tới. */
  execFile: string | null
  execPos: number | null
  /** Seconds_Behind_Master thô — xem cảnh báo ở đầu file. */
  secondsBehind: number | null
  sqlRunningState: string | null
  relayLogSpace: number | null
  lastErrno: number
  lastError: string | null
  lastIoErrno: number
  lastIoError: string | null
  lastSqlErrno: number
  lastSqlError: string | null
  /** CHANGE MASTER TO MASTER_DELAY=N — replica CỐ Ý chạy sau N giây. */
  sqlDelaySec: number
  remainingDelaySec: number | null
  /** MariaDB `Using_Gtid` (No/Slave_Pos/Current_Pos) hoặc MySQL `Auto_Position` (0/1). */
  usingGtid: string | null
  filters: ReplFilters
}

export interface MasterStatus {
  file: string | null
  position: number | null
  doDb: string
  ignoreDb: string
}

/** Biến hệ thống cần cho chẩn đoán (lấy bằng VARS_SQL). */
export interface ReplVars {
  serverId: number | null
  readOnly: boolean | null
  superReadOnly: boolean | null
  binlogFormat: string | null
  logBin: boolean | null
  logSlaveUpdates: boolean | null
  gtidMode: string | null
  version: string | null
  slaveParallelWorkers: number | null
  /** Binlog giữ bao lâu (giây) — quá ngắn là nguyên nhân gốc của lỗi 1236. */
  binlogExpireSeconds: number | null
}

export interface ReplDrift {
  /** Seconds_Behind_Master thô. */
  lagSec: number | null
  /** Trễ THẬT = lagSec − SQL_Delay (bỏ phần trễ cố ý). Kẹp ≥ 0. */
  effectiveLagSec: number | null
  /** Byte master đã ghi mà IO thread CHƯA tải về. null khi khác file binlog. */
  fetchGapBytes: number | null
  /** Byte đã tải về mà SQL thread CHƯA apply. null khi khác file binlog. */
  applyGapBytes: number | null
  /** Số file binlog IO thread còn cách master (0 = cùng file). */
  fetchFilesBehind: number | null
  /** Số file binlog SQL thread còn cách vị trí đã tải về. */
  applyFilesBehind: number | null
  /** Cả 2 thread chạy và không có lỗi. */
  healthy: boolean
}

/**
 * Một lần đo MỘT slave (kèm trạng thái master tại cùng thời điểm). Đây là thứ ReplicationService
 * phát ra và diagnose() nhận vào. Cụm có N slave → mỗi chu kỳ phát N sample dùng CHUNG một lần
 * đọc master, nên so giữa các slave mới có nghĩa.
 */
export interface ReplSample {
  pairId: string
  replicaId: string
  /** Nhãn slave để dựng thông báo/cảnh báo mà không cần mở vault. */
  replicaLabel: string
  ts: number
  ok: boolean
  /** Cách đã lấy được số liệu — hiện trên UI để user biết đang chạy đường nào. */
  mode: 'driver' | 'cli' | null
  master: MasterStatus | null
  replica: ReplicaStatus | null
  masterVars: ReplVars | null
  replicaVars: ReplVars | null
  drift: ReplDrift | null
  /** Lỗi khiến cả lần đo hỏng (ok = false). */
  error?: string
  /**
   * Đọc được replica nhưng KHÔNG đọc được master (thường do chỉ có quyền/đường mạng tới slave).
   * Lần đo vẫn hợp lệ — chỉ mất phần so vị trí binlog với master.
   */
  masterError?: string
}

// ---------------------------------------------------------------------------
// Chọn câu lệnh theo phiên bản
// ---------------------------------------------------------------------------

/**
 * Parse `SELECT VERSION()`: "10.11.6-MariaDB-log", "8.0.36", "8.4.0", "5.7.44-log".
 * MariaDB 10.x/11.x luôn có chuỗi "mariadb" trong version string.
 */
export function parseServerVersion(raw: string): ServerVersion {
  const text = String(raw ?? '').trim()
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(text)
  const flavor = /mariadb/i.test(text) ? 'mariadb' : m ? 'mysql' : 'unknown'
  return {
    raw: text,
    flavor,
    major: m ? Number(m[1]) : 0,
    minor: m ? Number(m[2]) : 0,
    patch: m ? Number(m[3]) : 0
  }
}

const atLeast = (v: ServerVersion, major: number, minor: number, patch = 0): boolean =>
  v.major > major ||
  (v.major === major && (v.minor > minor || (v.minor === minor && v.patch >= patch)))

/**
 * Thứ tự câu lệnh đọc trạng thái replica.
 * - MySQL ≥ 8.4: `SHOW SLAVE STATUS` đã bị XOÁ → chỉ còn `SHOW REPLICA STATUS`.
 * - MySQL ≥ 8.0.22: cả hai chạy được, ưu tiên tên mới (tên cũ đã deprecated).
 * - MariaDB / MySQL cũ / không rõ: `SHOW SLAVE STATUS` trước — chạy được trên MỌI bản.
 */
export function replicaStatusSqlFor(version: ServerVersion | null): StatusSql[] {
  if (version && version.flavor === 'mysql') {
    if (atLeast(version, 8, 4)) return ['SHOW REPLICA STATUS']
    if (atLeast(version, 8, 0, 22)) return ['SHOW REPLICA STATUS', 'SHOW SLAVE STATUS']
  }
  return ['SHOW SLAVE STATUS', 'SHOW REPLICA STATUS']
}

/** Tương tự cho master: MySQL 8.4 đổi thành `SHOW BINARY LOG STATUS`. */
export function masterStatusSqlFor(version: ServerVersion | null): StatusSql[] {
  if (version && version.flavor === 'mysql' && atLeast(version, 8, 4)) return ['SHOW BINARY LOG STATUS']
  return ['SHOW MASTER STATUS', 'SHOW BINARY LOG STATUS']
}

/**
 * Đọc RIÊNG hai biến hay đổi, mỗi chu kỳ.
 *
 * Vì sao không gộp vào `VARS_SQL`: `SHOW GLOBAL VARIABLES` KHÔNG phải tra cứu trực tiếp — MySQL
 * dựng cả danh sách ~500 biến rồi mới lọc, và giữ `LOCK_global_system_variables` trong lúc đó.
 * `SELECT @@global.x` thì tra thẳng, rẻ hơn hẳn một bậc. Còn `read_only`/`super_read_only` PHẢI
 * đọc mỗi chu kỳ vì nó là cảnh báo split-brain (slave cho phép ghi) — không được chậm.
 */
export const READ_ONLY_SQL =
  'SELECT @@global.read_only AS read_only, @@global.super_read_only AS super_read_only'

/** Đọc kết quả READ_ONLY_SQL, gộp vào một ReplVars đã có (các field khác giữ nguyên). */
export function mergeReadOnly(vars: ReplVars | null, rows: Record<string, unknown>[]): ReplVars | null {
  const row = rows?.[0]
  if (!row) return vars
  const base: ReplVars = vars ?? {
    serverId: null,
    readOnly: null,
    superReadOnly: null,
    binlogFormat: null,
    logBin: null,
    logSlaveUpdates: null,
    gtidMode: null,
    version: null,
    slaveParallelWorkers: null,
    binlogExpireSeconds: null
  }
  return {
    ...base,
    readOnly: toBool(readField(row, ['read_only'])),
    superReadOnly: toBool(readField(row, ['super_read_only']))
  }
}

/**
 * Biến cấu hình cho chẩn đoán. `SHOW GLOBAL VARIABLES WHERE` chạy trên cả MySQL lẫn MariaDB.
 *
 * ⚠️ Câu này ĐẮT hơn nhiều so với `SELECT @@global.x` (xem READ_ONLY_SQL) mà nội dung lại gần như
 * không đổi (`server_id`, `log_bin`, `binlog_format`, `version`…), nên caller CHỈ đọc lúc mở kết
 * nối rồi làm mới thưa (xem `VARS_REFRESH_MS`), không đọc mỗi chu kỳ.
 *
 * `super_read_only` vẫn nằm trong danh sách để lần đọc đầu có đủ dữ liệu ngay.
 */
export const VARS_SQL =
  "SHOW GLOBAL VARIABLES WHERE Variable_name IN (" +
  [
    'server_id',
    'read_only',
    'super_read_only',
    'binlog_format',
    'log_bin',
    'log_slave_updates',
    'log_replica_updates',
    'gtid_mode',
    'gtid_strict_mode',
    'version',
    'slave_parallel_workers',
    'replica_parallel_workers',
    'expire_logs_days',
    'binlog_expire_logs_seconds'
  ]
    .map((name) => `'${name}'`)
    .join(', ') +
  ')'

// ---------------------------------------------------------------------------
// Parse output `\G` của CLI
// ---------------------------------------------------------------------------

/** Dòng mở đầu một row của `\G`: `*************************** 1. row ***************************`. */
const G_ROW_SEPARATOR = /^\*+\s*\d+\.\s*row\s*\*+$/
/** Cặp `Tên: giá trị`. Tên trường MySQL chỉ gồm chữ/số/gạch dưới nên regex này đủ chặt. */
const G_FIELD = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s?(.*)$/

/**
 * Parse output của `... \G` thành mảng row.
 *
 * Giá trị nhiều dòng (điển hình là `Last_Error` chứa nguyên câu query gây lỗi) được nối lại
 * bằng `\n`: dòng nào KHÔNG khớp `Tên: ...` thì coi là phần tiếp của trường ngay trước.
 * Hạn chế đã biết: nếu dòng tiếp theo của một error message tình cờ bắt đầu bằng `word: ` thì
 * sẽ bị hiểu nhầm thành trường mới. Chấp nhận được — mọi trường ta thực sự dùng đều là 1 dòng,
 * chỉ có `*_Error` là nhiều dòng và nó chỉ để hiển thị.
 */
export function parseVerticalG(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = []
  let current: Record<string, string> | null = null
  let lastKey: string | null = null

  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (G_ROW_SEPARATOR.test(line.trim())) {
      current = {}
      lastKey = null
      rows.push(current)
      continue
    }
    if (!current) continue
    const m = G_FIELD.exec(line)
    if (m) {
      lastKey = m[1]
      current[lastKey] = m[2]
      continue
    }
    // Dòng tiếp của giá trị nhiều dòng. Dòng trống ở cuối output thì bỏ.
    if (lastKey !== null && line.trim() !== '') current[lastKey] += `\n${line}`
  }
  return rows
}

/** `SHOW GLOBAL VARIABLES` → map tên biến (thường hoá) → giá trị. Nhận cả row driver lẫn row `\G`. */
export function variableRowsToMap(rows: Record<string, unknown>[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows ?? []) {
    const name = readField(row, ['Variable_name'])
    const value = readField(row, ['Value'])
    if (typeof name === 'string' && name !== '') out[name.toLowerCase()] = value === null ? '' : String(value)
  }
  return out
}

// ---------------------------------------------------------------------------
// Chuẩn hoá row → DTO
// ---------------------------------------------------------------------------

/**
 * Đọc 1 trường theo danh sách tên có thể có (MariaDB trước, MySQL 8 sau). So khớp KHÔNG
 * phân biệt hoa thường vì driver và CLI trả về cách viết khác nhau ở vài bản.
 */
function readField(row: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (name in row) return row[name]
  }
  const lowered = new Map<string, unknown>()
  for (const [key, value] of Object.entries(row)) lowered.set(key.toLowerCase(), value)
  for (const name of names) {
    const hit = lowered.get(name.toLowerCase())
    if (hit !== undefined) return hit
  }
  return undefined
}

/** Chuỗi/số/bigint/null → number | null. Chuỗi "NULL" của `\G` cũng là null. */
function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return Number(value)
  const text = String(value).trim()
  if (text === '' || text.toUpperCase() === 'NULL') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** Như toNum nhưng thiếu/rác → 0. Dùng cho errno: "không có lỗi" và "không đọc được" đều là 0. */
const toErrno = (value: unknown): number => toNum(value) ?? 0

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  if (text.trim().toUpperCase() === 'NULL') return null
  return text
}

/** Chuỗi rỗng cho các trường filter — null/NULL đều quy về ''. */
const toStr = (value: unknown): string => toText(value) ?? ''

function toThreadState(value: unknown): ThreadState {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'yes') return 'yes'
  if (text === 'no') return 'no'
  if (text === 'connecting' || text === 'preparing') return 'connecting'
  return 'unknown'
}

/** ON/OFF/1/0/true → boolean. Không nhận diện được → null (khác với false!). */
function toBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (text === 'on' || text === '1' || text === 'yes' || text === 'true') return true
  if (text === 'off' || text === '0' || text === 'no' || text === 'false') return false
  return null
}

/**
 * Row `SHOW SLAVE STATUS`/`SHOW REPLICA STATUS` → DTO chuẩn.
 * Nhận cả object từ driver (giá trị đã đúng kiểu) lẫn object từ `parseVerticalG` (toàn chuỗi).
 */
export function normalizeReplicaStatus(row: Record<string, unknown>): ReplicaStatus {
  const filters: ReplFilters = {
    doDb: toStr(readField(row, ['Replicate_Do_DB'])),
    ignoreDb: toStr(readField(row, ['Replicate_Ignore_DB'])),
    doTable: toStr(readField(row, ['Replicate_Do_Table'])),
    ignoreTable: toStr(readField(row, ['Replicate_Ignore_Table'])),
    wildDoTable: toStr(readField(row, ['Replicate_Wild_Do_Table'])),
    wildIgnoreTable: toStr(readField(row, ['Replicate_Wild_Ignore_Table'])),
    any: false
  }
  filters.any = Boolean(
    filters.doDb ||
      filters.ignoreDb ||
      filters.doTable ||
      filters.ignoreTable ||
      filters.wildDoTable ||
      filters.wildIgnoreTable
  )

  const autoPosition = readField(row, ['Using_Gtid', 'Auto_Position'])

  return {
    ioState: toText(readField(row, ['Slave_IO_State', 'Replica_IO_State'])),
    masterHost: toText(readField(row, ['Master_Host', 'Source_Host'])),
    masterPort: toNum(readField(row, ['Master_Port', 'Source_Port'])),
    masterServerId: toNum(readField(row, ['Master_Server_Id', 'Source_Server_Id'])),
    ioRunning: toThreadState(readField(row, ['Slave_IO_Running', 'Replica_IO_Running'])),
    sqlRunning: toThreadState(readField(row, ['Slave_SQL_Running', 'Replica_SQL_Running'])),
    readFile: toText(readField(row, ['Master_Log_File', 'Source_Log_File'])),
    readPos: toNum(readField(row, ['Read_Master_Log_Pos', 'Read_Source_Log_Pos'])),
    execFile: toText(readField(row, ['Relay_Master_Log_File', 'Relay_Source_Log_File'])),
    execPos: toNum(readField(row, ['Exec_Master_Log_Pos', 'Exec_Source_Log_Pos'])),
    secondsBehind: toNum(readField(row, ['Seconds_Behind_Master', 'Seconds_Behind_Source'])),
    sqlRunningState: toText(readField(row, ['Slave_SQL_Running_State', 'Replica_SQL_Running_State'])),
    relayLogSpace: toNum(readField(row, ['Relay_Log_Space'])),
    lastErrno: toErrno(readField(row, ['Last_Errno'])),
    lastError: toText(readField(row, ['Last_Error'])),
    lastIoErrno: toErrno(readField(row, ['Last_IO_Errno'])),
    lastIoError: toText(readField(row, ['Last_IO_Error'])),
    lastSqlErrno: toErrno(readField(row, ['Last_SQL_Errno'])),
    lastSqlError: toText(readField(row, ['Last_SQL_Error'])),
    sqlDelaySec: toNum(readField(row, ['SQL_Delay'])) ?? 0,
    remainingDelaySec: toNum(readField(row, ['SQL_Remaining_Delay'])),
    usingGtid: toText(autoPosition),
    filters
  }
}

/** Row `SHOW MASTER STATUS`/`SHOW BINARY LOG STATUS` → DTO chuẩn. */
export function normalizeMasterStatus(row: Record<string, unknown>): MasterStatus {
  return {
    file: toText(readField(row, ['File'])),
    position: toNum(readField(row, ['Position'])),
    doDb: toStr(readField(row, ['Binlog_Do_DB'])),
    ignoreDb: toStr(readField(row, ['Binlog_Ignore_DB']))
  }
}

/** Map biến (từ variableRowsToMap) → ReplVars. Tên MariaDB và MySQL 8 đều được nhận. */
export function normalizeVars(vars: Record<string, string>): ReplVars {
  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = vars[name]
      if (value !== undefined) return value
    }
    return undefined
  }
  // expire_logs_days (ngày) và binlog_expire_logs_seconds (giây) là 2 biến khác nhau; bản nào
  // cũng chỉ dùng một trong hai. Quy hết về giây để so sánh được.
  const expireSeconds = toNum(pick('binlog_expire_logs_seconds'))
  const expireDays = toNum(pick('expire_logs_days'))
  return {
    serverId: toNum(pick('server_id')),
    readOnly: toBool(pick('read_only')),
    superReadOnly: toBool(pick('super_read_only')),
    binlogFormat: toText(pick('binlog_format')),
    logBin: toBool(pick('log_bin')),
    logSlaveUpdates: toBool(pick('log_slave_updates', 'log_replica_updates')),
    gtidMode: toText(pick('gtid_mode', 'gtid_strict_mode')),
    version: toText(pick('version')),
    slaveParallelWorkers: toNum(pick('slave_parallel_workers', 'replica_parallel_workers')),
    binlogExpireSeconds: expireSeconds && expireSeconds > 0 ? expireSeconds : expireDays ? expireDays * 86_400 : null
  }
}

// ---------------------------------------------------------------------------
// Tính độ lệch
// ---------------------------------------------------------------------------

/** `mysql-bin.000123` → { base: 'mysql-bin', seq: 123 }. Tên không theo mẫu → null. */
export function parseBinlogName(file: string | null): { base: string; seq: number } | null {
  if (!file) return null
  const m = /^(.*)\.(\d+)$/.exec(file.trim())
  if (!m) return null
  const seq = Number(m[2])
  return Number.isFinite(seq) ? { base: m[1], seq } : null
}

/**
 * Khoảng cách giữa 2 vị trí binlog (from → to, to là bên "đi trước").
 * - Cùng file  → { bytes, filesBehind: 0 }
 * - Khác file  → { bytes: null, filesBehind: n } — KHÔNG suy ra được byte vì không biết kích
 *                thước các file nằm giữa. Trả null thay vì bịa một con số.
 * - Khác base name (vừa đổi log_bin_basename) → không so được.
 */
function gapBetween(
  fromFile: string | null,
  fromPos: number | null,
  toFile: string | null,
  toPos: number | null
): { bytes: number | null; filesBehind: number | null } {
  if (!fromFile || !toFile || fromPos === null || toPos === null) return { bytes: null, filesBehind: null }
  if (fromFile === toFile) {
    // Hiệu ÂM là hợp lệ: 2 vị trí đọc ở 2 thời điểm khác nhau trên 2 máy khác nhau.
    return { bytes: Math.max(0, toPos - fromPos), filesBehind: 0 }
  }
  const a = parseBinlogName(fromFile)
  const b = parseBinlogName(toFile)
  if (!a || !b || a.base !== b.base) return { bytes: null, filesBehind: null }
  return { bytes: null, filesBehind: Math.max(0, b.seq - a.seq) }
}

/**
 * Tính độ lệch từ trạng thái 2 bên. `master` null (không đọc được master, vd chỉ có quyền trên
 * slave) vẫn tính được applyGap và lag — chỉ mất fetchGap.
 */
export function computeDrift(master: MasterStatus | null, replica: ReplicaStatus): ReplDrift {
  const fetch = gapBetween(replica.readFile, replica.readPos, master?.file ?? null, master?.position ?? null)
  const apply = gapBetween(replica.execFile, replica.execPos, replica.readFile, replica.readPos)

  const lagSec = replica.secondsBehind
  const effectiveLagSec = lagSec === null ? null : Math.max(0, lagSec - replica.sqlDelaySec)

  return {
    lagSec,
    effectiveLagSec,
    fetchGapBytes: fetch.bytes,
    applyGapBytes: apply.bytes,
    fetchFilesBehind: fetch.filesBehind,
    applyFilesBehind: apply.filesBehind,
    healthy: replica.ioRunning === 'yes' && replica.sqlRunning === 'yes' && replica.lastErrno === 0
  }
}
