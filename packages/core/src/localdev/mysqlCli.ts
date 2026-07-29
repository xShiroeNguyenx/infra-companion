import { randomBytes } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderClientCnf } from './templates/myIni'
import type { PlatformAdapter } from './platform/PlatformAdapter'

/**
 * Chạy SQL trên MariaDB portable qua CLI đi kèm runtime (mariadb.exe).
 *
 * Vì sao dùng CLI chứ không thêm driver JS: ta BẮT BUỘC phải có `mariadb-dump.exe` cho deploy
 * (M3), và WP-CLI `wp db import/export` cũng tự shell-out sang mysql/mysqldump. Nên CLI phải có
 * mặt bất kể chọn gì — thêm `mysql2` chỉ để CREATE DATABASE là dependency dư.
 *
 * HAI HÀNG RÀO AN TOÀN:
 *  1. Tên database/user KHÔNG parameterize được trong SQL (chúng là identifier, không phải
 *     value) → `IDENT_RE` là hàng rào DUY NHẤT chống injection. Bắt buộc kiểm trước khi nội suy.
 *  2. KHÔNG BAO GIỜ truyền `-p<password>` trên command line (hiện trong Task Manager / wmic
 *     cho mọi process đọc được) → ghi file .cnf tạm, dùng `--defaults-extra-file` (phải là
 *     tham số ĐẦU TIÊN), rồi xoá trong `finally`.
 */

/** Identifier MySQL an toàn: chỉ chữ/số/gạch dưới. Không cho backtick, dấu nháy, khoảng trắng. */
export const IDENT_RE = /^[A-Za-z0-9_]{1,64}$/

export function assertIdent(name: string, what: string): void {
  if (!IDENT_RE.test(name)) throw new Error(`${what} không hợp lệ: ${JSON.stringify(name)}`)
}

/** Escape giá trị chuỗi trong SQL (chỉ dùng cho password — không dùng cho identifier). */
export function sqlQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

/** Password random an toàn cho URL/ini: base64url không có ký tự cần escape. */
export function genDbPassword(bytes = 18): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Tên DB/user cho 1 site. Giới hạn thực tế:
 * - dbName ≤ 64 ký tự;
 * - dbUser ≤ 32 (MariaDB 10.2+; giữ 16 cho an toàn với mọi bản MySQL/MariaDB).
 * Hậu tố random tránh trùng khi 2 site có slug rút gọn giống nhau.
 */
export function deriveDbNames(slug: string): { dbName: string; dbUser: string } {
  const base = slug.replace(/[^A-Za-z0-9]/g, '_').slice(0, 40).replace(/_+$/g, '') || 'site'
  const rnd = randomBytes(3).toString('hex')
  return { dbName: `wp_${base}_${rnd}`.slice(0, 64), dbUser: `wp_${rnd}${randomBytes(2).toString('hex')}`.slice(0, 16) }
}

/** Câu SQL tạo database + user + grant. THUẦN → test được (đây là chỗ dễ sai nhất về injection). */
export function buildCreateDbSql(input: { dbName: string; dbUser: string; dbPassword: string }): string {
  assertIdent(input.dbName, 'Tên database')
  assertIdent(input.dbUser, 'Tên user database')
  return [
    `CREATE DATABASE IF NOT EXISTS \`${input.dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `CREATE USER IF NOT EXISTS '${input.dbUser}'@'127.0.0.1' IDENTIFIED BY ${sqlQuote(input.dbPassword)};`,
    `GRANT ALL PRIVILEGES ON \`${input.dbName}\`.* TO '${input.dbUser}'@'127.0.0.1';`,
    'FLUSH PRIVILEGES;'
  ].join('\n')
}

/** Câu SQL xoá database + user của 1 site. */
export function buildDropDbSql(input: { dbName: string; dbUser: string }): string {
  assertIdent(input.dbName, 'Tên database')
  assertIdent(input.dbUser, 'Tên user database')
  return [
    `DROP DATABASE IF EXISTS \`${input.dbName}\`;`,
    `DROP USER IF EXISTS '${input.dbUser}'@'127.0.0.1';`,
    'FLUSH PRIVILEGES;'
  ].join('\n')
}

export interface MysqlCliDeps {
  adapter: PlatformAdapter
  /** mariadb.exe (client) đã resolve từ runtime. */
  clientExe: string
  /** Thư mục ghi file .cnf tạm — phải nằm trong khu vực app. */
  tmpDir: string
  port: number
  user: string
  password: string
}

export interface SqlResult {
  ok: boolean
  stdout: string
  stderr: string
}

/**
 * Chạy 1 hoặc nhiều câu SQL. Password đi qua file .cnf tạm, KHÔNG qua command line.
 * File tạm luôn được xoá trong `finally`, kể cả khi lệnh lỗi.
 */
export async function runSql(deps: MysqlCliDeps, sql: string, opts?: { database?: string }): Promise<SqlResult> {
  if (opts?.database) assertIdent(opts.database, 'Tên database')
  await mkdir(deps.tmpDir, { recursive: true })
  const cnf = join(deps.tmpDir, `cli-${randomBytes(8).toString('hex')}.cnf`)
  try {
    await writeFile(cnf, renderClientCnf({ port: deps.port, user: deps.user, password: deps.password }), 'utf8')
    const args = [
      // --defaults-extra-file BẮT BUỘC là tham số đầu tiên, nếu không mariadb.exe bỏ qua
      `--defaults-extra-file=${cnf}`,
      '--protocol=tcp',
      '--batch',
      '--raw',
      ...(opts?.database ? [opts.database] : []),
      '-e',
      sql
    ]
    const res = await deps.adapter.runShort(deps.clientExe, args, { timeoutMs: 60_000 })
    return { ok: res.code === 0, stdout: res.stdout, stderr: res.stderr }
  } finally {
    await rm(cnf, { force: true }).catch(() => {})
  }
}

/** MariaDB đã sẵn sàng nhận kết nối chưa (dùng để chờ sau khi start). */
export async function pingDb(deps: MysqlCliDeps): Promise<boolean> {
  const res = await runSql(deps, 'SELECT 1;')
  return res.ok
}
