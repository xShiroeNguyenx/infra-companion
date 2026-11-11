import { describe, expect, test } from 'vitest'
import { pickPromptJump, type PromptJumpInput } from '@infra/shared'

/**
 * Ctrl+↑ / Ctrl+↓ — nhảy giữa các prompt (phần cuối của F23). Thực thi ở `packages/shared`.
 *
 * Bối cảnh chung: terminal 10 dòng, buffer 100 dòng (baseY = 90), prompt ở dòng 10/40/70/95.
 * Dòng 95 là prompt mới tinh ở đáy, con trỏ ở 95.
 */
const base: PromptJumpInput = {
  prompts: [70, 10, 95, 40],
  direction: 'prev',
  current: null,
  viewportTop: 90,
  rows: 10,
  baseY: 90,
  cursorLine: 95,
  running: false
}

describe('pickPromptJump', () => {
  test('không có mốc nào (chưa bật shell integration) → không làm gì', () => {
    expect(pickPromptJump({ ...base, prompts: [] })).toEqual({ kind: 'none' })
    expect(pickPromptJump({ ...base, prompts: [-1, -1] })).toEqual({ kind: 'none' })
  })

  test('ở đáy, đứng ở prompt mới: lần bấm đầu tới ngay lệnh vừa chạy, bỏ qua dòng đang gõ', () => {
    expect(pickPromptJump(base)).toEqual({ kind: 'line', line: 70 })
  })

  test('ở đáy, lệnh đang chạy: lần bấm đầu tới đầu lệnh đang chạy', () => {
    // Lệnh bắt đầu ở prompt 95, output đã chảy tới dòng 99
    expect(pickPromptJump({ ...base, running: true, cursorLine: 99 })).toEqual({ kind: 'line', line: 95 })
  })

  test('bấm tiếp khi viewport không nhúc nhích được vẫn đi tiếp (mốc = prompt vừa nhảy tới)', () => {
    // Prompt 95 ở sát đáy: scrollToLine không kéo được nó lên đầu, viewport đứng yên ở 90
    const first = pickPromptJump({ ...base, running: true, cursorLine: 99 })
    expect(first).toEqual({ kind: 'line', line: 95 })
    expect(pickPromptJump({ ...base, running: true, cursorLine: 99, current: 95 })).toEqual({ kind: 'line', line: 70 })
  })

  test('đi lùi liên tục rồi dừng ở prompt đầu tiên', () => {
    expect(pickPromptJump({ ...base, current: 40, viewportTop: 40 })).toEqual({ kind: 'line', line: 10 })
    expect(pickPromptJump({ ...base, current: 10, viewportTop: 10 })).toEqual({ kind: 'none' })
  })

  test('đi tới: prompt kế tiếp, rồi về đáy khi hết', () => {
    expect(pickPromptJump({ ...base, direction: 'next', current: 10, viewportTop: 10 })).toEqual({ kind: 'line', line: 40 })
    // Đã ở prompt cuối nhưng viewport chưa ở đáy → cuộn về đáy
    expect(
      pickPromptJump({ ...base, prompts: [10, 40], direction: 'next', current: 40, viewportTop: 40 })
    ).toEqual({ kind: 'bottom' })
  })

  test('ở đáy mà bấm đi tới → không làm gì', () => {
    expect(pickPromptJump({ ...base, direction: 'next' })).toEqual({ kind: 'none' })
  })

  test('user tự cuộn đi chỗ khác: bỏ mốc cũ, tính từ dòng trên cùng đang hiện', () => {
    // Lần trước nhảy tới 10, giờ user cuộn tới 50 (dòng 10 không còn trên màn hình)
    const scrolled = { ...base, current: 10, viewportTop: 50 }
    expect(pickPromptJump(scrolled)).toEqual({ kind: 'line', line: 40 })
    expect(pickPromptJump({ ...scrolled, direction: 'next' })).toEqual({ kind: 'line', line: 70 })
  })

  test('prompt nằm đúng dòng trên cùng: lùi là tới prompt TRƯỚC nó, không đứng yên', () => {
    expect(pickPromptJump({ ...base, viewportTop: 40 })).toEqual({ kind: 'line', line: 10 })
    expect(pickPromptJump({ ...base, viewportTop: 40, direction: 'next' })).toEqual({ kind: 'line', line: 70 })
  })

  test('mốc trùng nhau và mốc đã bị xoá không làm lệch kết quả', () => {
    expect(pickPromptJump({ ...base, prompts: [-1, 40, 40, 70, 95, -1] })).toEqual({ kind: 'line', line: 70 })
  })
})
