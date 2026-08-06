import { describe, expect, it } from 'vitest'
import { diagnose, extractTableFromError, formatBytes, formatDuration, type Diagnosis } from './diagnose'
import {
  computeDrift,
  normalizeReplicaStatus,
  normalizeVars,
  type MasterStatus,
  type ReplSample,
  type ReplVars
} from './status'

const MASTER: MasterStatus = { file: 'mysql-bin.000142', position: 84512377, doDb: '', ignoreDb: '' }

const vars = (over: Partial<ReplVars> = {}): ReplVars => ({
  ...normalizeVars({ server_id: '11', read_only: 'ON', binlog_format: 'ROW', log_bin: 'ON', version: '10.11.6-MariaDB' }),
  ...over
})

/** Sample khoẻ hoàn toàn — mọi test lệch đều bắt đầu từ đây rồi chỉ đổi đúng thứ cần đổi. */
function sample(
  replicaRow: Record<string, unknown> = {},
  over: Partial<ReplSample> = {},
  master: MasterStatus | null = MASTER
): ReplSample {
  const replica = normalizeReplicaStatus({
    Slave_IO_Running: 'Yes',
    Slave_SQL_Running: 'Yes',
    Master_Host: '10.0.0.11',
    Master_Port: 3306,
    Master_Log_File: 'mysql-bin.000142',
    Read_Master_Log_Pos: 84512377,
    Relay_Master_Log_File: 'mysql-bin.000142',
    Exec_Master_Log_Pos: 84512377,
    Seconds_Behind_Master: 0,
    Last_Errno: 0,
    Last_IO_Errno: 0,
    Last_SQL_Errno: 0,
    SQL_Delay: 0,
    ...replicaRow
  })
  return {
    pairId: 'p1',
    replicaId: 'r1',
    replicaLabel: 'slave-01',
    ts: 1_700_000_000_000,
    ok: true,
    mode: 'driver',
    master,
    replica,
    masterVars: vars(),
    replicaVars: vars({ serverId: 12 }),
    drift: computeDrift(master, replica),
    ...over
  }
}

const ids = (list: Diagnosis[]): string[] => list.map((d) => d.id)
const byId = (list: Diagnosis[], id: string): Diagnosis => {
  const hit = list.find((d) => d.id === id)
  if (!hit) throw new Error(`Không tìm thấy chẩn đoán "${id}" trong: ${ids(list).join(', ') || '(rỗng)'}`)
  return hit
}
/** Gộp toàn bộ text lệnh của 1 chẩn đoán để assert nội dung runbook. */
const allText = (d: Diagnosis): string => [...d.checks, ...d.fixes].map((c) => `${c.label}\n${c.text}\n${c.note ?? ''}`).join('\n')

describe('chống báo động giả', () => {
  it('replica khoẻ, bám sát master, không filter → KHÔNG có chẩn đoán nào', () => {
    expect(diagnose(sample())).toEqual([])
  })

  it('trễ dưới ngưỡng → vẫn im lặng', () => {
    expect(diagnose(sample({ Seconds_Behind_Master: 30 }), { lagWarnSec: 60 })).toEqual([])
  })

  it('read_only = ON thì không cảnh báo ghi được', () => {
    expect(ids(diagnose(sample()))).not.toContain('replica-writable')
  })
})

describe('không đo được', () => {
  it('sample lỗi → đúng 1 chẩn đoán, có nhắc quyền REPLICATION CLIENT', () => {
    const list = diagnose(sample({}, { ok: false, error: 'Kết nối bị từ chối', replica: null, drift: null }))
    expect(ids(list)).toEqual(['probe-failed'])
    expect(list[0].why).toContain('Kết nối bị từ chối')
    expect(allText(list[0])).toContain('REPLICATION CLIENT')
  })

  it('server không phải replica → hướng dẫn CHANGE MASTER TO, không đổ lỗi kết nối', () => {
    const list = diagnose(sample({}, { replica: null, drift: null }))
    expect(ids(list)).toEqual(['not-a-replica'])
    expect(allText(list[0])).toContain('CHANGE MASTER TO')
  })
})

