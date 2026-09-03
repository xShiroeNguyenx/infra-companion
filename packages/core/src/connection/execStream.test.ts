import { describe, expect, test } from 'vitest'
import { LineBuffer } from './execStream'
import { COMMON_LOG_PATHS, highlightSegments, lineMatches, tailCommand, type LogFilter } from '@infra/shared'

function filter(over: Partial<LogFilter> = {}): LogFilter {
  return { query: '', invert: false, caseSensitive: false, ...over }
}

describe('LineBuffer', () => {
  test('chỉ trả dòng ĐÃ TRỌN VẸN, giữ lại phần dở', () => {
    const buf = new LineBuffer()
    expect(buf.push('mot\nhai\nba')).toEqual(['mot', 'hai'])
    expect(buf.push(' phan sau\n')).toEqual(['ba phan sau'])
  })

  test('dòng bị cắt làm nhiều chunk vẫn ghép lại đúng', () => {
    // Chunk SSH cắt ở đâu là chuyện tầng vận chuyển, không theo ranh giới dòng
    const buf = new LineBuffer()
    expect(buf.push('ERR')).toEqual([])
    expect(buf.push('OR: khong')).toEqual([])
    expect(buf.push(' noi duoc\n')).toEqual(['ERROR: khong noi duoc'])
  })

  test('CRLF và CR đều quy về một dòng (log từ máy Windows/thiết bị mạng)', () => {
    expect(new LineBuffer().push('a\r\nb\rc\n')).toEqual(['a', 'b', 'c'])
  })

  test('flush trả dòng cuối không có \\n — bỏ qua là nuốt mất chính nó', () => {
    const buf = new LineBuffer()
    expect(buf.push('dong cuoi khong xuong dong')).toEqual([])
    expect(buf.flush()).toEqual(['dong cuoi khong xuong dong'])
    expect(buf.flush()).toEqual([]) // gọi lại không nhân đôi
  })

  test('dòng trống được giữ, không bị nuốt', () => {
    expect(new LineBuffer().push('a\n\nb\n')).toEqual(['a', '', 'b'])
  })

  test('chunk rỗng không sinh ra dòng ma', () => {
    const buf = new LineBuffer()
    expect(buf.push('')).toEqual([])
    expect(buf.flush()).toEqual([])
  })
})

describe('tailCommand', () => {
  test('dùng -F chứ KHÔNG phải -f (sống qua logrotate)', () => {
    // -f bám inode cũ: logrotate đổi tên file lúc nửa đêm là panel im lặng vĩnh viễn
    const cmd = tailCommand('/var/log/nginx/error.log')
    expect(cmd).toContain(' -F ')
    expect(cmd).not.toMatch(/\s-f\s/)
  })

  test('kéo sẵn lịch sử để không phải nhìn màn hình trắng', () => {
    expect(tailCommand('/var/log/syslog', 50)).toContain('-n 50')
  })

  test('bọc nháy đơn, trung hoà nháy đơn trong đường dẫn', () => {
    expect(tailCommand("/var/log/it's.log")).toContain(`'\\''`)
  })

  test('KHÔNG dùng $(…), backtick hay heredoc', () => {
    const cmd = tailCommand('/var/log/syslog')
    expect(cmd).not.toContain('$(')
    expect(cmd).not.toContain('`')
    expect(cmd).not.toContain('<<')
  })

  test('số dòng âm/lẻ được chuẩn hoá, không đẩy rác vào lệnh', () => {
    expect(tailCommand('/x', -5)).toContain('-n 0')
    expect(tailCommand('/x', 10.7)).toContain('-n 10')
  })
})

