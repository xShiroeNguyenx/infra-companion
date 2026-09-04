import { describe, expect, test } from 'vitest'
import {
  isGroupCollapsed,
  unseenHistory,
  visibleSidebarBlocks,
  DEFAULT_SIDEBAR_BLOCKS,
  DEFAULT_SIDEBAR_ENABLED
} from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer không import được `@infra/core` (CLAUDE.md §5). */

describe('visibleSidebarBlocks', () => {
  test('mặc định → đúng bố cục cũ: Yêu thích, nhóm host, gần đây', () => {
    expect(visibleSidebarBlocks(DEFAULT_SIDEBAR_BLOCKS, DEFAULT_SIDEBAR_ENABLED)).toEqual([
      'favorites',
      'groups',
      'recent'
    ])
  })

  test('giữ ĐÚNG thứ tự user đặt, không sắp lại theo mặc định', () => {
    expect(visibleSidebarBlocks(['tunnels', 'favorites', 'groups'], ['favorites', 'groups', 'tunnels'])).toEqual([
      'tunnels',
      'favorites',
      'groups'
    ])
  })

  test('khối tắt thì không hiện, kể cả khi có trong thứ tự', () => {
    expect(visibleSidebarBlocks(['favorites', 'tunnels', 'groups'], ['favorites', 'groups'])).toEqual([
      'favorites',
      'groups'
    ])
  })

  test('id lạ trong thứ tự đã lưu bị loại (không render khối trống)', () => {
    expect(visibleSidebarBlocks(['favorites', 'khong-ton-tai', 'groups'], ['favorites', 'groups'])).toEqual([
      'favorites',
      'groups'
    ])
  })

  test('id trùng trong thứ tự chỉ tính một lần (React key phải duy nhất)', () => {
    expect(visibleSidebarBlocks(['favorites', 'favorites'], ['favorites'])).toEqual(['favorites'])
  })

  test('khối MỚI của bản sau chưa có trong thứ tự đã lưu → nối vào cuối, không mất', () => {
    // Thứ tự lưu từ bản cũ chỉ có 2 khối; bật 'snippets' (khối mới) thì nó vẫn phải hiện.
    expect(visibleSidebarBlocks(['groups', 'favorites'], ['groups', 'favorites', 'snippets'])).toEqual([
      'groups',
      'favorites',
      'snippets'
    ])
  })

  test('tắt hết → rỗng (nơi gọi hiện gợi ý mở lại cấu hình)', () => {
    expect(visibleSidebarBlocks(DEFAULT_SIDEBAR_BLOCKS, [])).toEqual([])
  })

  test('thứ tự lưu rỗng (lần đầu) → rơi về thứ tự mặc định', () => {
    expect(visibleSidebarBlocks([], ['tunnels', 'favorites'])).toEqual(['favorites', 'tunnels'])
  })

  test('bật một id lạ cũng không tạo ra khối nào', () => {
    expect(visibleSidebarBlocks(DEFAULT_SIDEBAR_BLOCKS, ['khong-ton-tai'])).toEqual([])
  })
})

describe('isGroupCollapsed', () => {
  test('chưa lưu gì → mọi group đều MỞ (giữ hành vi cũ)', () => {
    expect(isGroupCollapsed([], 'g1')).toBe(false)
  })

  test('group có trong danh sách "đang gập" → gập', () => {
    expect(isGroupCollapsed(['g1', 'g2'], 'g2')).toBe(true)
  })

  test('group KHÔNG trong danh sách → mở, kể cả khi group khác đang gập', () => {
    expect(isGroupCollapsed(['g1'], 'g2')).toBe(false)
  })

  test('mục host chưa phân nhóm (null) KHÔNG bao giờ gập', () => {
    // Nó không có id để nhớ trạng thái, và gập nó lại thì host mới thêm sẽ biến mất.
    expect(isGroupCollapsed([], null)).toBe(false)
    expect(isGroupCollapsed(['g1'], null)).toBe(false)
  })
})

describe('unseenHistory', () => {
  const entry = (id: string, target: string, hostId: string | null) => ({ id, target, hostId })

  test('mục trỏ về host ĐANG hiện → bỏ (đã thấy ở danh sách trên)', () => {
    const history = [entry('1', 'deploy@app-01:22', 'h1')]
    expect(unseenHistory(history, ['h1'], 8)).toEqual([])
  })

  test('quick-connect chưa lưu thành host → GIỮ (không có đường vào nào khác)', () => {
    const history = [entry('1', 'admin@203.0.113.10:22', null)]
    expect(unseenHistory(history, ['h1'], 8)).toHaveLength(1)
  })

  test('mục trỏ về host KHÔNG còn hiện (đang tìm kiếm) → giữ lại', () => {
    // Lúc này host đã bị ô tìm loại khỏi danh sách trên, nên dòng history lại đáng hiện.
    const history = [entry('1', 'deploy@app-01:22', 'h1')]
    expect(unseenHistory(history, ['h2'], 8)).toHaveLength(1)
  })

  test('cùng một target quick-connect nhiều lần → chỉ giữ lần gần nhất', () => {
    const history = [
      entry('3', 'admin@203.0.113.10:22', null),
      entry('2', 'admin@203.0.113.10:22', null),
      entry('1', 'admin@203.0.113.10:22', null)
    ]
    const out = unseenHistory(history, [], 8)
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('3')
  })

  test('tôn trọng limit', () => {
    const history = Array.from({ length: 20 }, (_, i) => entry(`${i}`, `admin@203.0.113.${i}:22`, null))
    expect(unseenHistory(history, [], 4)).toHaveLength(4)
  })

  test('giữ THỨ TỰ mới→cũ của history', () => {
    const history = [
      entry('3', 'admin@203.0.113.12:22', null),
      entry('2', 'admin@203.0.113.11:22', null),
      entry('1', 'admin@203.0.113.10:22', null)
    ]
    expect(unseenHistory(history, [], 8).map((e) => e.id)).toEqual(['3', '2', '1'])
  })

  test('mọi mục đều đã thấy → rỗng (nơi gọi sẽ ẩn cả khối)', () => {
    const history = [entry('1', 'deploy@app-01:22', 'h1'), entry('2', 'deploy@app-02:22', 'h2')]
    expect(unseenHistory(history, ['h1', 'h2'], 8)).toEqual([])
  })

  test('không sửa mảng đầu vào', () => {
    const history = [entry('1', 'deploy@app-01:22', 'h1'), entry('2', 'admin@203.0.113.10:22', null)]
    unseenHistory(history, ['h1'], 8)
    expect(history).toHaveLength(2)
  })
})
