import * as net from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import {
  NO_MASTER,
  ReplicationService,
  VARS_REFRESH_MS,
  clampPollInterval,
  detectVersion,
  openEndpointProbe,
  readMasterSnapshot,
  readSample,
  type ProbeSession,
  type ReplEndpointTarget,
  type ReplPairTarget,
  type ReplReplicaTarget
} from './ReplicationService'
import type { ReplProbe } from './probe'
import type { HostKeyVerifier } from '../connection/types'

const VERIFY: HostKeyVerifier = async () => true

const SLAVE_ROW = {
  Slave_IO_Running: 'Yes',
  Slave_SQL_Running: 'Yes',
  Master_Log_File: 'mysql-bin.000142',
  Read_Master_Log_Pos: '84512377',
  Relay_Master_Log_File: 'mysql-bin.000142',
  Exec_Master_Log_Pos: '84512377',
  Seconds_Behind_Master: '0',
  Last_Errno: '0',
  SQL_Delay: '0'
}
const MASTER_ROW = { File: 'mysql-bin.000142', Position: '84512377' }
const VAR_ROWS = [
  { Variable_name: 'server_id', Value: '11' },
  { Variable_name: 'read_only', Value: 'ON' },
  { Variable_name: 'version', Value: '10.11.6-MariaDB' }
]

/** Probe giả: khớp câu SQL theo tiền tố. Câu không khai báo → ném lỗi cú pháp (như MySQL thật). */
function fakeProbe(
  answers: Record<string, Record<string, unknown>[] | Error>,
  mode: 'driver' | 'cli' = 'driver'
): ReplProbe & { seen: string[]; closed: number } {
  const seen: string[] = []
  const probe = {
    mode,
    seen,
    closed: 0,
    async queryRows(sql: string) {
      seen.push(sql)
      for (const [prefix, value] of Object.entries(answers)) {
        if (sql.startsWith(prefix)) {
          if (value instanceof Error) throw value
          return value
        }
      }
      throw new Error("ERROR 1064 (42000): You have an error in your SQL syntax")
    },
    close() {
      probe.closed += 1
    }
  }
  return probe
}

const session = (probe: ReplProbe): ProbeSession => ({ probe, version: null })

const REPLICA_ANSWERS = {
  'SELECT VERSION()': [{ v: '10.11.6-MariaDB' }],
  'SHOW SLAVE STATUS': [SLAVE_ROW],
  'SHOW GLOBAL VARIABLES': VAR_ROWS
}
const MASTER_ANSWERS = {
  'SELECT VERSION()': [{ v: '10.11.6-MariaDB' }],
  'SHOW MASTER STATUS': [MASTER_ROW],
  'SHOW GLOBAL VARIABLES': VAR_ROWS
}

describe('clampPollInterval', () => {
  it.each([
    [undefined, 15_000],
    [0, 15_000],
    [1_000, 5_000],
    [15_000, 15_000],
    [999_999, 300_000],
    [Number.NaN, 15_000]
  ])('%s → %d', (input, expected) => {
    expect(clampPollInterval(input)).toBe(expected)
  })
})

describe('detectVersion', () => {
  it('dò 1 lần rồi nhớ — không hỏi lại ở lần poll sau', async () => {
    const probe = fakeProbe(REPLICA_ANSWERS)
    const s = session(probe)
    expect((await detectVersion(s))?.flavor).toBe('mariadb')
    await detectVersion(s)
    expect(probe.seen.filter((q) => q.startsWith('SELECT VERSION()'))).toHaveLength(1)
  })

  it('không dò được version → null, KHÔNG làm hỏng cả lần đo', async () => {
    const s = session(fakeProbe({ 'SELECT VERSION()': new Error('nổ') }))
    expect(await detectVersion(s)).toBeNull()
  })
})

/** Bọc probe thành tham số replica của readSample. */
const asReplica = (probe: ReplProbe, replicaId = 'r1', label = 'slave-01') => ({
  replicaId,
  label,
  session: session(probe)
})

