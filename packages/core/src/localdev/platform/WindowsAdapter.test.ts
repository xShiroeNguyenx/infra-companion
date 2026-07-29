import { describe, expect, test } from 'vitest'
import { parseExcludedPortRanges, parseStrayJson } from './WindowsAdapter'

describe('parseStrayJson', () => {
  test('PowerShell trả ARRAY khi có nhiều kết quả', () => {
    const json = JSON.stringify([
      {
        ProcessId: 1234,
        ParentProcessId: 10,
        ExecutablePath: 'D:\\infra\\runtimes\\nginx-1.28\\nginx.exe',
        CreationDate: '/Date(1690000000000)/'
      },
      {
        ProcessId: 5678,
        ParentProcessId: 1234,
        ExecutablePath: 'D:\\infra\\runtimes\\php-8.3\\php-cgi.exe',
        CreationDate: '/Date(1690000001000)/'
      }
    ])
    const out = parseStrayJson(json)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      pid: 1234,
      parentPid: 10,
      exePath: 'D:\\infra\\runtimes\\nginx-1.28\\nginx.exe',
      startedAt: 1_690_000_000_000
    })
  })

  test('PowerShell trả OBJECT ĐƠN khi chỉ có 1 kết quả — chỗ rất dễ sai', () => {
    const json = JSON.stringify({
      ProcessId: 999,
      ParentProcessId: 1,
      ExecutablePath: 'D:\\infra\\runtimes\\php-8.3\\php-cgi.exe',
      CreationDate: '/Date(1690000000000)/'
    })
    const out = parseStrayJson(json)
    expect(out).toHaveLength(1)
    expect(out[0]?.pid).toBe(999)
  })

  test('không có process nào → rỗng (stdout trống)', () => {
    expect(parseStrayJson('')).toEqual([])
    expect(parseStrayJson('   \r\n ')).toEqual([])
  })

  test('JSON hỏng → rỗng, KHÔNG throw (reap là best-effort, không được làm app không boot)', () => {
    expect(parseStrayJson('{not json')).toEqual([])
    expect(parseStrayJson('null')).toEqual([])
  })

  test('bỏ entry thiếu PID hoặc thiếu ExecutablePath (không đủ căn cứ để diệt)', () => {
    const json = JSON.stringify([
      { ProcessId: 0, ExecutablePath: 'D:\\x\\a.exe' },
      { ProcessId: 5, ExecutablePath: '' },
      { ExecutablePath: 'D:\\x\\b.exe' },
      { ProcessId: 7, ExecutablePath: 'D:\\x\\c.exe' }
    ])
    expect(parseStrayJson(json).map((p) => p.pid)).toEqual([7])
  })

  test('CreationDate dạng ISO cũng parse được', () => {
    const json = JSON.stringify({
      ProcessId: 42,
      ExecutablePath: 'D:\\x\\a.exe',
      CreationDate: '2026-07-27T08:00:00.000Z'
    })
    expect(parseStrayJson(json)[0]?.startedAt).toBe(Date.parse('2026-07-27T08:00:00.000Z'))
  })

  test('CreationDate thiếu/rác → null, entry vẫn dùng được', () => {
    const json = JSON.stringify({ ProcessId: 42, ExecutablePath: 'D:\\x\\a.exe', CreationDate: 'rác' })
    const out = parseStrayJson(json)
    expect(out[0]?.startedAt).toBeNull()
    expect(out[0]?.pid).toBe(42)
  })

  test('ParentProcessId thiếu → null', () => {
    const json = JSON.stringify({ ProcessId: 42, ExecutablePath: 'D:\\x\\a.exe' })
    expect(parseStrayJson(json)[0]?.parentPid).toBeNull()
  })
})

describe('parseExcludedPortRanges', () => {
  test('parse output netsh thật (dải Hyper-V/WinNAT giữ)', () => {
    // Output thật trên máy dev: 50000-50059 bị WinNAT giữ
    const stdout = [
      '',
      'Protocol tcp Port Exclusion Ranges',
      '',
      'Start Port    End Port',
      '----------    --------',
      '     50000       50059',
      '     50060       50159',
      '',
      '* - Administered port exclusions.',
      ''
    ].join('\r\n')
    expect(parseExcludedPortRanges(stdout)).toEqual([
      [50_000, 50_059],
      [50_060, 50_159]
    ])
  })

  test('bỏ dòng header/gạch ngang/ghi chú (không phải 2 số)', () => {
    const stdout = 'Start Port    End Port\r\n----------    --------\r\n* - note\r\n   8080      8090\r\n'
    expect(parseExcludedPortRanges(stdout)).toEqual([[8080, 8090]])
  })

  test('output rỗng / netsh lỗi → rỗng', () => {
    expect(parseExcludedPortRanges('')).toEqual([])
    expect(parseExcludedPortRanges('The requested operation requires elevation.')).toEqual([])
  })

  test('loại dải vô lý (from > to, ngoài 1..65535)', () => {
    expect(parseExcludedPortRanges('   9000      8000\r\n')).toEqual([])
    expect(parseExcludedPortRanges('      0        100\r\n')).toEqual([])
    expect(parseExcludedPortRanges('   60000     70000\r\n')).toEqual([])
  })

  test('hoạt động với output dùng LF (không chỉ CRLF)', () => {
    expect(parseExcludedPortRanges('   1024      1033\n')).toEqual([[1024, 1033]])
  })
})
