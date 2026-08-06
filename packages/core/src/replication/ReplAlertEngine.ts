import {
  HysteresisStates,
  binaryZone,
  feedHysteresis,
  numericZone,
  type HysteresisOptions
} from '../monitor/hysteresis'
import type { ReplSample } from './status'

/**
 * F55 — Cảnh báo ngưỡng cho replication. Dùng CHUNG máy trạng thái hysteresis với F04
 * (`monitor/hysteresis.ts`) nên ngữ nghĩa breach/vùng chết/recover/cooldown giống hệt monitoring.
 *
 * THUẦN: không I/O, không Date.now() — mốc thời gian lấy từ sample.ts.
 *
 * Khác monitoring ở hai chỗ đáng nói:
 *  1. Chu kỳ đo mặc định 15s (không phải 3s) nên `breachSamples` mặc định là 2 chứ không phải 3 —
 *     replication đứt mà đợi 45s mới báo thì quá chậm.
 *  2. Trễ dùng `effectiveLagSec` (đã trừ MASTER_DELAY) — replica trễ CỐ Ý không được coi là sự cố.
 */

export type ReplAlertMetric = 'lag' | 'applyGap' | 'threads' | 'error' | 'writable' | 'probe'

export interface ReplAlertThresholds {
  /** Trễ thật (giây) vượt mức này thì báo. null = tắt. */
  lagSec: number | null
  /** Byte đã tải về mà SQL thread chưa apply. null = tắt. */
  applyGapBytes: number | null
  /** IO hoặc SQL thread không chạy. */
  threads: boolean
  /** Có mã lỗi khác 0 ở bất kỳ thread nào. */
  error: boolean
  /** Replica đang cho phép ghi (read_only = OFF) → nguy cơ split-brain. */
  writable: boolean
  /** Không đo được trạng thái (mất SSH, MySQL chết, hết quyền). */
  probe: boolean
}

export interface ReplAlertRules {
  defaults: ReplAlertThresholds
  /** Override từng cặp — thiếu field nào thì dùng defaults. */
  perPair: Record<string, Partial<ReplAlertThresholds>>
}

export interface ReplAlertEvent {
  pairId: string
  /** Slave nào trong cụm — mỗi slave có máy trạng thái riêng, một cái đứt không kéo cái kia theo. */
  replicaId: string
  replicaLabel: string
  metric: ReplAlertMetric
  kind: 'breach' | 'recover'
  /** Giá trị đo được lúc chốt (null với metric nhị phân). */
  value: number | null
  threshold: number | null
  /** Mô tả ngắn để dựng thông báo, vd "SQL thread dừng · lỗi 1062". */
  detail: string | null
  ts: number
}

export interface ReplAlertEngineOptions {
  /** Số mẫu vượt LIÊN TIẾP mới breach. Mặc định 2 (≈30s với chu kỳ 15s). */
  breachSamples?: number
  recoverSamples?: number
  /** Vùng chết cho trễ (giây); thực tế lấy max(giá trị này, 20% ngưỡng) vì lag rất hay nhảy. */
  lagRecoverMarginSec?: number
  probeBreachSamples?: number
  probeRecoverSamples?: number
  realertCooldownMs?: number
}

export const DEFAULT_REPL_THRESHOLDS: ReplAlertThresholds = {
  // Trễ 60s là mốc phổ quát cho replica phục vụ đọc. applyGap TẮT mặc định vì baseline mỗi hệ
  // thống một khác (site ghi nhiều thì vài chục MB backlog là bình thường) — bật sẽ spam.
  lagSec: 60,
  applyGapBytes: null,
  threads: true,
  error: true,
  writable: true,
  probe: true
}

type NumericReplMetric = 'lag' | 'applyGap'

/** Ngưỡng đặt theo CỤM nhưng máy trạng thái theo TỪNG SLAVE — slave này đứt không kéo slave kia. */
const stateKey = (sample: ReplSample, metric: ReplAlertMetric): string =>
  `${sample.pairId}:${sample.replicaId}:${metric}`

