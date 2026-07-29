import { describe, expect, test } from 'vitest'
import { LogRing, rotatePlan, shouldRotate, splitLines } from './logLines'

describe('splitLines', () => {
  test('tách dòng hoàn chỉnh, giữ phần dư', () => {
    const r = splitLines('', 'a\nb\nc')
    expect(r.lines).toEqual(['a', 'b'])
    expect(r.rest).toBe('c')
  })

  test('CHUNK CẮT GIỮA DÒNG: nối được qua 2 lần gọi (nếu không, mọi dòng dài thành 2 dòng rác)', () => {
    const r1 = splitLines('', '2026/07/27 08:00:00 [error] some very long mes')
    expect(r1.lines).toEqual([])
    const r2 = splitLines(r1.rest, 'sage here\n')
    expect(r2.lines).toEqual(['2026/07/27 08:00:00 [error] some very long message here'])
    expect(r2.rest).toBe('')
  })

  test('chuẩn hoá CRLF của nginx/mariadb trên Windows', () => {
    const r = splitLines('', 'a\r\nb\r\n')
    expect(r.lines).toEqual(['a', 'b'])
    expect(r.rest).toBe('')
    // Không để \r sót lại làm log hiển thị lệch
    for (const l of r.lines) expect(l).not.toContain('\r')
  })

  test('CR đơn lẻ cũng coi là hết dòng', () => {
    expect(splitLines('', 'a\rb\r').lines).toEqual(['a', 'b'])
  })

  test('dòng trống được giữ (nginx có dòng trống giữa các block lỗi)', () => {
    expect(splitLines('', 'a\n\nb\n').lines).toEqual(['a', '', 'b'])
  })

  test('chunk rỗng không sinh dòng', () => {
    const r = splitLines('abc', '')
    expect(r.lines).toEqual([])
    expect(r.rest).toBe('abc')
  })

  test('giữ nguyên UTF-8 nhiều byte (tên site tiếng Việt trong log)', () => {
    const r = splitLines('', 'Tài liệu lỗi ở /trang-chủ\n')
    expect(r.lines).toEqual(['Tài liệu lỗi ở /trang-chủ'])
  })

  test('nhiều dòng trong 1 chunk lớn', () => {
    const r = splitLines('', Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n') + '\n')
    expect(r.lines).toHaveLength(100)
    expect(r.rest).toBe('')
  })
})

describe('shouldRotate', () => {
  test('rotate khi vượt trần', () => {
    expect(shouldRotate(1_900_000, 200_000, 2_000_000)).toBe(true)
  })

  test('chưa vượt thì không rotate', () => {
    expect(shouldRotate(100, 100, 2_000_000)).toBe(false)
  })

  test('file rỗng thì KHÔNG rotate (tránh rotate vô ích khi chunk đầu quá lớn)', () => {
    expect(shouldRotate(0, 5_000_000, 2_000_000)).toBe(false)
  })
})

describe('rotatePlan', () => {
  test('keep=2: đổi tên từ file CŨ NHẤT trước để không ghi đè mất dữ liệu', () => {
    const p = rotatePlan('a.log', 2)
    expect(p.deleteFile).toBe('a.log.2')
    expect(p.renames).toEqual([
      { from: 'a.log.1', to: 'a.log.2' },
      { from: 'a.log', to: 'a.log.1' }
    ])
  })

  test('keep=3', () => {
    const p = rotatePlan('a.log', 3)
    expect(p.deleteFile).toBe('a.log.3')
    expect(p.renames.map((r) => r.from)).toEqual(['a.log.2', 'a.log.1', 'a.log'])
  })

  test('keep=0: xoá thẳng, không giữ bản nào', () => {
    const p = rotatePlan('a.log', 0)
    expect(p.deleteFile).toBe('a.log')
    expect(p.renames).toEqual([])
  })

  test('thứ tự rename luôn giảm dần theo index (bất biến quan trọng nhất)', () => {
    const p = rotatePlan('x.log', 5)
    const idx = p.renames.map((r) => Number(/\.(\d+)$/.exec(r.from)?.[1] ?? 0))
    for (let i = 1; i < idx.length; i++) expect(idx[i]!).toBeLessThan(idx[i - 1]!)
  })
})

describe('LogRing', () => {
  test('tail lấy N dòng cuối', () => {
    const r = new LogRing(10)
    r.push(['a', 'b', 'c'])
    expect(r.tail(2)).toEqual(['b', 'c'])
    expect(r.tail(10)).toEqual(['a', 'b', 'c'])
  })

  test('vượt cap thì bỏ dòng cũ nhất (không phình bộ nhớ khi nginx log 1000 dòng/giây)', () => {
    const r = new LogRing(3)
    r.push(['1', '2', '3', '4', '5'])
    expect(r.size).toBe(3)
    expect(r.tail(3)).toEqual(['3', '4', '5'])
  })

  test('tail(0) và tail âm trả rỗng', () => {
    const r = new LogRing(5)
    r.push(['a'])
    expect(r.tail(0)).toEqual([])
    expect(r.tail(-1)).toEqual([])
  })

  test('clear', () => {
    const r = new LogRing(5)
    r.push(['a', 'b'])
    r.clear()
    expect(r.size).toBe(0)
    expect(r.tail(5)).toEqual([])
  })
})
