import { assertIdent } from '../localdev/mysqlCli'
import type { ReplFilters, ReplVars } from './status'

/**
 * F55 — So lệch THỰC TẾ giữa master và slave, chạy theo yêu cầu (không phải mỗi chu kỳ poll).
 *
 * Vì sao cần dù replication đã báo OK: có những kiểu lệch mà `SHOW SLAVE STATUS` không bao giờ
 * thấy — ai đó ghi tay vào slave, một lần `sql_slave_skip_counter` trước đây, hoặc binlog_format
 * = STATEMENT khiến NOW()/RAND() cho kết quả khác nhau ở hai bên. Replication vẫn "Yes/Yes/0s"
 * trong khi dữ liệu đã trôi.
 *
 * TOÀN BỘ FILE LÀ HÀM THUẦN: dựng câu SQL và so hai mảng row. Caller (main) lo phần chạy.
 *
 * BA MỨC, từ rẻ tới đắt — UI cho chọn để không ai lỡ tay quét CHECKSUM cả TB dữ liệu:
 *  1. Kiểm kê bảng   — 1 câu information_schema mỗi bên, tức thì. row count là ƯỚC LƯỢNG.
 *  2. So schema      — cột + index, vẫn từ information_schema, vẫn rẻ.
 *  3. Đếm / checksum — COUNT(*) hoặc CHECKSUM TABLE từng bảng. CHÍNH XÁC nhưng quét toàn bảng.
 */

/** Schema hệ thống — luôn khác nhau giữa 2 server và không bao giờ được replicate. */
const SYSTEM_SCHEMAS = new Set(['mysql', 'information_schema', 'performance_schema', 'sys'])

// ---------------------------------------------------------------------------
// 1. Kiểm kê bảng
// ---------------------------------------------------------------------------

export interface TableInfo {
  schema: string
  name: string
  engine: string | null
  /**
   * Số dòng ƯỚC LƯỢNG (information_schema.TABLES.TABLE_ROWS). Với InnoDB đây là con số do
   * optimizer thống kê, sai lệch tới hàng chục phần trăm là bình thường — CHỈ dùng để khoanh
   * vùng bảng đáng ngờ, không bao giờ dùng để kết luận đã lệch.
   */
  rowsEstimate: number | null
  dataBytes: number | null
  indexBytes: number | null
  collation: string | null
}

export const TABLE_INVENTORY_SQL =
  'SELECT TABLE_SCHEMA, TABLE_NAME, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH, TABLE_COLLATION ' +
  "FROM information_schema.TABLES WHERE TABLE_TYPE = 'BASE TABLE' " +
  "AND TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys') " +
  'ORDER BY TABLE_SCHEMA, TABLE_NAME'

const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value))
const num = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const n = typeof value === 'bigint' ? Number(value) : Number(value)
  return Number.isFinite(n) ? n : null
}
const orNull = (value: unknown): string | null => {
  const text = str(value)
  return text === '' || text.toUpperCase() === 'NULL' ? null : text
}

/** Đọc theo tên cột KHÔNG phân biệt hoa thường — information_schema trả khác nhau tuỳ bản/driver. */
function col(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name]
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(row)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

export function normalizeTableRows(rows: Record<string, unknown>[]): TableInfo[] {
  return (rows ?? [])
    .map((row) => ({
      schema: str(col(row, 'TABLE_SCHEMA')),
      name: str(col(row, 'TABLE_NAME')),
      engine: orNull(col(row, 'ENGINE')),
      rowsEstimate: num(col(row, 'TABLE_ROWS')),
      dataBytes: num(col(row, 'DATA_LENGTH')),
      indexBytes: num(col(row, 'INDEX_LENGTH')),
      collation: orNull(col(row, 'TABLE_COLLATION'))
    }))
    .filter((t) => t.schema !== '' && t.name !== '' && !SYSTEM_SCHEMAS.has(t.schema.toLowerCase()))
}

export type TableDiffStatus =
  | 'missing-on-replica'
  | 'missing-on-master'
  | 'engine-differs'
  | 'collation-differs'
  | 'rows-differ'
  | 'same'

export interface TableDiff {
  schema: string
  name: string
  status: TableDiffStatus
  master: TableInfo | null
  replica: TableInfo | null
  /** replica − master theo số dòng ƯỚC LƯỢNG. */
  rowDelta: number | null
  /** Bảng nằm ngoài phạm vi replication → chênh lệch là CỐ Ý, đừng báo động. */
  filtered: boolean
}

