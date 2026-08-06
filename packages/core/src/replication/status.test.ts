import { describe, expect, it } from 'vitest'
import {
  VARS_SQL,
  computeDrift,
  masterStatusSqlFor,
  normalizeMasterStatus,
  normalizeReplicaStatus,
  normalizeVars,
  parseBinlogName,
  parseServerVersion,
  parseVerticalG,
  replicaStatusSqlFor,
  variableRowsToMap
} from './status'

/**
 * Fixture dựng bằng mảng chuỗi (không template literal) để khoảng trắng cuối dòng — thứ MySQL
 * thật sự in ra cho trường rỗng — không bị editor/formatter cắt mất.
 */
const G_HEADER = '*************************** 1. row ***************************'

/** MariaDB 10.11, replica khoẻ, bám sát master. */
const MARIADB_HEALTHY = [
  G_HEADER,
  '                Slave_IO_State: Waiting for master to send event',
  '                   Master_Host: 10.0.0.11',
  '                   Master_User: repl',
  '                   Master_Port: 3306',
  '                 Connect_Retry: 60',
  '               Master_Log_File: mysql-bin.000142',
  '           Read_Master_Log_Pos: 84512377',
  '                Relay_Log_File: relay-bin.000233',
  '                 Relay_Log_Pos: 84512676',
  '         Relay_Master_Log_File: mysql-bin.000142',
  '              Slave_IO_Running: Yes',
  '             Slave_SQL_Running: Yes',
  '               Replicate_Do_DB: ',
  '           Replicate_Ignore_DB: ',
  '            Replicate_Do_Table: ',
  '        Replicate_Ignore_Table: ',
  '       Replicate_Wild_Do_Table: ',
  '   Replicate_Wild_Ignore_Table: ',
  '                    Last_Errno: 0',
  '                    Last_Error: ',
  '                  Skip_Counter: 0',
  '           Exec_Master_Log_Pos: 84512377',
  '               Relay_Log_Space: 84513283',
  '         Seconds_Behind_Master: 0',
  '                 Last_IO_Errno: 0',
  '                 Last_IO_Error: ',
  '                Last_SQL_Errno: 0',
  '                Last_SQL_Error: ',
  '              Master_Server_Id: 11',
  '                    Using_Gtid: Slave_Pos',
  '                     SQL_Delay: 0',
  '           SQL_Remaining_Delay: NULL',
  '       Slave_SQL_Running_State: Slave has read all relay log; waiting for more updates'
].join('\n')

/** MySQL 8.0.36 — tên trường mới hoàn toàn: Replica_* và Source_*. */
const MYSQL8_HEALTHY = [
  G_HEADER,
  '             Replica_IO_State: Waiting for source to send event',
  '                  Source_Host: 10.0.0.11',
  '                  Source_User: repl',
  '                  Source_Port: 3306',
  '              Source_Log_File: mysql-bin.000501',
  '          Read_Source_Log_Pos: 15200',
  '        Relay_Source_Log_File: mysql-bin.000501',
  '          Exec_Source_Log_Pos: 15000',
  '           Replica_IO_Running: Yes',
  '          Replica_SQL_Running: Yes',
  '                   Last_Errno: 0',
  '                   Last_Error: ',
  '        Seconds_Behind_Source: 2',
  '                Last_IO_Errno: 0',
  '               Last_SQL_Errno: 0',
  '             Source_Server_Id: 11',
  '                Auto_Position: 1',
  '                    SQL_Delay: 0',
  '          SQL_Remaining_Delay: NULL',
  '    Replica_SQL_Running_State: Waiting for dependent transaction to commit'
].join('\n')

/** IO thread chết vì master đã xoá mất binlog cần đọc. */
const BROKEN_1236 = [
  G_HEADER,
  '                Slave_IO_State: ',
  '                   Master_Host: 10.0.0.11',
  '               Master_Log_File: mysql-bin.000120',
  '           Read_Master_Log_Pos: 4',
  '         Relay_Master_Log_File: mysql-bin.000120',
  '           Exec_Master_Log_Pos: 4',
  '              Slave_IO_Running: No',
  '             Slave_SQL_Running: Yes',
  '                    Last_Errno: 0',
  '                    Last_Error: ',
  '         Seconds_Behind_Master: NULL',
  '                 Last_IO_Errno: 1236',
  "                 Last_IO_Error: Got fatal error 1236 from master when reading data from binary log: 'Could not find first log file name in binary log index file'",
  '                Last_SQL_Errno: 0',
  '                     SQL_Delay: 0'
].join('\n')