function makeEvent(
  sample: ReplSample,
  metric: ReplAlertMetric,
  kind: 'breach' | 'recover',
  value: number | null,
  threshold: number | null,
  detail: string | null
): ReplAlertEvent {
  return {
    pairId: sample.pairId,
    replicaId: sample.replicaId,
    replicaLabel: sample.replicaLabel,
    metric,
    kind,
    value,
    threshold,
    detail,
    ts: sample.ts
  }
}

export class ReplAlertEngine {
  private rules: ReplAlertRules
  private readonly opts: Required<ReplAlertEngineOptions>
  /** key = `${pairId}:${replicaId}:${metric}` — mỗi slave một máy trạng thái riêng. */
  private readonly states = new HysteresisStates()

  constructor(rules: ReplAlertRules, opts: ReplAlertEngineOptions = {}) {
    this.rules = rules
    this.opts = {
      breachSamples: opts.breachSamples ?? 2,
      recoverSamples: opts.recoverSamples ?? 2,
      lagRecoverMarginSec: opts.lagRecoverMarginSec ?? 10,
      probeBreachSamples: opts.probeBreachSamples ?? 2,
      probeRecoverSamples: opts.probeRecoverSamples ?? 2,
      realertCooldownMs: opts.realertCooldownMs ?? 900_000
    }
  }

  /** Đổi ngưỡng → reset toàn bộ state (state cũ vô nghĩa với ngưỡng mới), không emit gì. */
  setRules(rules: ReplAlertRules): void {
    this.rules = rules
    this.states.clear()
  }

  /** Dừng theo dõi cả cụm (mọi slave) — xoá state, KHÔNG emit recover (dừng ≠ hồi phục). */
  removePair(pairId: string): void {
    this.states.deleteByPrefix(`${pairId}:`)
  }

  /** Bỏ MỘT slave khỏi cụm (user xoá nó khỏi danh sách) — cũng không emit recover. */
  removeReplica(pairId: string, replicaId: string): void {
    this.states.deleteByPrefix(`${pairId}:${replicaId}:`)
  }

  clear(): void {
    this.states.clear()
  }

  onSample(sample: ReplSample): ReplAlertEvent[] {
    const events: ReplAlertEvent[] = []
    const t = this.effectiveThresholds(sample.pairId)

    this.evalBinary(sample, 'probe', t.probe, !sample.ok, sample.error ?? null, events, {
      breachSamples: this.opts.probeBreachSamples,
      recoverSamples: this.opts.probeRecoverSamples,
      realertCooldownMs: this.opts.realertCooldownMs
    })

    // Không đo được → ĐÓNG BĂNG mọi metric khác (không tăng, không reset) để một lần rớt mạng
    // không xoá chuỗi breach đang tích luỹ. Cùng quy tắc với AlertEngine.
    if (!sample.ok) return events

    this.evalBinary(sample, 'threads', t.threads, threadsBad(sample), threadsDetail(sample), events)
    this.evalBinary(sample, 'error', t.error, errorNo(sample) !== 0, errorDetail(sample), events)
    this.evalWritable(sample, t.writable, events)

    this.evalNumeric(sample, 'lag', t.lagSec, sample.drift?.effectiveLagSec ?? null, events)
    this.evalNumeric(sample, 'applyGap', t.applyGapBytes, sample.drift?.applyGapBytes ?? null, events)

    return events
  }

  private evalBinary(
    sample: ReplSample,
    metric: ReplAlertMetric,
    enabled: boolean,
    bad: boolean,
    detail: string | null,
    events: ReplAlertEvent[],
    override?: HysteresisOptions
  ): void {
    const key = stateKey(sample, metric)
    if (!enabled) {
      this.states.delete(key)
      return
    }
    const outcome = feedHysteresis(this.states.get(key), binaryZone(bad), sample.ts, override ?? this.hysteresisOpts)
    if (outcome) events.push(makeEvent(sample, metric, outcome, null, null, detail))
  }

