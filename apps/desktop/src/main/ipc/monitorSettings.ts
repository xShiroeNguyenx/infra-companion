import { app, ipcMain, net } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  IPC,
  SERVICE_CATALOG,
  emptyServiceWatch,
  type MonitorSettingsDto,
  type MonitorThresholdsDto,
  type ServiceWatchConfig
} from '@infra/shared'
import { buildWebhookRequest, type AlertEvent } from '@infra/core'

/**
 * F04 — Cài đặt cảnh báo monitoring: monitor-settings.json trong userData
 * (pattern plugins/state.json). CHỦ Ý không để trong vault: vault tự khoá sau
 * 15 phút idle còn alert phải đọc được ngưỡng/webhook liên tục. Đánh đổi:
 * webhook URL nằm plaintext trên máy user (như state.json) — chấp nhận v1.
 */

const WEBHOOK_TIMEOUT_MS = 10_000

export const DEFAULT_MONITOR_SETTINGS: MonitorSettingsDto = {
  // Load/Conn mặc định TẮT: baseline mỗi server một khác — bật mặc định sẽ spam.
  // RAM/Disk 90 và Steal 20 thì phổ quát (steal >20% kéo dài chắc chắn là bất thường).
  defaults: { loadPct: null, memPct: 90, diskPct: 90, stealPct: 20, connCount: null, offline: true },
  perHost: {},
  webhookUrl: '',
  osNotify: true,
  // Không tick sẵn mục nào: "service nào bắt buộc phải chạy" là quyết định của người vận hành,
  // đoán hộ thì máy không chạy service đó sẽ kêu oan ngay lần đầu mở app.
  serviceWatch: emptyServiceWatch()
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'monitor-settings.json')
}

// Load chuẩn hoá theo CPU KHÔNG bị chặn 100% (server bận có thể 300-400%, thậm chí hàng ngàn %)
// → ngưỡng load cho tới 10000. RAM/Disk/Steal là tỉ lệ thật nên 0-100. Conn là số tuyệt đối.
const LOAD_MAX = 10_000
const CONN_MAX = 1_000_000

/** Chuẩn hoá 1 ngưỡng: số 0-max (làm tròn) hoặc null = tắt. Giá trị rác → fallback. */
function sanePct(v: unknown, fallback: number | null, max: number): number | null {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(0, Math.round(v)))
}

type PctKey = Exclude<keyof MonitorThresholdsDto, 'offline'>
/** Trần từng ngưỡng — load không chặn 100, conn là số tuyệt đối. */
const PCT_LIMITS: Array<[PctKey, number]> = [
  ['loadPct', LOAD_MAX],
  ['memPct', 100],
  ['diskPct', 100],
  ['stealPct', 100],
  ['connCount', CONN_MAX]
]

function saneThresholds(raw: unknown, base: MonitorThresholdsDto): MonitorThresholdsDto {
  const t = (raw ?? {}) as Partial<MonitorThresholdsDto>
  const out = { ...base }
  for (const [key, max] of PCT_LIMITS) out[key] = sanePct(t[key], base[key], max)
  if (typeof t.offline === 'boolean') out.offline = t.offline
  return out
}

/** Override 1 host: chỉ giữ field có mặt — thiếu = kế thừa defaults (khác với null = tắt). */
function saneOverride(raw: unknown): Partial<MonitorThresholdsDto> | null {
  if (!raw || typeof raw !== 'object') return null
  const over = raw as Partial<MonitorThresholdsDto>
  const clean: Partial<MonitorThresholdsDto> = {}
  for (const [key, max] of PCT_LIMITS) {
    if (key in over) clean[key] = sanePct(over[key], null, max)
  }
  if (typeof over.offline === 'boolean') clean.offline = over.offline
  return Object.keys(clean).length > 0 ? clean : null
}

/**
 * F71 — làm sạch cấu hình dõi service. Nguồn là file JSON trên đĩa + payload renderer, nên phải
 * chặn mảng rác. Tên tự thêm: cắt khoảng trắng, bỏ rỗng, chặn độ dài (tên tiến trình `comm` của
 * Linux tối đa 15 ký tự — dài hơn chắc chắn không bao giờ khớp) và giới hạn số lượng.
 */
function saneServiceWatch(raw: unknown): ServiceWatchConfig {
  const v = (raw ?? {}) as Partial<ServiceWatchConfig>
  const ids = Array.isArray(v.enabledIds) ? v.enabledIds : []
  const names = Array.isArray(v.customNames) ? v.customNames : []
  return {
    enabledIds: [...new Set(ids.filter((x): x is string => typeof x === 'string'))]
      .filter((id) => SERVICE_CATALOG.some((c) => c.id === id))
      .slice(0, 50),
    customNames: [
      ...new Set(
        names
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter((x) => x.length > 0 && x.length <= 15)
      )
    ].slice(0, 50)
  }
}

/** Validate + điền field thiếu bằng defaults — dùng cho cả đọc file lẫn payload từ renderer. */
function sanitize(raw: unknown): MonitorSettingsDto {
  const s = (raw ?? {}) as Partial<MonitorSettingsDto>
  const perHost: MonitorSettingsDto['perHost'] = {}
  if (s.perHost && typeof s.perHost === 'object') {
    for (const [hostId, over] of Object.entries(s.perHost)) {
      const clean = saneOverride(over)
      if (clean) perHost[hostId] = clean
    }
  }
  return {
    defaults: saneThresholds(s.defaults, DEFAULT_MONITOR_SETTINGS.defaults),
    perHost,
    webhookUrl: typeof s.webhookUrl === 'string' ? s.webhookUrl.trim() : '',
    osNotify: typeof s.osNotify === 'boolean' ? s.osNotify : true,
    serviceWatch: saneServiceWatch(s.serviceWatch)
  }
}

export function readMonitorSettings(): MonitorSettingsDto {
  try {
    return sanitize(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return structuredClone(DEFAULT_MONITOR_SETTINGS)
  }
}

function writeMonitorSettings(s: MonitorSettingsDto): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch (e) {
    console.error('[monitor] cannot write monitor-settings.json:', e)
  }
}

/** POST webhook với timeout — dùng cho cả alert thật lẫn nút Gửi thử. Throw message tiếng Việt. */
export async function postWebhook(req: { url: string; body: string }): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const res = await net.fetch(req.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: req.body,
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Hết thời gian chờ (10s)')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Đăng ký GET/SET/TEST — onChanged để monitor.ts cập nhật AlertEngine ngay khi user lưu. */
export function registerMonitorSettingsIpc(onChanged: (s: MonitorSettingsDto) => void): void {
  ipcMain.handle(IPC.MONITOR_GET_SETTINGS, () => readMonitorSettings())

  ipcMain.handle(IPC.MONITOR_SET_SETTINGS, (_event, raw: unknown) => {
    const clean = sanitize(raw)
    writeMonitorSettings(clean)
    onChanged(clean)
  })

  ipcMain.handle(IPC.MONITOR_TEST_WEBHOOK, async (_event, url: string) => {
    const fake: AlertEvent & { label: string } = {
      hostId: 'test',
      label: 'test-host',
      metric: 'mem',
      kind: 'breach',
      value: 93,
      threshold: 90,
      ts: Date.now()
    }
    const req = buildWebhookRequest(String(url ?? '').trim(), fake)
    if (!req) return { ok: false, message: 'URL không hợp lệ' }
    try {
      await postWebhook(req)
      return { ok: true, message: 'Đã gửi thành công — kiểm tra kênh nhận' }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })
}
