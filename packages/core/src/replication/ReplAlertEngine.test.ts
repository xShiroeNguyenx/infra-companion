import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPL_THRESHOLDS,
  ReplAlertEngine,
  errorNo,
  threadsBad,
  threadsDetail,
  type ReplAlertRules
} from './ReplAlertEngine'
import { computeDrift, normalizeReplicaStatus, normalizeVars, type ReplSample } from './status'

const RULES: ReplAlertRules = { defaults: DEFAULT_REPL_THRESHOLDS, perPair: {} }

let seq = 0
/** Sample khoẻ; ts tăng 15s mỗi lần (mô phỏng chu kỳ poll thật). */
function sample(over: Partial<Record<string, unknown>> = {}, ts?: number, replicaId = 'r1'): ReplSample {
  seq += 1
  const replica = normalizeReplicaStatus({
    Slave_IO_Running: 'Yes',
    Slave_SQL_Running: 'Yes',
    Master_Log_File: 'mysql-bin.000142',
    Read_Master_Log_Pos: 1000,
    Relay_Master_Log_File: 'mysql-bin.000142',
    Exec_Master_Log_Pos: 1000,
    Seconds_Behind_Master: 0,
    Last_Errno: 0,
    SQL_Delay: 0,
    ...over
  })
  const master = { file: 'mysql-bin.000142', position: 1000, doDb: '', ignoreDb: '' }
  return {
    pairId: 'p1',
    replicaId,
    replicaLabel: `slave-${replicaId}`,
    ts: ts ?? seq * 15_000,
    ok: true,
    mode: 'driver',
    master,
    replica,
    masterVars: normalizeVars({ server_id: '11' }),
    replicaVars: normalizeVars({ server_id: '12', read_only: 'ON' }),
    drift: computeDrift(master, replica)
  }
}

function unreadable(ts?: number, replicaId = 'r1'): ReplSample {
  seq += 1
  return {
    pairId: 'p1',
    replicaId,
    replicaLabel: `slave-${replicaId}`,
    ts: ts ?? seq * 15_000,
    ok: false,
    mode: null,
    master: null,
    replica: null,
    masterVars: null,
    replicaVars: null,
    drift: null,
    error: 'Mất kết nối SSH'
  }
}

/** Sample có trễ cho trước, replication vẫn chạy. */
const lagged = (sec: number, ts?: number): ReplSample => sample({ Seconds_Behind_Master: sec }, ts)

describe('ReplAlertEngine — nhịp cơ bản', () => {
  it('replica khoẻ → không có cảnh báo nào', () => {
    const e = new ReplAlertEngine(RULES)
    expect(e.onSample(sample())).toEqual([])
    expect(e.onSample(sample())).toEqual([])
    expect(e.onSample(sample())).toEqual([])
  })

  it('breach sau ĐÚNG 2 mẫu liên tiếp (chu kỳ 15s → báo trong ~30s)', () => {
    const e = new ReplAlertEngine(RULES)
    expect(e.onSample(sample({ Slave_SQL_Running: 'No' }))).toEqual([])
    const events = e.onSample(sample({ Slave_SQL_Running: 'No' }))
    expect(events.filter((x) => x.metric === 'threads')).toHaveLength(1)
    expect(events.find((x) => x.metric === 'threads')).toMatchObject({ kind: 'breach', pairId: 'p1' })
  })

  it('1 mẫu hỏng rồi khoẻ lại → không breach (chuỗi bị cắt)', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(sample({ Slave_SQL_Running: 'No' }))
    expect(e.onSample(sample())).toEqual([])
    expect(e.onSample(sample())).toEqual([])
  })

  it('breach rồi hồi → phát recover đúng một lần', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(sample({ Slave_SQL_Running: 'No' }))
    e.onSample(sample({ Slave_SQL_Running: 'No' }))
    e.onSample(sample())
    const events = e.onSample(sample())
    expect(events.find((x) => x.metric === 'threads')).toMatchObject({ kind: 'recover' })
    expect(e.onSample(sample())).toEqual([])
  })

  it('breach kéo dài → nhắc lại sau cooldown, không spam mỗi chu kỳ', () => {
    const e = new ReplAlertEngine(RULES, { realertCooldownMs: 60_000 })
    e.onSample(sample({ Slave_SQL_Running: 'No' }, 0))
    expect(e.onSample(sample({ Slave_SQL_Running: 'No' }, 15_000))).toHaveLength(1) // breach đầu
    expect(e.onSample(sample({ Slave_SQL_Running: 'No' }, 30_000))).toEqual([])
    expect(e.onSample(sample({ Slave_SQL_Running: 'No' }, 60_000))).toEqual([])
    expect(e.onSample(sample({ Slave_SQL_Running: 'No' }, 75_000))).toHaveLength(1) // đủ 60s → nhắc lại
  })
})