  /** read_only chưa đọc được (thiếu quyền) → đóng băng, không đoán là an toàn cũng không báo động. */
  private evalWritable(sample: ReplSample, enabled: boolean, events: ReplAlertEvent[]): void {
    const key = stateKey(sample, 'writable')
    if (!enabled) {
      this.states.delete(key)
      return
    }
    const readOnly = sample.replicaVars?.readOnly
    if (readOnly === null || readOnly === undefined) return
    const outcome = feedHysteresis(this.states.get(key), binaryZone(readOnly === false), sample.ts, this.hysteresisOpts)
    if (outcome) events.push(makeEvent(sample, 'writable', outcome, null, null, 'read_only = OFF'))
  }

  private evalNumeric(
    sample: ReplSample,
    metric: NumericReplMetric,
    threshold: number | null,
    value: number | null,
    events: ReplAlertEvent[]
  ): void {
    const key = stateKey(sample, metric)
    if (threshold === null) {
      this.states.delete(key)
      return
    }
    // Thiếu số liệu (SBM = NULL lúc replication đứt, khác file binlog…) → đóng băng
    if (value === null) return

    // applyGap tính bằng byte nên vùng chết phải theo TỈ LỆ; lag theo giây, lấy mức lớn hơn
    // giữa hằng số và 20% ngưỡng vì lag nhảy rất mạnh quanh mốc.
    const margin =
      metric === 'applyGap'
        ? Math.max(1, Math.round(threshold * 0.1))
        : Math.max(this.opts.lagRecoverMarginSec, Math.round(threshold * 0.2))

    const outcome = feedHysteresis(this.states.get(key), numericZone(value, threshold, margin), sample.ts, this.hysteresisOpts)
    if (outcome) events.push(makeEvent(sample, metric, outcome, value, threshold, null))
  }

  private get hysteresisOpts(): HysteresisOptions {
    return {
      breachSamples: this.opts.breachSamples,
      recoverSamples: this.opts.recoverSamples,
      realertCooldownMs: this.opts.realertCooldownMs
    }
  }

  private effectiveThresholds(pairId: string): ReplAlertThresholds {
    const over = this.rules.perPair[pairId]
    // KHÔNG dùng ?? — override null nghĩa là "tắt riêng cặp này", phải thắng defaults
    const pick = <K extends keyof ReplAlertThresholds>(key: K): ReplAlertThresholds[K] => {
      const v = over?.[key]
      return v !== undefined ? (v as ReplAlertThresholds[K]) : this.rules.defaults[key]
    }
    return {
      lagSec: pick('lagSec'),
      applyGapBytes: pick('applyGapBytes'),
      threads: pick('threads'),
      error: pick('error'),
      writable: pick('writable'),
      probe: pick('probe')
    }
  }
}

// ---------------------------------------------------------------------------
// Trích trạng thái — export để test và để main dựng text thông báo
// ---------------------------------------------------------------------------

/** Đo được nhưng server không phải replica cũng tính là "thread hỏng" — đó là sự cố thật. */
export function threadsBad(sample: ReplSample): boolean {
  if (!sample.replica) return true
  return sample.replica.ioRunning !== 'yes' || sample.replica.sqlRunning !== 'yes'
}

export function threadsDetail(sample: ReplSample): string | null {
  if (!sample.replica) return 'chưa cấu hình làm replica'
  const down: string[] = []
  if (sample.replica.ioRunning !== 'yes') down.push(`IO=${sample.replica.ioRunning}`)
  if (sample.replica.sqlRunning !== 'yes') down.push(`SQL=${sample.replica.sqlRunning}`)
  return down.length > 0 ? down.join(' · ') : null
}

/** Mã lỗi đáng kể nhất: ưu tiên SQL thread, rồi IO, rồi Last_Errno chung. */
export function errorNo(sample: ReplSample): number {
  const r = sample.replica
  if (!r) return 0
  return r.lastSqlErrno || r.lastIoErrno || r.lastErrno || 0
}

export function errorDetail(sample: ReplSample): string | null {
  const errno = errorNo(sample)
  if (errno === 0) return null
  const text = sample.replica?.lastSqlError || sample.replica?.lastIoError || sample.replica?.lastError || ''
  return text ? `lỗi ${errno}: ${text.slice(0, 160)}` : `lỗi ${errno}`
}