export interface DiffInventoryOptions {
  /** Bộ lọc replication đọc từ SHOW SLAVE STATUS — dùng để đánh dấu chênh lệch cố ý. */
  filters?: ReplFilters
  /**
   * Chênh lệch số dòng ước lượng dưới tỉ lệ này thì bỏ qua (InnoDB thống kê rất lệch).
   * Mặc định 5%, và luôn bỏ qua chênh dưới `rowsMinDelta` dòng.
   */
  rowsTolerancePct?: number
  rowsMinDelta?: number
}

/**
 * So hai danh sách bảng. Sắp xếp theo mức nghiêm trọng: thiếu bảng → khác engine/collation →
 * lệch số dòng. Bảng khớp hoàn toàn vẫn được trả về (status 'same') để UI hiện tổng số đã kiểm.
 */
export function diffInventory(
  master: TableInfo[],
  replica: TableInfo[],
  options: DiffInventoryOptions = {}
): TableDiff[] {
  const tolerancePct = options.rowsTolerancePct ?? 5
  const minDelta = options.rowsMinDelta ?? 100
  const key = (t: TableInfo): string => `${t.schema}.${t.name}`
  const masterMap = new Map(master.map((t) => [key(t), t]))
  const replicaMap = new Map(replica.map((t) => [key(t), t]))

  const out: TableDiff[] = []
  for (const k of new Set([...masterMap.keys(), ...replicaMap.keys()])) {
    const m = masterMap.get(k) ?? null
    const r = replicaMap.get(k) ?? null
    const info = m ?? r!
    const filtered = options.filters ? isFilteredOut(info.schema, info.name, options.filters) : false

    let status: TableDiffStatus = 'same'
    let rowDelta: number | null = null
    if (!r) status = 'missing-on-replica'
    else if (!m) status = 'missing-on-master'
    else {
      if (m.engine && r.engine && m.engine !== r.engine) status = 'engine-differs'
      else if (m.collation && r.collation && m.collation !== r.collation) status = 'collation-differs'
      if (m.rowsEstimate !== null && r.rowsEstimate !== null) {
        rowDelta = r.rowsEstimate - m.rowsEstimate
        const base = Math.max(m.rowsEstimate, r.rowsEstimate, 1)
        const significant = Math.abs(rowDelta) >= minDelta && (Math.abs(rowDelta) / base) * 100 >= tolerancePct
        if (status === 'same' && significant) status = 'rows-differ'
      }
    }
    out.push({ schema: info.schema, name: info.name, status, master: m, replica: r, rowDelta, filtered })
  }

  const rank: Record<TableDiffStatus, number> = {
    'missing-on-replica': 0,
    'missing-on-master': 1,
    'engine-differs': 2,
    'collation-differs': 3,
    'rows-differ': 4,
    same: 5
  }
  return out.sort(
    (a, b) =>
      Number(a.filtered) - Number(b.filtered) ||
      rank[a.status] - rank[b.status] ||
      `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`)
  )
}

// ---------------------------------------------------------------------------
// Bộ lọc replication
// ---------------------------------------------------------------------------

const splitList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')

/** Pattern kiểu LIKE của MySQL: `%` = nhiều ký tự, `_` = một ký tự. So khớp KHÔNG phân biệt hoa thường. */
export function matchesWildPattern(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i')
  return regex.test(value)
}

/**
 * Bảng này có nằm NGOÀI phạm vi replication không?
 *
 * ⚠️ Đây là XẤP XỈ. Thứ tự áp dụng filter thật của MySQL (do-db trước wild-do-table, hành vi
 * khác nhau giữa lệnh có/không chỉ định database…) phức tạp hơn nhiều. Kết quả ở đây CHỈ dùng để
 * HẠ mức một chênh lệch xuống "cố ý" trong báo cáo so lệch — không bao giờ dùng để giấu lỗi
 * replication thật, nên đoán sai cũng không gây hậu quả nghiêm trọng.
 */
export function isFilteredOut(schema: string, table: string, filters: ReplFilters): boolean {
  if (!filters.any) return false
  const full = `${schema}.${table}`
  const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

  // Ignore thắng do — bị loại tường minh là chắc chắn ngoài phạm vi
  if (splitList(filters.ignoreDb).some((db) => eq(db, schema))) return true
  if (splitList(filters.ignoreTable).some((t) => eq(t, full))) return true
  if (splitList(filters.wildIgnoreTable).some((p) => matchesWildPattern(p, full))) return true

  // Có whitelist mà không khớp cái nào → ngoài phạm vi
  const doDb = splitList(filters.doDb)
  const doTable = splitList(filters.doTable)
  const wildDo = splitList(filters.wildDoTable)
  if (doDb.length === 0 && doTable.length === 0 && wildDo.length === 0) return false
  const allowed =
    doDb.some((db) => eq(db, schema)) ||
    doTable.some((t) => eq(t, full)) ||
    wildDo.some((p) => matchesWildPattern(p, full))
  return !allowed
}