describe('ReplAlertEngine — trễ', () => {
  it('vượt ngưỡng đủ số mẫu → breach kèm giá trị và ngưỡng', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(lagged(300))
    const events = e.onSample(lagged(300))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ metric: 'lag', kind: 'breach', value: 300, threshold: 60 })
  })

  it('dao động sát ngưỡng KHÔNG gây flapping (vùng chết)', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(lagged(61))
    e.onSample(lagged(61)) // breach
    // 55 nằm trong vùng chết [60−12, 60) → không recover
    expect(e.onSample(lagged(55))).toEqual([])
    expect(e.onSample(lagged(55))).toEqual([])
    expect(e.onSample(lagged(61))).toEqual([])
  })

  it('tụt hẳn dưới vùng chết → recover', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(lagged(300))
    e.onSample(lagged(300))
    e.onSample(lagged(0))
    expect(e.onSample(lagged(0))).toMatchObject([{ metric: 'lag', kind: 'recover' }])
  })

  it('replica trễ CỐ Ý (MASTER_DELAY) không bị báo — dùng effectiveLagSec', () => {
    const e = new ReplAlertEngine(RULES)
    const delayed = (): ReplSample => sample({ Seconds_Behind_Master: 3605, SQL_Delay: 3600 })
    expect(e.onSample(delayed())).toEqual([])
    expect(e.onSample(delayed())).toEqual([])
    expect(e.onSample(delayed())).toEqual([])
  })

  it('trễ vượt ngưỡng NGOÀI phần cố ý → vẫn báo', () => {
    const e = new ReplAlertEngine(RULES)
    const late = (): ReplSample => sample({ Seconds_Behind_Master: 4000, SQL_Delay: 3600 })
    e.onSample(late())
    expect(e.onSample(late())[0]).toMatchObject({ metric: 'lag', kind: 'breach', value: 400 })
  })

  it('Seconds_Behind_Master = NULL → đóng băng, không breach cũng không recover', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(lagged(300))
    e.onSample(lagged(300)) // breach
    expect(e.onSample(sample({ Seconds_Behind_Master: null }))).toEqual([])
    expect(e.onSample(sample({ Seconds_Behind_Master: null }))).toEqual([])
    // Chuỗi breach vẫn giữ: tụt hẳn mới recover
    e.onSample(lagged(0))
    expect(e.onSample(lagged(0))).toMatchObject([{ metric: 'lag', kind: 'recover' }])
  })

  it('ngưỡng null = tắt hẳn metric đó', () => {
    const e = new ReplAlertEngine({ defaults: { ...DEFAULT_REPL_THRESHOLDS, lagSec: null }, perPair: {} })
    e.onSample(lagged(9999))
    expect(e.onSample(lagged(9999))).toEqual([])
  })
})

describe('ReplAlertEngine — applyGap', () => {
  const withGap = (bytes: number): ReplSample =>
    sample({ Read_Master_Log_Pos: 1000 + bytes, Exec_Master_Log_Pos: 1000 })

  it('mặc định TẮT (baseline mỗi hệ thống một khác)', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(withGap(999_999_999))
    expect(e.onSample(withGap(999_999_999))).toEqual([])
  })

  it('bật thì breach theo byte, vùng chết theo tỉ lệ 10%', () => {
    const e = new ReplAlertEngine({
      defaults: { ...DEFAULT_REPL_THRESHOLDS, lagSec: null, applyGapBytes: 1000 },
      perPair: {}
    })
    e.onSample(withGap(2000))
    expect(e.onSample(withGap(2000))[0]).toMatchObject({ metric: 'applyGap', kind: 'breach', value: 2000 })
    // 950 nằm trong vùng chết [900, 1000) → chưa recover
    expect(e.onSample(withGap(950))).toEqual([])
    e.onSample(withGap(0))
    expect(e.onSample(withGap(0))).toMatchObject([{ metric: 'applyGap', kind: 'recover' }])
  })
})