describe('readMasterSnapshot', () => {
  it('đọc được master → trả vị trí + biến, không có lỗi', async () => {
    const snapshot = await readMasterSnapshot(session(fakeProbe(MASTER_ANSWERS)), 1_000)
    expect(snapshot.master?.file).toBe('mysql-bin.000142')
    expect(snapshot.masterVars?.serverId).toBe(11)
    expect(snapshot.masterError).toBeUndefined()
  })

  it('không có master (cụm chỉ theo dõi slave) → snapshot rỗng, KHÔNG phải lỗi', async () => {
    expect(await readMasterSnapshot(null, 1_000)).toEqual(NO_MASTER)
  })

  it('master lỗi → KHÔNG ném, ghi masterError để các slave vẫn đo được', async () => {
    const probe = fakeProbe({
      'SELECT VERSION()': [{ v: '10.11.6-MariaDB' }],
      'SHOW MASTER STATUS': new Error('ERROR 1227: Access denied')
    })
    const snapshot = await readMasterSnapshot(session(probe), 1_000)
    expect(snapshot.master).toBeNull()
    expect(snapshot.masterError).toContain('1227')
  })

  it('đọc master MỘT lần rồi dùng chung — không hỏi lại cho từng slave', async () => {
    const probe = fakeProbe(MASTER_ANSWERS)
    const snapshot = await readMasterSnapshot(session(probe), 1_000)
    // Dùng lại snapshot cho 2 slave: probe của master không bị gọi thêm lần nào
    const before = probe.seen.length
    await readSample('p1', asReplica(fakeProbe(REPLICA_ANSWERS), 'r1'), snapshot, 1_000)
    await readSample('p1', asReplica(fakeProbe(REPLICA_ANSWERS), 'r2'), snapshot, 1_000)
    expect(probe.seen).toHaveLength(before)
  })
})

describe('tiết kiệm câu lệnh cho server', () => {
  /** Trả về danh sách câu đã chạy, lọc theo tiền tố. */
  const asked = (probe: ReturnType<typeof fakeProbe>, prefix: string): string[] =>
    probe.seen.filter((q) => q.startsWith(prefix))

  it('SELECT VERSION() chỉ hỏi MỘT lần cho cả phiên, dù poll nhiều chu kỳ', async () => {
    const probe = fakeProbe(REPLICA_ANSWERS)
    const s = session(probe)
    for (let i = 0; i < 5; i += 1) {
      await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, i * 15_000)
    }
    expect(asked(probe, 'SELECT VERSION()')).toHaveLength(1)
  })

  it('SHOW GLOBAL VARIABLES (câu ĐẮT) chỉ đọc lần đầu, các chu kỳ sau dùng SELECT @@global rẻ hơn', async () => {
    const probe = fakeProbe({ ...REPLICA_ANSWERS, 'SELECT @@global.read_only': [{ read_only: 1, super_read_only: 1 }] })
    const s = session(probe)
    // 8 chu kỳ × 15s = 2 phút, chưa tới mốc làm mới 5 phút
    for (let i = 0; i < 8; i += 1) {
      await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, i * 15_000)
    }
    expect(asked(probe, 'SHOW GLOBAL VARIABLES')).toHaveLength(1)
    expect(asked(probe, 'SELECT @@global.read_only')).toHaveLength(7)
  })

  it('quá VARS_REFRESH_MS thì đọc lại biến cấu hình (bắt được thay đổi cấu hình trên server)', async () => {
    const probe = fakeProbe({ ...REPLICA_ANSWERS, 'SELECT @@global.read_only': [{ read_only: 1, super_read_only: 1 }] })
    const s = session(probe)
    await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, 0)
    await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, VARS_REFRESH_MS - 1)
    expect(asked(probe, 'SHOW GLOBAL VARIABLES')).toHaveLength(1)
    await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, VARS_REFRESH_MS)
    expect(asked(probe, 'SHOW GLOBAL VARIABLES')).toHaveLength(2)
  })

  it('read_only đọc mỗi chu kỳ nên bắt được slave BỊ MỞ GHI ngay, không đợi 5 phút', async () => {
    let readOnly = 1
    const probe: ReplProbe = {
      mode: 'driver',
      async queryRows(sql: string) {
        if (sql.startsWith('SELECT VERSION()')) return [{ v: '10.11.6-MariaDB' }]
        if (sql.startsWith('SHOW SLAVE STATUS')) return [SLAVE_ROW]
        if (sql.startsWith('SHOW GLOBAL VARIABLES')) return VAR_ROWS
        if (sql.startsWith('SELECT @@global.read_only')) return [{ read_only: readOnly, super_read_only: readOnly }]
        throw new Error('ERROR 1064: syntax')
      },
      close() {}
    }
    const s = session(probe)
    await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, 0)
    readOnly = 0 // ai đó vừa SET GLOBAL read_only = OFF
    const after = await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, 15_000)
    expect(after.replicaVars?.readOnly).toBe(false)
  })

  it('đọc read_only lỗi → trả NULL chứ không dùng giá trị cache (engine phải đóng băng)', async () => {
    const probe = fakeProbe({
      ...REPLICA_ANSWERS,
      'SELECT @@global.read_only': new Error('ERROR 1227: Access denied')
    })
    const s = session(probe)
    const first = await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, 0)
    expect(first.replicaVars?.readOnly).toBe(true) // lần đầu lấy từ SHOW GLOBAL VARIABLES
    const second = await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, 15_000)
    expect(second.replicaVars?.readOnly).toBeNull()
    expect(second.replicaVars?.serverId).toBe(11) // field khác vẫn giữ từ cache
  })

  it('thiếu quyền đọc biến → KHÔNG thử lại mỗi chu kỳ (đợi tới mốc làm mới)', async () => {
    const probe = fakeProbe({
      'SELECT VERSION()': [{ v: '10.11.6-MariaDB' }],
      'SHOW SLAVE STATUS': [SLAVE_ROW],
      'SHOW GLOBAL VARIABLES': new Error('thiếu quyền')
    })
    const s = session(probe)
    for (let i = 0; i < 5; i += 1) {
      await readSample('p1', { replicaId: 'r1', label: 'a', session: s }, NO_MASTER, i * 15_000)
    }
    expect(asked(probe, 'SHOW GLOBAL VARIABLES')).toHaveLength(1)
  })
})