/** SQL thread chết vì duplicate key — Last_Error trải trên 2 dòng. */
const BROKEN_1062 = [
  G_HEADER,
  '                Slave_IO_State: Waiting for master to send event',
  '               Master_Log_File: mysql-bin.000142',
  '           Read_Master_Log_Pos: 84900000',
  '         Relay_Master_Log_File: mysql-bin.000142',
  '           Exec_Master_Log_Pos: 84512900',
  '              Slave_IO_Running: Yes',
  '             Slave_SQL_Running: No',
  '                    Last_Errno: 1062',
  "                    Last_Error: Could not execute Write_rows_v1 event on table app.orders; Duplicate entry '90210' for key 'PRIMARY', Error_code: 1062;",
  "handler error HA_ERR_FOUND_DUPP_KEY; the event's master log mysql-bin.000142, end_log_pos 84512900",
  '         Seconds_Behind_Master: NULL',
  '                 Last_IO_Errno: 0',
  '                Last_SQL_Errno: 1062',
  '                     SQL_Delay: 0'
].join('\n')

const parseOne = (text: string): Record<string, string> => {
  const rows = parseVerticalG(text)
  expect(rows).toHaveLength(1)
  return rows[0]
}

describe('parseServerVersion', () => {
  it.each([
    ['10.11.6-MariaDB-1:10.11.6+maria~ubu2204', 'mariadb', 10, 11, 6],
    ['11.4.3-MariaDB', 'mariadb', 11, 4, 3],
    ['8.0.36', 'mysql', 8, 0, 36],
    ['8.4.0', 'mysql', 8, 4, 0],
    ['5.7.44-log', 'mysql', 5, 7, 44]
  ])('%s → %s %d.%d.%d', (raw, flavor, major, minor, patch) => {
    expect(parseServerVersion(raw)).toMatchObject({ flavor, major, minor, patch })
  })

  it('chuỗi rác → unknown, không throw', () => {
    expect(parseServerVersion('')).toMatchObject({ flavor: 'unknown', major: 0 })
  })
})

describe('chọn câu lệnh theo phiên bản', () => {
  it('MySQL 8.4 KHÔNG được thử SHOW SLAVE STATUS — lệnh đó đã bị xoá', () => {
    const sql = replicaStatusSqlFor(parseServerVersion('8.4.0'))
    expect(sql).toEqual(['SHOW REPLICA STATUS'])
    expect(masterStatusSqlFor(parseServerVersion('8.4.0'))).toEqual(['SHOW BINARY LOG STATUS'])
  })

  it('MySQL 8.0.22+ ưu tiên tên mới nhưng vẫn có đường lui', () => {
    expect(replicaStatusSqlFor(parseServerVersion('8.0.36'))).toEqual([
      'SHOW REPLICA STATUS',
      'SHOW SLAVE STATUS'
    ])
  })

  it('MySQL 8.0.21 (trước khi đổi tên) và MariaDB dùng tên cũ trước', () => {
    expect(replicaStatusSqlFor(parseServerVersion('8.0.21'))[0]).toBe('SHOW SLAVE STATUS')
    expect(replicaStatusSqlFor(parseServerVersion('11.4.3-MariaDB'))[0]).toBe('SHOW SLAVE STATUS')
  })

  it('chưa biết phiên bản → tên cũ trước (chạy được trên mọi bản trừ MySQL 8.4)', () => {
    expect(replicaStatusSqlFor(null)[0]).toBe('SHOW SLAVE STATUS')
    expect(masterStatusSqlFor(null)[0]).toBe('SHOW MASTER STATUS')
  })
})

