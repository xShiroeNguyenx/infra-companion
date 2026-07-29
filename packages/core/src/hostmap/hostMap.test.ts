import { describe, expect, test } from 'vitest'
import {
  buildChromiumArgs,
  buildCurlResolveCommand,
  buildHostResolverRules,
  defaultUrlFor,
  isSafeHostPattern,
  isSafeHttpUrl,
  isSafeIpLiteral
} from './hostMap'

describe('isSafeHostPattern', () => {
  test('domain thường và wildcard 1 cấp đều hợp lệ', () => {
    expect(isSafeHostPattern('www.webike.pk')).toBe(true)
    expect(isSafeHostPattern('*.webike.net')).toBe(true)
    expect(isSafeHostPattern('japan.webike.net')).toBe(true)
  })

  test('CHẶN injection rule: dấu phẩy, khoảng trắng, xuống dòng', () => {
    // Đây là hàng rào chính: 'a,MAP * evil.ip' sẽ map CẢ INTERNET về IP của kẻ tấn công
    expect(isSafeHostPattern('a.com,MAP * 1.2.3.4')).toBe(false)
    expect(isSafeHostPattern('a.com MAP b.com')).toBe(false)
    expect(isSafeHostPattern('a.com\nb.com')).toBe(false)
    expect(isSafeHostPattern(' a.com')).toBe(false)
    expect(isSafeHostPattern('a.com ')).toBe(false)
  })

  test('CHẶN cờ dòng lệnh trá hình và `*` trơ trọi (map cả Internet về 1 IP)', () => {
    expect(isSafeHostPattern('--incognito')).toBe(false)
    expect(isSafeHostPattern('*')).toBe(false)
    expect(isSafeHostPattern('*.')).toBe(false)
    expect(isSafeHostPattern('')).toBe(false)
  })

  test('CHẶN dạng có cổng / có scheme (Chromium sẽ hiểu khác ý user)', () => {
    expect(isSafeHostPattern('a.com:443')).toBe(false)
    expect(isSafeHostPattern('https://a.com')).toBe(false)
  })
})

describe('isSafeIpLiteral', () => {
  test('nhận v4 và v6, từ chối domain / rỗng / có ngoặc', () => {
    expect(isSafeIpLiteral('59.106.231.202')).toBe(true)
    expect(isSafeIpLiteral('::1')).toBe(true)
    expect(isSafeIpLiteral('2001:db8::5')).toBe(true)
    expect(isSafeIpLiteral('webike.net')).toBe(false)
    expect(isSafeIpLiteral('')).toBe(false)
    expect(isSafeIpLiteral('[::1]')).toBe(false)
    expect(isSafeIpLiteral(' 1.2.3.4')).toBe(false)
  })
})

describe('buildHostResolverRules', () => {
  test('ghép nhiều domain về cùng 1 IP, phân tách bằng dấu phẩy', () => {
    expect(buildHostResolverRules(['www.webike.pk', 'vn.webike.net'], '59.106.231.202')).toBe(
      'MAP www.webike.pk 59.106.231.202,MAP vn.webike.net 59.106.231.202'
    )
  })

  test('IPv6 được bọc [] (không bọc thì Chromium hiểu `:` là dấu tách cổng)', () => {
    expect(buildHostResolverRules(['a.test'], '2001:db8::5')).toBe('MAP a.test [2001:db8::5]')
  })

  test('bỏ pattern trùng (Chromium chỉ dùng rule khớp đầu tiên)', () => {
    expect(buildHostResolverRules(['a.test', 'a.test'], '1.2.3.4')).toBe('MAP a.test 1.2.3.4')
  })

  test('throw khi pattern/IP không sạch — KHÔNG tự "làm sạch" rồi chạy tiếp', () => {
    expect(() => buildHostResolverRules(['a.com,MAP * 6.6.6.6'], '1.2.3.4')).toThrow(/không hợp lệ/)
    expect(() => buildHostResolverRules(['a.com'], 'not-an-ip')).toThrow(/IP không hợp lệ/)
    expect(() => buildHostResolverRules([], '1.2.3.4')).toThrow(/Chưa có domain/)
  })
})

describe('buildChromiumArgs', () => {
  const args = buildChromiumArgs({
    rules: 'MAP a.test 1.2.3.4',
    profileDir: 'C:\\Users\\me\\AppData\\Roaming\\@infra\\desktop\\hostmap-profiles\\g1-t1',
    url: 'https://a.test/'
  })

  test('có --host-resolver-rules và URL', () => {
    expect(args).toContain('--host-resolver-rules=MAP a.test 1.2.3.4')
    expect(args.at(-1)).toBe('https://a.test/')
  })

  test('BẮT BUỘC có --user-data-dir: thiếu nó thì browser đang mở sẽ bỏ qua cờ resolver', () => {
    expect(args.some((a) => a.startsWith('--user-data-dir='))).toBe(true)
  })

  test('không hỏi wizard/đặt browser mặc định trên profile mới', () => {
    expect(args).toContain('--no-first-run')
    expect(args).toContain('--no-default-browser-check')
  })

  test('URL không phải http/https ⇒ throw (không mở file:// hay javascript:)', () => {
    const base = { rules: 'MAP a.test 1.2.3.4', profileDir: 'C:\\tmp' }
    expect(() => buildChromiumArgs({ ...base, url: 'file:///C:/Windows/win.ini' })).toThrow(/URL không hợp lệ/)
    expect(() => buildChromiumArgs({ ...base, url: 'javascript:alert(1)' })).toThrow(/URL không hợp lệ/)
  })
})

describe('defaultUrlFor / isSafeHttpUrl', () => {
  test('suy ra https từ pattern đầu, bỏ tiền tố wildcard', () => {
    expect(defaultUrlFor(['*.webike.net', 'a.test'])).toBe('https://webike.net/')
    expect(defaultUrlFor(['www.webike.pk'])).toBe('https://www.webike.pk/')
    expect(defaultUrlFor([])).toBeNull()
  })

  test('chỉ http/https là hợp lệ', () => {
    expect(isSafeHttpUrl('http://a.test:8080/x?y=1')).toBe(true)
    expect(isSafeHttpUrl('ftp://a.test/')).toBe(false)
    expect(isSafeHttpUrl('a.test')).toBe(false)
  })
})

describe('buildCurlResolveCommand', () => {
  test('mỗi domain × mỗi cổng một --resolve, kết thúc bằng URL', () => {
    expect(buildCurlResolveCommand(['a.test'], '1.2.3.4', 'https://a.test/', [443])).toBe(
      'curl --resolve a.test:443:1.2.3.4 -I https://a.test/'
    )
  })

  test('wildcard bị rút về domain cụ thể (curl không hiểu *)', () => {
    expect(buildCurlResolveCommand(['*.webike.net'], '1.2.3.4', 'https://webike.net/', [443])).toContain(
      '--resolve webike.net:443:1.2.3.4'
    )
  })

  test('mặc định map cả 80 và 443', () => {
    const cmd = buildCurlResolveCommand(['a.test'], '1.2.3.4', 'https://a.test/')
    expect(cmd).toContain('a.test:80:1.2.3.4')
    expect(cmd).toContain('a.test:443:1.2.3.4')
  })

  test('IPv6 bọc [] để curl không hiểu nhầm dấu :', () => {
    expect(buildCurlResolveCommand(['a.test'], '2001:db8::5', 'https://a.test/', [443])).toContain(
      'a.test:443:[2001:db8::5]'
    )
  })
})