describe('IO thread', () => {
  it('1236 — binlog đã bị xoá: nói rõ START SLAVE vô ích, runbook re-seed là destructive', () => {
    const list = diagnose(
      sample({ Slave_IO_Running: 'No', Last_IO_Errno: 1236, Last_IO_Error: 'Got fatal error 1236…', Seconds_Behind_Master: null })
    )
    const d = byId(list, 'io-1236-binlog-purged')
    expect(d.severity).toBe('critical')
    expect(d.why).toContain('vô ích')
    expect(allText(d)).toContain('--master-data=2')
    expect(d.fixes.some((f) => f.danger === 'destructive')).toBe(true)
    // Phải kèm cả cách phòng lần sau, không chỉ chữa cháy
    expect(allText(d)).toContain('binlog_expire_logs_seconds')
  })

  it('1236 nội suy đúng tên file binlog replica đang cần', () => {
    const list = diagnose(sample({ Slave_IO_Running: 'No', Last_IO_Errno: 1236, Master_Log_File: 'mysql-bin.000120' }))
    expect(byId(list, 'io-1236-binlog-purged').why).toContain('mysql-bin.000120')
  })

  it.each([2003, 2013, 2002, 1040, 1053])('lỗi mạng %d → io-network, lệnh test cổng có sẵn IP master', (errno) => {
    const list = diagnose(sample({ Slave_IO_Running: 'No', Last_IO_Errno: errno }))
    const d = byId(list, 'io-network')
    expect(allText(d)).toContain('10.0.0.11')
    expect(d.fixes[0].text).toBe('START SLAVE IO_THREAD;')
    expect(d.fixes[0].danger).toBe('safe')
  })

  it.each([1045, 1130, 1044])('lỗi xác thực %d → io-auth', (errno) => {
    expect(ids(diagnose(sample({ Slave_IO_Running: 'No', Last_IO_Errno: errno })))).toContain('io-auth')
  })

  it('1593 → nghi trùng server_id/uuid', () => {
    const d = byId(diagnose(sample({ Slave_IO_Running: 'No', Last_IO_Errno: 1593 })), 'io-1593-fatal')
    expect(d.why).toContain('server_id')
  })

  it('lỗi lạ vẫn ra chẩn đoán chung, không im lặng', () => {
    expect(ids(diagnose(sample({ Slave_IO_Running: 'No', Last_IO_Errno: 9999 })))).toContain('io-error')
  })

  it('IO tắt mà không có lỗi → đoán là ai đó STOP SLAVE, mức warn', () => {
    const d = byId(diagnose(sample({ Slave_IO_Running: 'No' })), 'io-stopped-manual')
    expect(d.severity).toBe('warn')
    expect(d.fixes[0].text).toBe('START SLAVE IO_THREAD;')
  })

  it('Connecting không lỗi → chỉ warn, không báo động đỏ', () => {
    const list = diagnose(sample({ Slave_IO_Running: 'Connecting' }))
    expect(byId(list, 'io-connecting').severity).toBe('warn')
  })
})

