import type { AlertEvent, AlertMetric } from './AlertEngine'

/**
 * F04 — Dựng payload webhook + text thông báo. THUẦN (không I/O) — caller (main)
 * tự POST bằng net.fetch. Nhận diện dịch vụ theo URL, không cần user chọn loại.
 */

export interface AlertInfo extends Pick<AlertEvent, 'metric' | 'kind' | 'value' | 'threshold'> {
  label: string
}

const METRIC_LABEL: Record<AlertMetric, string> = {
  load: 'Load',
  mem: 'RAM',
  disk: 'Disk',
  steal: 'CPU steal',
  conn: 'Kết nối TCP',
  offline: 'kết nối'
}

/** Text ngắn gọn dùng chung cho OS notification + webhook. conn là số tuyệt đối (không %). */
export function formatAlertText(a: AlertInfo): string {
  if (a.metric === 'offline') {
    return a.kind === 'breach' ? `🔴 [${a.label}] mất kết nối` : `✅ [${a.label}] đã kết nối lại`
  }
  const name = METRIC_LABEL[a.metric]
  const unit = a.metric === 'conn' ? '' : '%'
  if (a.kind === 'breach') return `⚠ [${a.label}] ${name} ${a.value}${unit} ≥ ngưỡng ${a.threshold}${unit}`
  return `✅ [${a.label}] ${name} đã hồi phục (${a.value}${unit})`
}

export interface WebhookRequest {
  url: string
  /** JSON string — Content-Type luôn application/json. */
  body: string
}

/**
 * Dựng request theo dịch vụ đoán từ URL:
 * - chat.googleapis.com (Google Chat)   → { text }
 * - hooks.slack.com                     → { text }
 * - discord.com/api/webhooks            → { content }
 * - api.telegram.org/bot…/sendMessage   → tách chat_id từ query, POST { chat_id, text } vào URL bỏ query
 * - còn lại (generic)                   → JSON đầy đủ { text, hostId, host, metric, kind, value, threshold, ts }
 * URL không parse được → null (caller bỏ qua + log).
 */
export function buildWebhookRequest(webhookUrl: string, alert: AlertEvent & { label: string }): WebhookRequest | null {
  let url: URL
  try {
    url = new URL(webhookUrl)
  } catch {
    return null
  }
  const text = formatAlertText(alert)

  if (url.hostname === 'chat.googleapis.com' || url.hostname === 'hooks.slack.com') {
    return { url: webhookUrl, body: JSON.stringify({ text }) }
  }
  if (
    (url.hostname === 'discord.com' || url.hostname === 'discordapp.com') &&
    url.pathname.startsWith('/api/webhooks')
  ) {
    return { url: webhookUrl, body: JSON.stringify({ content: text }) }
  }
  if (url.hostname === 'api.telegram.org' && url.pathname.endsWith('/sendMessage')) {
    const chatId = url.searchParams.get('chat_id')
    const clean = `${url.origin}${url.pathname}`
    return { url: clean, body: JSON.stringify(chatId ? { chat_id: chatId, text } : { text }) }
  }
  return {
    url: webhookUrl,
    body: JSON.stringify({
      text,
      hostId: alert.hostId,
      host: alert.label,
      metric: alert.metric,
      kind: alert.kind,
      value: alert.value,
      threshold: alert.threshold,
      ts: alert.ts
    })
  }
}
