import type { ReplChecksumRowDto, ReplSchemaDiffDto, ReplTableDiffDto, ReplVarDiffDto } from '@infra/shared'
import { describe, expect, test } from 'vitest'
import { buildChecksumRun, buildScanRun, isChecksumMismatch, runHasFindings } from './history'

/** F59 — rút gọn kết quả so lệch trước khi cất vào lịch sử. */

const table = (name: string, status: ReplTableDiffDto['status'], filtered = false): ReplTableDiffDto => ({
  schema: 'shop',
  name,
  status,
  master: null,
  replica: null,
  rowDelta: null,
  filtered
})

const column = (item: string): ReplSchemaDiffDto => ({
  table: 'shop.orders',
  item,
  status: 'differs',
  masterSignature: 'int(11) | NO |  | ',
  replicaSignature: 'bigint(20) | NO |  | '
})

const variable = (name: string, expected: boolean): ReplVarDiffDto => ({
  name,
  master: '1',
  replica: '2',
  expected,
  note: ''
})

const row = (over: Partial<ReplChecksumRowDto>): ReplChecksumRowDto => ({
  schema: 'shop',
  name: 'orders',
  masterCount: null,
  replicaCount: null,
  masterChecksum: null,
  replicaChecksum: null,
  ...over
})

describe('buildScanRun', () => {
  test('không lưu bảng khớp — lịch sử chỉ giữ mục lệch', () => {
    const { payload, counts } = buildScanRun({
      tables: [table('orders', 'rows-differ'), table('users', 'same'), table('logs', 'same')],
      columns: [],
      indexes: [],
      variables: []
    })
    expect(payload.tables.map((t) => t.name)).toEqual(['orders'])
    expect(counts.tableDiffs).toBe(1)
  })

  test('bảng ngoài phạm vi replication vẫn lưu nhưng KHÔNG tính là lệch', () => {
    const { payload, counts } = buildScanRun({
      tables: [table('orders', 'rows-differ'), table('sessions', 'missing-on-replica', true)],
      columns: [],
      indexes: [],
      variables: []
    })
    expect(payload.tables).toHaveLength(2)
    expect(counts.tableDiffs).toBe(1)
  })

  test('biến vốn phải khác nhau (server_id…) không tính vào số lệch', () => {
    const { counts } = buildScanRun({
      tables: [],
      columns: [],
      indexes: [],
      variables: [variable('server_id', true), variable('binlog_format', false)]
    })
    expect(counts.varDiffs).toBe(1)
  })

  test('vượt trần thì cắt và BÁO đã cắt — không im lặng để tưởng là đủ', () => {
    const many = Array.from({ length: 12 }, (_, i) => table(`t${i}`, 'rows-differ'))
    const { payload, counts } = buildScanRun({ tables: many, columns: [], indexes: [], variables: [] }, 5)
    expect(payload.tables).toHaveLength(5)
    expect(payload.truncated).toBe(true)
    // Con số tóm tắt vẫn là TỔNG THẬT, không phải số dòng còn giữ lại
    expect(counts.tableDiffs).toBe(12)
  })

  test('vừa đủ trần thì không đánh dấu đã cắt', () => {
    const { payload } = buildScanRun(
      { tables: [], columns: [column('a'), column('b')], indexes: [], variables: [] },
      2
    )
    expect(payload.columns).toHaveLength(2)
    expect(payload.truncated).toBe(false)
  })
})

describe('isChecksumMismatch', () => {
  test('số dòng khác nhau = lệch', () => {
    expect(isChecksumMismatch(row({ masterCount: 10, replicaCount: 9 }))).toBe(true)
  })

  test('checksum khác nhau = lệch dù số dòng bằng nhau', () => {
    expect(isChecksumMismatch(row({ masterChecksum: 111, replicaChecksum: 222 }))).toBe(true)
  })

  test('một bên KHÔNG ĐỌC ĐƯỢC thì không kết luận là lệch', () => {
    // Engine không hỗ trợ CHECKSUM → null. Coi null là "khác" sẽ báo động giả hàng loạt.
    expect(isChecksumMismatch(row({ masterChecksum: 111, replicaChecksum: null }))).toBe(false)
    expect(isChecksumMismatch(row({ masterCount: null, replicaCount: 5 }))).toBe(false)
  })
})

describe('buildChecksumRun', () => {
  test('giữ cả dòng khớp và đếm đúng số bảng lệch', () => {
    const { payload, counts } = buildChecksumRun([
      row({ name: 'orders', masterCount: 10, replicaCount: 9 }),
      row({ name: 'users', masterCount: 5, replicaCount: 5 }),
      row({ name: 'logs', error: 'Tên bảng không hợp lệ' })
    ])
    expect(payload.rows).toHaveLength(3)
    expect(counts.checked).toBe(3)
    expect(counts.mismatches).toBe(1)
  })
})

describe('runHasFindings', () => {
  test('không lệch gì → false', () => {
    const { counts } = buildScanRun({ tables: [table('users', 'same')], columns: [], indexes: [], variables: [] })
    expect(runHasFindings(counts)).toBe(false)
  })

  test('chỉ lệch index cũng là có phát hiện', () => {
    const { counts } = buildScanRun({
      tables: [],
      columns: [],
      indexes: [{ table: 'shop.orders', item: 'idx_created', status: 'missing-on-replica', masterSignature: 'INDEX(created_at)', replicaSignature: null }],
      variables: []
    })
    expect(runHasFindings(counts)).toBe(true)
  })
})
