import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  IDENT_RE,
  assertIdent,
  buildCreateDbSql,
  buildDropDbSql,
  deriveDbNames,
  genDbPassword,
  pingDb,
  runSql,
  sqlQuote,
  type MysqlCliDeps
} from './mysqlCli'
import type { PlatformAdapter } from './platform/PlatformAdapter'
import type { PortRange } from './ports'
import type { StrayProcess } from './types'

describe('assertIdent / IDENT_RE', () => {
  test('cho qua tên hợp lệ', () => {
    for (const ok of ['wp_site', 'a', 'A1_2', 'x'.repeat(64)]) {
      expect(() => assertIdent(ok, 'Tên')).not.toThrow()
    }
  })

  test('CHẶN mọi ký tự có thể phá cú pháp SQL — đây là hàng rào injection duy nhất', () => {
    const attacks = [
      'a`b', // đóng backtick sớm
      "a'b",
      'a"b',
      'a b',
      'a;DROP DATABASE x',
      'a\nb',
      'a\\b',
      'a-b', // gạch ngang cần quote trong MySQL
      'a.b', // qualified name → đổi được schema
      '',
      'x'.repeat(65),
      'a%b',
      '*'
    ]
    for (const bad of attacks) expect(() => assertIdent(bad, 'Tên'), bad).toThrow()
    for (const bad of attacks) expect(IDENT_RE.test(bad), bad).toBe(false)
  })

  test('thông báo lỗi nêu rõ đang nói về cái gì', () => {
    expect(() => assertIdent('a;b', 'Tên database')).toThrow(/Tên database/)
  })
})