describe('readSample', () => {
  const MASTER_SNAPSHOT = {
    master: { file: 'mysql-bin.000142', position: 84512377, doDb: '', ignoreDb: '' },
    masterVars: null
  }

  it('đọc slave + snapshot master → sample ok, drift tính xong', async () => {
    const sample = await readSample('p1', asReplica(fakeProbe(REPLICA_ANSWERS)), MASTER_SNAPSHOT, 1_000)
    expect(sample.ok).toBe(true)
    expect(sample.pairId).toBe('p1')
    expect(sample.replicaId).toBe('r1')
    expect(sample.replicaLabel).toBe('slave-01')
    expect(sample.ts).toBe(1_000)
    expect(sample.mode).toBe('driver')
    expect(sample.replica?.ioRunning).toBe('yes')
    expect(sample.master?.file).toBe('mysql-bin.000142')
    expect(sample.drift).toMatchObject({ healthy: true, fetchGapBytes: 0, applyGapBytes: 0 })
    expect(sample.replicaVars?.serverId).toBe(11)
  })

  it('MySQL 8.4: câu cũ lỗi cú pháp → tự dùng SHOW REPLICA STATUS', async () => {
    const probe = fakeProbe({
      'SELECT VERSION()': [{ v: '8.4.0' }],
      'SHOW REPLICA STATUS': [{ Replica_IO_Running: 'Yes', Replica_SQL_Running: 'Yes', Last_Errno: '0' }],
      'SHOW GLOBAL VARIABLES': VAR_ROWS
    })
    const sample = await readSample('p1', asReplica(probe), NO_MASTER, 1_000)
    expect(sample.ok).toBe(true)
    expect(sample.replica?.ioRunning).toBe('yes')
    expect(probe.seen).not.toContain('SHOW SLAVE STATUS')
  })

  it('replica không cấu hình replication → ok nhưng replica = null (để diagnose báo not-a-replica)', async () => {
    const probe = fakeProbe({ ...REPLICA_ANSWERS, 'SHOW SLAVE STATUS': [] })
    const sample = await readSample('p1', asReplica(probe), NO_MASTER, 1_000)
    expect(sample.ok).toBe(true)
    expect(sample.replica).toBeNull()
    expect(sample.drift).toBeNull()
  })

  it('không đọc được replica → ok = false kèm lý do, vẫn giữ danh tính slave', async () => {
    const probe = fakeProbe({
      'SELECT VERSION()': [{ v: '10.11.6-MariaDB' }],
      'SHOW SLAVE STATUS': new Error('ERROR 1227: Access denied; you need REPLICATION CLIENT')
    })
    const sample = await readSample('p1', asReplica(probe, 'r2', 'slave-02'), NO_MASTER, 1_000)
    expect(sample.ok).toBe(false)
    expect(sample.error).toContain('1227')
    expect(sample.replicaId).toBe('r2')
    expect(sample.replicaLabel).toBe('slave-02')
  })

  it('master không đọc được → sample vẫn ok, mang theo masterError của snapshot', async () => {
    const snapshot = { master: null, masterVars: null, masterError: 'ERROR 1227: Access denied' }
    const sample = await readSample('p1', asReplica(fakeProbe(REPLICA_ANSWERS)), snapshot, 1_000)
    expect(sample.ok).toBe(true)
    expect(sample.master).toBeNull()
    expect(sample.masterError).toContain('1227')
    // Mất phần so byte với master nhưng lag và trạng thái thread vẫn dùng được
    expect(sample.drift?.fetchGapBytes).toBeNull()
    expect(sample.drift?.healthy).toBe(true)
  })

  it('không đọc được biến hệ thống → vars null, không làm hỏng lần đo', async () => {
    const probe = fakeProbe({
      'SELECT VERSION()': [{ v: '10.11.6-MariaDB' }],
      'SHOW SLAVE STATUS': [SLAVE_ROW],
      'SHOW GLOBAL VARIABLES': new Error('thiếu quyền')
    })
    const sample = await readSample('p1', asReplica(probe), NO_MASTER, 1_000)
    expect(sample.ok).toBe(true)
    expect(sample.replicaVars).toBeNull()
  })

  it('mode của sample lấy theo probe của replica', async () => {
    const sample = await readSample('p1', asReplica(fakeProbe(REPLICA_ANSWERS, 'cli')), NO_MASTER, 1_000)
    expect(sample.mode).toBe('cli')
  })
})