describe('ReplAlertEngine — lỗi và cấu hình', () => {
  it('có errno → breach metric error kèm nguyên văn lỗi', () => {
    const e = new ReplAlertEngine(RULES)
    const broken = (): ReplSample =>
      sample({ Slave_SQL_Running: 'No', Last_SQL_Errno: 1062, Last_SQL_Error: "Duplicate entry '9'" })
    e.onSample(broken())
    const events = e.onSample(broken())
    const err = events.find((x) => x.metric === 'error')
    expect(err).toMatchObject({ kind: 'breach' })
    expect(err?.detail).toContain('1062')
    expect(err?.detail).toContain('Duplicate entry')
  })

  it('replica ghi được → breach metric writable', () => {
    const e = new ReplAlertEngine(RULES)
    const writable = (): ReplSample => {
      const s = sample()
      s.replicaVars = normalizeVars({ read_only: 'OFF' })
      return s
    }
    e.onSample(writable())
    expect(e.onSample(writable()).find((x) => x.metric === 'writable')).toMatchObject({
      kind: 'breach',
      detail: 'read_only = OFF'
    })
  })

  it('không đọc được read_only → đóng băng, KHÔNG đoán là an toàn', () => {
    const e = new ReplAlertEngine(RULES)
    const unknown = (): ReplSample => {
      const s = sample()
      s.replicaVars = null
      return s
    }
    expect(e.onSample(unknown())).toEqual([])
    expect(e.onSample(unknown())).toEqual([])
  })

  it('server không phải replica → tính là threads hỏng', () => {
    const e = new ReplAlertEngine(RULES)
    const notReplica = (): ReplSample => {
      const s = sample()
      s.replica = null
      s.drift = null
      return s
    }
    e.onSample(notReplica())
    const events = e.onSample(notReplica())
    expect(events.find((x) => x.metric === 'threads')).toMatchObject({
      kind: 'breach',
      detail: 'chưa cấu hình làm replica'
    })
  })
})

describe('ReplAlertEngine — không đo được', () => {
  it('mất kết nối đủ số mẫu → breach metric probe kèm lý do', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(unreadable())
    const events = e.onSample(unreadable())
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ metric: 'probe', kind: 'breach', detail: 'Mất kết nối SSH' })
  })

  it('đo lại được → recover', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(unreadable())
    e.onSample(unreadable())
    e.onSample(sample())
    expect(e.onSample(sample())).toMatchObject([{ metric: 'probe', kind: 'recover' }])
  })

  it('rớt mạng giữa chừng KHÔNG xoá chuỗi breach đang tích luỹ của metric khác', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(lagged(300)) // 1 mẫu vượt
    e.onSample(unreadable()) // đóng băng, không reset
    // Mẫu vượt kế tiếp là mẫu thứ 2 → breach ngay
    expect(e.onSample(lagged(300)).find((x) => x.metric === 'lag')).toMatchObject({ kind: 'breach' })
  })
})

describe('ReplAlertEngine — ngưỡng riêng từng cặp', () => {
  it('override thắng defaults', () => {
    const e = new ReplAlertEngine({ defaults: DEFAULT_REPL_THRESHOLDS, perPair: { p1: { lagSec: 5 } } })
    e.onSample(lagged(10))
    expect(e.onSample(lagged(10))[0]).toMatchObject({ metric: 'lag', threshold: 5 })
  })

  it('override null = TẮT riêng cặp đó (không rơi về defaults)', () => {
    const e = new ReplAlertEngine({ defaults: DEFAULT_REPL_THRESHOLDS, perPair: { p1: { lagSec: null } } })
    e.onSample(lagged(9999))
    expect(e.onSample(lagged(9999))).toEqual([])
  })

  it('cặp khác không bị ảnh hưởng bởi override', () => {
    const e = new ReplAlertEngine({ defaults: DEFAULT_REPL_THRESHOLDS, perPair: { other: { lagSec: null } } })
    e.onSample(lagged(300))
    expect(e.onSample(lagged(300))[0]).toMatchObject({ metric: 'lag', threshold: 60 })
  })
})

