import { DatabaseSync } from 'node:sqlite'
import type { MetricSample } from './MonitorService'
import { accumulate, bucketStart, finishBucket, newBucket, type Bucket, type BucketRes, type MetricRow } from './downsample'

/**
 * F32 — Lịch sử metrics trong SQLite RIÊNG (metrics.db, userData), KHÔNG mã hoá
 * (load/RAM/disk không phải bí mật) và tách khỏi vault.db (không đụng schema vault).
 * Chỉ ghi khi monitoring chạy: dữ liệu chỉ sinh từ event 'sample'.
 *
 * Downsample 2 độ phân giải song song: bucket phút (giữ 48h) + bucket 10 phút
 * (giữ 30 ngày) — ghi song song thay vì derive lúc prune để flush dở lúc dừng
 * hoạt động y hệt cho cả hai. Dung lượng: ~vài MB/tháng cho 10 host.
 */

/** Chỉ append vào cuối, KHÔNG sửa entry cũ (giống vault/db.ts). */
const MIGRATIONS: string[] = [
  // v1 — bảng samples: PK (host,res,ts) để INSERT OR REPLACE idempotent khi flush lại cùng bucket
  `
  CREATE TABLE samples (
    host_id     TEXT    NOT NULL,
    res         INTEGER NOT NULL,
    ts          INTEGER NOT NULL,
    load_pct    REAL,
    mem_pct     REAL,
    disk_pct    REAL,
    ok_count    INTEGER NOT NULL,
    total_count INTEGER NOT NULL,
    PRIMARY KEY (host_id, res, ts)
  ) WITHOUT ROWID;
  CREATE INDEX idx_samples_prune ON samples(res, ts);
  `,
  // v2 — CPU thật/steal/kết nối TCP (đợt mở rộng monitor: chẩn đoán thiếu CPU vs bị steal vs bot cào)
  `
  ALTER TABLE samples ADD COLUMN cpu_pct REAL;
  ALTER TABLE samples ADD COLUMN steal_pct REAL;
  ALTER TABLE samples ADD COLUMN conns REAL;
  `
]

const MINUTE_RETENTION_MS = 48 * 3_600_000 // res 1: 48 giờ
const TEN_MIN_RETENTION_MS = 30 * 24 * 3_600_000 // res 10: 30 ngày
const PRUNE_INTERVAL_MS = 3_600_000

export interface MetricHistoryPoint {
  ts: number
  loadPct: number | null
  cpuPct: number | null
  stealPct: number | null
  memPct: number | null
  diskPct: number | null
  conns: number | null
  okRatio: number
}

/** 1 host có dữ liệu lịch sử: khoảng thời gian đã ghi (theo mọi độ phân giải). */
export interface MetricHistoryHost {
  hostId: string
  firstTs: number
  lastTs: number
}

function openMetricsDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = row.user_version
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version]!)
      version += 1
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return db
}

interface HostBuckets {
  m1: Bucket
  m10: Bucket
}

export class MetricsStore {
  private db: DatabaseSync | null = null
  private buckets = new Map<string, HostBuckets>()
  private pruneTimer: NodeJS.Timeout | null = null

  constructor(private readonly dbPath: string) {}

  /** Nhận 1 sample realtime: rollover bucket nào thì flush bucket đó rồi cộng dồn tiếp. */
  record(sample: MetricSample): void {
    this.ensureDb()
    let hb = this.buckets.get(sample.hostId)
    if (!hb) {
      hb = { m1: newBucket(sample.hostId, 1, sample.ts), m10: newBucket(sample.hostId, 10, sample.ts) }
      this.buckets.set(sample.hostId, hb)
    }
    for (const key of ['m1', 'm10'] as const) {
      const res: BucketRes = key === 'm1' ? 1 : 10
      if (bucketStart(sample.ts, res) !== hb[key].ts) {
        this.write(finishBucket(hb[key]))
        hb[key] = newBucket(sample.hostId, res, sample.ts)
      }
      accumulate(hb[key], sample)
    }
  }

