import { describe, expect, it } from 'vitest'
import {
  COLUMNS_SQL,
  INDEXES_SQL,
  TABLE_INVENTORY_SQL,
  buildChecksumSql,
  buildCountSql,
  diffInventory,
  diffSchemaEntries,
  diffVariables,
  isFilteredOut,
  matchesWildPattern,
  normalizeColumns,
  normalizeIndexes,
  normalizeTableRows,
  readChecksumRow,
  readCountRow,
  type TableInfo
} from './compare'
import { normalizeReplicaStatus, normalizeVars, type ReplFilters } from './status'

const table = (over: Partial<TableInfo> = {}): TableInfo => ({
  schema: 'app',
  name: 'orders',
  engine: 'InnoDB',
  rowsEstimate: 10_000,
  dataBytes: 1024,
  indexBytes: 256,
  collation: 'utf8mb4_unicode_ci',
  ...over
})

const noFilters = (): ReplFilters => normalizeReplicaStatus({}).filters

describe('câu SQL kiểm kê', () => {
  it('bỏ schema hệ thống ngay trong câu lệnh (rẻ hơn lọc phía app)', () => {
    for (const sql of [TABLE_INVENTORY_SQL, COLUMNS_SQL, INDEXES_SQL]) {
      expect(sql).toContain("'mysql','information_schema','performance_schema','sys'")
    }
  })

  it('chỉ lấy BASE TABLE — view không có dữ liệu để so', () => {
    expect(TABLE_INVENTORY_SQL).toContain("TABLE_TYPE = 'BASE TABLE'")
  })
})

describe('normalizeTableRows', () => {
  it('đọc được row từ driver và loại schema hệ thống', () => {
    const rows = normalizeTableRows([
      { TABLE_SCHEMA: 'app', TABLE_NAME: 'orders', ENGINE: 'InnoDB', TABLE_ROWS: 10, DATA_LENGTH: 1, INDEX_LENGTH: 2, TABLE_COLLATION: 'utf8mb4_general_ci' },
      { TABLE_SCHEMA: 'mysql', TABLE_NAME: 'user', ENGINE: 'InnoDB', TABLE_ROWS: 5 }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ schema: 'app', name: 'orders', engine: 'InnoDB', rowsEstimate: 10 })
  })

  it('đọc được cả row viết thường (CLI \\G) và giá trị bigint', () => {
    const rows = normalizeTableRows([{ table_schema: 'app', table_name: 't', TABLE_ROWS: 42n }])
    expect(rows[0]).toMatchObject({ schema: 'app', name: 't', rowsEstimate: 42 })
  })
})

describe('diffInventory', () => {
  it('hai bên khớp → tất cả là "same"', () => {
    const diffs = diffInventory([table()], [table()])
    expect(diffs).toHaveLength(1)
    expect(diffs[0].status).toBe('same')
  })

  it('bảng thiếu ở slave → nghiêm trọng nhất, đứng đầu', () => {
    const diffs = diffInventory([table(), table({ name: 'users' })], [table({ name: 'users' })])
    expect(diffs[0]).toMatchObject({ name: 'orders', status: 'missing-on-replica' })
  })

  it('bảng chỉ có ở slave (ai đó tạo tay) cũng được phát hiện', () => {
    const diffs = diffInventory([], [table({ name: 'tmp_fix' })])
    expect(diffs[0].status).toBe('missing-on-master')
  })

  it('khác engine → báo', () => {
    expect(diffInventory([table()], [table({ engine: 'MyISAM' })])[0].status).toBe('engine-differs')
  })

  it('khác collation → báo', () => {
    expect(diffInventory([table()], [table({ collation: 'latin1_swedish_ci' })])[0].status).toBe('collation-differs')
  })

  it('chênh số dòng nhỏ → BỎ QUA (TABLE_ROWS của InnoDB chỉ là ước lượng)', () => {
    const diffs = diffInventory([table({ rowsEstimate: 10_000 })], [table({ rowsEstimate: 10_050 })])
    expect(diffs[0].status).toBe('same')
  })

  it('chênh số dòng lớn → báo kèm delta có dấu', () => {
    const diffs = diffInventory([table({ rowsEstimate: 10_000 })], [table({ rowsEstimate: 4_000 })])
    expect(diffs[0].status).toBe('rows-differ')
    expect(diffs[0].rowDelta).toBe(-6_000) // slave thiếu 6000 dòng
  })

  it('bảng nhỏ chênh vài dòng không bị báo (dưới rowsMinDelta)', () => {
    const diffs = diffInventory([table({ rowsEstimate: 10 })], [table({ rowsEstimate: 20 })])
    expect(diffs[0].status).toBe('same')
  })

  it('ngưỡng chỉnh được', () => {
    const diffs = diffInventory([table({ rowsEstimate: 10 })], [table({ rowsEstimate: 20 })], {
      rowsMinDelta: 1,
      rowsTolerancePct: 1
    })
    expect(diffs[0].status).toBe('rows-differ')
  })

  it('bảng bị filter → đánh dấu filtered và xếp xuống cuối', () => {
    const filters: ReplFilters = { ...noFilters(), ignoreDb: 'tmp', any: true }
    const diffs = diffInventory(
      [table({ schema: 'tmp', name: 'scratch' }), table()],
      [table()],
      { filters }
    )
    expect(diffs[0]).toMatchObject({ schema: 'app', filtered: false })
    expect(diffs[1]).toMatchObject({ schema: 'tmp', status: 'missing-on-replica', filtered: true })
  })

  it('không đọc được số dòng ở một bên → không kết luận lệch', () => {
    const diffs = diffInventory([table({ rowsEstimate: null })], [table({ rowsEstimate: 999_999 })])
    expect(diffs[0].status).toBe('same')
    expect(diffs[0].rowDelta).toBeNull()
  })
})