describe('ReplAlertEngine — nhiều slave trong một cụm', () => {
  const brokenOn = (replicaId: string): ReplSample => sample({ Slave_SQL_Running: 'No' }, undefined, replicaId)
  const healthyOn = (replicaId: string): ReplSample => sample({}, undefined, replicaId)

  it('slave này đứt KHÔNG kéo theo slave kia — máy trạng thái tách riêng', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(brokenOn('r1'))
    e.onSample(healthyOn('r2'))
    const events = e.onSample(brokenOn('r1')) // mẫu thứ 2 của r1 → breach
    expect(events.find((x) => x.metric === 'threads')).toMatchObject({ replicaId: 'r1' })
    // r2 vẫn khoẻ, không có cảnh báo nào
    expect(e.onSample(healthyOn('r2'))).toEqual([])
  })

  it('mỗi slave breach riêng, cảnh báo mang đúng nhãn slave', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(brokenOn('r1'))
    e.onSample(brokenOn('r2'))
    expect(e.onSample(brokenOn('r1'))[0]).toMatchObject({ replicaId: 'r1', replicaLabel: 'slave-r1' })
    expect(e.onSample(brokenOn('r2'))[0]).toMatchObject({ replicaId: 'r2', replicaLabel: 'slave-r2' })
  })

  it('ngưỡng đặt theo CỤM nên áp cho mọi slave trong cụm', () => {
    const e = new ReplAlertEngine({ defaults: DEFAULT_REPL_THRESHOLDS, perPair: { p1: { lagSec: 5 } } })
    e.onSample(sample({ Seconds_Behind_Master: 10 }, undefined, 'r2'))
    expect(e.onSample(sample({ Seconds_Behind_Master: 10 }, undefined, 'r2'))[0]).toMatchObject({ threshold: 5 })
  })

  it('bỏ 1 slave khỏi cụm chỉ xoá state của nó', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(brokenOn('r1'))
    e.onSample(brokenOn('r2'))
    e.removeReplica('p1', 'r1')
    // r1 đếm lại từ đầu → mẫu này mới là mẫu thứ 1, chưa breach
    expect(e.onSample(brokenOn('r1'))).toEqual([])
    // r2 giữ nguyên chuỗi → mẫu thứ 2 breach ngay
    expect(e.onSample(brokenOn('r2'))[0]).toMatchObject({ replicaId: 'r2', kind: 'breach' })
  })

  it('removePair xoá state của TẤT CẢ slave trong cụm', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(brokenOn('r1'))
    e.onSample(brokenOn('r2'))
    e.removePair('p1')
    expect(e.onSample(brokenOn('r1'))).toEqual([])
    expect(e.onSample(brokenOn('r2'))).toEqual([])
  })
})

describe('ReplAlertEngine — vòng đời', () => {
  it('setRules reset state, không phát sự kiện', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(lagged(300))
    e.setRules(RULES)
    expect(e.onSample(lagged(300))).toEqual([]) // chuỗi phải đếm lại từ đầu
  })

  it('removePair KHÔNG phát recover (dừng theo dõi ≠ hồi phục)', () => {
    const e = new ReplAlertEngine(RULES)
    e.onSample(lagged(300))
    e.onSample(lagged(300))
    e.removePair('p1')
    expect(e.onSample(lagged(0))).toEqual([])
  })
})

describe('trích trạng thái', () => {
  it('threadsBad / threadsDetail', () => {
    expect(threadsBad(sample())).toBe(false)
    expect(threadsDetail(sample())).toBeNull()
    const ioDown = sample({ Slave_IO_Running: 'No' })
    expect(threadsBad(ioDown)).toBe(true)
    expect(threadsDetail(ioDown)).toBe('IO=no')
    const bothDown = sample({ Slave_IO_Running: 'No', Slave_SQL_Running: 'No' })
    expect(threadsDetail(bothDown)).toBe('IO=no · SQL=no')
  })

  it('errorNo ưu tiên SQL thread rồi tới IO', () => {
    expect(errorNo(sample())).toBe(0)
    expect(errorNo(sample({ Last_SQL_Errno: 1062, Last_IO_Errno: 2003 }))).toBe(1062)
    expect(errorNo(sample({ Last_IO_Errno: 1236 }))).toBe(1236)
  })
})
