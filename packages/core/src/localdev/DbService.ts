import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
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
import { renderClientCnf } from './templates/myIni'
import type { MariadbTarget } from './ManagedStackProvider'
import type { PlatformAdapter } from './platform/PlatformAdapter'
import type { SiteRow } from './types'

/**
 * Cấp/xoá database cho từng site. Tầng duy nhất được phép chạm dữ liệu MariaDB.
 *
 * Không nhận `MariadbTarget` trong constructor mà nhận HÀM lấy target: runtime có thể được cài
 * (hoặc đổi cổng) sau khi service này đã được tạo.
 */

export interface DbServiceDeps {
  adapter: PlatformAdapter
  /** null = chưa cài runtime MariaDB. */
  target: () => Promise<MariadbTarget | null>
  running: () => boolean
  /** Nơi ghi file .cnf tạm — trong khu vực app, không phải %TEMP% chung. */
  tmpDir: string
  /** Nơi ghi dump trước khi drop DB (thùng rác). */
  trashDir: string
}

export interface DbCredentials {
  dbName: string
  dbUser: string
  dbPass: string
  host: string
  port: number
}

export interface DbReadyResult {
  ok: boolean
  /** Lý do ở dạng đã sẵn sàng hiện cho user. */
  error?: string
}

export class DbService {
  constructor(private readonly deps: DbServiceDeps) {}

  /** Đã cài runtime MariaDB chưa (không cần đang chạy). */
  async available(): Promise<boolean> {
    return (await this.deps.target()) !== null
  }

  /**
   * Chờ MariaDB nhận kết nối bằng password root ta đang giữ; tự chữa nếu password chưa được đặt.
   *
   * VÌ SAO CẦN TỰ CHỮA: ta đặt password root qua `mariadb-install-db --password=…`. Cờ đó chỉ có
   * trên bản Windows của MariaDB và có thể bị bỏ ở bản khác — khi đó datadir được tạo với root
   * KHÔNG mật khẩu, mọi lệnh sau đều "Access denied" mà không có cách nào tự thoát. Ở đây: nếu
   * password không vào được nhưng password RỖNG lại vào được thì đặt lại password ngay.
   */
  async ensureReady(): Promise<DbReadyResult> {
    const t = await this.deps.target()
    if (!t) return { ok: false, error: 'Chưa cài runtime MariaDB' }
    if (!this.deps.running()) return { ok: false, error: 'MariaDB chưa chạy — bật service MariaDB trước' }

    const root = this.cliDeps(t, t.rootPassword)
    if (await pingDb(root)) {
      await this.secureOnce(t, root)
      return { ok: true }
    }

    // Thử password rỗng: datadir được tạo mà chưa kịp đặt password root
    const empty = this.cliDeps(t, '')
    if (await pingDb(empty)) {
      const sql = [
        // Đặt cho cả 'localhost' và '127.0.0.1': skip_name_resolve khiến kết nối qua TCP loopback
        // được nhìn thấy là '127.0.0.1', KHÔNG phải 'localhost'
        `ALTER USER 'root'@'localhost' IDENTIFIED BY ${sqlQuote(t.rootPassword)};`,
        `CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY ${sqlQuote(t.rootPassword)};`,
        `GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;`,
        'FLUSH PRIVILEGES;'
      ].join('\n')
      const res = await runSql(empty, sql)
      if (!res.ok) return { ok: false, error: `Không đặt được mật khẩu root: ${trimErr(res.stderr)}` }
      if (!(await pingDb(root))) {
        return { ok: false, error: 'Đã đặt mật khẩu root nhưng vẫn không kết nối được' }
      }
      await this.secureOnce(t, root)
      return { ok: true }
    }

    const probe = await runSql(root, 'SELECT 1;')
    return { ok: false, error: `Không kết nối được MariaDB: ${trimErr(probe.stderr) || 'không rõ lý do'}` }
  }

