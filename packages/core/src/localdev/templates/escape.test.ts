import { describe, expect, test } from 'vitest'
import { assertSafeDomain, iniPath, isSafeDomain, isSafePort, nginxPath, toFwd } from './escape'

describe('toFwd', () => {
  test('đổi mọi backslash thành forward slash', () => {
    expect(toFwd('D:\\a\\b\\c')).toBe('D:/a/b/c')
    expect(toFwd('D:/a/b')).toBe('D:/a/b')
    expect(toFwd('\\\\server\\share')).toBe('//server/share')
  })
})

describe('nginxPath', () => {
  test('luôn quote + forward slash', () => {
    expect(nginxPath('D:\\infra\\conf')).toBe('"D:/infra/conf"')
  })

  test('path có dấu cách vẫn an toàn nhờ quote', () => {
    expect(nginxPath('C:\\Program Files\\Infra Companion\\x')).toBe('"C:/Program Files/Infra Companion/x"')
  })

  test('path có ký tự tiếng Việt giữ nguyên', () => {
    expect(nginxPath('D:\\Tài liệu\\web')).toBe('"D:/Tài liệu/web"')
  })

  test('KHÔNG để lại backslash — nginx coi \\ là ký tự escape', () => {
    // 'C:\app\new' mà không đổi thì nginx đọc \n thành newline
    expect(nginxPath('C:\\app\\new')).not.toContain('\\a')
    expect(nginxPath('C:\\app\\new')).toBe('"C:/app/new"')
  })

  test('escape dấu ngoặc kép trong path', () => {
    expect(nginxPath('D:/a"b')).toBe('"D:/a\\"b"')
  })
})

describe('iniPath', () => {
  test('quote + forward slash cho php.ini/my.ini', () => {
    expect(iniPath('D:\\infra\\ext')).toBe('"D:/infra/ext"')
    expect(iniPath('C:\\Program Files\\x')).toBe('"C:/Program Files/x"')
  })
})

describe('isSafeDomain', () => {
  test('domain hợp lệ', () => {
    for (const d of ['myshop.localhost', 'demo.test', 'a.b.c.test', 'x1-y2.localhost', 'localhost']) {
      expect(isSafeDomain(d), d).toBe(true)
    }
  })

  test('loại domain sai định dạng', () => {
    for (const d of ['', '.test', 'test.', 'MyShop.test', 'a..b', '-a.test', 'a-.test', 'a_b.test']) {
      expect(isSafeDomain(d), d).toBe(false)
    }
  })

  test('CHẶN injection qua newline (nếu lọt vào hosts file sẽ tạo dòng map IP mới)', () => {
    expect(isSafeDomain('a.test\n127.0.0.1 evil.com')).toBe(false)
    expect(isSafeDomain('a.test\r\n127.0.0.1 evil.com')).toBe(false)
    expect(isSafeDomain('a.test evil.com')).toBe(false)
    expect(isSafeDomain('a.test\t evil')).toBe(false)
  })

  test('chặn ký tự điều khiển + ký tự phá PowerShell/nginx', () => {
    for (const d of ['a\u0000.test', "a'.test", 'a".test', 'a;b.test', 'a$b.test', 'a`b.test', 'a|b.test']) {
      expect(isSafeDomain(d), JSON.stringify(d)).toBe(false)
    }
  })

  test('chặn label > 63 ký tự và domain > 253', () => {
    expect(isSafeDomain(`${'a'.repeat(64)}.test`)).toBe(false)
    expect(isSafeDomain(`${'a'.repeat(63)}.test`)).toBe(true)
    const long = Array.from({ length: 40 }, () => 'abcdef').join('.')
    expect(long.length).toBeGreaterThan(253)
    expect(isSafeDomain(long)).toBe(false)
  })

  test('assertSafeDomain throw với domain xấu', () => {
    expect(() => assertSafeDomain('a.test\nevil')).toThrow()
    expect(() => assertSafeDomain('ok.localhost')).not.toThrow()
  })
})

describe('isSafePort', () => {
  test('biên', () => {
    expect(isSafePort(1)).toBe(true)
    expect(isSafePort(65_535)).toBe(true)
    expect(isSafePort(0)).toBe(false)
    expect(isSafePort(65_536)).toBe(false)
    expect(isSafePort(8080.5)).toBe(false)
    expect(isSafePort(Number.NaN)).toBe(false)
  })
})
