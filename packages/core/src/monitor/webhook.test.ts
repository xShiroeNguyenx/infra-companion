import { describe, expect, it } from 'vitest'
import { buildWebhookRequest, formatAlertText } from './webhook'
import type { AlertEvent } from './AlertEngine'

const ALERT: AlertEvent & { label: string } = {
  hostId: 'h1',
  label: 'web-01',
  metric: 'mem',
  kind: 'breach',
  value: 93,
  threshold: 90,
  ts: 1_700_000_000_000
}

describe('formatAlertText', () => {
  it('breach metric số', () => {
    expect(formatAlertText(ALERT)).toBe('⚠ [web-01] RAM 93% ≥ ngưỡng 90%')
  })
  it('recover metric số', () => {
    expect(formatAlertText({ ...ALERT, kind: 'recover', value: 82 })).toBe('✅ [web-01] RAM đã hồi phục (82%)')
  })
  it('conn: số tuyệt đối không có %', () => {
    expect(formatAlertText({ ...ALERT, metric: 'conn', value: 1500, threshold: 1000 })).toBe(
      '⚠ [web-01] Kết nối TCP 1500 ≥ ngưỡng 1000'
    )
  })
  it('steal breach', () => {
    expect(formatAlertText({ ...ALERT, metric: 'steal', value: 37, threshold: 10 })).toBe(
      '⚠ [web-01] CPU steal 37% ≥ ngưỡng 10%'
    )
  })
  it('offline breach/recover', () => {
    expect(formatAlertText({ ...ALERT, metric: 'offline', value: null, threshold: null })).toBe(
      '🔴 [web-01] mất kết nối'
    )
    expect(
      formatAlertText({ ...ALERT, metric: 'offline', kind: 'recover', value: null, threshold: null })
    ).toBe('✅ [web-01] đã kết nối lại')
  })
})

describe('buildWebhookRequest — nhận diện dịch vụ theo URL', () => {
  it('Google Chat → {text}, giữ nguyên URL (kèm key/token trong query)', () => {
    const url = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t'
    const req = buildWebhookRequest(url, ALERT)!
    expect(req.url).toBe(url)
    expect(JSON.parse(req.body)).toEqual({ text: formatAlertText(ALERT) })
  })

  it('Slack → {text}', () => {
    const req = buildWebhookRequest('https://hooks.slack.com/services/T/B/x', ALERT)!
    expect(JSON.parse(req.body)).toEqual({ text: formatAlertText(ALERT) })
  })

  it('Discord → {content} (cả discord.com lẫn discordapp.com)', () => {
    for (const host of ['discord.com', 'discordapp.com']) {
      const req = buildWebhookRequest(`https://${host}/api/webhooks/123/abc`, ALERT)!
      expect(JSON.parse(req.body)).toEqual({ content: formatAlertText(ALERT) })
    }
  })

  it('Telegram → tách chat_id từ query, URL bỏ query', () => {
    const req = buildWebhookRequest('https://api.telegram.org/botTOKEN/sendMessage?chat_id=-100123', ALERT)!
    expect(req.url).toBe('https://api.telegram.org/botTOKEN/sendMessage')
    expect(JSON.parse(req.body)).toEqual({ chat_id: '-100123', text: formatAlertText(ALERT) })
  })

  it('generic → JSON đầy đủ', () => {
    const req = buildWebhookRequest('https://example.com/hook', ALERT)!
    expect(JSON.parse(req.body)).toMatchObject({
      text: formatAlertText(ALERT),
      hostId: 'h1',
      host: 'web-01',
      metric: 'mem',
      kind: 'breach',
      value: 93,
      threshold: 90
    })
  })

  it('URL rác → null', () => {
    expect(buildWebhookRequest('không phải url', ALERT)).toBeNull()
  })
})
