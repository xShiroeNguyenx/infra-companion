import { describe, expect, test } from 'vitest'
import {
  moveInList,
  orderTools,
  recordToolUse,
  toolScore,
  TOOL_USAGE_HALF_LIFE_MS,
  type ToolUsage
} from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer không import được `@infra/core` (CLAUDE.md §5). */

const NOW = 1_700_000_000_000
const DAY = 86_400_000

/** Danh mục rút gọn, cùng hình dạng với `TOOLS` thật (chỉ cần `id`). */
const TOOLS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] as const

function order(
  over: {
    usage?: Record<string, ToolUsage | undefined>
    pinned?: readonly string[]
    tools?: readonly { id: string }[]
    now?: number
  } = {}
): string[] {
  return orderTools({
    tools: over.tools ?? TOOLS,
    id: (tool) => tool.id,
    usage: over.usage ?? {},
    pinned: over.pinned ?? [],
    now: over.now ?? NOW
  }).map((tool) => tool.id)
}

describe('toolScore', () => {
  test('chưa từng dùng → 0 điểm', () => {
    expect(toolScore(undefined, NOW)).toBe(0)
  })

  test('count 0 → 0 điểm (không chia cho thứ gì)', () => {
    expect(toolScore({ count: 0, lastAt: NOW }, NOW)).toBe(0)
  })

  test('dùng ngay bây giờ → điểm bằng đúng số lượt', () => {
    expect(toolScore({ count: 4, lastAt: NOW }, NOW)).toBeCloseTo(4)
  })

  test('sau đúng một chu kỳ bán rã → còn nửa điểm', () => {
    expect(toolScore({ count: 8, lastAt: NOW - TOOL_USAGE_HALF_LIFE_MS }, NOW)).toBeCloseTo(4)
  })

  test('lượt ở TƯƠNG LAI (đồng hồ máy bị đẩy lên) không thành điểm vô cực', () => {
    const score = toolScore({ count: 3, lastAt: NOW + 90 * DAY }, NOW)
    expect(score).toBeCloseTo(3)
  })
})

describe('orderTools', () => {
  test('user mới (chưa dùng gì, chưa ghim) → ĐÚNG thứ tự danh mục', () => {
    expect(order()).toEqual(['a', 'b', 'c', 'd'])
  })

  test('dùng nhiều thì lên trước', () => {
    expect(
      order({
        usage: { c: { count: 10, lastAt: NOW }, a: { count: 2, lastAt: NOW } }
      })
    ).toEqual(['c', 'a', 'b', 'd'])
  })

  test('điểm bằng nhau → giữ thứ tự danh mục, không đảo ngẫu nhiên', () => {
    expect(
      order({ usage: { d: { count: 5, lastAt: NOW }, b: { count: 5, lastAt: NOW } } })
    ).toEqual(['b', 'd', 'a', 'c'])
  })

  test('dùng đều tuần này thắng cụm dùng dồn đã bỏ từ lâu', () => {
    // Đây là lý do tồn tại của decay: tổng thô thì 'a' (40 lượt) mãi mãi đứng trước.
    expect(
      order({
        usage: {
          a: { count: 40, lastAt: NOW - 300 * DAY },
          b: { count: 6, lastAt: NOW - DAY }
        }
      })
    ).toEqual(['b', 'a', 'c', 'd'])
  })

  test('ghim luôn nằm trước, kể cả khi chưa từng dùng', () => {
    expect(
      order({ pinned: ['d'], usage: { a: { count: 99, lastAt: NOW } } })
    ).toEqual(['d', 'a', 'b', 'c'])
  })

  test('nhiều ghim giữ ĐÚNG thứ tự user đặt (không theo danh mục, không theo điểm)', () => {
    expect(
      order({ pinned: ['c', 'a'], usage: { a: { count: 99, lastAt: NOW } } })
    ).toEqual(['c', 'a', 'b', 'd'])
  })

  test('ghim một công cụ không còn trong danh mục → bỏ qua, không tạo ô rỗng', () => {
    // Xảy ra thật: ghim Local dev rồi tắt nó ở Cài đặt.
    expect(order({ pinned: ['localdev', 'b'] })).toEqual(['b', 'a', 'c', 'd'])
  })

  test('không sửa mảng đầu vào', () => {
    const tools = [{ id: 'a' }, { id: 'b' }]
    orderTools({
      tools,
      id: (tool) => tool.id,
      usage: { b: { count: 3, lastAt: NOW } },
      pinned: [],
      now: NOW
    })
    expect(tools.map((tool) => tool.id)).toEqual(['a', 'b'])
  })
})

describe('moveInList (kéo thả mục đã ghim)', () => {
  const list = ['a', 'b', 'c', 'd']

  test('kéo sang PHẢI: mục được kéo nằm ĐÚNG chỗ mục đích, không lệch một ô', () => {
    // 'a' thả lên 'c' (chỉ số 2) → 'a' phải đứng ở chỗ 'c' đang đứng.
    // Cái bẫy: chèn thẳng vào chỉ số 2 sau khi đã xoá 'a' thì ra ['b','c','a','d'] — lệch một ô.
    expect(moveInList(list, 'a', 2)).toEqual(['b', 'a', 'c', 'd'])
  })

  test('kéo sang TRÁI: chèn ngay trước mục đích', () => {
    expect(moveInList(list, 'd', 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  test('kéo về đầu danh sách', () => {
    expect(moveInList(list, 'c', 0)).toEqual(['c', 'a', 'b', 'd'])
  })

  test('kéo vào chính chỗ mình → không đổi gì', () => {
    expect(moveInList(list, 'b', 1)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('id không có trong danh sách → trả bản sao nguyên vẹn', () => {
    expect(moveInList(list, 'zz', 0)).toEqual(list)
  })

  test('không sửa danh sách gốc', () => {
    const src = ['a', 'b', 'c']
    moveInList(src, 'a', 2)
    expect(src).toEqual(['a', 'b', 'c'])
  })
})

describe('recordToolUse', () => {
  test('lượt đầu tiên của một công cụ', () => {
    expect(recordToolUse({}, 'a', NOW)).toEqual({ a: { count: 1, lastAt: NOW } })
  })

  test('cộng dồn và cập nhật lần cuối', () => {
    const before = { a: { count: 2, lastAt: NOW - 10 * DAY } }
    expect(recordToolUse(before, 'a', NOW)).toEqual({ a: { count: 3, lastAt: NOW } })
  })

  test('không sửa bảng cũ (store zustand cần tham chiếu mới để render lại)', () => {
    const before = { a: { count: 2, lastAt: NOW - DAY } }
    recordToolUse(before, 'a', NOW)
    expect(before.a).toEqual({ count: 2, lastAt: NOW - DAY })
  })

  test('giữ lượt của các công cụ khác', () => {
    const next = recordToolUse({ b: { count: 7, lastAt: NOW } }, 'a', NOW)
    expect(next.b).toEqual({ count: 7, lastAt: NOW })
  })
})