  /**
   * Cấp database + user cho site (idempotent theo tên đã lưu).
   *
   * Nếu site đã có `dbName` thì DÙNG LẠI tên đó và chỉ đặt lại password: đổi tên DB sẽ làm
   * `wp-config.php` đang trỏ vào DB cũ trở thành sai, và bỏ lại một DB mồ côi.
   */
  async provisionSite(site: SiteRow): Promise<{ ok: true; creds: DbCredentials } | { ok: false; error: string }> {
    const t = await this.deps.target()
    if (!t) return { ok: false, error: 'Chưa cài runtime MariaDB' }
    const ready = await this.ensureReady()
    if (!ready.ok) return { ok: false, error: ready.error ?? 'MariaDB chưa sẵn sàng' }

    // Gọi deriveDbNames ĐÚNG MỘT LẦN: mỗi lần gọi sinh hậu tố random khác nhau
    const fresh = deriveDbNames(site.slug)
    const dbName = site.dbName ?? fresh.dbName
    const dbUser = site.dbUser ?? fresh.dbUser
    // Giữ password cũ nếu có — wp-config.php trên đĩa đang dùng nó
    const dbPass = site.dbPass ?? genDbPassword()
    try {
      assertIdent(dbName, 'Tên database')
      assertIdent(dbUser, 'Tên user database')
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    const res = await runSql(this.cliDeps(t, t.rootPassword), buildCreateDbSql({ dbName, dbUser, dbPassword: dbPass }))
    if (!res.ok) return { ok: false, error: `Tạo database thất bại: ${trimErr(res.stderr)}` }
    return { ok: true, creds: { dbName, dbUser, dbPass, host: '127.0.0.1', port: t.port } }
  }

  /**
   * Xoá database + user của site. Mặc định DUMP TRƯỚC vào `trash/` — xoá site là hành động
   * không hoàn tác được, và một bản dump vài MB là cái giá quá nhỏ so với mất dữ liệu.
   */
  async dropSite(
    site: SiteRow,
    opts?: { dump?: boolean; stamp?: number }
  ): Promise<{ ok: boolean; error?: string; dumpFile?: string }> {
    if (!site.dbName || !site.dbUser) return { ok: true }
    const t = await this.deps.target()
    if (!t) return { ok: false, error: 'Chưa cài runtime MariaDB' }
    const ready = await this.ensureReady()
    if (!ready.ok) return { ok: false, error: ready.error }

    let dumpFile: string | undefined
    if (opts?.dump !== false) {
      const stamp = opts?.stamp ?? Date.now()
      const r = await this.dumpDatabase(site.dbName, join(this.deps.trashDir, `${site.slug}-${String(stamp)}.sql`))
      if (!r.ok) return { ok: false, error: `Không sao lưu được database trước khi xoá: ${r.error ?? ''}` }
      dumpFile = r.file
    }

    const res = await runSql(this.cliDeps(t, t.rootPassword), buildDropDbSql({ dbName: site.dbName, dbUser: site.dbUser }))
    if (!res.ok) return { ok: false, error: `Xoá database thất bại: ${trimErr(res.stderr)}` }
    return { ok: true, dumpFile }
  }

  /** Dump 1 database ra file .sql (dùng cho thùng rác và cho deploy ở M3). */
  async dumpDatabase(dbName: string, toFile: string): Promise<{ ok: boolean; file?: string; error?: string }> {
    const t = await this.deps.target()
    if (!t) return { ok: false, error: 'Chưa cài runtime MariaDB' }
    try {
      assertIdent(dbName, 'Tên database')
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    await mkdir(dirOf(toFile), { recursive: true })
    await mkdir(this.deps.tmpDir, { recursive: true })
    const cnf = join(this.deps.tmpDir, `dump-${String(Math.abs(hash(toFile)))}.cnf`)
    try {
      await writeFile(cnf, renderClientCnf({ port: t.port, user: 'root', password: t.rootPassword }), 'utf8')
      const res = await this.deps.adapter.runShort(
        t.dumpExe,
        [
          `--defaults-extra-file=${cnf}`,
          '--protocol=tcp',
          // Dump khôi phục được nguyên trạng: có DROP TABLE, giữ charset, gói trong 1 transaction
          '--single-transaction',
          '--default-character-set=utf8mb4',
          `--result-file=${toFile}`,
          dbName
        ],
        { cwd: t.dir, timeoutMs: 10 * 60_000 }
      )
      if (res.code !== 0) return { ok: false, error: trimErr(res.stderr) }
      return { ok: true, file: toFile }
    } finally {
      await rm(cnf, { force: true }).catch(() => {})
    }
  }

  /**
   * Nạp 1 file .sql vào database của site (dump từ XAMPP/Laragon/phpMyAdmin/prod).
   *
   * `mariadb.exe < file` chứ KHÔNG phải `-e "source <file>"`: `source` là builtin của client,
   * nó dừng giữa đường khi lỗi và đường dẫn phải nhúng vào chuỗi SQL (nháy/backslash trong
   * path Windows là mìn).
   */
  async importDump(dbName: string, fromFile: string): Promise<{ ok: boolean; error?: string }> {
    const t = await this.deps.target()
    if (!t) return { ok: false, error: 'Chưa cài runtime MariaDB' }
    const ready = await this.ensureReady()
    if (!ready.ok) return { ok: false, error: ready.error }
    try {
      assertIdent(dbName, 'Tên database')
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    await mkdir(this.deps.tmpDir, { recursive: true })
    const cnf = join(this.deps.tmpDir, `import-${String(Math.abs(hash(fromFile)))}.cnf`)
    try {
      await writeFile(cnf, renderClientCnf({ port: t.port, user: 'root', password: t.rootPassword }), 'utf8')
      const res = await this.deps.adapter.runWithStdinFile(
        t.clientExe,
        [
          `--defaults-extra-file=${cnf}`,
          '--protocol=tcp',
          '--default-character-set=utf8mb4',
          // Dừng ngay ở câu lỗi ĐẦU TIÊN: nhập nửa vời để lại DB không nhất quán mà user
          // tưởng là thành công — tệ hơn hẳn so với báo lỗi rõ ràng.
          '--abort-source-on-error',
          dbName
        ],
        fromFile,
        { cwd: t.dir, timeoutMs: 30 * 60_000 }
      )
      if (res.code !== 0) return { ok: false, error: trimErr(res.stderr) || `mã ${String(res.code)}` }
      return { ok: true }
    } finally {
      await rm(cnf, { force: true }).catch(() => {})
    }
  }

  /** Số bảng trong 1 database — để biết import xong có dữ liệu thật hay không. */
  async countTables(dbName: string): Promise<number> {
    const t = await this.deps.target()
    if (!t) return 0
    try {
      assertIdent(dbName, 'Tên database')
    } catch {
      return 0
    }
    const res = await runSql(
      this.cliDeps(t, t.rootPassword),
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ${sqlQuote(dbName)};`
    )
    if (!res.ok) return 0
    // Dòng CUỐI có nội dung = giá trị (dòng đầu là tên cột trong chế độ --batch)
    const lines = res.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const n = Number(lines[lines.length - 1] ?? '0')
    return Number.isFinite(n) ? n : 0
  }

  /** Danh sách database do người dùng tạo (bỏ schema hệ thống). */
  async listDatabases(): Promise<string[]> {
    const t = await this.deps.target()
    if (!t) return []
    const res = await runSql(this.cliDeps(t, t.rootPassword), 'SHOW DATABASES;')
    if (!res.ok) return []
    const system = new Set(['information_schema', 'performance_schema', 'mysql', 'sys', 'Database'])
    return res.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !system.has(s))
  }

  /**
   * Dọn dẹp SAU bootstrap, chạy ĐÚNG MỘT LẦN (gác bằng file marker).
   *
   * Vì sao không làm trong `bootstrap`: lúc đó server chưa lên. Vì sao phải gác 1 lần:
   * `DROP DATABASE test` là thao tác phá dữ liệu — nếu chạy mỗi lần kết nối thì một database
   * tên `test` do user tự tạo sẽ bị xoá âm thầm. Ta chỉ dọn cái mà install-db vừa tạo ra.
   */
  private async secureOnce(t: MariadbTarget, root: MysqlCliDeps): Promise<void> {
    if (await fileExists(t.securedMarkerFile)) return
    // Bản install-db nào không có `--skip-test-db` sẽ tạo `test` mà MỌI user ghi được —
    // kể cả user của site khác. Bỏ đi để grant hẹp theo site có ý nghĩa.
    await runSql(root, 'DROP DATABASE IF EXISTS test;').catch(() => undefined)
    await mkdir(dirOf(t.securedMarkerFile), { recursive: true }).catch(() => undefined)
    await writeFile(t.securedMarkerFile, 'ok\n', 'utf8').catch(() => undefined)
  }

  private cliDeps(t: MariadbTarget, password: string): MysqlCliDeps {
    return {
      adapter: this.deps.adapter,
      clientExe: t.clientExe,
      tmpDir: this.deps.tmpDir,
      port: t.port,
      user: 'root',
      password
    }
  }
}

function trimErr(s: string): string {
  return s.trim().slice(-400)
}

async function fileExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false
  )
}

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i > 0 ? p.slice(0, i) : p
}

/** Hash rẻ để tên file tạm khác nhau — KHÔNG dùng cho mục đích bảo mật. */
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