describe('matchesWildPattern', () => {
  it.each([
    ['app.tmp_%', 'app.tmp_orders', true],
    ['app.tmp_%', 'app.orders', false],
    ['app.%', 'app.anything', true],
    ['app.order_', 'app.orders', true],
    ['app.order_', 'app.orderss', false],
    ['APP.ORDERS', 'app.orders', true]
  ])('%s vs %s', (pattern, value, expected) => {
    expect(matchesWildPattern(pattern, value)).toBe(expected)
  })

  it('ký tự regex trong tên bảng không phá pattern', () => {
    expect(matchesWildPattern('app.a.b', 'appXaXb')).toBe(false)
  })
})

describe('isFilteredOut', () => {
  it('không có filter → mọi bảng đều trong phạm vi', () => {
    expect(isFilteredOut('app', 'orders', noFilters())).toBe(false)
  })

  it('ignore_db loại cả database', () => {
    const f: ReplFilters = { ...noFilters(), ignoreDb: 'tmp,logs', any: true }
    expect(isFilteredOut('tmp', 'x', f)).toBe(true)
    expect(isFilteredOut('app', 'x', f)).toBe(false)
  })

  it('wild_ignore_table loại theo pattern', () => {
    const f: ReplFilters = { ...noFilters(), wildIgnoreTable: 'app.tmp_%', any: true }
    expect(isFilteredOut('app', 'tmp_cache', f)).toBe(true)
    expect(isFilteredOut('app', 'orders', f)).toBe(false)
  })

  it('có whitelist → mọi thứ ngoài whitelist là ngoài phạm vi', () => {
    const f: ReplFilters = { ...noFilters(), doDb: 'app', any: true }
    expect(isFilteredOut('app', 'orders', f)).toBe(false)
    expect(isFilteredOut('other', 'orders', f)).toBe(true)
  })

  it('ignore thắng do khi cùng khớp', () => {
    const f: ReplFilters = { ...noFilters(), doDb: 'app', ignoreTable: 'app.secrets', any: true }
    expect(isFilteredOut('app', 'secrets', f)).toBe(true)
  })
})