describe('SQL thread', () => {
  const DUP_ERROR =
    "Could not execute Write_rows_v1 event on table app.orders; Duplicate entry '90210' for key 'PRIMARY', Error_code: 1062"

  it('1062 — moi được tên bảng, dựng sẵn SELECT so hai bên', () => {
    const list = diagnose(sample({ Slave_SQL_Running: 'No', Last_Errno: 1062, Last_SQL_Errno: 1062, Last_SQL_Error: DUP_ERROR }))
    const d = byId(list, 'sql-1062-duplicate')
    expect(d.severity).toBe('critical')
    expect(d.why).toContain('`app`.`orders`')
    expect(d.checks.some((c) => c.on === 'master')).toBe(true)
    expect(d.checks.some((c) => c.on === 'replica')).toBe(true)
  })

  it('1062 — lệnh skip là destructive và nói thẳng hậu quả', () => {
    const list = diagnose(sample({ Slave_SQL_Running: 'No', Last_SQL_Errno: 1062, Last_SQL_Error: DUP_ERROR }))
    const skip = byId(list, 'sql-1062-duplicate').fixes.find((f) => f.text.includes('sql_slave_skip_counter'))
    expect(skip?.danger).toBe('destructive')
    expect(skip?.note).toContain('VĨNH VIỄN')
  })

  it('1062 — khuyên khoá ghi replica trước cả khi sửa lỗi', () => {
    const list = diagnose(sample({ Slave_SQL_Running: 'No', Last_SQL_Errno: 1062, Last_SQL_Error: DUP_ERROR }))
    expect(byId(list, 'sql-1062-duplicate').fixes[0].text).toContain('read_only = ON')
  })

  it('1032 — thiếu bản ghi, gợi ý chép lại bảng thay vì skip mù', () => {
    const d = byId(
      diagnose(sample({ Slave_SQL_Running: 'No', Last_SQL_Errno: 1032, Last_SQL_Error: 'Could not execute Update_rows event on table app.users;' })),
      'sql-1032-missing-row'
    )
    expect(allText(d)).toContain('mysqldump')
    expect(d.why).toContain('`app`.`users`')
  })

  it.each([1050, 1051, 1146, 1054, 1091, 1060])('lỗi DDL %d → sql-ddl-mismatch', (errno) => {
    expect(ids(diagnose(sample({ Slave_SQL_Running: 'No', Last_SQL_Errno: errno })))).toContain('sql-ddl-mismatch')
  })

  it('DDL — có tên bảng thì dựng sẵn SHOW CREATE TABLE cho cả hai bên', () => {
    const d = byId(
      diagnose(sample({ Slave_SQL_Running: 'No', Last_SQL_Errno: 1054, Last_SQL_Error: "Could not execute Write_rows event on table shop.items; Unknown column 'sku'" })),
      'sql-ddl-mismatch'
    )
    expect(d.checks.filter((c) => c.text.includes('SHOW CREATE TABLE `shop`.`items`'))).toHaveLength(2)
  })

  it('1594 relay log hỏng — nội suy sẵn vị trí đã apply xong vào CHANGE MASTER TO', () => {
    const d = byId(
      diagnose(sample({ Slave_SQL_Running: 'No', Last_SQL_Errno: 1594, Relay_Master_Log_File: 'mysql-bin.000142', Exec_Master_Log_Pos: 84512900 })),
      'sql-relay-corrupt'
    )
    expect(d.fixes[0].text).toContain("MASTER_LOG_FILE='mysql-bin.000142'")
    expect(d.fixes[0].text).toContain('MASTER_LOG_POS=84512900')
    expect(d.why).toContain('KHÔNG mất gì')
  })

  it('SQL tắt không lỗi → warn, nhắc replica sẽ tụt dần', () => {
    const d = byId(diagnose(sample({ Slave_SQL_Running: 'No' })), 'sql-stopped-manual')
    expect(d.severity).toBe('warn')
    expect(d.why).toContain('tụt dần')
  })
})