describe('openEndpointProbe — đọc qua tunnel đã bật', () => {
  const base: ReplEndpointTarget = {
    hostId: 'h1',
    // chain RỖNG là hợp lệ ở chế độ tunnel: TunnelService đã giữ kết nối, ta chỉ nối vào đầu local
    chain: [],
    probeMode: 'auto',
    dbPort: 3306,
    localAddress: { host: '127.0.0.1', port: 3311 }
  }

  /** Listener thật trên cổng ephemeral, cắt ngay khi có kết nối (để mysql2 lỗi nhanh). */
  async function listener(): Promise<{ port: number; arrived: Promise<void>; close: () => void }> {
    const server = net.createServer()
    let hit: () => void = () => {}
    const arrived = new Promise<void>((resolve) => {
      hit = resolve
    })
    server.on('connection', (socket) => {
      hit()
      socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { port: (server.address() as net.AddressInfo).port, arrived, close: () => server.close() }
  }

  it('thiếu credential → ném lỗi RÕ, KHÔNG im lặng rơi sang CLI (qua tunnel không có đường CLI)', async () => {
    await expect(openEndpointProbe(base, VERIFY)).rejects.toThrow(/user \+ mật khẩu/)
    await expect(openEndpointProbe({ ...base, dbUser: 'monitor' }, VERIFY)).rejects.toThrow(/user \+ mật khẩu/)
  })

  it('probeMode cli cũng KHÔNG được rơi sang CLI khi đã chỉ định tunnel', async () => {
    await expect(openEndpointProbe({ ...base, probeMode: 'cli' }, VERIFY)).rejects.toThrow(/user \+ mật khẩu/)
  })

  it('có tunnel thì nối THẲNG vào đầu local của nó, không bắc cầu thêm', async () => {
    // Dựng listener THẬT rồi khẳng định kết nối tới đúng cổng đó. Không đoán qua nội dung lỗi:
    // cổng cố định có thể đang có MySQL thật trên máy dev, và khi đó lỗi sẽ là "Access denied"
    // chứ không phải lỗi kết nối — test cũ đã fail đúng vì vậy.
    const l = await listener()
    try {
      // dbPort = 1 (chắc chắn đóng): nếu code dùng nhầm dbPort thì không kết nối nào tới listener
      // và `arrived` sẽ treo → test timeout, tức phân biệt được hai đường.
      const opening = openEndpointProbe(
        { ...base, dbPort: 1, localAddress: { host: '127.0.0.1', port: l.port }, dbUser: 'monitor', dbPassword: 'x' },
        VERIFY
      )
      await l.arrived
      await expect(opening).rejects.toThrow() // listener không nói giao thức MySQL nên handshake hỏng
    } finally {
      l.close()
    }
  })
})

describe('ReplicationService', () => {
  const endpoint = (over: Partial<ReplEndpointTarget> = {}): ReplEndpointTarget => ({
    hostId: 'h1',
    chain: [{ host: '10.0.0.1', port: 22, username: 'root' }],
    probeMode: 'auto',
    dbPort: 3306,
    ...over
  })
  const replicaTarget = (hostId: string, replicaId = hostId): ReplReplicaTarget => ({
    ...endpoint({ hostId }),
    replicaId,
    label: hostId
  })
  const target = (over: Partial<ReplPairTarget> = {}): ReplPairTarget => ({
    pairId: 'p1',
    master: endpoint({ hostId: 'master' }),
    replicas: [replicaTarget('replica')],
    ...over
  })

  /** openProbe giả: trả probe khác nhau cho master và từng slave, giữ lại để assert. */
  const deps = () => {
    const probes = new Map<string, ReturnType<typeof fakeProbe>>()
    return {
      probes,
      openProbe: vi.fn(async (ep: ReplEndpointTarget) => {
        const probe = fakeProbe(ep.hostId === 'master' ? MASTER_ANSWERS : REPLICA_ANSWERS)
        probes.set(ep.hostId, probe)
        return session(probe)
      }),
      now: () => 1_000
    }
  }

  it('start phát sample ngay, không đợi hết chu kỳ đầu', async () => {
    const d = deps()
    const service = new ReplicationService(d)
    const samples: unknown[] = []
    service.on('sample', (s) => samples.push(s))
    await service.start(target(), VERIFY)
    expect(samples).toHaveLength(1)
    service.stopAll()
  })

  it('start hai lần cùng pairId là no-op — không mở thêm kết nối', async () => {
    const d = deps()
    const service = new ReplicationService(d)
    await service.start(target(), VERIFY)
    await service.start(target(), VERIFY)
    expect(d.openProbe).toHaveBeenCalledTimes(2) // 1 master + 1 replica, không phải 4
    service.stopAll()
  })

  it('dùng lại probe đã mở ở các lần poll sau', async () => {
    const d = deps()
    const service = new ReplicationService(d)
    await service.start(target(), VERIFY)
    await service.pollNow('p1')
    await service.pollNow('p1')
    expect(d.openProbe).toHaveBeenCalledTimes(2)
    service.stopAll()
  })

  it('không mở được master → vẫn đo replica bình thường', async () => {
    const service = new ReplicationService({
      now: () => 1_000,
      openProbe: async (ep) => {
        if (ep.hostId === 'master') throw new Error('cổng đóng')
        return session(fakeProbe(REPLICA_ANSWERS))
      }
    })
    const samples: import('./status').ReplSample[] = []
    service.on('sample', (s) => samples.push(s))
    await service.start(target(), VERIFY)
    expect(samples[0].ok).toBe(true)
    expect(samples[0].replica?.ioRunning).toBe('yes')
    service.stopAll()
  })

  it('không mở được replica → phát sample lỗi thay vì im lặng', async () => {
    const service = new ReplicationService({
      now: () => 1_000,
      openProbe: async () => {
        throw new Error('SSH từ chối')
      }
    })
    const samples: import('./status').ReplSample[] = []
    service.on('sample', (s) => samples.push(s))
    await service.start(target(), VERIFY)
    expect(samples[0]).toMatchObject({ ok: false, pairId: 'p1', mode: null })
    expect(samples[0].error).toContain('SSH từ chối')
    service.stopAll()
  })

  it('đo hỏng → vứt kết nối của SLAVE đó, kết nối master vẫn giữ', async () => {
    const opened: string[] = []
    const bad = fakeProbe({
      'SELECT VERSION()': [{ v: '10.11.6-MariaDB' }],
      'SHOW SLAVE STATUS': new Error('ERROR 2013: Lost connection')
    })
    const service = new ReplicationService({
      now: () => 1_000,
      openProbe: async (ep) => {
        opened.push(ep.hostId)
        return session(ep.hostId === 'master' ? fakeProbe(MASTER_ANSWERS) : bad)
      }
    })
    await service.start(target(), VERIFY)
    expect(bad.closed).toBe(1)
    await service.pollNow('p1')
    // Master mở đúng 1 lần (đọc được thì giữ), slave hỏng mở lại mỗi lượt
    expect(opened).toEqual(['master', 'replica', 'replica'])
    service.stopAll()
  })

  it('master đọc hỏng → vứt kết nối master để lượt sau dựng lại', async () => {
    const opened: string[] = []
    const service = new ReplicationService({
      now: () => 1_000,
      openProbe: async (ep) => {
        opened.push(ep.hostId)
        return session(
          ep.hostId === 'master'
            ? fakeProbe({
                'SELECT VERSION()': [{ v: '10.11.6-MariaDB' }],
                'SHOW MASTER STATUS': new Error('ERROR 2013: Lost connection')
              })
            : fakeProbe(REPLICA_ANSWERS)
        )
      }
    })
    await service.start(target(), VERIFY)
    await service.pollNow('p1')
    expect(opened.filter((h) => h === 'master')).toHaveLength(2)
    service.stopAll()
  })

  it('stop đóng hết kết nối và gỡ khỏi danh sách', async () => {
    const d = deps()
    const service = new ReplicationService(d)
    await service.start(target(), VERIFY)
    expect(service.isRunning('p1')).toBe(true)
    service.stop('p1')
    expect(service.isRunning('p1')).toBe(false)
    expect(d.probes.get('replica')?.closed).toBe(1)
    expect(d.probes.get('master')?.closed).toBe(1)
  })

  it('sau khi stop thì pollNow không làm gì', async () => {
    const d = deps()
    const service = new ReplicationService(d)
    await service.start(target(), VERIFY)
    service.stop('p1')
    const before = d.openProbe.mock.calls.length
    await service.pollNow('p1')
    expect(d.openProbe.mock.calls).toHaveLength(before)
  })

  it('CỤM NHIỀU SLAVE: mỗi chu kỳ phát 1 sample cho MỖI slave', async () => {
    const d = deps()
    const service = new ReplicationService(d)
    const samples: import('./status').ReplSample[] = []
    service.on('sample', (s) => samples.push(s))
    await service.start(
      target({ replicas: [replicaTarget('slave-a'), replicaTarget('slave-b'), replicaTarget('slave-c')] }),
      VERIFY
    )
    expect(samples).toHaveLength(3)
    expect(samples.map((s) => s.replicaId)).toEqual(['slave-a', 'slave-b', 'slave-c'])
    expect(samples.every((s) => s.ok && s.pairId === 'p1')).toBe(true)
    service.stopAll()
  })

  it('CỤM NHIỀU SLAVE: master chỉ đọc MỘT lần cho cả lượt, không phải mỗi slave một lần', async () => {
    const d = deps()
    const service = new ReplicationService(d)
    await service.start(target({ replicas: [replicaTarget('a'), replicaTarget('b'), replicaTarget('c')] }), VERIFY)
    const masterProbe = d.probes.get('master')!
    // 1 lần SELECT VERSION() + 1 SHOW MASTER STATUS + 1 SHOW GLOBAL VARIABLES = 3, dù có 3 slave
    expect(masterProbe.seen).toHaveLength(3)
    expect(masterProbe.seen.filter((q) => q.startsWith('SHOW MASTER STATUS'))).toHaveLength(1)
    service.stopAll()
  })

  it('CỤM NHIỀU SLAVE: mọi slave được so trên CÙNG một mốc vị trí master', async () => {
    const d = deps()
    const service = new ReplicationService(d)
    const samples: import('./status').ReplSample[] = []
    service.on('sample', (s) => samples.push(s))
    await service.start(target({ replicas: [replicaTarget('a'), replicaTarget('b')] }), VERIFY)
    expect(samples[0].master).toEqual(samples[1].master)
    service.stopAll()
  })

  it('CỤM NHIỀU SLAVE: một slave chết KHÔNG chặn các slave còn lại', async () => {
    const service = new ReplicationService({
      now: () => 1_000,
      openProbe: async (ep) => {
        if (ep.hostId === 'bad') throw new Error('SSH từ chối')
        return session(fakeProbe(ep.hostId === 'master' ? MASTER_ANSWERS : REPLICA_ANSWERS))
      }
    })
    const samples: import('./status').ReplSample[] = []
    service.on('sample', (s) => samples.push(s))
    await service.start(target({ replicas: [replicaTarget('bad'), replicaTarget('good')] }), VERIFY)
    expect(samples).toHaveLength(2)
    expect(samples[0]).toMatchObject({ replicaId: 'bad', ok: false })
    expect(samples[0].error).toContain('SSH từ chối')
    expect(samples[1]).toMatchObject({ replicaId: 'good', ok: true })
    service.stopAll()
  })

  it('CỤM NHIỀU SLAVE: slave hỏng bị vứt kết nối, slave khoẻ GIỮ nguyên kết nối', async () => {
    const good = fakeProbe(REPLICA_ANSWERS)
    const bad = fakeProbe({
      'SELECT VERSION()': [{ v: '10.11.6-MariaDB' }],
      'SHOW SLAVE STATUS': new Error('ERROR 2013: Lost connection')
    })
    const service = new ReplicationService({
      now: () => 1_000,
      openProbe: async (ep) =>
        session(ep.hostId === 'master' ? fakeProbe(MASTER_ANSWERS) : ep.hostId === 'bad' ? bad : good)
    })
    await service.start(target({ replicas: [replicaTarget('bad'), replicaTarget('good')] }), VERIFY)
    expect(bad.closed).toBe(1)
    expect(good.closed).toBe(0)
    service.stopAll()
  })

  it('cụm không có master (chỉ theo dõi slave) vẫn chạy', async () => {
    const service = new ReplicationService({
      now: () => 1_000,
      openProbe: async () => session(fakeProbe(REPLICA_ANSWERS))
    })
    const samples: import('./status').ReplSample[] = []
    service.on('sample', (s) => samples.push(s))
    await service.start(target({ master: null }), VERIFY)
    expect(samples[0].ok).toBe(true)
    expect(samples[0].master).toBeNull()
    expect(samples[0].masterError).toBeUndefined()
    service.stopAll()
  })

  it('lần đo trước còn treo → bỏ lượt, không chồng kết nối', async () => {
    let release: (() => void) | undefined
    const openProbe = vi.fn(
      () =>
        new Promise<ProbeSession>((resolve) => {
          release = () => resolve(session(fakeProbe(REPLICA_ANSWERS)))
        })
    )
    const service = new ReplicationService({ now: () => 1_000, openProbe })
    const samples: import('./status').ReplSample[] = []
    service.on('sample', (s) => samples.push(s))

    const first = service.start(target({ master: null }), VERIFY)
    await service.pollNow('p1') // gọi trong lúc lần đầu còn treo → phải bị bỏ qua ngay
    expect(openProbe).toHaveBeenCalledTimes(1)
    expect(samples).toHaveLength(0)

    release?.()
    await first
    expect(openProbe).toHaveBeenCalledTimes(1)
    expect(samples).toHaveLength(1)
    service.stopAll()
  })
})
