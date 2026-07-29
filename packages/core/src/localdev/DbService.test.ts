import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DbService, type DbServiceDeps } from './DbService'
import type { MariadbTarget } from './ManagedStackProvider'
import type { PlatformAdapter } from './platform/PlatformAdapter'
import type { PortRange } from './ports'
import type { SiteRow, StrayProcess } from './types'

const ROOT_PW = 'root-secret'

function site(over: Partial<SiteRow> = {}): SiteRow {
  return {
    id: 's1',
    name: 'The Blogs',
    slug: 'the-blogs',
    domain: 'the-blogs.localhost',
    rootPath: 'C:\\www\\blog',
    docRoot: 'C:\\www\\blog',
    phpVersion: 'php-8.3',
    httpPort: 8080,
    https: false,
    kind: 'wordpress',
    status: 'ready',
    createdByApp: false,
    lastError: null,
    dbName: null,
    dbUser: null,
    dbPass: null,
    createdAt: 0,
    updatedAt: 0,
    ...over
  }
}

interface Call {
  exe: string
  args: string[]
  /** Password đọc từ file .cnf tại thời điểm lệnh chạy. */
  cnfPassword: string | null
  sql: string | null
  /** File nối vào stdin (chỉ có ở lệnh import). */
  stdinFile?: string
}