describe('COMMON_LOG_PATHS', () => {
  const all = COMMON_LOG_PATHS.flatMap((g) => g.paths)

  test('đều là đường dẫn tuyệt đối — dán vào lệnh tail phải chạy được ngay', () => {
    expect(all.every((p) => p.startsWith('/'))).toBe(true)
  })

  test('không trùng lặp — dropdown hiện hai dòng y hệt là lỗi gõ', () => {
    expect(new Set(all).size).toBe(all.length)
  })

  test('có CẢ hai họ distro cho cùng phần mềm (app không biết máy bên kia chạy gì)', () => {
    expect(all).toContain('/var/log/syslog') // Debian/Ubuntu
    expect(all).toContain('/var/log/messages') // RHEL/CentOS
    expect(all).toContain('/var/log/apache2/error.log')
    expect(all).toContain('/var/log/httpd/error_log')
  })

  test('không nhóm nào rỗng', () => {
    expect(COMMON_LOG_PATHS.every((g) => g.software !== '' && g.paths.length > 0)).toBe(true)
  })

  test('dùng được thẳng với tailCommand', () => {
    for (const path of all) expect(tailCommand(path)).toContain(`'${path}'`)
  })
})

describe('lineMatches', () => {
  test('query rỗng cho qua tất cả', () => {
    expect(lineMatches('bat ky', filter())).toBe(true)
  })

  test('tìm chuỗi thường, mặc định không phân biệt hoa thường', () => {
    expect(lineMatches('ERROR: oops', filter({ query: 'error' }))).toBe(true)
    expect(lineMatches('ERROR: oops', filter({ query: 'error', caseSensitive: true }))).toBe(false)
  })

  test('mẫu /…/ là regex', () => {
    expect(lineMatches('status=503', filter({ query: '/5\\d\\d/' }))).toBe(true)
    expect(lineMatches('status=200', filter({ query: '/5\\d\\d/' }))).toBe(false)
  })

  test('invert giữ những dòng KHÔNG khớp (đuổi tiếng ồn)', () => {
    expect(lineMatches('health check ok', filter({ query: 'health', invert: true }))).toBe(false)
    expect(lineMatches('ERROR: oops', filter({ query: 'health', invert: true }))).toBe(true)
  })

  test('regex gõ dở KHÔNG làm trắng panel', () => {
    // Đang gõ `/[` mà lọc sạch màn hình thì mất luôn bối cảnh vừa đọc.
    // Bẫy: nếu chỉ "không parse được → tìm chuỗi" thì app đi tìm literal "/[/" → 0 dòng khớp.
    expect(lineMatches('bat ky', filter({ query: '/[/' }))).toBe(true)
  })

  test('regex hỏng + invert vẫn hiện tất cả, không giấu sạch', () => {
    expect(lineMatches('bat ky', filter({ query: '/[/', invert: true }))).toBe(true)
  })
})

describe('highlightSegments', () => {
  test('tách đúng phần khớp', () => {
    const segs = highlightSegments('a ERROR b', filter({ query: 'ERROR' }))
    expect(segs).toEqual([
      { text: 'a ', hit: false },
      { text: 'ERROR', hit: true },
      { text: ' b', hit: false }
    ])
  })

  test('khớp nhiều lần trong một dòng', () => {
    expect(highlightSegments('x y x', filter({ query: 'x' })).filter((s) => s.hit)).toHaveLength(2)
  })

  test('ký tự đặc biệt trong query tìm theo NGHĨA ĐEN, không thành regex', () => {
    const segs = highlightSegments('gia 1.50 usd', filter({ query: '1.50' }))
    expect(segs.some((s) => s.hit && s.text === '1.50')).toBe(true)
    expect(highlightSegments('gia 1x50 usd', filter({ query: '1.50' })).some((s) => s.hit)).toBe(false)
  })

  test('không tô gì khi đang đảo — dòng còn lại vốn không chứa query', () => {
    expect(highlightSegments('abc', filter({ query: 'x', invert: true }))).toEqual([{ text: 'abc', hit: false }])
  })

  test('mẫu khớp chuỗi RỖNG không làm treo', () => {
    // matchAll với mẫu rỗng lặp vô hạn nếu không chặn
    expect(highlightSegments('abc', filter({ query: '/x*/' }))).toBeDefined()
  })

  test('không khớp gì thì trả nguyên dòng, một đoạn', () => {
    expect(highlightSegments('abc', filter({ query: 'zzz' }))).toEqual([{ text: 'abc', hit: false }])
  })
})