describe('parseVerticalG', () => {
  it('parse output \\G thành cặp tên/giá trị, bỏ khoảng trắng căn lề', () => {
    const row = parseOne(MARIADB_HEALTHY)
    expect(row.Master_Host).toBe('10.0.0.11')
    expect(row.Read_Master_Log_Pos).toBe('84512377')
    expect(row.Slave_SQL_Running_State).toBe('Slave has read all relay log; waiting for more updates')
  })

  it('trường rỗng → chuỗi rỗng, không phải undefined', () => {
    expect(parseOne(MARIADB_HEALTHY).Replicate_Do_DB).toBe('')
  })

  it('giá trị nhiều dòng được nối lại (Last_Error chứa nguyên câu query)', () => {
    const row = parseOne(BROKEN_1062)
    expect(row.Last_Error).toContain("Duplicate entry '90210'")
    expect(row.Last_Error).toContain('HA_ERR_FOUND_DUPP_KEY')
    expect(row.Last_Error.split('\n')).toHaveLength(2)
  })

  it('nhiều row (vd SHOW GLOBAL VARIABLES) tách đúng', () => {
    const rows = parseVerticalG(
      [
        G_HEADER,
        'Variable_name: server_id',
        '        Value: 11',
        '*************************** 2. row ***************************',
        'Variable_name: read_only',
        '        Value: ON'
      ].join('\n')
    )
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual({ Variable_name: 'read_only', Value: 'ON' })
  })

  it('output rỗng (slave chưa cấu hình replication) → mảng rỗng', () => {
    expect(parseVerticalG('')).toEqual([])
    expect(parseVerticalG('\n\n')).toEqual([])
  })

  it('chịu được CRLF', () => {
    const rows = parseVerticalG(`${G_HEADER}\r\nMaster_Host: 10.0.0.11\r\n`)
    expect(rows[0].Master_Host).toBe('10.0.0.11')
  })
})

describe('normalizeReplicaStatus', () => {
  it('MariaDB khoẻ', () => {
    const s = normalizeReplicaStatus(parseOne(MARIADB_HEALTHY))
    expect(s).toMatchObject({
      masterHost: '10.0.0.11',
      masterPort: 3306,
      masterServerId: 11,
      ioRunning: 'yes',
      sqlRunning: 'yes',
      readFile: 'mysql-bin.000142',
      readPos: 84512377,
      execFile: 'mysql-bin.000142',
      execPos: 84512377,
      secondsBehind: 0,
      lastErrno: 0,
      sqlDelaySec: 0,
      usingGtid: 'Slave_Pos'
    })
    expect(s.filters.any).toBe(false)
    expect(s.lastError).toBe('')
  })

  it('MySQL 8 tên Replica_*/Source_* cho ra CÙNG một DTO', () => {
    const s = normalizeReplicaStatus(parseOne(MYSQL8_HEALTHY))
    expect(s).toMatchObject({
      masterHost: '10.0.0.11',
      masterServerId: 11,
      ioRunning: 'yes',
      sqlRunning: 'yes',
      readFile: 'mysql-bin.000501',
      readPos: 15200,
      execPos: 15000,
      secondsBehind: 2,
      usingGtid: '1'
    })
  })

  it('SQL_Remaining_Delay: NULL → null chứ không phải chuỗi "NULL"', () => {
    expect(normalizeReplicaStatus(parseOne(MARIADB_HEALTHY)).remainingDelaySec).toBeNull()
  })

  it('Seconds_Behind_Master: NULL → null (replication đang đứt)', () => {
    expect(normalizeReplicaStatus(parseOne(BROKEN_1236)).secondsBehind).toBeNull()
  })

  it('đứt 1236: IO no, SQL vẫn yes, errno nằm ở Last_IO_Errno', () => {
    const s = normalizeReplicaStatus(parseOne(BROKEN_1236))
    expect(s.ioRunning).toBe('no')
    expect(s.sqlRunning).toBe('yes')
    expect(s.lastIoErrno).toBe(1236)
    expect(s.lastErrno).toBe(0)
  })

  it('đứt 1062: SQL no, Last_Errno = 1062', () => {
    const s = normalizeReplicaStatus(parseOne(BROKEN_1062))
    expect(s.sqlRunning).toBe('no')
    expect(s.lastErrno).toBe(1062)
    expect(s.lastSqlErrno).toBe(1062)
  })

  it('nhận row từ driver (giá trị đã đúng kiểu, có null thật)', () => {
    const s = normalizeReplicaStatus({
      Slave_IO_Running: 'Yes',
      Slave_SQL_Running: 'Yes',
      Master_Log_File: 'mysql-bin.000142',
      Read_Master_Log_Pos: 84512377,
      Relay_Master_Log_File: 'mysql-bin.000142',
      Exec_Master_Log_Pos: 84512377,
      Seconds_Behind_Master: null,
      Last_Errno: 0,
      SQL_Delay: 0
    })
    expect(s.readPos).toBe(84512377)
    expect(s.secondsBehind).toBeNull()
  })

  it('vị trí binlog kiểu bigint (mysql2 supportBigNumbers) vẫn ra số', () => {
    const s = normalizeReplicaStatus({ Read_Master_Log_Pos: 84512377n, Exec_Master_Log_Pos: 1n })
    expect(s.readPos).toBe(84512377)
  })

  it('Connecting là trạng thái trung gian, không phải "no"', () => {
    expect(normalizeReplicaStatus({ Slave_IO_Running: 'Connecting' }).ioRunning).toBe('connecting')
  })

  it('phát hiện có bộ lọc replication', () => {
    const s = normalizeReplicaStatus({ Replicate_Wild_Ignore_Table: 'app.tmp_%' })
    expect(s.filters.any).toBe(true)
    expect(s.filters.wildIgnoreTable).toBe('app.tmp_%')
  })
})