describe('DbService', () => {
  let dir: string
  let calls: Call[]
  /** Hàm quyết định kết quả cho từng lệnh — mỗi test tự cài đặt. */
  let respond: (c: Call) => { code: number; stdout?: string; stderr?: string }
  let running = true
  let target: MariadbTarget | null

  /** Ghi lại 1 lệnh + đọc password từ file .cnf NGAY LÚC lệnh chạy (sau đó nó bị xoá). */
  function record(exe: string, args: string[], stdinFile?: string): Call {
    const cnfArg = args.find((a) => a.startsWith('--defaults-extra-file='))
    const cnfPath = cnfArg?.slice('--defaults-extra-file='.length)
    const text = cnfPath && existsSync(cnfPath) ? readFileSync(cnfPath, 'utf8') : ''
    const pw = /^\s*password\s*=\s*(.*)$/m.exec(text)?.[1]?.trim() ?? null
    const eIdx = args.indexOf('-e')
    const call: Call = {
      exe,
      args,
      cnfPassword: pw,
      sql: eIdx >= 0 ? (args[eIdx + 1] ?? null) : null,
      ...(stdinFile !== undefined ? { stdinFile } : {})
    }
    calls.push(call)
    return call
  }

  function adapter(): PlatformAdapter {
    return {
      platform: 'win32',
      extractArchive: async () => {},
      killTree: async () => {},
      findStrayProcesses: async (): Promise<StrayProcess[]> => [],
      reservedPortRanges: async (): Promise<PortRange[]> => [],
      runShort: async (exe, args) => {
        const r = respond(record(exe, args))
        return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
      },
      runWithStdinFile: async (exe, args, stdinFile) => {
        const r = respond(record(exe, args, stdinFile))
        return { code: r.code, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
      }
    }
  }

  function svc(): DbService {
    const deps: DbServiceDeps = {
      adapter: adapter(),
      target: async () => target,
      running: () => running,
      tmpDir: join(dir, 'tmp'),
      trashDir: join(dir, 'trash')
    }
    return new DbService(deps)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dbsvc-'))
    calls = []
    running = true
    respond = () => ({ code: 0 })
    target = {
      runtimeId: 'mariadb-11.4',
      dir: 'C:\\rt\\mariadb-11.4',
      port: 3307,
      serverExe: 'C:\\rt\\mariadb-11.4\\bin\\mariadbd.exe',
      clientExe: 'C:\\rt\\mariadb-11.4\\bin\\mariadb.exe',
      adminExe: 'C:\\rt\\mariadb-11.4\\bin\\mariadb-admin.exe',
      dumpExe: 'C:\\rt\\mariadb-11.4\\bin\\mariadb-dump.exe',
      dataDir: 'D:\\localdev\\data\\mariadb',
      confFile: 'D:\\localdev\\conf\\mariadb\\my.ini',
      rootCnfFile: 'D:\\localdev\\conf\\mariadb\\root.cnf',
      rootPassword: ROOT_PW,
      securedMarkerFile: join(dir, 'conf', '.secured')
    }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  // ── available / ensureReady ────────────────────────────────────────────────

  test('chưa cài runtime → available false, mọi thao tác trả lỗi rõ ràng', async () => {
    target = null
    const s = svc()
    expect(await s.available()).toBe(false)
    expect((await s.ensureReady()).error).toMatch(/Chưa cài runtime MariaDB/)
    expect((await s.provisionSite(site())).ok).toBe(false)
    expect(calls).toEqual([])
  })

  test('service chưa chạy → nói đúng việc cần làm, KHÔNG gọi CLI', async () => {
    running = false
    const res = await svc().ensureReady()
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/chưa chạy/)
    expect(calls).toEqual([])
  })

  test('ping bằng password root thành công → ready ngay, không đặt lại password', async () => {
    const res = await svc().ensureReady()
    expect(res.ok).toBe(true)
    expect(calls[0]!.cnfPassword).toBe(ROOT_PW)
    expect(calls[0]!.sql).toBe('SELECT 1;')
    expect(calls.some((c) => c.sql?.includes('ALTER USER'))).toBe(false)
  })

  // Bản install-db không có `--skip-test-db` sẽ tạo database `test` mà MỌI user ghi được —
  // kể cả user của site khác ⇒ grant hẹp theo site thành vô nghĩa.
  test('lần đầu ready: bỏ database `test` mặc định rồi ghi marker', async () => {
    const s = svc()
    await s.ensureReady()
    expect(calls.some((c) => c.sql === 'DROP DATABASE IF EXISTS test;')).toBe(true)
    expect(existsSync(join(dir, 'conf', '.secured'))).toBe(true)
  })

  // DROP DATABASE là thao tác phá dữ liệu: nếu chạy mỗi lần kết nối thì một DB tên `test` do
  // chính user tạo về sau sẽ bị xoá âm thầm.
  test('đã có marker ⇒ KHÔNG drop `test` nữa', async () => {
    await svc().ensureReady()
    calls = []
    await svc().ensureReady()
    expect(calls.some((c) => c.sql?.includes('DROP DATABASE'))).toBe(false)
  })

  test('TỰ CHỮA: root chưa có password → đặt password rồi ready', async () => {
    // Mô phỏng bản install-db KHÔNG nhận --password ⇒ datadir tạo ra với root rỗng.
    // Sau khi ALTER USER thì password mới có tác dụng và password rỗng hết vào được.
    let passwordSet = false
    respond = (c) => {
      if (c.sql?.includes('ALTER USER')) {
        passwordSet = true
        return { code: 0 }
      }
      const usingEmpty = c.cnfPassword === ''
      const shouldPass = passwordSet ? !usingEmpty : usingEmpty
      return shouldPass ? { code: 0 } : { code: 1, stderr: 'Access denied' }
    }
    const res = await svc().ensureReady()
    expect(res.ok).toBe(true)
    const alter = calls.find((c) => c.sql?.includes('ALTER USER'))!
    expect(alter.sql).toContain("ALTER USER 'root'@'localhost' IDENTIFIED BY 'root-secret'")
    // skip_name_resolve ⇒ kết nối loopback hiện ra là 127.0.0.1, phải grant cả host đó
    expect(alter.sql).toContain("CREATE USER IF NOT EXISTS 'root'@'127.0.0.1'")
    expect(alter.sql).toContain('FLUSH PRIVILEGES;')
  })

  test('không vào được bằng cả password lẫn rỗng → báo lỗi kèm stderr thật', async () => {
    respond = () => ({ code: 1, stderr: "Can't connect to server on '127.0.0.1'" })
    const res = await svc().ensureReady()
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/Can't connect/)
  })

  // ── provisionSite ──────────────────────────────────────────────────────────

  test('cấp DB mới: tên hợp lệ, grant hẹp, trả về đủ thông tin kết nối', async () => {
    const res = await svc().provisionSite(site())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.creds.dbName).toMatch(/^wp_the_blogs_[0-9a-f]{6}$/)
    expect(res.creds.host).toBe('127.0.0.1')
    expect(res.creds.port).toBe(3307)
    expect(res.creds.dbPass.length).toBeGreaterThanOrEqual(20)

    const create = calls.find((c) => c.sql?.includes('CREATE DATABASE'))!
    expect(create.sql).toContain(`GRANT ALL PRIVILEGES ON \`${res.creds.dbName}\`.*`)
    expect(create.sql).not.toContain('ON *.*')
    // Chạy bằng root
    expect(create.cnfPassword).toBe(ROOT_PW)
  })

  test('site ĐÃ có DB → dùng lại đúng tên và password cũ (wp-config.php đang trỏ vào đó)', async () => {
    const existing = site({ dbName: 'wp_old_aaaaaa', dbUser: 'wp_olduser', dbPass: 'keepme' })
    const res = await svc().provisionSite(existing)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.creds).toMatchObject({ dbName: 'wp_old_aaaaaa', dbUser: 'wp_olduser', dbPass: 'keepme' })
  })

  test('gọi 2 lần cho cùng site đã có DB → cùng credential (idempotent)', async () => {
    const existing = site({ dbName: 'wp_x_aaaaaa', dbUser: 'wp_xuser', dbPass: 'p1' })
    const a = await svc().provisionSite(existing)
    const b = await svc().provisionSite(existing)
    expect(a.ok && b.ok && a.creds).toEqual(b.ok ? b.creds : null)
  })

  test('tên DB trong DB bị hỏng (dữ liệu cũ/sửa tay) → TỪ CHỐI, không nối vào SQL', async () => {
    const bad = site({ dbName: 'wp_x`; DROP DATABASE mysql; --', dbUser: 'u' })
    const res = await svc().provisionSite(bad)
    expect(res.ok).toBe(false)
    expect(calls.some((c) => c.sql?.includes('DROP DATABASE mysql'))).toBe(false)
  })

  test('CREATE lỗi → trả stderr, không im lặng coi là thành công', async () => {
    respond = (c) => (c.sql?.includes('CREATE DATABASE') ? { code: 1, stderr: 'Access denied for user' } : { code: 0 })
    const res = await svc().provisionSite(site())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/Access denied/)
  })

  test('không cấp DB khi MariaDB chưa sẵn sàng', async () => {
    running = false
    const res = await svc().provisionSite(site())
    expect(res.ok).toBe(false)
    expect(calls.some((c) => c.sql?.includes('CREATE DATABASE'))).toBe(false)
  })

  // ── dropSite ───────────────────────────────────────────────────────────────

  test('site không có DB → drop là no-op thành công', async () => {
    expect(await svc().dropSite(site())).toEqual({ ok: true })
    expect(calls).toEqual([])
  })

  test('DUMP TRƯỚC rồi mới drop — thứ tự này là thứ chống mất dữ liệu', async () => {
    const s = site({ dbName: 'wp_x', dbUser: 'wp_u' })
    const res = await svc().dropSite(s, { stamp: 111 })
    expect(res.ok).toBe(true)
    const dumpIdx = calls.findIndex((c) => c.exe.includes('mariadb-dump'))
    const dropIdx = calls.findIndex((c) => c.sql?.includes('DROP DATABASE IF EXISTS `wp_x`'))
    expect(dumpIdx).toBeGreaterThanOrEqual(0)
    expect(dropIdx).toBeGreaterThan(dumpIdx)
    // Tên file theo SLUG site + mốc thời gian, không theo tên DB
    expect(res.dumpFile).toBe(join(dir, 'trash', 'the-blogs-111.sql'))
  })

  test('dump thất bại → KHÔNG drop (thà giữ DB rác hơn mất dữ liệu)', async () => {
    respond = (c) => (c.exe.includes('mariadb-dump') ? { code: 2, stderr: 'no space left' } : { code: 0 })
    const res = await svc().dropSite(site({ dbName: 'wp_x', dbUser: 'wp_u' }))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/sao lưu/)
    expect(calls.some((c) => c.sql?.includes('DROP DATABASE IF EXISTS `wp_x`'))).toBe(false)
  })

  test('dump:false bỏ qua sao lưu (dùng khi caller đã tự dump)', async () => {
    await svc().dropSite(site({ dbName: 'wp_x', dbUser: 'wp_u' }), { dump: false })
    expect(calls.some((c) => c.exe.includes('mariadb-dump'))).toBe(false)
    expect(calls.some((c) => c.sql?.includes('DROP DATABASE IF EXISTS `wp_x`'))).toBe(true)
  })

  test('drop xoá CẢ user, không để lại user mồ côi', async () => {
    await svc().dropSite(site({ dbName: 'wp_x', dbUser: 'wp_u' }), { dump: false })
    const drop = calls.find((c) => c.sql?.includes('DROP DATABASE IF EXISTS `wp_x`'))!
    expect(drop.sql).toContain("DROP USER IF EXISTS 'wp_u'@'127.0.0.1'")
  })

  // ── dumpDatabase ───────────────────────────────────────────────────────────

  test('dump: dùng --single-transaction + utf8mb4 + result-file, password qua .cnf', async () => {
    const out = join(dir, 'out', 'x.sql')
    const res = await svc().dumpDatabase('wp_x', out)
    expect(res.ok).toBe(true)
    const c = calls[0]!
    expect(c.exe).toContain('mariadb-dump')
    expect(c.args[0]).toMatch(/^--defaults-extra-file=/)
    expect(c.args).toContain('--single-transaction')
    expect(c.args).toContain('--default-character-set=utf8mb4')
    expect(c.args).toContain(`--result-file=${out}`)
    expect(c.args).toContain('wp_x')
    expect(c.cnfPassword).toBe(ROOT_PW)
    for (const a of c.args) expect(a).not.toContain(ROOT_PW)
  })

  test('dump: file .cnf tạm bị xoá sau khi chạy', async () => {
    await svc().dumpDatabase('wp_x', join(dir, 'out', 'x.sql'))
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
  })

  test('dump: tên DB xấu bị chặn trước khi spawn', async () => {
    const res = await svc().dumpDatabase('wp x; rm -rf', join(dir, 'x.sql'))
    expect(res.ok).toBe(false)
    expect(calls).toEqual([])
  })

  // ── importDump ─────────────────────────────────────────────────────────────

  test('import: nối stdin vào file, KHÔNG nhúng path vào chuỗi SQL', async () => {
    const f = join(dir, 'dump.sql')
    const res = await svc().importDump('wp_x', f)
    expect(res.ok).toBe(true)
    const call = calls.find((c) => c.stdinFile !== undefined)!
    expect(call.stdinFile).toBe(f)
    expect(call.args).toContain('wp_x')
    // Không dùng `-e "source <path>"` (đường dẫn Windows có backslash/nháy là mìn)
    expect(call.sql).toBeNull()
    expect(call.args).not.toContain('-e')
    expect(call.args.some((a) => a.includes('.sql'))).toBe(false)
  })

  test('import: dừng ở câu lỗi ĐẦU TIÊN — nhập nửa vời tệ hơn báo lỗi', async () => {
    await svc().importDump('wp_x', join(dir, 'd.sql'))
    const call = calls.find((c) => c.stdinFile !== undefined)!
    expect(call.args).toContain('--abort-source-on-error')
    expect(call.args).toContain('--default-character-set=utf8mb4')
  })

  test('import: password qua .cnf, file .cnf bị xoá sau khi chạy', async () => {
    await svc().importDump('wp_x', join(dir, 'd.sql'))
    const call = calls.find((c) => c.stdinFile !== undefined)!
    expect(call.args[0]).toMatch(/^--defaults-extra-file=/)
    expect(call.cnfPassword).toBe(ROOT_PW)
    for (const a of call.args) expect(a).not.toContain(ROOT_PW)
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
  })

  test('import: lỗi → trả stderr, KHÔNG báo thành công', async () => {
    respond = (c) => (c.stdinFile !== undefined ? { code: 1, stderr: 'ERROR 1064 at line 42' } : { code: 0 })
    const res = await svc().importDump('wp_x', join(dir, 'd.sql'))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/ERROR 1064/)
  })

  test('import: tên DB xấu bị chặn trước khi spawn', async () => {
    const res = await svc().importDump('wp x; drop', join(dir, 'd.sql'))
    expect(res.ok).toBe(false)
    expect(calls.some((c) => c.stdinFile !== undefined)).toBe(false)
  })

  test('import: MariaDB chưa chạy ⇒ không nhập', async () => {
    running = false
    const res = await svc().importDump('wp_x', join(dir, 'd.sql'))
    expect(res.ok).toBe(false)
    expect(calls.some((c) => c.stdinFile !== undefined)).toBe(false)
  })

  // ── countTables ────────────────────────────────────────────────────────────

  test('countTables đọc số từ dòng cuối (dòng đầu là tên cột ở chế độ --batch)', async () => {
    respond = () => ({ code: 0, stdout: 'COUNT(*)\n37\n' })
    expect(await svc().countTables('wp_x')).toBe(37)
  })

  test('countTables: DB rỗng ⇒ 0 (UI dùng số này để gợi ý nhập dump)', async () => {
    respond = () => ({ code: 0, stdout: 'COUNT(*)\n0\n' })
    expect(await svc().countTables('wp_x')).toBe(0)
  })

  test('countTables: lỗi hoặc tên xấu ⇒ 0, không throw', async () => {
    respond = () => ({ code: 1, stderr: 'nope' })
    expect(await svc().countTables('wp_x')).toBe(0)
    expect(await svc().countTables('bad name')).toBe(0)
  })

  // ── listDatabases ──────────────────────────────────────────────────────────

  test('listDatabases bỏ schema hệ thống và dòng tiêu đề', async () => {
    respond = () => ({ code: 0, stdout: 'Database\ninformation_schema\nmysql\nperformance_schema\nsys\nwp_blog\nwp_shop\n' })
    expect(await svc().listDatabases()).toEqual(['wp_blog', 'wp_shop'])
  })

  test('listDatabases lỗi → mảng rỗng, không throw', async () => {
    respond = () => ({ code: 1, stderr: 'nope' })
    expect(await svc().listDatabases()).toEqual([])
  })
})
