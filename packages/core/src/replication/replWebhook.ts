import { buildWebhookRequestFor, type WebhookRequest } from '../monitor/webhook'
import { formatBytes, formatDuration } from './diagnose'
import type { ReplAlertEvent, ReplAlertMetric } from './ReplAlertEngine'

/**
 * F55 — Text thông báo + payload webhook cho cảnh báo replication.
 * THUẦN (không I/O) — caller (main) tự POST bằng net.fetch, y như F04.
 */

export interface ReplAlertInfo extends Pick<ReplAlertEvent, 'metric' | 'kind' | 'value' | 'threshold' | 'detail'> {
  /** Tên cặp để người đọc biết ngay hệ thống nào. */
  label: string
}

const BREACH_TEXT: Record<ReplAlertMetric, (a: ReplAlertInfo) => string> = {
  probe: () => 'không đo được trạng thái replication',
  threads: (a) => `replication ĐỨT${a.detail ? ` (${a.detail})` : ''}`,
  error: (a) => a.detail ?? 'replication báo lỗi',
  writable: () => 'slave đang CHO PHÉP GHI (read_only = OFF)',
  lag: (a) => `trễ ${formatDuration(a.value ?? 0)} ≥ ngưỡng ${formatDuration(a.threshold ?? 0)}`,
  applyGap: (a) => `còn ${formatBytes(a.value ?? 0)} chưa apply ≥ ngưỡng ${formatBytes(a.threshold ?? 0)}`
}

const RECOVER_TEXT: Record<ReplAlertMetric, (a: ReplAlertInfo) => string> = {
  probe: () => 'đo lại được trạng thái replication',
  threads: () => 'replication đã chạy lại',
  error: () => 'lỗi replication đã hết',
  writable: () => 'slave đã khoá ghi lại (read_only = ON)',
  lag: (a) => `độ trễ đã về ${formatDuration(a.value ?? 0)}`,
  applyGap: (a) => `hàng đợi apply đã về ${formatBytes(a.value ?? 0)}`
}

/** Text ngắn dùng chung cho toast, OS notification và webhook. */
export function formatReplAlertText(alert: ReplAlertInfo): string {
  const icon = alert.kind === 'breach' ? (alert.metric === 'lag' || alert.metric === 'applyGap' ? '⚠' : '🔴') : '✅'
  const body = (alert.kind === 'breach' ? BREACH_TEXT : RECOVER_TEXT)[alert.metric](alert)
  return `${icon} [${alert.label}] ${body}`
}

export function buildReplWebhookRequest(
  webhookUrl: string,
  alert: ReplAlertEvent & { label: string }
): WebhookRequest | null {
  return buildWebhookRequestFor(webhookUrl, formatReplAlertText(alert), {
    kind: 'replication',
    pairId: alert.pairId,
    // `pair` là nhãn hiển thị (đã gồm tên slave); `replica*` tách riêng để tự động hoá phía sau
    // biết chính xác con nào mà không phải parse chuỗi.
    pair: alert.label,
    replicaId: alert.replicaId,
    replica: alert.replicaLabel,
    metric: alert.metric,
    event: alert.kind,
    value: alert.value,
    threshold: alert.threshold,
    detail: alert.detail,
    ts: alert.ts
  })
}