describe('normalizeMasterStatus', () => {
  it('parse SHOW MASTER STATUS', () => {
    const rows = parseVerticalG(
      [G_HEADER, '            File: mysql-bin.000142', '        Position: 84600000', '    Binlog_Do_DB: ', 'Binlog_Ignore_DB: '].join(
        '\n'
      )
    )
    expect(normalizeMasterStatus(rows[0])).toEqual({
      file: 'mysql-bin.000142',
      position: 84600000,
      doDb: '',
      ignoreDb: ''
    })
  })
})

describe('normalizeVars', () => {
  it('gom biến MariaDB', () => {
    const vars = normalizeVars(
      variableRowsToMap([
        { Variable_name: 'server_id', Value: '11' },
        { Variable_name: 'read_only', Value: 'ON' },
        { Variable_name: 'super_read_only', Value: 'OFF' },
        { Variable_name: 'binlog_format', Value: 'ROW' },
        { Variable_name: 'log_bin', Value: 'ON' },
        { Variable_name: 'version', Value: '10.11.6-MariaDB' },
        { Variable_name: 'slave_parallel_workers', Value: '4' },
        { Variable_name: 'expire_logs_days', Value: '3' }
      ])
    )
    expect(vars).toMatchObject({
      serverId: 11,
      readOnly: true,
      superReadOnly: false,
      binlogFormat: 'ROW',
      logBin: true,
      slaveParallelWorkers: 4,
      binlogExpireSeconds: 3 * 86_400
    })
  })

  it('MySQL 8: replica_parallel_workers + binlog_expire_logs_seconds', () => {
    const vars = normalizeVars(
      variableRowsToMap([
        { Variable_name: 'replica_parallel_workers', Value: '8' },
        { Variable_name: 'binlog_expire_logs_seconds', Value: '604800' },
        { Variable_name: 'expire_logs_days', Value: '0' }
      ])
    )
    expect(vars.slaveParallelWorkers).toBe(8)
    // Có cả 2 biến: bản MySQL 8 để expire_logs_days = 0 nên phải lấy biến giây
    expect(vars.binlogExpireSeconds).toBe(604_800)
  })

  it('biến thiếu → null (khác với false/0)', () => {
    const vars = normalizeVars({})
    expect(vars.readOnly).toBeNull()
    expect(vars.serverId).toBeNull()
    expect(vars.binlogExpireSeconds).toBeNull()
  })

  it('VARS_SQL là câu SHOW hợp lệ và hỏi đủ biến cần cho chẩn đoán', () => {
    expect(VARS_SQL.startsWith('SHOW GLOBAL VARIABLES WHERE Variable_name IN (')).toBe(true)
    for (const name of ['server_id', 'read_only', 'super_read_only', 'binlog_format']) {
      expect(VARS_SQL).toContain(`'${name}'`)
    }
  })
})

describe('parseBinlogName', () => {
  it.each([
    ['mysql-bin.000142', 'mysql-bin', 142],
    ['binlog.000001', 'binlog', 1],
    ['my.host.bin.000999', 'my.host.bin', 999]
  ])('%s', (file, base, seq) => {
    expect(parseBinlogName(file)).toEqual({ base, seq })
  })

  it('tên không theo mẫu → null', () => {
    expect(parseBinlogName('relay-bin')).toBeNull()
    expect(parseBinlogName(null)).toBeNull()
  })
})

