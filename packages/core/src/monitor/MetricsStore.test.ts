// Cần node:sqlite (Node >= 22.5) — Node 20 dev tự skip, chạy đủ qua Node của Electron/CI
// (giống vaultMerge.test.ts). Chạy tay: $env:ELECTRON_RUN_AS_NODE=1; electron vitest run
import { describe, expect, it, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MetricSample } from './MonitorService'

let MetricsStoreClass: typeof import('./MetricsStore').MetricsStore | null = null
try {
  await import('node:sqlite')
  MetricsStoreClass = (await import('./MetricsStore')).MetricsStore
} catch {
  /* node:sqlite không có — skip */
}

const tmpRoots: string[] = []
const stores: Array<{ close(): void }> = []

function newStore(): InstanceType<NonNullable<typeof MetricsStoreClass>> {
  const dir = mkdtempSync(join(tmpdir(), 'infra-metrics-'))
  tmpRoots.push(dir)
  const store = new MetricsStoreClass!(join(dir, 'metrics.db'))
  stores.push(store)
  return store
}

afterAll(() => {
  // close() TRƯỚC khi xoá — SQLite mở (WAL) làm rmSync EPERM trên Windows
  for (const s of stores) s.close()
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

function sample(ts: number, over: Partial<MetricSample> = {}): MetricSample {
  return {
    hostId: 'h1',
    ts,
    ok: true,
    load1: 2,
    loadText: '2',
    memUsedPct: 50,
    diskUsedPct: 80,
    diskMount: '/',
    inodeUsedPct: null,
    uptimeSec: 1,
    cpuCount: 4,
    cpuPct: 55,
    cpuUserPct: null,
    cpuSystemPct: null,
    cpuIowaitPct: null,
    cpuStealPct: 35,
    runQueue: null,
    swapUsedMb: null,
    swapTotalMb: null,
    netRxKbps: null,
    netTxKbps: null,
    tcpConns: 1200,
    tcpTimeWait: null,
    topProc: null,
    services: null,
    ...over
  }
}

describe.skipIf(MetricsStoreClass === null)('MetricsStore', () => {
  it('rollover phút → ghi row res=1; bucket 10 phút vẫn gộp tiếp', () => {
    const store = newStore()
    const base = 600_000 // biên 10 phút
    store.record(sample(base + 1000, { memUsedPct: 40 }))
    store.record(sample(base + 4000, { memUsedPct: 60 }))
    store.record(sample(base + 61_000, { memUsedPct: 90 })) // sang phút mới → flush phút cũ
    const rows = store.query('h1', base, base + 120_000, 1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ts: base, memPct: 50, okRatio: 1, cpuPct: 55, stealPct: 35, conns: 1200 })
    // res=10 chưa rollover → chưa có row
    expect(store.query('h1', base, base + 120_000, 10)).toHaveLength(0)
  })

  it('flushHost ghi bucket dở cả 2 độ phân giải', () => {
    const store = newStore()
    const base = 1_200_000
    store.record(sample(base + 1000))
    store.record(sample(base + 4000, { ok: false, load1: null, memUsedPct: null, diskUsedPct: null }))
    store.flushHost('h1')
    const m1 = store.query('h1', base, base + 60_000, 1)
    const m10 = store.query('h1', base, base + 600_000, 10)
    expect(m1).toHaveLength(1)
    expect(m10).toHaveLength(1)
    expect(m1[0]!.okRatio).toBeCloseTo(0.5)
  })

  it('query lọc theo host + khoảng thời gian, trả theo thứ tự ts', () => {
    const store = newStore()
    store.record(sample(60_000))
    store.record(sample(121_000)) // flush phút 1
    store.record(sample(181_000)) // flush phút 2
    store.record(sample(60_500, { hostId: 'h2' }))
    store.flushAll()
    const rows = store.query('h1', 0, 300_000, 1)
    expect(rows.map((r) => r.ts)).toEqual([60_000, 120_000, 180_000])
    expect(store.query('h2', 0, 300_000, 1)).toHaveLength(1)
  })

  it('prune xoá đúng theo hạn giữ từng độ phân giải', () => {
    const store = newStore()
    const now = Date.now()
    // 3 mốc: 31 ngày (quá cả 2 hạn), 49h (quá hạn phút 48h, còn hạn 10' 30 ngày), hiện tại
    for (const ts of [now - 31 * 24 * 3_600_000, now - 49 * 3_600_000, now]) {
      store.record(sample(ts))
      store.flushAll()
    }
    store.prune(now)
    const m1 = store.query('h1', 0, now + 1, 1)
    expect(m1).toHaveLength(1) // res=1 chỉ còn mốc hiện tại
    expect(m1[0]!.ts).toBe(bucketOf(now, 1))
    const m10 = store.query('h1', 0, now + 1, 10).map((r) => r.ts)
    expect(m10).toHaveLength(2) // res=10 còn mốc 49h + hiện tại; mốc 31 ngày bị xoá
    expect(m10).toContain(bucketOf(now - 49 * 3_600_000, 10))
    expect(m10).toContain(bucketOf(now, 10))
  })

  it('mở lại DB cũ không lỗi (migration idempotent), dữ liệu còn nguyên', () => {
    const dir = mkdtempSync(join(tmpdir(), 'infra-metrics-'))
    tmpRoots.push(dir)
    const path = join(dir, 'metrics.db')
    // ts phải GẦN HIỆN TẠI: prune() chạy lúc mở DB sẽ xoá row quá hạn 48h (đúng thiết kế)
    const base = bucketOf(Date.now(), 1) - 120_000
    const a = new MetricsStoreClass!(path)
    a.record(sample(base + 1000))
    a.flushAll()
    a.close()
    const b = new MetricsStoreClass!(path)
    stores.push(b)
    expect(b.query('h1', base, base + 60_000, 1)).toHaveLength(1)
  })

  it('listHosts: gộp DB + bucket dở trong RAM, mới nhất trước', () => {
    const store = newStore()
    const base = bucketOf(Date.now(), 1) - 600_000
    // h-old: đã flush xuống DB; h-live: mới record, bucket còn dở trong RAM
    store.record(sample(base, { hostId: 'h-old' }))
    store.flushHost('h-old')
    store.record(sample(base + 300_000, { hostId: 'h-live' }))
    const hosts = store.listHosts()
    expect(hosts.map((h) => h.hostId)).toEqual(['h-live', 'h-old'])
    expect(hosts[1]!.firstTs).toBeLessThanOrEqual(hosts[1]!.lastTs)
  })
})

function bucketOf(ts: number, res: 1 | 10): number {
  const size = res * 60_000
  return ts - (ts % size)
}