// ---------------------------------------------------------------------------
// 2. So schema
// ---------------------------------------------------------------------------

export const COLUMNS_SQL =
  'SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, ' +
  'COLUMN_DEFAULT, COLUMN_KEY, EXTRA FROM information_schema.COLUMNS ' +
  "WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys') " +
  'ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION'

export const INDEXES_SQL =
  'SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE ' +
  'FROM information_schema.STATISTICS ' +
  "WHERE TABLE_SCHEMA NOT IN ('mysql','information_schema','performance_schema','sys') " +
  'ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX'

export interface SchemaEntry {
  /** `schema`.`table` */
  table: string
  /** Tên cột hoặc tên index. */
  item: string
  /** Chữ ký so sánh — khác nhau nghĩa là định nghĩa khác nhau. */
  signature: string
}

export function normalizeColumns(rows: Record<string, unknown>[]): SchemaEntry[] {
  return (rows ?? [])
    .map((row) => ({
      table: `${str(col(row, 'TABLE_SCHEMA'))}.${str(col(row, 'TABLE_NAME'))}`,
      item: str(col(row, 'COLUMN_NAME')),
      // ORDINAL_POSITION CỐ Ý không nằm trong chữ ký: thứ tự cột khác nhau không ảnh hưởng
      // replication ROW-based và sẽ tạo ra rừng khác biệt vô nghĩa.
      signature: [
        str(col(row, 'COLUMN_TYPE')),
        str(col(row, 'IS_NULLABLE')),
        str(col(row, 'COLUMN_DEFAULT')),
        str(col(row, 'EXTRA'))
      ].join(' | ')
    }))
    .filter((e) => e.item !== '')
}

export function normalizeIndexes(rows: Record<string, unknown>[]): SchemaEntry[] {
  // STATISTICS trả 1 dòng cho MỖI CỘT trong index → gom lại thành 1 entry/index
  const acc = new Map<string, { table: string; item: string; parts: string[]; unique: boolean }>()
  for (const row of rows ?? []) {
    const table = `${str(col(row, 'TABLE_SCHEMA'))}.${str(col(row, 'TABLE_NAME'))}`
    const item = str(col(row, 'INDEX_NAME'))
    if (item === '') continue
    const key = `${table}::${item}`
    const entry = acc.get(key) ?? { table, item, parts: [], unique: num(col(row, 'NON_UNIQUE')) === 0 }
    entry.parts.push(str(col(row, 'COLUMN_NAME')))
    acc.set(key, entry)
  }
  return [...acc.values()].map((e) => ({
    table: e.table,
    item: e.item,
    signature: `${e.unique ? 'UNIQUE' : 'INDEX'}(${e.parts.join(', ')})`
  }))
}

export type SchemaDiffStatus = 'missing-on-replica' | 'missing-on-master' | 'differs'

export interface SchemaDiff {
  table: string
  item: string
  status: SchemaDiffStatus
  masterSignature: string | null
  replicaSignature: string | null
}

/** So cột hoặc index. Chỉ trả về khác biệt — giống nhau thì không cần nhắc tới. */
export function diffSchemaEntries(master: SchemaEntry[], replica: SchemaEntry[]): SchemaDiff[] {
  const key = (e: SchemaEntry): string => `${e.table}::${e.item}`
  const masterMap = new Map(master.map((e) => [key(e), e]))
  const replicaMap = new Map(replica.map((e) => [key(e), e]))
  const out: SchemaDiff[] = []
  for (const k of new Set([...masterMap.keys(), ...replicaMap.keys()])) {
    const m = masterMap.get(k)
    const r = replicaMap.get(k)
    const info = m ?? r!
    if (!r) out.push({ table: info.table, item: info.item, status: 'missing-on-replica', masterSignature: m!.signature, replicaSignature: null })
    else if (!m) out.push({ table: info.table, item: info.item, status: 'missing-on-master', masterSignature: null, replicaSignature: r.signature })
    else if (m.signature !== r.signature)
      out.push({ table: info.table, item: info.item, status: 'differs', masterSignature: m.signature, replicaSignature: r.signature })
  }
  return out.sort((a, b) => a.table.localeCompare(b.table) || a.item.localeCompare(b.item))
}

// ---------------------------------------------------------------------------
// 3. So biến cấu hình
// ---------------------------------------------------------------------------

export interface VarDiff {
  name: string
  master: string
  replica: string
  /** Khác nhau ở biến này là BÌNH THƯỜNG (vd server_id BẮT BUỘC khác nhau). */
  expected: boolean
  /** Vì sao đáng quan tâm — hiện thẳng trên UI. */
  note: string
}