  /** Host dừng theo dõi — ghi nốt bucket dở (avg trên ít sample vẫn đúng). */
  flushHost(hostId: string): void {
    const hb = this.buckets.get(hostId)
    if (!hb) return
    if (hb.m1.totalCount > 0) this.write(finishBucket(hb.m1))
    if (hb.m10.totalCount > 0) this.write(finishBucket(hb.m10))
    this.buckets.delete(hostId)
  }

  flushAll(): void {
    for (const hostId of [...this.buckets.keys()]) this.flushHost(hostId)
  }

  query(hostId: string, fromTs: number, toTs: number, res: BucketRes): MetricHistoryPoint[] {
    const db = this.ensureDb()
    const rows = db
      .prepare(
        'SELECT ts, load_pct, cpu_pct, steal_pct, mem_pct, disk_pct, conns, ok_count, total_count FROM samples WHERE host_id = ? AND res = ? AND ts >= ? AND ts <= ? ORDER BY ts'
      )
      .all(hostId, res, fromTs, toTs) as Array<{
      ts: number
      load_pct: number | null
      cpu_pct: number | null
      steal_pct: number | null
      mem_pct: number | null
      disk_pct: number | null
      conns: number | null
      ok_count: number
      total_count: number
    }>
    return rows.map((r) => ({
      ts: r.ts,
      loadPct: r.load_pct,
      cpuPct: r.cpu_pct,
      stealPct: r.steal_pct,
      memPct: r.mem_pct,
      diskPct: r.disk_pct,
      conns: r.conns,
      okRatio: r.total_count > 0 ? r.ok_count / r.total_count : 0
    }))
  }

  /** Các host từng được monitor (còn dữ liệu trong hạn giữ), mới nhất trước.
   *  Gồm cả bucket đang tích dở trong RAM — host vừa bật monitor <1 phút cũng hiện. */
  listHosts(): MetricHistoryHost[] {
    const db = this.ensureDb()
    const found = new Map<string, MetricHistoryHost>()
    const rows = db
      .prepare('SELECT host_id, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM samples GROUP BY host_id')
      .all() as Array<{ host_id: string; first_ts: number; last_ts: number }>
    for (const r of rows) found.set(r.host_id, { hostId: r.host_id, firstTs: r.first_ts, lastTs: r.last_ts })
    for (const [hostId, hb] of this.buckets) {
      if (hb.m1.totalCount === 0) continue
      const cur = found.get(hostId)
      if (!cur) found.set(hostId, { hostId, firstTs: hb.m1.ts, lastTs: hb.m1.ts })
      else cur.lastTs = Math.max(cur.lastTs, hb.m1.ts)
    }
    return [...found.values()].sort((a, b) => b.lastTs - a.lastTs)
  }

  /** Xoá dữ liệu quá hạn giữ. Public để test; tự chạy khi mở + mỗi giờ. */
  prune(now = Date.now()): void {
    const db = this.ensureDb()
    db.prepare('DELETE FROM samples WHERE res = 1 AND ts < ?').run(now - MINUTE_RETENTION_MS)
    db.prepare('DELETE FROM samples WHERE res = 10 AND ts < ?').run(now - TEN_MIN_RETENTION_MS)
  }

  /** Flush hết + đóng DB (giải phóng WAL — quan trọng trên Windows). */
  close(): void {
    this.flushAll()
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }
    this.db?.close()
    this.db = null
  }

  private ensureDb(): DatabaseSync {
    if (!this.db) {
      this.db = openMetricsDb(this.dbPath)
      this.prune()
      // unref: timer dọn dẹp không giữ process sống
      this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS)
      this.pruneTimer.unref()
    }
    return this.db
  }

  private write(row: MetricRow): void {
    this.ensureDb()
      .prepare(
        'INSERT OR REPLACE INTO samples (host_id, res, ts, load_pct, cpu_pct, steal_pct, mem_pct, disk_pct, conns, ok_count, total_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        row.hostId,
        row.res,
        row.ts,
        row.loadPct,
        row.cpuPct,
        row.stealPct,
        row.memPct,
        row.diskPct,
        row.conns,
        row.okCount,
        row.totalCount
      )
  }
}
