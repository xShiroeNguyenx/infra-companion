import {
  HysteresisStates,
  binaryZone,
  feedHysteresis,
  numericZone,
  type HysteresisOptions
} from './hysteresis'
import type { MetricSample } from './MonitorService'

/**
 * F04 — Cảnh báo ngưỡng cho monitoring tài nguyên host.
 *
 * THUẦN logic: không Electron, không I/O, không Date.now() — mọi mốc thời gian
 * lấy từ sample.ts nên test deterministic. Caller (main ipc) subscribe event
 * 'sample' của MonitorService rồi đưa từng sample vào onSample(), nhận về danh
 * sách AlertEvent cần phát (toast/OS notification/webhook).
 *
 * Máy trạng thái breach/vùng chết/recover nằm ở `hysteresis.ts` — dùng chung với cảnh báo
 * replication (F55) để hai bộ cảnh báo không trôi lệch ngữ nghĩa.
 */

/** Ngưỡng một host — null = tắt metric đó. loadPct = load1/cpuCount*100 (chuẩn hoá per-core,
 *  KHÔNG chặn 100). connCount là số kết nối tuyệt đối, không phải %. */
export interface AlertThresholds {
  loadPct: number | null
  memPct: number | null
  diskPct: number | null
  stealPct: number | null
  connCount: number | null
  offline: boolean
}

export interface AlertRules {
  defaults: AlertThresholds
  /** Override từng host — thiếu field nào dùng defaults. */
  perHost: Record<string, Partial<AlertThresholds>>
}

export type AlertMetric = 'load' | 'mem' | 'disk' | 'steal' | 'conn' | 'offline'

export interface AlertEvent {
  hostId: string
  metric: AlertMetric
  kind: 'breach' | 'recover'
  /** Giá trị đo được lúc chốt (null với offline). */
  value: number | null
  /** Ngưỡng hiệu lực (null với offline). */
  threshold: number | null
  ts: number
}

export interface AlertEngineOptions {
  /** Số sample vượt ngưỡng LIÊN TIẾP mới breach (mặc định 3 ≈ 9s với poll 3s). */
  breachSamples?: number
  /** Số sample dưới (ngưỡng - margin) liên tiếp mới recover. */
  recoverSamples?: number
  /** Vùng chết dưới ngưỡng (điểm %): [T-margin, T) không tính bên nào — chống flapping. */
  recoverMarginPts?: number
  /** Số sample !ok liên tiếp mới coi là offline. */
  offlineBreachSamples?: number
  /** Số sample ok liên tiếp mới coi là hồi (2 là đủ: 1 reconnect thật + 1 poll sạch). */
  offlineRecoverSamples?: number
  /** Đang breach kéo dài thì nhắc lại sau mỗi khoảng này. */
  realertCooldownMs?: number
}

type NumericMetric = Exclude<AlertMetric, 'offline'>
const METRICS: NumericMetric[] = ['load', 'mem', 'disk', 'steal', 'conn']
const THRESHOLD_KEY: Record<NumericMetric, keyof Omit<AlertThresholds, 'offline'>> = {
  load: 'loadPct',
  mem: 'memPct',
  disk: 'diskPct',
  steal: 'stealPct',
  conn: 'connCount'
}

export class AlertEngine {
  private rules: AlertRules
  private readonly opts: Required<AlertEngineOptions>
  /** key = `${hostId}:${metric}` */
  private readonly states = new HysteresisStates()

  constructor(rules: AlertRules, opts: AlertEngineOptions = {}) {
    this.rules = rules
    this.opts = {
      breachSamples: opts.breachSamples ?? 3,
      recoverSamples: opts.recoverSamples ?? 3,
      recoverMarginPts: opts.recoverMarginPts ?? 5,
      offlineBreachSamples: opts.offlineBreachSamples ?? 3,
      offlineRecoverSamples: opts.offlineRecoverSamples ?? 2,
      realertCooldownMs: opts.realertCooldownMs ?? 900_000
    }
  }

  /** Đổi ngưỡng → reset TOÀN BỘ máy trạng thái (state cũ vô nghĩa với ngưỡng mới), không emit gì. */
  setRules(rules: AlertRules): void {
    this.rules = rules
    this.states.clear()
  }

