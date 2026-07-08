import type { MetricSample } from './MonitorService'

/**
 * F32 — Gộp sample 3s thành bucket phút / 10 phút (trung bình). THUẦN logic,
 * không I/O — MetricsStore giữ bucket đang mở trong RAM và flush khi rollover.
 */

export type BucketRes = 1 | 10

export interface Bucket {
  hostId: string
  res: BucketRes
  /** Đầu bucket (ms epoch, chia hết cho res*60000). */
  ts: number
  sumLoad: number
  nLoad: number
  sumCpu: number
  nCpu: number
  sumSteal: number
  nSteal: number
  sumMem: number
  nMem: number
  sumDisk: number
  nDisk: number
  sumConn: number
  nConn: number
  okCount: number
  totalCount: number
}

/** Row đã chốt để ghi DB — giá trị trung bình trong bucket, null nếu không có số liệu. */
export interface MetricRow {
  hostId: string
  res: BucketRes
  ts: number
  loadPct: number | null
  cpuPct: number | null
  stealPct: number | null
  memPct: number | null
  diskPct: number | null
  conns: number | null
  okCount: number
  totalCount: number
}

export function bucketStart(ts: number, res: BucketRes): number {
  const size = res * 60_000
  return ts - (ts % size)
}

export function newBucket(hostId: string, res: BucketRes, ts: number): Bucket {
  return {
    hostId,
    res,
    ts: bucketStart(ts, res),
    sumLoad: 0,
    nLoad: 0,
    sumCpu: 0,
    nCpu: 0,
    sumSteal: 0,
    nSteal: 0,
    sumMem: 0,
    nMem: 0,
    sumDisk: 0,
    nDisk: 0,
    sumConn: 0,
    nConn: 0,
    okCount: 0,
    totalCount: 0
  }
}

/** Cộng dồn 1 sample. Sample lỗi chỉ tăng totalCount (okRatio phản ánh downtime); field null bỏ qua. */
export function accumulate(b: Bucket, s: MetricSample): void {
  b.totalCount += 1
  if (!s.ok) return
  b.okCount += 1
  if (s.load1 !== null) {
    // chuẩn hoá theo số CPU như AlertEngine/MonitorDock — cùng thang với ngưỡng
    b.sumLoad += (s.load1 / (s.cpuCount ?? 1)) * 100
    b.nLoad += 1
  }
  if (s.cpuPct !== null) {
    b.sumCpu += s.cpuPct
    b.nCpu += 1
  }
  if (s.cpuStealPct !== null) {
    b.sumSteal += s.cpuStealPct
    b.nSteal += 1
  }
  if (s.memUsedPct !== null) {
    b.sumMem += s.memUsedPct
    b.nMem += 1
  }
  if (s.diskUsedPct !== null) {
    b.sumDisk += s.diskUsedPct
    b.nDisk += 1
  }
  if (s.tcpConns !== null) {
    b.sumConn += s.tcpConns
    b.nConn += 1
  }
}

export function finishBucket(b: Bucket): MetricRow {
  const avg = (sum: number, n: number): number | null => (n > 0 ? Math.round((sum / n) * 10) / 10 : null)
  return {
    hostId: b.hostId,
    res: b.res,
    ts: b.ts,
    loadPct: avg(b.sumLoad, b.nLoad),
    cpuPct: avg(b.sumCpu, b.nCpu),
    stealPct: avg(b.sumSteal, b.nSteal),
    memPct: avg(b.sumMem, b.nMem),
    diskPct: avg(b.sumDisk, b.nDisk),
    conns: avg(b.sumConn, b.nConn),
    okCount: b.okCount,
    totalCount: b.totalCount
  }
}
