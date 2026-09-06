import { describe, expect, test } from 'vitest'
import {
  isTunnelUp,
  pickAutoStartRules,
  trayMenuModel,
  trayStrings,
  trayTooltip,
  type TunnelRuleDto,
  type TunnelStateDto
} from '@infra/shared'

/** Thực thi ở `packages/shared` — main dùng, nhưng hàm thuần nên test ở đây không cần Electron. */

const rule = (id: string, label: string, autoStart = false): TunnelRuleDto => ({
  id,
  hostId: 'h1',
  type: 'L',
  label,
  bindHost: '127.0.0.1',
  bindPort: 3307,
  destHost: '10.20.30.40',
  destPort: 3306,
  autoStart
})

const RULES = [rule('t1', 'db-tunnel', true), rule('t2', 'redis'), rule('t3', '', true)]
const STATES: TunnelStateDto[] = [
  { ruleId: 't1', status: 'active' },
  { ruleId: 't3', status: 'error', detail: 'bind EADDRINUSE :3307' }
]

describe('pickAutoStartRules / isTunnelUp', () => {
  test('chỉ lấy rule có cờ autoStart, giữ thứ tự', () => {
    expect(pickAutoStartRules(RULES).map((r) => r.id)).toEqual(['t1', 't3'])
    expect(pickAutoStartRules([])).toEqual([])
  })

  test('active và starting đều là "đang chạy"; stopped/error/undefined thì không', () => {
    expect(isTunnelUp('active')).toBe(true)
    expect(isTunnelUp('starting')).toBe(true)
    expect(isTunnelUp('stopped')).toBe(false)
    expect(isTunnelUp('error')).toBe(false)
    expect(isTunnelUp(undefined)).toBe(false)
  })
})

describe('trayTooltip', () => {
  test('vault mở: n/tổng', () => {
    expect(trayTooltip(RULES, STATES, 'vi')).toBe('Infra Companion · 1/3 tunnel đang chạy')
    expect(trayTooltip(RULES, STATES, 'en')).toBe('Infra Companion · 1/3 tunnels running')
  })

  test('không có gì chạy → câu "không có"', () => {
    expect(trayTooltip(RULES, [], 'vi')).toBe('Infra Companion · Không có tunnel đang chạy')
    expect(trayTooltip([], [], 'ja')).toBe('Infra Companion · 稼働中のトンネルはありません')
  })

  test('vault khoá (rules null) nhưng tunnel vẫn chạy → chỉ đếm được số đang chạy', () => {
    expect(trayTooltip(null, STATES, 'en')).toBe('Infra Companion · 1/1 tunnels running')
  })

  test('ngôn ngữ lạ → về tiếng Việt', () => {
    expect(trayStrings('xx' as never).quit).toBe('Thoát')
  })
})

describe('trayMenuModel', () => {
  test('vault mở, có rule: Mở · — · header · từng rule (checkbox = đang chạy) · — · Thoát', () => {
    const items = trayMenuModel(RULES, STATES, 'vi')
    expect(items.map((i) => i.kind)).toEqual([
      'open',
      'separator',
      'tunnels-header',
      'tunnel',
      'tunnel',
      'tunnel',
      'separator',
      'quit'
    ])
    const tunnels = items.filter((i) => i.kind === 'tunnel')
    expect(tunnels[0]).toMatchObject({ ruleId: 't1', label: 'db-tunnel', checked: true, status: 'active' })
    expect(tunnels[1]).toMatchObject({ ruleId: 't2', label: 'redis', checked: false, status: 'stopped' })
  })

  test('rule lỗi: nhãn có ⚠ và lý do, KHÔNG tick; rule không tên hiện :port', () => {
    const items = trayMenuModel(RULES, STATES, 'en')
    const t3 = items.find((i) => i.kind === 'tunnel' && i.ruleId === 't3')
    expect(t3).toMatchObject({ label: '⚠ :3307 — bind EADDRINUSE :3307', checked: false, status: 'error' })
  })

  test('đang nối → dấu … và đã tick (để bấm lại là dừng)', () => {
    const items = trayMenuModel([rule('t2', 'redis')], [{ ruleId: 't2', status: 'starting' }], 'vi')
    expect(items.find((i) => i.kind === 'tunnel')).toMatchObject({ label: 'redis …', checked: true })
  })

  test('vault khoá → một dòng ghi chú, không có rule nào để bấm', () => {
    const items = trayMenuModel(null, STATES, 'en')
    expect(items.map((i) => i.kind)).toEqual(['open', 'separator', 'note', 'separator', 'quit'])
    expect(items[2]).toMatchObject({ label: 'Vault is locked — open the app to unlock' })
  })

  test('vault mở nhưng chưa có tunnel → ghi chú "chưa có"', () => {
    const items = trayMenuModel([], [], 'ja')
    expect(items[2]).toMatchObject({ kind: 'note', label: 'トンネルはありません' })
  })
})
