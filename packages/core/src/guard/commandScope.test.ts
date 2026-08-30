import { describe, expect, test } from 'vitest'
import { guardScope, resolveProduction, typePhraseMatches, type CommandTarget } from '@infra/shared'

/**
 * ⚠️ Thực thi nằm ở `packages/shared` chứ không phải `packages/core`: **renderer không được
 * import từ `@infra/core`** (kéo `ssh2` vào bundle web là vỡ build — CLAUDE.md §5), mà guard
 * chạy ngay lúc bấm Enter nên cũng không thể đi vòng qua IPC. `@infra/shared` thì renderer
 * vốn đã import sẵn. Test để lại đây vì vitest chỉ quét các file test trong `packages/core`.
 */

function target(label: string, production = false): CommandTarget {
  return { label, production }
}

describe('resolveProduction — kế thừa qua chuỗi group', () => {
  const parents: Record<string, string | null> = { db: 'prod', prod: null, staging: null, loop_a: 'loop_b', loop_b: 'loop_a' }
  const parentOf = (id: string): string | null => parents[id] ?? null

  test('cờ đặt ở nhóm CHA thì nhóm con cũng là production', () => {
    expect(resolveProduction('db', (id) => id === 'prod', parentOf)).toBe(true)
  })

  test('không nhóm nào trên đường lên gốc bật cờ → false', () => {
    expect(resolveProduction('staging', (id) => id === 'prod', parentOf)).toBe(false)
  })

  test('host không thuộc nhóm nào → false', () => {
    expect(resolveProduction(null, () => true, parentOf)).toBe(false)
  })

  test('parentId tạo vòng lặp thì không treo', () => {
    expect(resolveProduction('loop_a', () => false, parentOf)).toBe(false)
  })
})

describe('guardScope', () => {
  test('không đích nào production → chỉ cần bấm xác nhận', () => {
    const scope = guardScope([target('app-01'), target('app-02')])
    expect(scope.level).toBe('confirm')
    expect(scope.typePhrase).toBeNull()
    expect(scope.targetCount).toBe(2)
  })

  test('CHỈ MỘT đích production cũng đủ nâng lên gõ-để-xác-nhận', () => {
    // Đây là ca đắt nhất: broadcast 5 pane mà lẫn 1 con production
    const scope = guardScope([target('app-01'), target('db-01', true), target('app-02')])
    expect(scope.level).toBe('type-to-confirm')
    expect(scope.productionLabels).toEqual(['db-01'])
    expect(scope.typePhrase).toBe('db-01')
  })

  test('giữ số đích thật để hộp thoại nói được "chạy trên N máy"', () => {
    expect(guardScope([target('a'), target('b'), target('c')]).targetCount).toBe(3)
  })

  test('nhãn production trùng nhau chỉ liệt kê một lần', () => {
    const scope = guardScope([target('db-01', true), target('db-01', true), target('db-02', true)])
    expect(scope.productionLabels).toEqual(['db-01', 'db-02'])
  })

  test('không có đích nào (không nên xảy ra) → vẫn trả về hợp lệ, không ném', () => {
    const scope = guardScope([])
    expect(scope.level).toBe('confirm')
    expect(scope.targetCount).toBe(0)
  })
})

describe('typePhraseMatches', () => {
  test('khớp đúng, bỏ khoảng trắng thừa hai đầu', () => {
    expect(typePhraseMatches('  db-01 ', 'db-01')).toBe(true)
  })

  test('PHÂN BIỆT hoa thường — nhãn host hay chỉ khác nhau đúng chỗ đó', () => {
    expect(typePhraseMatches('DB-01', 'db-01')).toBe(false)
  })

  test('gõ sai / gõ thiếu → false', () => {
    expect(typePhraseMatches('db-0', 'db-01')).toBe(false)
    expect(typePhraseMatches('', 'db-01')).toBe(false)
  })

  test('không yêu cầu gõ (mức confirm) → luôn true', () => {
    expect(typePhraseMatches('', null)).toBe(true)
  })
})
