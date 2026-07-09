import { describe, expect, it } from 'vitest'
import { AlertEngine, type AlertRules } from './AlertEngine'
import type { MetricSample } from './MonitorService'

const RULES: AlertRules = {
  defaults: { loadPct: 90, memPct: 90, diskPct: 90, stealPct: null, connCount: null, offline: true },
  perHost: {}
}

/** Field mở rộng — mặc định null (test nào cần thì override). */
const EXTRA: Omit<
  MetricSample,
  'hostId' | 'ts' | 'ok' | 'load1' | 'loadText' | 'memUsedPct' | 'diskUsedPct' | 'uptimeSec' | 'cpuCount'
> = {
  diskMount: null,
  inodeUsedPct: null,
  cpuPct: null,
  cpuUserPct: null,
  cpuSystemPct: null,
  cpuIowaitPct: null,
  cpuStealPct: null,
  runQueue: null,
  swapUsedMb: null,
  swapTotalMb: null,
  netRxKbps: null,
  netTxKbps: null,
  tcpConns: null,
  tcpTimeWait: null,
  topProc: null,
  services: null
}

let seq = 0
/** Sample ok với RAM cho trước; ts tăng 3s mỗi lần (mô phỏng poll thật). */
function mem(pct: number | null, hostId = 'h1', ts?: number): MetricSample {
  seq += 1
  return {
    hostId,
    ts: ts ?? seq * 3000,
    ok: true,
    load1: 0.1,
    loadText: '0.1',
    memUsedPct: pct,
    diskUsedPct: 10,
    uptimeSec: 1000,
    cpuCount: 4,
    ...EXTRA
  }
}

function offline(hostId = 'h1', ts?: number): MetricSample {
  seq += 1
  return { ...mem(null, hostId, ts), ok: false, memUsedPct: null, diskUsedPct: null, load1: null, error: 'x' }
}

