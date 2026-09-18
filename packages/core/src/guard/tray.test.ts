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

describe('trayMenuModel — lọc theo tunnel đã ghim', () => {
  test('vault mở, CHƯA ghim gì: chỉ tunnel ĐANG CHẠY lên mức đầu, phần còn lại vào submenu', () => {
    const items = trayMenuModel(RULES, STATES, 'vi')
    expect(items.map((i) => i.kind)).toEqual([
      'open',
      'separator',
      'tunnels-header',
      'note', // tóm tắt "1/3 đang chạy"
      'tunnel', // t1 đang chạy
      'note', // gợi ý ghim
      'submenu', // t2 + t3 (không chạy)
      'stop-all',
      'separator',
      'quit'
    ])
    expect(items[3]).toMatchObject({ label: '1/3 đang chạy' })
    expect(items.filter((i) => i.kind === 'tunnel')).toHaveLength(1)
    expect(items[4]).toMatchObject({ ruleId: 't1', checked: true })
    expect(items[5]).toMatchObject({ label: 'Ghim ⭐ tunnel để hiện ở đây' })
    const sub = items.find((i) => i.kind === 'submenu')
    expect(sub).toMatchObject({ label: 'Tất cả tunnel' })
    expect(sub?.kind === 'submenu' && sub.items.map((i) => i.kind === 'tunnel' && i.ruleId)).toEqual(['t2', 't3'])
  })

  test('ĐÃ ghim: mức đầu đúng bằng danh sách ghim, kể cả tunnel đang TẮT', () => {
    // t2 đang stopped nhưng được ghim → vẫn phải hiện (ghim chính là để bật nó từ khay)
    const items = trayMenuModel(RULES, STATES, 'vi', ['t2'])
    const top = items.filter((i) => i.kind === 'tunnel')
    expect(top.map((i) => i.kind === 'tunnel' && i.ruleId)).toEqual(['t2'])
    expect(top[0]).toMatchObject({ checked: false })
    // không còn dòng gợi ý ghim nữa
    expect(items.some((i) => i.kind === 'note' && i.label.includes('Ghim'))).toBe(false)
    const sub = items.find((i) => i.kind === 'submenu')
    expect(sub?.kind === 'submenu' && sub.items.map((i) => i.kind === 'tunnel' && i.ruleId)).toEqual(['t1', 't3'])
  })

  test('id ghim không còn tồn tại → coi như chưa ghim, không tạo mục rỗng', () => {
    const items = trayMenuModel(RULES, STATES, 'vi', ['đã-xoá'])
    // rơi về nhánh "chưa ghim": hiện tunnel đang chạy + gợi ý
    expect(items.some((i) => i.kind === 'note' && i.label.includes('Ghim'))).toBe(true)
    expect(items.filter((i) => i.kind === 'tunnel').map((i) => i.kind === 'tunnel' && i.ruleId)).toEqual(['t1'])
  })

  test('ghim HẾT → không có submenu thừa', () => {
    const items = trayMenuModel(RULES, STATES, 'vi', ['t1', 't2', 't3'])
    expect(items.some((i) => i.kind === 'submenu')).toBe(false)
    expect(items.filter((i) => i.kind === 'tunnel')).toHaveLength(3)
  })
})

describe('trayMenuModel — dừng tất cả / trạng thái / mở khoá', () => {
  test('"Dừng tất cả" chỉ hiện khi có tunnel đang chạy, kèm số lượng', () => {
    const stopAll = trayMenuModel(RULES, STATES, 'vi').find((i) => i.kind === 'stop-all')
    expect(stopAll).toMatchObject({ label: 'Dừng tất cả tunnel (1)', count: 1 })

    // không có gì chạy → không có mục đó
    expect(trayMenuModel(RULES, [], 'vi').some((i) => i.kind === 'stop-all')).toBe(false)
  })

  test('đang nối cũng tính là đang chạy khi đếm', () => {
    const states: TunnelStateDto[] = [
      { ruleId: 't1', status: 'active' },
      { ruleId: 't2', status: 'starting' }
    ]
    const items = trayMenuModel(RULES, states, 'en')
    expect(items.find((i) => i.kind === 'stop-all')).toMatchObject({ label: 'Stop all tunnels (2)', count: 2 })
    expect(items[3]).toMatchObject({ label: '2/3 running' })
  })

  test('rule lỗi: nhãn có ⚠ và lý do, KHÔNG tick; rule không tên hiện :port', () => {
    // t3 lỗi → nằm trong submenu (không chạy, không ghim)
    const sub = trayMenuModel(RULES, STATES, 'en').find((i) => i.kind === 'submenu')
    const t3 = sub?.kind === 'submenu' ? sub.items.find((i) => i.kind === 'tunnel' && i.ruleId === 't3') : undefined
    expect(t3).toMatchObject({ label: '⚠ :3307 — bind EADDRINUSE :3307', checked: false, status: 'error' })
  })

  test('đang nối → dấu … và đã tick (để bấm lại là dừng)', () => {
    const items = trayMenuModel([rule('t2', 'redis')], [{ ruleId: 't2', status: 'starting' }], 'vi')
    expect(items.find((i) => i.kind === 'tunnel')).toMatchObject({ label: 'redis …', checked: true })
  })

  test('vault khoá → dòng MỞ KHOÁ bấm được (không phải ghi chú chết)', () => {
    const items = trayMenuModel(null, STATES, 'en')
    expect(items.map((i) => i.kind)).toEqual(['open', 'separator', 'unlock', 'separator', 'quit'])
    expect(items[2]).toMatchObject({ label: 'Vault is locked — click to unlock' })
  })

  test('vault mở nhưng chưa có tunnel → ghi chú "chưa có", không có submenu/stop-all', () => {
    const items = trayMenuModel([], [], 'ja')
    expect(items[2]).toMatchObject({ kind: 'note', label: 'トンネルはありません' })
    expect(items.some((i) => i.kind === 'submenu' || i.kind === 'stop-all')).toBe(false)
  })
})