describe('trễ khi replication vẫn chạy', () => {
  it('vượt ngưỡng → lag-high, có sẵn câu tìm bảng thiếu PRIMARY KEY', () => {
    const d = byId(diagnose(sample({ Seconds_Behind_Master: 300 }), { lagWarnSec: 60 }), 'lag-high')
    expect(d.title).toContain('5m')
    expect(allText(d)).toContain('PRIMARY KEY')
    expect(allText(d)).toContain('innodb_trx')
  })

  it('replica trễ CỐ Ý → không báo lag, chỉ ghi chú info', () => {
    const list = diagnose(sample({ Seconds_Behind_Master: 3605, SQL_Delay: 3600 }), { lagWarnSec: 60 })
    expect(ids(list)).not.toContain('lag-high')
    expect(byId(list, 'delayed-replica').severity).toBe('info')
  })

  it('trễ vượt ngưỡng KỂ CẢ sau khi trừ phần cố ý → vẫn báo', () => {
    const list = diagnose(sample({ Seconds_Behind_Master: 4000, SQL_Delay: 3600 }), { lagWarnSec: 60 })
    expect(ids(list)).toContain('lag-high')
  })

  it('replica 1 luồng apply → nêu đúng nguyên nhân và đưa lệnh MariaDB', () => {
    const s = sample({ Seconds_Behind_Master: 300 })
    s.replicaVars = vars({ serverId: 12, slaveParallelWorkers: 1 })
    const d = byId(diagnose(s, { lagWarnSec: 60 }), 'lag-high')
    expect(d.why).toContain('MỘT luồng')
    expect(allText(d)).toContain('slave_parallel_threads')
  })

  it('replica MySQL 8 → dùng đúng tên biến replica_parallel_workers, không phải slave_*', () => {
    const s = sample({ Seconds_Behind_Master: 300 })
    s.replicaVars = vars({ serverId: 12, slaveParallelWorkers: 1, version: '8.0.36' })
    s.masterVars = vars({ version: '8.0.36' })
    const text = allText(byId(diagnose(s, { lagWarnSec: 60 }), 'lag-high'))
    expect(text).toContain('replica_parallel_workers')
    expect(text).not.toContain('slave_parallel_threads')
    expect(text).toContain('binlog_transaction_dependency_tracking')
  })

  it('tải về nhiều mà apply không kịp → apply-backlog kèm số byte', () => {
    const replica = {
      Read_Master_Log_Pos: 200 * 1024 * 1024,
      Exec_Master_Log_Pos: 0,
      Seconds_Behind_Master: 5
    }
    const d = byId(diagnose(sample(replica, {}, { file: 'mysql-bin.000142', position: 200 * 1024 * 1024, doDb: '', ignoreDb: '' })), 'apply-backlog')
    expect(d.why).toContain('200')
    expect(d.why).toContain('KHÔNG phải vấn đề mạng')
  })

  it('IO tụt cả file binlog → fetch-backlog', () => {
    const d = byId(
      diagnose(sample({ Master_Log_File: 'mysql-bin.000140', Relay_Master_Log_File: 'mysql-bin.000140' })),
      'fetch-backlog'
    )
    expect(d.title).toContain('2 file')
  })

  it('replication đang đứt thì KHÔNG báo thêm về trễ (tránh nhiễu)', () => {
    const list = diagnose(sample({ Slave_SQL_Running: 'No', Last_SQL_Errno: 1062, Seconds_Behind_Master: 99999 }))
    expect(ids(list)).not.toContain('lag-high')
  })
})