describe('AlertEngine — hysteresis', () => {
  it('breach sau ĐÚNG 3 sample vượt ngưỡng liên tiếp, không sớm hơn', () => {
    const e = new AlertEngine(RULES)
    expect(e.onSample(mem(95))).toEqual([])
    expect(e.onSample(mem(95))).toEqual([])
    const events = e.onSample(mem(95))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ metric: 'mem', kind: 'breach', value: 95, threshold: 90 })
  })

  it('2 sample vượt rồi tụt hẳn → không breach (chuỗi bị cắt)', () => {
    const e = new AlertEngine(RULES)
    e.onSample(mem(95))
    e.onSample(mem(95))
    expect(e.onSample(mem(50))).toEqual([]) // < T-5 → reset overCount
    expect(e.onSample(mem(95))).toEqual([])
    expect(e.onSample(mem(95))).toEqual([])
    expect(e.onSample(mem(95))).toHaveLength(1) // phải đếm lại từ đầu
  })

  it('vùng chết [T-5, T): flapping quanh ngưỡng không bao giờ alert', () => {
    const e = new AlertEngine(RULES)
    for (let i = 0; i < 20; i++) {
      expect(e.onSample(mem(95))).toEqual([]) // 1 vượt
      expect(e.onSample(mem(88))).toEqual([]) // vùng chết → reset cả 2 counter
    }
  })

  it('recover cần 3 sample < T-5 liên tiếp; vùng chết không tính là recover', () => {
    const e = new AlertEngine(RULES)
    e.onSample(mem(95))
    e.onSample(mem(95))
    e.onSample(mem(95)) // breach
    expect(e.onSample(mem(87))).toEqual([]) // vùng chết — vẫn breach
    expect(e.onSample(mem(80))).toEqual([])
    expect(e.onSample(mem(80))).toEqual([])
    const events = e.onSample(mem(80))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ metric: 'mem', kind: 'recover', value: 80 })
  })

  it('đang breach: nhắc lại chỉ sau cooldown 15 phút (theo sample.ts)', () => {
    const e = new AlertEngine(RULES)
    let ts = 0
    const at = (pct: number): MetricSample => mem(pct, 'h1', (ts += 3000))
    e.onSample(at(95))
    e.onSample(at(95))
    expect(e.onSample(at(95))).toHaveLength(1) // breach lúc ts=9000
    // vẫn breach suốt 14 phút → không nhắc lại
    for (let i = 0; i < 20; i++) expect(e.onSample(at(95))).toEqual([])
    // nhảy quá 15 phút kể từ lần báo
    ts += 900_000
    expect(e.onSample(at(95))).toHaveLength(1) // re-alert
  })

  it('sample lỗi ĐÓNG BĂNG counter metric số (không tăng, không reset)', () => {
    const e = new AlertEngine(RULES)
    e.onSample(mem(95))
    e.onSample(mem(95))
    e.onSample(offline()) // offline xen giữa — không xoá tiến trình (offline event chưa đủ 3 nên rỗng)
    const events = e.onSample(mem(95)) // sample vượt thứ 3 → breach
    expect(events.some((ev) => ev.metric === 'mem' && ev.kind === 'breach')).toBe(true)
  })

  it('offline: breach sau 3 sample !ok, recover sau 2 sample ok', () => {
    const e = new AlertEngine(RULES)
    expect(e.onSample(offline())).toEqual([])
    expect(e.onSample(offline())).toEqual([])
    const breach = e.onSample(offline())
    expect(breach).toHaveLength(1)
    expect(breach[0]).toMatchObject({ metric: 'offline', kind: 'breach' })
    expect(e.onSample(mem(10))).toEqual([])
    const recover = e.onSample(mem(10))
    expect(recover.some((ev) => ev.metric === 'offline' && ev.kind === 'recover')).toBe(true)
  })

  it('ngưỡng null = tắt metric — không bao giờ alert', () => {
    const e = new AlertEngine({
      defaults: { loadPct: null, memPct: null, diskPct: null, stealPct: null, connCount: null, offline: false },
      perHost: {}
    })
    for (let i = 0; i < 10; i++) expect(e.onSample(mem(99))).toEqual([])
    for (let i = 0; i < 10; i++) expect(e.onSample(offline())).toEqual([])
  })

  it('override per-host thắng defaults (kể cả override = null để tắt riêng 1 host)', () => {
    const e = new AlertEngine({
      defaults: { loadPct: null, memPct: 90, diskPct: null, stealPct: null, connCount: null, offline: false },
      perHost: { h1: { memPct: 50 }, h2: { memPct: null } }
    })
    // h1: ngưỡng 50 → 60% là vượt
    e.onSample(mem(60, 'h1'))
    e.onSample(mem(60, 'h1'))
    expect(e.onSample(mem(60, 'h1'))).toHaveLength(1)
    // h2: tắt riêng → 99% không alert
    for (let i = 0; i < 5; i++) expect(e.onSample(mem(99, 'h2'))).toEqual([])
    // h3: dùng default 90
    e.onSample(mem(95, 'h3'))
    e.onSample(mem(95, 'h3'))
    expect(e.onSample(mem(95, 'h3'))).toHaveLength(1)
  })

  it('load chuẩn hoá theo cpuCount: load1=3.6/4 CPU = 90% → chạm ngưỡng', () => {
    const e = new AlertEngine(RULES)
    const s = (load1: number): MetricSample => ({ ...mem(10), load1, cpuCount: 4 })
    e.onSample(s(3.6))
    e.onSample(s(3.6))
    const events = e.onSample(s(3.6))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ metric: 'load', value: 90, threshold: 90 })
  })

  it('metric steal: ngưỡng 10% bắt được VPS bị trộm CPU', () => {
    const e = new AlertEngine({
      defaults: { loadPct: null, memPct: null, diskPct: null, stealPct: 10, connCount: null, offline: false },
      perHost: {}
    })
    const s = (steal: number): MetricSample => ({ ...mem(10), cpuStealPct: steal })
    e.onSample(s(37))
    e.onSample(s(34))
    const events = e.onSample(s(40))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ metric: 'steal', kind: 'breach', value: 40, threshold: 10 })
  })

  it('metric conn: vùng chết theo 10% ngưỡng (số tuyệt đối, không phải %)', () => {
    const e = new AlertEngine({
      defaults: { loadPct: null, memPct: null, diskPct: null, stealPct: null, connCount: 1000, offline: false },
      perHost: {}
    })
    const s = (conns: number): MetricSample => ({ ...mem(10), tcpConns: conns })
    // breach sau 3 sample >= 1000
    e.onSample(s(1200))
    e.onSample(s(1100))
    expect(e.onSample(s(1500))).toHaveLength(1)
    // 950 nằm trong vùng chết [900, 1000) → chưa recover
    expect(e.onSample(s(950))).toEqual([])
    expect(e.onSample(s(950))).toEqual([])
    expect(e.onSample(s(950))).toEqual([])
    // < 900 đủ 3 lần → recover
    e.onSample(s(800))
    e.onSample(s(800))
    const rec = e.onSample(s(800))
    expect(rec).toHaveLength(1)
    expect(rec[0]).toMatchObject({ metric: 'conn', kind: 'recover' })
  })

  it('setRules reset máy trạng thái im lặng (không emit recover giả)', () => {
    const e = new AlertEngine(RULES)
    e.onSample(mem(95))
    e.onSample(mem(95))
    e.onSample(mem(95)) // breached
    e.setRules({ ...RULES, defaults: { ...RULES.defaults, memPct: 99 } })
    // với ngưỡng mới, 95 < 99-5 → không có gì (state đã reset, không còn breached để recover)
    expect(e.onSample(mem(95))).toEqual([])
    expect(e.onSample(mem(95))).toEqual([])
    expect(e.onSample(mem(95))).toEqual([])
  })

  it('removeHost xoá state không emit; host khác không ảnh hưởng', () => {
    const e = new AlertEngine(RULES)
    e.onSample(mem(95, 'h1'))
    e.onSample(mem(95, 'h1'))
    e.onSample(mem(95, 'h1')) // h1 breached
    e.onSample(mem(95, 'h2'))
    e.onSample(mem(95, 'h2'))
    e.removeHost('h1')
    // h1 quay lại từ đầu (state đã mất)
    expect(e.onSample(mem(95, 'h1'))).toEqual([])
    // h2 vẫn giữ tiến trình → sample thứ 3 breach
    expect(e.onSample(mem(95, 'h2'))).toHaveLength(1)
  })
})