describe('sqlQuote', () => {
  test('escape nháy đơn và backslash', () => {
    expect(sqlQuote("it's")).toBe("'it''s'")
    expect(sqlQuote('a\\b')).toBe("'a\\\\b'")
  })

  test('password kèm nháy không thoát ra khỏi literal', () => {
    // MySQL hiểu cả \' và '' — escape backslash trước rồi nháy nên không tạo ra \\' hở
    const q = sqlQuote("x' OR 1=1 -- ")
    expect(q.startsWith("'")).toBe(true)
    expect(q.endsWith("'")).toBe(true)
    expect(q.slice(1, -1)).not.toMatch(/(^|[^'])'([^']|$)/)
  })
})

describe('genDbPassword', () => {
  test('base64url — không có ký tự cần escape trong ini/URL/SQL', () => {
    for (let i = 0; i < 40; i++) expect(genDbPassword()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('đủ dài và không lặp', () => {
    const a = genDbPassword()
    expect(a.length).toBeGreaterThanOrEqual(20)
    expect(new Set(Array.from({ length: 20 }, () => genDbPassword())).size).toBe(20)
  })
})

describe('deriveDbNames', () => {
  test('luôn ra identifier hợp lệ, kể cả slug có dấu gạch ngang', () => {
    for (const slug of ['the-blogs-news', 'a', 'x'.repeat(90), 'chỉ-số', '123', '---']) {
      const { dbName, dbUser } = deriveDbNames(slug)
      expect(IDENT_RE.test(dbName), `${slug} → ${dbName}`).toBe(true)
      expect(IDENT_RE.test(dbUser), `${slug} → ${dbUser}`).toBe(true)
    }
  })

  test('dbUser ≤ 16 ký tự — giới hạn cột user của MySQL cũ, MariaDB im lặng cắt bớt', () => {
    // Bị cắt = user tạo ra khác user trong wp-config → "Access denied" rất khó truy
    for (const slug of ['x'.repeat(90), 'blog']) {
      expect(deriveDbNames(slug).dbUser.length).toBeLessThanOrEqual(16)
    }
  })

  test('dbName ≤ 64', () => {
    expect(deriveDbNames('x'.repeat(200)).dbName.length).toBeLessThanOrEqual(64)
  })

  test('slug trống/rác vẫn ra tên dùng được', () => {
    expect(deriveDbNames('').dbName).toMatch(/^wp_site_[0-9a-f]{6}$/)
    expect(deriveDbNames('###').dbName).toMatch(/^wp_site_[0-9a-f]{6}$/)
  })

  test('2 site cùng slug ra tên KHÁC nhau (hậu tố random)', () => {
    expect(deriveDbNames('blog').dbName).not.toBe(deriveDbNames('blog').dbName)
  })
})

describe('buildCreateDbSql', () => {
  const sql = buildCreateDbSql({ dbName: 'wp_blog_a1b2c3', dbUser: 'wp_a1b2c3d4', dbPassword: "p'w" })

  test('utf8mb4 + unicode_ci (WordPress mặc định, cần cho tiếng Việt/emoji)', () => {
    expect(sql).toContain('CHARACTER SET utf8mb4')
    expect(sql).toContain('COLLATE utf8mb4_unicode_ci')
  })

  test('IF NOT EXISTS → chạy lại không lỗi (provision phải idempotent)', () => {
    expect(sql).toContain('CREATE DATABASE IF NOT EXISTS')
    expect(sql).toContain('CREATE USER IF NOT EXISTS')
  })

  test('grant CHỈ trên database của site, CHỈ từ 127.0.0.1', () => {
    expect(sql).toContain('ON `wp_blog_a1b2c3`.*')
    expect(sql).not.toContain('ON *.*')
    expect(sql).toContain("'wp_a1b2c3d4'@'127.0.0.1'")
    expect(sql).not.toContain("@'%'")
  })

  test('password được escape, không cắt ra khỏi literal', () => {
    expect(sql).toContain("IDENTIFIED BY 'p''w'")
  })

  test('tên xấu bị chặn TRƯỚC khi nối chuỗi', () => {
    expect(() => buildCreateDbSql({ dbName: 'a`;DROP DATABASE mysql;--', dbUser: 'u', dbPassword: 'p' })).toThrow()
    expect(() => buildCreateDbSql({ dbName: 'ok', dbUser: "u'@'%", dbPassword: 'p' })).toThrow()
  })
})

describe('buildDropDbSql', () => {
  test('xoá cả database và user, idempotent', () => {
    const sql = buildDropDbSql({ dbName: 'wp_x', dbUser: 'wp_u' })
    expect(sql).toContain('DROP DATABASE IF EXISTS `wp_x`;')
    expect(sql).toContain("DROP USER IF EXISTS 'wp_u'@'127.0.0.1';")
  })

  test('tên xấu bị chặn — DROP là chỗ injection tai hại nhất', () => {
    expect(() => buildDropDbSql({ dbName: '*', dbUser: 'u' })).toThrow()
    expect(() => buildDropDbSql({ dbName: 'mysql`,`x', dbUser: 'u' })).toThrow()
  })
})

describe('runSql', () => {
  let dir: string
  let calls: { exe: string; args: string[] }[]
  let cnfSeen: string | null

  function fakeAdapter(code = 0): PlatformAdapter {
    return {
      platform: 'win32',
      extractArchive: async () => {},
      killTree: async () => {},
      findStrayProcesses: async (): Promise<StrayProcess[]> => [],
      reservedPortRanges: async (): Promise<PortRange[]> => [],
      runShort: async (exe, args) => {
        calls.push({ exe, args })
        const f = args[0]?.replace('--defaults-extra-file=', '')
        // Đọc file NGAY trong lúc lệnh chạy — sau khi runSql xong nó phải biến mất
        cnfSeen = f ? readFileSync(f, 'utf8') : null
        return { code, stdout: 'ok', stderr: code === 0 ? '' : 'boom' }
      },
      runWithStdinFile: () => Promise.resolve({ code: 0, stdout: '', stderr: '' })
    }
  }

  function deps(code = 0): MysqlCliDeps {
    return { adapter: fakeAdapter(code), clientExe: 'C:\\rt\\bin\\mariadb.exe', tmpDir: dir, port: 3307, user: 'root', password: 'S3cret!' }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mysqlcli-'))
    calls = []
    cnfSeen = null
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('password KHÔNG BAO GIỜ xuất hiện trên command line', async () => {
    await runSql(deps(), 'SELECT 1;')
    const args = calls[0]!.args
    expect(args.join(' ')).not.toContain('S3cret!')
    // Không có dạng -p<pass> hay --password=<pass> (soi từng arg: '--protocol' cũng chứa '-p')
    for (const a of args) {
      expect(a, a).not.toMatch(/^-p./)
      expect(a, a).not.toMatch(/^--password/)
    }
    // …mà nằm trong file .cnf tạm
    expect(cnfSeen).toContain('password = S3cret!')
  })

  test('--defaults-extra-file là tham số ĐẦU TIÊN (mariadb.exe bỏ qua nếu đứng sau)', async () => {
    await runSql(deps(), 'SELECT 1;')
    expect(calls[0]!.args[0]).toMatch(/^--defaults-extra-file=/)
  })

  test('file .cnf tạm bị XOÁ sau khi chạy', async () => {
    await runSql(deps(), 'SELECT 1;')
    expect(readdirSync(dir)).toEqual([])
  })

  test('file .cnf tạm bị xoá CẢ KHI lệnh lỗi', async () => {
    const bad: MysqlCliDeps = {
      ...deps(),
      adapter: {
        ...fakeAdapter(),
        runShort: async () => {
          throw new Error('spawn ENOENT')
        }
      }
    }
    await expect(runSql(bad, 'SELECT 1;')).rejects.toThrow(/ENOENT/)
    expect(readdirSync(dir)).toEqual([])
  })

  test('code ≠ 0 → ok=false kèm stderr, KHÔNG throw', async () => {
    const res = await runSql(deps(1), 'SELECT 1;')
    expect(res.ok).toBe(false)
    expect(res.stderr).toBe('boom')
  })

  test('database tuỳ chọn được validate và truyền như đối số vị trí', async () => {
    await runSql(deps(), 'SHOW TABLES;', { database: 'wp_x' })
    expect(calls[0]!.args).toContain('wp_x')
    await expect(runSql(deps(), 'x', { database: 'a b' })).rejects.toThrow(/database/)
  })

  test('luôn ép TCP (named pipe bị tắt trong my.ini)', async () => {
    await runSql(deps(), 'SELECT 1;')
    expect(calls[0]!.args).toContain('--protocol=tcp')
  })

  test('mỗi lần gọi dùng file .cnf tên khác nhau (2 lệnh song song không đạp nhau)', async () => {
    const d = deps()
    const seen: string[] = []
    d.adapter = {
      ...fakeAdapter(),
      runShort: async (_exe, args) => {
        seen.push(args[0]!)
        return { code: 0, stdout: '', stderr: '' }
      }
    }
    await Promise.all([runSql(d, 'SELECT 1;'), runSql(d, 'SELECT 2;')])
    expect(new Set(seen).size).toBe(2)
    expect(readdirSync(dir)).toEqual([])
  })

  test('pingDb: true khi lệnh thành công, false khi thất bại', async () => {
    expect(await pingDb(deps(0))).toBe(true)
    expect(await pingDb(deps(1))).toBe(false)
  })
})