describe('computeDrift', () => {
  const healthy = normalizeReplicaStatus(parseOne(MARIADB_HEALTHY))

  it('bám sát master trong cùng file → gap 0, healthy', () => {
    const d = computeDrift({ file: 'mysql-bin.000142', position: 84512377, doDb: '', ignoreDb: '' }, healthy)
    expect(d).toMatchObject({
      lagSec: 0,
      effectiveLagSec: 0,
      fetchGapBytes: 0,
      applyGapBytes: 0,
      fetchFilesBehind: 0,
      applyFilesBehind: 0,
      healthy: true
    })
  })

  it('tính đúng byte IO thread chưa tải và SQL thread chưa apply', () => {
    const replica = normalizeReplicaStatus(parseOne(BROKEN_1062))
    const d = computeDrift({ file: 'mysql-bin.000142', position: 85000000, doDb: '', ignoreDb: '' }, replica)
    expect(d.fetchGapBytes).toBe(85000000 - 84900000) // master → đã tải
    expect(d.applyGapBytes).toBe(84900000 - 84512900) // đã tải → đã apply
    expect(d.healthy).toBe(false)
  })

  it('master đi trước NHIỀU file → không bịa số byte, chỉ báo số file', () => {
    const replica = normalizeReplicaStatus(parseOne(BROKEN_1236))
    const d = computeDrift({ file: 'mysql-bin.000125', position: 500, doDb: '', ignoreDb: '' }, replica)
    expect(d.fetchGapBytes).toBeNull()
    expect(d.fetchFilesBehind).toBe(5)
  })

  it('vị trí master đọc trước replica → hiệu âm, kẹp về 0 chứ không trả số âm', () => {
    // Đọc master lúc pos=100, sau đó replica đã đọc tới 900 → không phải "âm 800 byte"
    const replica = normalizeReplicaStatus({
      Master_Log_File: 'mysql-bin.000142',
      Read_Master_Log_Pos: 900,
      Relay_Master_Log_File: 'mysql-bin.000142',
      Exec_Master_Log_Pos: 900,
      Slave_IO_Running: 'Yes',
      Slave_SQL_Running: 'Yes',
      Last_Errno: 0
    })
    const d = computeDrift({ file: 'mysql-bin.000142', position: 100, doDb: '', ignoreDb: '' }, replica)
    expect(d.fetchGapBytes).toBe(0)
  })

  it('không đọc được master (thiếu quyền) vẫn tính được applyGap', () => {
    const d = computeDrift(null, healthy)
    expect(d.fetchGapBytes).toBeNull()
    expect(d.fetchFilesBehind).toBeNull()
    expect(d.applyGapBytes).toBe(0)
    expect(d.lagSec).toBe(0)
  })

  it('replica trễ CỐ Ý (MASTER_DELAY=3600) → effectiveLagSec trừ đi phần cố ý', () => {
    const replica = normalizeReplicaStatus({
      Slave_IO_Running: 'Yes',
      Slave_SQL_Running: 'Yes',
      Last_Errno: 0,
      Seconds_Behind_Master: 3605,
      SQL_Delay: 3600
    })
    const d = computeDrift(null, replica)
    expect(d.lagSec).toBe(3605)
    expect(d.effectiveLagSec).toBe(5)
  })

  it('lag nhỏ hơn delay cấu hình → kẹp 0, không ra số âm', () => {
    const replica = normalizeReplicaStatus({ Seconds_Behind_Master: 10, SQL_Delay: 3600 })
    expect(computeDrift(null, replica).effectiveLagSec).toBe(0)
  })

  it('SBM = 0 nhưng IO thread chết → healthy phải là false (SBM nói dối)', () => {
    const replica = normalizeReplicaStatus({
      Slave_IO_Running: 'No',
      Slave_SQL_Running: 'Yes',
      Seconds_Behind_Master: 0,
      Last_Errno: 0
    })
    const d = computeDrift(null, replica)
    expect(d.lagSec).toBe(0)
    expect(d.healthy).toBe(false)
  })
})
