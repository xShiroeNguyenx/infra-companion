import { describe, expect, test } from 'vitest'
import {
  DEFAULT_NAV_ENABLED,
  DEFAULT_NAV_MENU,
  NAV_HOME,
  isNavMenuId,
  mergeKnownOrder,
  orderedNavMenu,
  resolveNavigatorSection,
  startupNavSection,
  visibleNavMenu
} from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer không import được `@infra/core` (CLAUDE.md §5). */

describe('mergeKnownOrder', () => {
  const known = ['a', 'b', 'c', 'd'] as const

  test('chưa lưu gì → đúng thứ tự mặc định', () => {
    expect(mergeKnownOrder([], known)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('giữ thứ tự user đặt cho id còn tồn tại', () => {
    expect(mergeKnownOrder(['c', 'a', 'd', 'b'], known)).toEqual(['c', 'a', 'd', 'b'])
  })

  test('id lạ và id trùng bị bỏ, id thiếu nối vào cuối theo mặc định', () => {
    expect(mergeKnownOrder(['d', 'khong-ton-tai', 'd', 'a'], known)).toEqual(['d', 'a', 'b', 'c'])
  })

  test('kết quả luôn là hoán vị đầy đủ của known', () => {
    for (const order of [[], ['b'], ['d', 'c', 'b', 'a'], ['x', 'y']]) {
      expect([...mergeKnownOrder(order, known)].sort()).toEqual([...known].sort())
    }
  })
})

describe('orderedNavMenu / visibleNavMenu', () => {
  test('mặc định: đủ 9 mục, Dashboard đứng đầu nhưng TẮT → cột trái bắt đầu từ Hosts', () => {
    expect(orderedNavMenu([])).toEqual(DEFAULT_NAV_MENU)
    expect(DEFAULT_NAV_MENU[0]).toBe('dashboard')
    expect(DEFAULT_NAV_ENABLED).not.toContain('dashboard')
    expect(visibleNavMenu([], DEFAULT_NAV_ENABLED)).toEqual([
      'hosts',
      'sftp',
      'tunnels',
      'snippets',
      'keys',
      'workspaces',
      'history',
      'tools'
    ])
  })

  test('bật Dashboard → nó hiện đúng vị trí đầu như menu cũ', () => {
    expect(visibleNavMenu([], DEFAULT_NAV_MENU)[0]).toBe('dashboard')
  })

  test('mọi mục bật, thứ tự user đặt được giữ', () => {
    expect(visibleNavMenu(['tunnels', 'hosts', 'sftp'], DEFAULT_NAV_MENU)).toEqual([
      'tunnels',
      'hosts',
      'sftp',
      'dashboard',
      'snippets',
      'keys',
      'workspaces',
      'history',
      'tools'
    ])
  })

  test('mục tắt biến mất khỏi cột nhưng vẫn giữ chỗ trong thứ tự đầy đủ', () => {
    const order = ['hosts', 'history', 'tunnels']
    expect(visibleNavMenu(order, ['hosts', 'tunnels'])).toEqual(['hosts', 'tunnels'])
    // orderedNavMenu là cái hộp cấu hình vẽ: history vẫn ở vị trí thứ 2 để bật lại là về đúng chỗ
    expect(orderedNavMenu(order).slice(0, 3)).toEqual(['hosts', 'history', 'tunnels'])
  })

  test('Hosts KHÔNG tắt được: enabled không ghi nó thì nó vẫn hiện', () => {
    expect(visibleNavMenu([], ['tunnels'])).toEqual(['hosts', 'tunnels'])
    expect(visibleNavMenu([], [])).toEqual(['hosts'])
  })

  test('Hosts bị kéo xuống dưới thì vẫn ở đúng chỗ đó (khoá tick, không khoá thứ tự)', () => {
    expect(visibleNavMenu(['tunnels', 'snippets', 'hosts'], ['tunnels', 'snippets'])).toEqual([
      'tunnels',
      'snippets',
      'hosts'
    ])
  })

  test('id lạ trong localStorage bị bỏ', () => {
    expect(visibleNavMenu(['hosts', 'x', 'y'], ['hosts', 'x'])).toEqual(['hosts'])
  })

  test('mục mới của bản sau chưa có trong thứ tự lưu thì nối cuối, không biến mất', () => {
    expect(visibleNavMenu(['hosts', 'tunnels'], DEFAULT_NAV_MENU).at(-1)).toBe('tools')
  })
})

describe('resolveNavigatorSection (trong phiên)', () => {
  test('mục hợp lệ giữ nguyên — kể cả dashboard và mục user đã tắt trên menu (palette vẫn tới được)', () => {
    for (const id of DEFAULT_NAV_MENU) expect(resolveNavigatorSection(id)).toBe(id)
  })

  test('giá trị lạ → home = hosts', () => {
    expect(NAV_HOME).toBe('hosts')
    expect(resolveNavigatorSection('')).toBe('hosts')
    expect(resolveNavigatorSection('khong-ton-tai')).toBe('hosts')
  })

  test('isNavMenuId', () => {
    expect(isNavMenuId('sftp')).toBe(true)
    expect(isNavMenuId('dashboard')).toBe(true)
    expect(isNavMenuId('settings')).toBe(false)
  })
})

describe('startupNavSection (lúc mở app)', () => {
  test('mục đã nhớ đang có trên menu → mở vào đúng nó', () => {
    expect(startupNavSection('tunnels', [], DEFAULT_NAV_ENABLED)).toBe('tunnels')
  })

  test('nhớ dashboard từ v0.2.20 nhưng Dashboard mặc định tắt → về Hosts, không mở vào mục không có trên menu', () => {
    expect(startupNavSection('dashboard', [], DEFAULT_NAV_ENABLED)).toBe('hosts')
  })

  test('user đã bật Dashboard thì nhớ dashboard vẫn mở vào Dashboard', () => {
    expect(startupNavSection('dashboard', [], DEFAULT_NAV_MENU)).toBe('dashboard')
  })

  test('mục đã tắt (kể cả không phải dashboard) → về Hosts', () => {
    expect(startupNavSection('history', [], ['hosts', 'tunnels'])).toBe('hosts')
  })

  test('chưa lưu gì / giá trị lạ → Hosts', () => {
    expect(startupNavSection(null, [], DEFAULT_NAV_ENABLED)).toBe('hosts')
    expect(startupNavSection('x', [], DEFAULT_NAV_MENU)).toBe('hosts')
  })
})