  /** Host dừng theo dõi — xoá state, KHÔNG emit recover (dừng ≠ hồi phục). */
  removeHost(hostId: string): void {
    for (const metric of [...METRICS, 'offline']) this.states.delete(`${hostId}:${metric}`)
  }

  clear(): void {
    this.states.clear()
  }

  onSample(sample: MetricSample): AlertEvent[] {
    const events: AlertEvent[] = []
    const t = this.effectiveThresholds(sample.hostId)

    this.evalOffline(sample, t.offline, events)

    // Metric số: CHỈ khi sample.ok — sample lỗi đóng băng counter (không tăng, không reset)
    // để blip mất kết nối 10s không xoá tiến trình breach đang tích luỹ
    if (!sample.ok) return events
    for (const metric of METRICS) {
      const threshold = t[THRESHOLD_KEY[metric]]
      if (threshold === null) {
        this.states.delete(`${sample.hostId}:${metric}`)
        continue
      }
      const value = metricValue(sample, metric)
      if (value === null) continue // thiếu số liệu → đóng băng
      this.evalNumeric(sample, metric, value, threshold, events)
    }
    return events
  }

  /** Offline đánh giá theo sample.ok, kể cả sample lỗi — nhị phân, không có vùng chết. */
  private evalOffline(sample: MetricSample, enabled: boolean, events: AlertEvent[]): void {
    if (!enabled) {
      this.states.delete(`${sample.hostId}:offline`)
      return
    }
    const outcome = feedHysteresis(
      this.states.get(`${sample.hostId}:offline`),
      binaryZone(!sample.ok),
      sample.ts,
      {
        breachSamples: this.opts.offlineBreachSamples,
        recoverSamples: this.opts.offlineRecoverSamples,
        realertCooldownMs: this.opts.realertCooldownMs
      }
    )
    if (outcome) {
      events.push({ hostId: sample.hostId, metric: 'offline', kind: outcome, value: null, threshold: null, ts: sample.ts })
    }
  }

  /** Metric số: phân vùng theo ngưỡng + vùng chết rồi đẩy vào máy trạng thái chung. */
  private evalNumeric(
    sample: MetricSample,
    metric: NumericMetric,
    value: number,
    threshold: number,
    events: AlertEvent[]
  ): void {
    // conn là số tuyệt đối (ngưỡng có thể hàng nghìn) → vùng chết theo tỉ lệ 10%
    const margin =
      metric === 'conn'
        ? Math.max(this.opts.recoverMarginPts, Math.round(threshold * 0.1))
        : this.opts.recoverMarginPts

    const outcome = feedHysteresis(
      this.states.get(`${sample.hostId}:${metric}`),
      numericZone(value, threshold, margin),
      sample.ts,
      this.hysteresisOpts
    )
    if (outcome) events.push({ hostId: sample.hostId, metric, kind: outcome, value, threshold, ts: sample.ts })
  }

  private get hysteresisOpts(): HysteresisOptions {
    return {
      breachSamples: this.opts.breachSamples,
      recoverSamples: this.opts.recoverSamples,
      realertCooldownMs: this.opts.realertCooldownMs
    }
  }

  private effectiveThresholds(hostId: string): AlertThresholds {
    const over = this.rules.perHost[hostId]
    // KHÔNG dùng ?? — override null nghĩa là "tắt riêng host này", phải thắng defaults
    const pick = <K extends keyof AlertThresholds>(key: K): AlertThresholds[K] => {
      const v = over?.[key]
      return v !== undefined ? (v as AlertThresholds[K]) : this.rules.defaults[key]
    }
    return {
      loadPct: pick('loadPct'),
      memPct: pick('memPct'),
      diskPct: pick('diskPct'),
      stealPct: pick('stealPct'),
      connCount: pick('connCount'),
      offline: pick('offline')
    }
  }

}

/** Giá trị của metric từ sample; load chuẩn hoá theo số CPU, conn là số tuyệt đối. */
function metricValue(sample: MetricSample, metric: NumericMetric): number | null {
  if (metric === 'mem') return sample.memUsedPct
  if (metric === 'disk') return sample.diskUsedPct
  if (metric === 'steal') return sample.cpuStealPct
  if (metric === 'conn') return sample.tcpConns
  if (sample.load1 === null) return null
  return Math.round((sample.load1 / (sample.cpuCount ?? 1)) * 100)
}
