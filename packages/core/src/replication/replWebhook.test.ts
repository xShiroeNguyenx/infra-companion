import { describe, expect, it } from 'vitest'
import { buildReplWebhookRequest, formatReplAlertText, type ReplAlertInfo } from './replWebhook'
import type { ReplAlertEvent } from './ReplAlertEngine'

const info = (over: Partial<ReplAlertInfo> = {}): ReplAlertInfo => ({
  label: 'Prod cluster',
  metric: 'threads',
  kind: 'breach',
  value: null,
  threshold: null,
  detail: null,
  ...over
})

const event = (over: Partial<ReplAlertEvent> = {}): ReplAlertEvent & { label: string } => ({
  pairId: 'p1',
  replicaId: 'r1',
  replicaLabel: 'slave-01',
  label: 'Prod cluster · slave-01',
  metric: 'threads',
  kind: 'breach',
  value: null,
  threshold: null,
  detail: null,
  ts: 1_700_000_000_000,
  ...over
})

describe('formatReplAlertText', () => {
  it('luôn có tên cặp để biết ngay hệ thống nào', () => {
    expect(formatReplAlertText(info())).toContain('[Prod cluster]')
  })

  it('replication đứt → đỏ, kèm thread nào chết', () => {
    const text = formatReplAlertText(info({ detail: 'SQL=no' }))
    expect(text).toContain('🔴')
    expect(text).toContain('ĐỨT')
    expect(text).toContain('SQL=no')
  })

  it('trễ → cảnh báo vàng, nêu cả giá trị lẫn ngưỡng ở dạng người đọc được', () => {
    const text = formatReplAlertText(info({ metric: 'lag', value: 300, threshold: 60 }))
    expect(text).toBe('⚠ [Prod cluster] trễ 5m ≥ ngưỡng 1m')
  })

  it('applyGap hiển thị theo đơn vị byte dễ đọc', () => {
    const text = formatReplAlertText(info({ metric: 'applyGap', value: 200 * 1024 * 1024, threshold: 64 * 1024 * 1024 }))
    expect(text).toContain('200 MB')
    expect(text).toContain('64 MB')
  })

  it('lỗi replication in nguyên văn detail', () => {
    expect(formatReplAlertText(info({ metric: 'error', detail: 'lỗi 1062: Duplicate entry' }))).toContain('1062')
  })

  it('slave ghi được → nói rõ read_only', () => {
    expect(formatReplAlertText(info({ metric: 'writable' }))).toContain('read_only = OFF')
  })

  it('không đo được', () => {
    expect(formatReplAlertText(info({ metric: 'probe' }))).toContain('không đo được')
  })

  it('recover luôn là dấu xanh', () => {
    for (const metric of ['probe', 'threads', 'error', 'writable', 'lag', 'applyGap'] as const) {
      expect(formatReplAlertText(info({ metric, kind: 'recover', value: 0, threshold: 60 }))).toContain('✅')
    }
  })
})

describe('buildReplWebhookRequest', () => {
  it('Slack/Google Chat → { text }', () => {
    for (const url of ['https://hooks.slack.com/services/x', 'https://chat.googleapis.com/v1/spaces/x']) {
      const req = buildReplWebhookRequest(url, event())
      expect(JSON.parse(req!.body)).toEqual({ text: expect.stringContaining('Prod cluster') })
    }
  })

  it('Discord → { content }', () => {
    const req = buildReplWebhookRequest('https://discord.com/api/webhooks/1/abc', event())
    expect(JSON.parse(req!.body).content).toContain('Prod cluster')
  })

  it('Telegram → tách chat_id ra body, bỏ query khỏi URL', () => {
    const req = buildReplWebhookRequest('https://api.telegram.org/bot123/sendMessage?chat_id=42', event())
    expect(req!.url).toBe('https://api.telegram.org/bot123/sendMessage')
    expect(JSON.parse(req!.body).chat_id).toBe('42')
  })

  it('generic → JSON đủ trường, có cờ kind=replication để phân biệt với cảnh báo tài nguyên', () => {
    const req = buildReplWebhookRequest('https://example.com/hook', event({ metric: 'lag', value: 300, threshold: 60 }))
    expect(JSON.parse(req!.body)).toMatchObject({
      kind: 'replication',
      pairId: 'p1',
      pair: 'Prod cluster · slave-01',
      // Tách riêng để tự động hoá biết đúng slave nào mà không phải parse chuỗi nhãn
      replicaId: 'r1',
      replica: 'slave-01',
      metric: 'lag',
      event: 'breach',
      value: 300,
      threshold: 60,
      ts: 1_700_000_000_000
    })
  })

  it('URL rác → null (caller bỏ qua)', () => {
    expect(buildReplWebhookRequest('không-phải-url', event())).toBeNull()
  })
})

