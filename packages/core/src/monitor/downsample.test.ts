import { describe, expect, it } from 'vitest'
import { accumulate, bucketStart, finishBucket, newBucket } from './downsample'
import type { MetricSample } from './MonitorService'

function sample(over: Partial<MetricSample> = {}): MetricSample {
  return {
    hostId: 'h1',
    ts: 60_000,
    ok: true,
    load1: 2,
    loadText: '2',
    memUsedPct: 50,
    diskUsedPct: 80,
    diskMount: '/',
    inodeUsedPct: null,
    uptimeSec: 1,
    cpuCount: 4,
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
    ...over
  }
}

describe('downsample', () => {
  it('bucketStart chia đúng biên phút và 10 phút', () => {
    expect(bucketStart(60_000, 1)).toBe(60_000)
    expect(bucketStart(119_999, 1)).toBe(60_000)
    expect(bucketStart(120_000, 1)).toBe(120_000)
    expect(bucketStart(599_999, 10)).toBe(0)
    expect(bucketStart(600_000, 10)).toBe(600_000)
  })

  it('accumulate + finishBucket: trung bình đúng, load chuẩn hoá theo cpuCount', () => {
    const b = newBucket('h1', 1, 60_000)
    accumulate(b, sample({ load1: 2, memUsedPct: 40, diskUsedPct: 80, cpuPct: 50, cpuStealPct: 30, tcpConns: 1000 })) // load 2/4 = 50%
    accumulate(b, sample({ load1: 4, memUsedPct: 60, diskUsedPct: 80, cpuPct: 60, cpuStealPct: 40, tcpConns: 2000 })) // load 4/4 = 100%
    const row = finishBucket(b)
    expect(row).toMatchObject({
      hostId: 'h1',
      res: 1,
      ts: 60_000,
      loadPct: 75,
      cpuPct: 55,
      stealPct: 35,
      memPct: 50,
      diskPct: 80,
      conns: 1500
    })
    expect(row.okCount).toBe(2)
    expect(row.totalCount).toBe(2)
  })

  it('sample lỗi chỉ tăng totalCount (okRatio phản ánh downtime)', () => {
    const b = newBucket('h1', 1, 60_000)
    accumulate(b, sample())
    accumulate(b, sample({ ok: false, load1: null, memUsedPct: null, diskUsedPct: null }))
    const row = finishBucket(b)
    expect(row.okCount).toBe(1)
    expect(row.totalCount).toBe(2)
    expect(row.memPct).toBe(50) // avg chỉ trên sample ok
  })

  it('field null bị bỏ qua; cả bucket không có số liệu → null', () => {
    const b = newBucket('h1', 1, 60_000)
    accumulate(b, sample({ load1: null, memUsedPct: null }))
    accumulate(b, sample({ load1: null, memUsedPct: 70 }))
    const row = finishBucket(b)
    expect(row.loadPct).toBeNull()
    expect(row.memPct).toBe(70)
  })
})