/**
 * So các biến ảnh hưởng tới tính đúng đắn của replication.
 * `server_id` khác nhau là BẮT BUỘC, `read_only` khác nhau là ĐÚNG — đánh dấu `expected` để
 * không lẫn với lệch thật.
 */
export function diffVariables(master: ReplVars | null, replica: ReplVars | null): VarDiff[] {
  if (!master || !replica) return []
  const show = (v: unknown): string => (v === null || v === undefined ? '—' : String(v))
  const rows: Array<{ name: string; m: unknown; r: unknown; expected?: boolean; note: string }> = [
    { name: 'server_id', m: master.serverId, r: replica.serverId, expected: true, note: 'Bắt buộc khác nhau. TRÙNG nhau mới là lỗi nghiêm trọng.' },
    { name: 'read_only', m: master.readOnly, r: replica.readOnly, expected: true, note: 'Master OFF / slave ON là đúng. Slave OFF là nguy cơ split-brain.' },
    { name: 'version', m: master.version, r: replica.version, note: 'Slave nên bằng hoặc mới hơn master. Slave CŨ hơn có thể không hiểu binlog của master.' },
    { name: 'binlog_format', m: master.binlogFormat, r: replica.binlogFormat, note: 'Định dạng của MASTER quyết định. STATEMENT dễ gây lệch dữ liệu âm thầm.' },
    { name: 'log_bin', m: master.logBin, r: replica.logBin, note: 'Master bắt buộc ON. Slave chỉ cần ON khi làm master tầng dưới.' },
    { name: 'log_slave_updates', m: master.logSlaveUpdates, r: replica.logSlaveUpdates, note: 'Slave cần ON nếu có tầng replication phía sau nó.' },
    { name: 'gtid_mode', m: master.gtidMode, r: replica.gtidMode, note: 'Hai bên phải cùng chế độ GTID.' },
    { name: 'slave_parallel_workers', m: master.slaveParallelWorkers, r: replica.slaveParallelWorkers, expected: true, note: 'Chỉ có ý nghĩa ở slave — khác nhau là bình thường.' },
    { name: 'binlog_expire_logs_seconds', m: master.binlogExpireSeconds, r: replica.binlogExpireSeconds, expected: true, note: 'Của master mới quan trọng: giữ quá ngắn sẽ gây lỗi 1236 khi slave tụt lâu.' }
  ]
  return rows
    .filter((row) => show(row.m) !== show(row.r))
    .map((row) => ({ name: row.name, master: show(row.m), replica: show(row.r), expected: row.expected ?? false, note: row.note }))
}

// ---------------------------------------------------------------------------
// 4. Đếm chính xác / checksum
// ---------------------------------------------------------------------------

/**
 * Tên schema/bảng đi thẳng vào SQL (identifier không parameterize được) nên `assertIdent` là
 * hàng rào DUY NHẤT — dùng lại đúng hàm đã bảo vệ local dev stack. Tên chứa ký tự ngoài
 * [A-Za-z0-9_] sẽ bị TỪ CHỐI: caller phải báo "không kiểm tự động được", không được im lặng bỏ qua.
 */
function quoteTable(schema: string, table: string): string {
  assertIdent(schema, 'Tên database')
  assertIdent(table, 'Tên bảng')
  return `\`${schema}\`.\`${table}\``
}

/** COUNT(*) — chính xác tuyệt đối nhưng quét toàn bảng (InnoDB không có bộ đếm sẵn). */
export function buildCountSql(schema: string, table: string): string {
  return `SELECT COUNT(*) AS c FROM ${quoteTable(schema, table)}`
}

/**
 * CHECKSUM TABLE — so cả NỘI DUNG chứ không chỉ số dòng. Đây là thứ duy nhất phát hiện được
 * "đủ số dòng nhưng giá trị khác nhau". Rất nặng: khoá đọc và quét toàn bảng.
 */
export function buildChecksumSql(schema: string, table: string): string {
  return `CHECKSUM TABLE ${quoteTable(schema, table)}`
}

/** Đọc kết quả CHECKSUM TABLE (`{ Table, Checksum }`). Checksum null = engine không hỗ trợ. */
export function readChecksumRow(rows: Record<string, unknown>[]): number | null {
  const row = rows?.[0]
  if (!row) return null
  return num(col(row, 'Checksum'))
}

/** Đọc kết quả COUNT(*). */
export function readCountRow(rows: Record<string, unknown>[]): number | null {
  const row = rows?.[0]
  if (!row) return null
  return num(col(row, 'c'))
}
