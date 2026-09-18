import {
  emptyServiceWatch,
  nextSeenServices,
  resolveWatchedServices,
  serviceProbes,
  type ServiceWatchConfig,
  type WatchedService
} from '@infra/shared'
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
  /** F71 — service bắt buộc phải chạy. Dùng CHUNG mọi host (không override từng host). */
  serviceWatch?: ServiceWatchConfig
}

export type AlertMetric = 'load' | 'mem' | 'disk' | 'steal' | 'conn' | 'offline' | 'service'

export interface AlertEvent {
  hostId: string
  metric: AlertMetric
  kind: 'breach' | 'recover'
  /** Giá trị đo được lúc chốt (null với offline/service). */
  value: number | null
  /** Ngưỡng hiệu lực (null với offline/service). */
  threshold: number | null
  ts: number
  /** Chỉ với metric 'service': tên service (để phân biệt nhiều cảnh báo trên cùng host). */
  service?: string
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
  /**
   * F71 — số sample LIÊN TIẾP thấy service tắt mới báo chết (mặc định 3 ≈ 9s).
   * Không để 1: `graceful restart` của Apache/Tomcat có khoảnh khắc không tiến trình nào khớp,
   * báo ngay thì mỗi lần deploy là một cảnh báo giả.
   */
  serviceBreachSamples?: number
  /** Số sample liên tiếp thấy service chạy lại mới báo hồi phục. */
  serviceRecoverSamples?: number
  /** Đang breach kéo dài thì nhắc lại sau mỗi khoảng này. */
  realertCooldownMs?: number
}

type NumericMetric = Exclude<AlertMetric, 'offline' | 'service'>
const METRICS: NumericMetric[] = ['load', 'mem', 'disk', 'steal', 'conn']

/** Khoá state của một service trên một host. Tiền tố `:service:` cho `deleteByPrefix` gom được. */
const serviceStateKey = (hostId: string, svcKey: string): string => `${hostId}:service:${svcKey}`
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
  /**
   * F71 — service đã TỪNG thấy chạy trên từng host (hostId → tập key service).
   *
   * Sống trong RAM, cố ý không lưu đĩa: sau khi khởi động lại app, một service đang chết sẽ
   * không bị coi là "từng có" nên im lặng cho tới khi nó chạy lại lần đầu. Đánh đổi có chủ ý —
   * thà bỏ sót lúc mới mở app còn hơn kêu oan trên host vốn không chạy service đó.
   */
  private readonly seenServices = new Map<string, string[]>()

  constructor(rules: AlertRules, opts: AlertEngineOptions = {}) {
    this.rules = rules
    this.opts = {
      breachSamples: opts.breachSamples ?? 3,
      recoverSamples: opts.recoverSamples ?? 3,
      recoverMarginPts: opts.recoverMarginPts ?? 5,
      offlineBreachSamples: opts.offlineBreachSamples ?? 3,
      offlineRecoverSamples: opts.offlineRecoverSamples ?? 2,
      serviceBreachSamples: opts.serviceBreachSamples ?? 3,
      serviceRecoverSamples: opts.serviceRecoverSamples ?? 2,
      realertCooldownMs: opts.realertCooldownMs ?? 900_000
    }
  }

  /**
   * Đổi ngưỡng → reset TOÀN BỘ máy trạng thái (state cũ vô nghĩa với ngưỡng mới), không emit gì.
   *
   * `seenServices` GIỮ NGUYÊN: nó ghi sự thật quan sát được ("host này từng chạy httpd"), không
   * phụ thuộc ngưỡng. Xoá đi thì mỗi lần user chỉnh settings là mọi service đang chết lại được
   * tha, đúng lúc người ta vừa bật tính năng lên để bắt chúng.
   */
  setRules(rules: AlertRules): void {
    this.rules = rules
    this.states.clear()
  }

  /** Host dừng theo dõi — xoá state, KHÔNG emit recover (dừng ≠ hồi phục). */
  removeHost(hostId: string): void {
    for (const metric of [...METRICS, 'offline']) this.states.delete(`${hostId}:${metric}`)
    for (const svc of this.watchedServices()) this.states.delete(serviceStateKey(hostId, svc.key))
    this.seenServices.delete(hostId)
  }

  clear(): void {
    this.states.clear()
    this.seenServices.clear()
  }

  onSample(sample: MetricSample): AlertEvent[] {
    const events: AlertEvent[] = []
    const t = this.effectiveThresholds(sample.hostId)

    this.evalOffline(sample, t.offline, events)

    // Metric số: CHỈ khi sample.ok — sample lỗi đóng băng counter (không tăng, không reset)
    // để blip mất kết nối 10s không xoá tiến trình breach đang tích luỹ
    if (!sample.ok) return events

    this.evalServices(sample, events)
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

  /** Danh sách mục đang dõi, suy từ rules (rỗng = tính năng tắt). */
  private watchedServices(): WatchedService[] {
    return resolveWatchedServices(this.rules.serviceWatch ?? emptyServiceWatch())
  }

  /**
   * F71 — service chết. Nhị phân như offline, nhưng MỖI service một máy trạng thái riêng để
   * httpd chết không nuốt mất cảnh báo của java trên cùng host.
   *
   * `sample.services === null` = KHÔNG ĐO ĐƯỢC (ps hỏng, distro lạ, lệnh bị cắt) — khác hẳn
   * "đo được và không có gì chạy". Phải thoát sớm, không thì một lần parser trả null sẽ báo chết
   * TOÀN BỘ service của host. Đóng băng counter y như cách sample lỗi được xử lý ở trên.
   */
  private evalServices(sample: MetricSample, events: AlertEvent[]): void {
    const watched = this.watchedServices()
    if (watched.length === 0) {
      // Tắt tính năng → dọn state của host này để bật lại không kêu ngay bằng counter cũ
      this.states.deleteByPrefix(`${sample.hostId}:service:`)
      return
    }
    if (sample.services === null) return

    const running = sample.services
    const prevSeen = this.seenServices.get(sample.hostId) ?? []
    // Cập nhật "đã từng thấy" TRƯỚC khi chấm: service vừa xuất hiện lần đầu ở chính lần poll này
    // là đang chạy, không sinh cảnh báo; nhưng lần sau nó tắt thì đã có dấu vết để bắt.
    const seen = nextSeenServices(prevSeen, watched, running)
    this.seenServices.set(sample.hostId, seen)

    for (const probe of serviceProbes(watched, running, seen)) {
      const outcome = feedHysteresis(
        this.states.get(serviceStateKey(sample.hostId, probe.key)),
        binaryZone(!probe.running),
        sample.ts,
        {
          breachSamples: this.opts.serviceBreachSamples,
          recoverSamples: this.opts.serviceRecoverSamples,
          realertCooldownMs: this.opts.realertCooldownMs
        }
      )
      if (outcome) {
        events.push({
          hostId: sample.hostId,
          metric: 'service',
          kind: outcome,
          value: null,
          threshold: null,
          ts: sample.ts,
          service: probe.label
        })
      }
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