describe('so schema', () => {
  const colRow = (name: string, type = 'int(11)', extra = '') => ({
    TABLE_SCHEMA: 'app',
    TABLE_NAME: 'orders',
    COLUMN_NAME: name,
    ORDINAL_POSITION: 1,
    COLUMN_TYPE: type,
    IS_NULLABLE: 'NO',
    COLUMN_DEFAULT: null,
    COLUMN_KEY: '',
    EXTRA: extra
  })

  it('cột thiếu ở slave', () => {
    const diffs = diffSchemaEntries(normalizeColumns([colRow('id'), colRow('sku')]), normalizeColumns([colRow('id')]))
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ table: 'app.orders', item: 'sku', status: 'missing-on-replica' })
  })

  it('cột khác kiểu → differs, hiện cả hai chữ ký', () => {
    const diffs = diffSchemaEntries(
      normalizeColumns([colRow('qty', 'int(11)')]),
      normalizeColumns([colRow('qty', 'bigint(20)')])
    )
    expect(diffs[0].status).toBe('differs')
    expect(diffs[0].masterSignature).toContain('int(11)')
    expect(diffs[0].replicaSignature).toContain('bigint(20)')
  })

  it('chỉ khác THỨ TỰ cột → không báo (không ảnh hưởng replication ROW-based)', () => {
    const master = normalizeColumns([{ ...colRow('id'), ORDINAL_POSITION: 1 }, { ...colRow('sku'), ORDINAL_POSITION: 2 }])
    const replica = normalizeColumns([{ ...colRow('sku'), ORDINAL_POSITION: 1 }, { ...colRow('id'), ORDINAL_POSITION: 2 }])
    expect(diffSchemaEntries(master, replica)).toEqual([])
  })

  it('index gom nhiều cột thành 1 entry, so cả tính unique', () => {
    const rows = (nonUnique: number) => [
      { TABLE_SCHEMA: 'app', TABLE_NAME: 'orders', INDEX_NAME: 'idx_a_b', SEQ_IN_INDEX: 1, COLUMN_NAME: 'a', NON_UNIQUE: nonUnique },
      { TABLE_SCHEMA: 'app', TABLE_NAME: 'orders', INDEX_NAME: 'idx_a_b', SEQ_IN_INDEX: 2, COLUMN_NAME: 'b', NON_UNIQUE: nonUnique }
    ]
    const master = normalizeIndexes(rows(0))
    expect(master).toHaveLength(1)
    expect(master[0].signature).toBe('UNIQUE(a, b)')
    expect(diffSchemaEntries(master, normalizeIndexes(rows(1)))[0].status).toBe('differs')
  })

  it('schema khớp hoàn toàn → mảng rỗng, không nhiễu', () => {
    expect(diffSchemaEntries(normalizeColumns([colRow('id')]), normalizeColumns([colRow('id')]))).toEqual([])
  })
})

describe('diffVariables', () => {
  const vars = (over: Record<string, string> = {}) =>
    normalizeVars({ server_id: '11', read_only: 'OFF', version: '10.11.6-MariaDB', binlog_format: 'ROW', log_bin: 'ON', ...over })

  it('server_id và read_only khác nhau là BÌNH THƯỜNG → đánh dấu expected', () => {
    const diffs = diffVariables(vars(), vars({ server_id: '12', read_only: 'ON' }))
    expect(diffs.find((d) => d.name === 'server_id')?.expected).toBe(true)
    expect(diffs.find((d) => d.name === 'read_only')?.expected).toBe(true)
  })

  it('lệch phiên bản → KHÔNG expected, có ghi chú về chiều nâng cấp', () => {
    const d = diffVariables(vars(), vars({ version: '10.5.0-MariaDB' })).find((x) => x.name === 'version')
    expect(d?.expected).toBe(false)
    expect(d?.note).toContain('mới hơn')
  })

  it('lệch binlog_format → báo', () => {
    expect(diffVariables(vars(), vars({ binlog_format: 'STATEMENT' })).some((d) => d.name === 'binlog_format')).toBe(true)
  })

  it('giống hệt nhau → mảng rỗng', () => {
    expect(diffVariables(vars(), vars())).toEqual([])
  })

  it('thiếu một bên → không so bừa', () => {
    expect(diffVariables(null, vars())).toEqual([])
    expect(diffVariables(vars(), null)).toEqual([])
  })
})

describe('câu đếm / checksum', () => {
  it('bọc backtick đúng schema và bảng', () => {
    expect(buildCountSql('app', 'orders')).toBe('SELECT COUNT(*) AS c FROM `app`.`orders`')
    expect(buildChecksumSql('app', 'orders')).toBe('CHECKSUM TABLE `app`.`orders`')
  })

  it('TỪ CHỐI tên bảng có ký tự lạ — hàng rào duy nhất chống injection', () => {
    expect(() => buildCountSql('app', 'orders`; DROP TABLE x; --')).toThrow(/không hợp lệ/)
    expect(() => buildChecksumSql('app; DROP DATABASE y', 'orders')).toThrow(/không hợp lệ/)
    expect(() => buildCountSql('app', '')).toThrow(/không hợp lệ/)
  })

  it('đọc kết quả', () => {
    expect(readCountRow([{ c: 12_345 }])).toBe(12_345)
    expect(readCountRow([{ c: 12_345n }])).toBe(12_345)
    expect(readChecksumRow([{ Table: 'app.orders', Checksum: '3086465134' }])).toBe(3_086_465_134)
    // Engine không hỗ trợ checksum → NULL, phải phân biệt với 0
    expect(readChecksumRow([{ Table: 'app.orders', Checksum: null }])).toBeNull()
    expect(readChecksumRow([])).toBeNull()
  })
})