describe('cấu hình nguy hiểm', () => {
  it('replica ghi được → cảnh báo split-brain + lệnh giữ sau restart', () => {
    const s = sample()
    s.replicaVars = vars({ serverId: 12, readOnly: false })
    const d = byId(diagnose(s), 'replica-writable')
    expect(d.why).toContain('1062')
    expect(allText(d)).toContain('super_read_only')
    expect(d.fixes[0].danger).toBe('safe')
  })

  it('trùng server_id → critical', () => {
    const s = sample()
    s.masterVars = vars({ serverId: 11 })
    s.replicaVars = vars({ serverId: 11 })
    const d = byId(diagnose(s), 'server-id-conflict')
    expect(d.severity).toBe('critical')
    expect(d.fixes[0].text).toContain('server_id = 12')
  })

  it('server_id không đọc được ở một bên → không kết luận trùng', () => {
    const s = sample()
    s.masterVars = vars({ serverId: null })
    s.replicaVars = vars({ serverId: null })
    expect(ids(diagnose(s))).not.toContain('server-id-conflict')
  })

  it('master tắt binlog → critical, cảnh báo restart có downtime', () => {
    const s = sample()
    s.masterVars = vars({ logBin: false })
    const d = byId(diagnose(s), 'master-binlog-off')
    expect(d.severity).toBe('critical')
    expect(d.fixes[0].danger).toBe('destructive')
  })

  it('binlog_format STATEMENT → cảnh báo lệch dữ liệu âm thầm', () => {
    const s = sample()
    s.masterVars = vars({ binlogFormat: 'STATEMENT' })
    const d = byId(diagnose(s), 'binlog-format-statement')
    expect(d.why).toContain('âm thầm')
    expect(d.why).toContain('NOW()')
  })

  it('giữ binlog quá ngắn → cảnh báo đây là nguồn gốc của 1236', () => {
    const s = sample()
    s.masterVars = vars({ binlogExpireSeconds: 3600 })
    const d = byId(diagnose(s), 'binlog-retention-short')
    expect(d.title).toContain('1h')
    expect(d.why).toContain('1236')
  })

  it('giữ binlog đủ dài → im lặng', () => {
    const s = sample()
    s.masterVars = vars({ binlogExpireSeconds: 7 * 86_400 })
    expect(ids(diagnose(s))).not.toContain('binlog-retention-short')
  })
})

describe('ghi chú thông tin', () => {
  it('có bộ lọc replication → info, nói rõ lệch dữ liệu là CỐ Ý', () => {
    const d = byId(diagnose(sample({ Replicate_Wild_Ignore_Table: 'app.tmp_%' })), 'repl-filters')
    expect(d.severity).toBe('info')
    expect(d.why).toContain('app.tmp_%')
    expect(d.why).toContain('CỐ Ý')
  })

  it('SBM null khi cả 2 thread chạy → info chứ không phải lỗi', () => {
    const d = byId(diagnose(sample({ Seconds_Behind_Master: null })), 'sbm-null')
    expect(d.severity).toBe('info')
  })
})

describe('sắp xếp', () => {
  it('critical đứng trước warn, warn trước info', () => {
    const s = sample({ Slave_SQL_Running: 'No', Last_SQL_Errno: 1062, Replicate_Do_DB: 'app', SQL_Delay: 60 })
    s.replicaVars = vars({ serverId: 12, readOnly: false })
    const list = diagnose(s)
    const order = list.map((d) => d.severity)
    expect(order).toEqual([...order].sort((a, b) => ({ critical: 0, warn: 1, info: 2 })[a] - ({ critical: 0, warn: 1, info: 2 })[b]))
    expect(list[0].severity).toBe('critical')
  })
})

describe('extractTableFromError', () => {
  it('dạng ROW-based', () => {
    expect(extractTableFromError('Could not execute Write_rows_v1 event on table app.orders; Duplicate entry')).toBe('`app`.`orders`')
  })

  it('dạng STATEMENT-based lấy được cả database lẫn bảng', () => {
    expect(
      extractTableFromError("Error 'Duplicate entry' on query. Default database: 'shop'. Query: 'INSERT INTO orders (id) VALUES (1)'")
    ).toBe('`shop`.`orders`')
  })

  it('chỉ có tên bảng trong query', () => {
    expect(extractTableFromError("Query: 'UPDATE `items` SET a=1'")).toBe('`items`')
  })

  it('không moi được → null, không đoán bừa', () => {
    expect(extractTableFromError('Some unrelated failure')).toBeNull()
    expect(extractTableFromError(null)).toBeNull()
  })
})

describe('định dạng', () => {
  it.each([
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [64 * 1024 * 1024, '64 MB'],
    [3 * 1024 ** 3, '3.0 GB']
  ])('formatBytes(%d) = %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })

  it.each([
    [45, '45s'],
    [60, '1m'],
    [305, '5m 5s'],
    [3600, '1h'],
    [7 * 86_400, '168h']
  ])('formatDuration(%d) = %s', (sec, text) => {
    expect(formatDuration(sec)).toBe(text)
  })
})
