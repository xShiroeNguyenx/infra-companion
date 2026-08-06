import { randomBytes } from 'node:crypto'
import type { ExecOnceResult } from '../connection/execOnce'
import { parseVerticalG } from './status'

/**
 * F55 — Hai đường lấy trạng thái replication, cùng một interface.
 *
 *  - `driver`: mysql2 nối thẳng vào MySQL (qua `startForward` nếu host nằm sau jump host).
 *              Trả về row đã đúng kiểu, không phải parse text.
 *  - `cli`   : chạy `mysql -e '…\G'` qua SSH rồi parse. Dùng khi cổng 3306 không mở, hoặc khi
 *              muốn tận dụng luôn credential có sẵn trên server (~/.my.cnf, unix_socket auth).
 *
 * QUY TẮC BẤT DI BẤT DỊCH VỀ MẬT KHẨU: không bao giờ đưa `-p<mật-khẩu>` lên command line —
 * mọi user trên máy đó đọc được qua `ps`. Mật khẩu chỉ đi qua file `.cnf` tạm mode 0600.
 * (Cùng quy tắc đã áp dụng cho MariaDB local ở `localdev/mysqlCli.ts`.)
 *
 * VÌ SAO LỆNH CLI TRÔNG "THÔ SƠ" (không `$(mktemp)`, không heredoc, không `$?`):
 * host vào bằng login-script sẽ bọc lệnh qua nhiều lớp `ssh`/`su`, mỗi lớp lột một tầng quote.
 * Ký tự `$` và heredoc sẽ nổ ở sai hop. Nên lệnh chỉ dùng `printf`, đường dẫn tuyệt đối và
 * chuỗi nháy đơn — đúng bài học đã ghi trong `MonitorService.METRIC_CMD`.
 */

export interface ReplProbe {
  readonly mode: 'driver' | 'cli'
  /** Chạy 1 câu SQL đọc trạng thái, trả mảng row. Không có row → mảng rỗng (không phải lỗi). */
  queryRows(sql: string): Promise<Record<string, unknown>[]>
  close(): void
}

// ---------------------------------------------------------------------------
// Phần THUẦN: dựng lệnh CLI
// ---------------------------------------------------------------------------

/** Bọc chuỗi vào nháy đơn POSIX. `'` bên trong được đóng-thoát-mở lại. */
export function shq(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** Đường dẫn file tạm chỉ cho phép ký tự an toàn — chặn chèn thêm lệnh vào chuỗi shell. */
const SAFE_PATH_RE = /^\/[A-Za-z0-9._/-]+$/
/** Tên/đường dẫn binary mysql client. */
const SAFE_BINARY_RE = /^[A-Za-z0-9._/-]+$/

export interface RemoteMysqlOptions {
  /** Câu lệnh SQL. Dấu `;`/`\G` ở cuối sẽ được thay bằng `\G` (luôn xuất dạng dọc). */
  sql: string
  /** Binary client trên server. MariaDB 11 đổi tên thành `mariadb` nhưng vẫn giữ symlink `mysql`. */
  binary?: string
  host?: string
  port?: number
  user?: string
  /**
   * Có mật khẩu = chế độ "app gửi credential" → BẮT BUỘC kèm `cnfPath`.
   * Không có = chế độ mặc định, dựa vào credential sẵn trên server.
   */
  password?: string
  /** Đường dẫn `.cnf` tạm trên server. Caller tự sinh ngẫu nhiên (xem `randomCnfPath`). */
  cnfPath?: string
  database?: string
  connectTimeoutSec?: number
}

/** Giá trị nhét vào file .cnf không được chứa xuống dòng — sẽ thành dòng cấu hình khác. */
function assertSingleLine(value: string, what: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`${what} không được chứa ký tự xuống dòng`)
}

/** Sinh đường dẫn .cnf tạm ngẫu nhiên trên server. Tách khỏi hàm thuần để test deterministic. */
export function randomCnfPath(dir = '/tmp'): string {
  return `${dir}/.infra-companion-repl-${randomBytes(8).toString('hex')}.cnf`
}

/**
 * Dựng lệnh shell chạy 1 câu SQL trên server từ xa và in ra dạng dọc (`\G`).
 * THUẦN — đây là chỗ dễ rò mật khẩu nhất nên phải test được.
 */
export function buildRemoteMysqlCommand(opts: RemoteMysqlOptions): string {
  const binary = opts.binary ?? 'mysql'
  if (!SAFE_BINARY_RE.test(binary)) throw new Error(`Đường dẫn mysql client không hợp lệ: ${JSON.stringify(binary)}`)

  // Luôn ép dạng dọc: cắt `;`/`\G` cuối câu rồi gắn lại `\G`
  const sql = `${opts.sql.trim().replace(/(\\G|;)\s*$/, '').trim()}\\G`
  const timeout = Math.max(1, Math.round(opts.connectTimeoutSec ?? 10))

  const commonArgs: string[] = ['--batch', '--raw', `--connect-timeout=${timeout}`]
  if (opts.database) commonArgs.push(shq(opts.database))
  const tail = [...commonArgs, '-e', shq(sql)].join(' ')

  if (opts.password === undefined) {
    // Chế độ mặc định: credential lấy từ ~/.my.cnf hoặc unix_socket auth của chính user SSH
    const args: string[] = []
    if (opts.host) args.push(`-h ${shq(opts.host)}`)
    if (opts.port) args.push(`-P ${String(Math.round(opts.port))}`)
    if (opts.user) args.push(`-u ${shq(opts.user)}`)
    return [binary, ...args, tail].filter(Boolean).join(' ')
  }

  // Chế độ gửi credential: mật khẩu chỉ nằm trong file .cnf 0600, KHÔNG lên command line
  const cnfPath = opts.cnfPath
  if (!cnfPath) throw new Error('Thiếu cnfPath — có mật khẩu thì bắt buộc ghi qua file .cnf tạm')
  if (!SAFE_PATH_RE.test(cnfPath)) throw new Error(`Đường dẫn .cnf tạm không hợp lệ: ${JSON.stringify(cnfPath)}`)
  assertSingleLine(opts.password, 'Mật khẩu')
  if (opts.user) assertSingleLine(opts.user, 'Tên user')
  if (opts.host) assertSingleLine(opts.host, 'Host')

  const lines = ['[client]']
  if (opts.user) lines.push(`user=${opts.user}`)
  lines.push(`password=${opts.password}`)
  if (opts.host) lines.push(`host=${opts.host}`)
  if (opts.port) lines.push(`port=${Math.round(opts.port)}`)

  // umask 077 TRƯỚC printf → file sinh ra đã là 0600, không có khe hở nào để user khác đọc.
  // `--defaults-extra-file` BẮT BUỘC là tham số đầu tiên, nếu không client bỏ qua.
  // Không lấy exit code (`$?` nổ qua login-script) — thành/bại nhận biết qua stdout + stderr.
  return [
    'umask 077;',
    `printf '%s\\n' ${lines.map(shq).join(' ')} > ${cnfPath};`,
    `${binary} --defaults-extra-file=${cnfPath} ${tail};`,
    `rm -f ${cnfPath}`
  ].join(' ')
}

/** Bỏ các dòng cảnh báo vô hại của mysql client để stderr còn lại đúng là lỗi thật. */
export function cleanMysqlStderr(stderr: string): string {
  return String(stderr ?? '')
    .split('\n')
    .filter((line) => {
      const text = line.trim()
      if (text === '') return false
      if (/^(mysql|mariadb):?\s*\[warning\]/i.test(text)) return false
      if (/^warning:/i.test(text)) return false
      return true
    })
    .join('\n')
    .trim()
}

/**
 * Lỗi "câu lệnh này bản MySQL đó không hiểu" → thử câu thay thế. Phân biệt với lỗi thật
 * (sai mật khẩu, thiếu quyền) vì những lỗi đó KHÔNG được nuốt.
 */
export function isUnsupportedSyntaxError(message: string): boolean {
  const text = String(message ?? '')
  if (/\b1064\b/.test(text)) return true
  return /you have an error in your sql syntax/i.test(text)
}

// ---------------------------------------------------------------------------
// Probe qua CLI
// ---------------------------------------------------------------------------

export interface CliProbeDeps {
  /** Thường là `execOnce(chain, cmd, verify, { loginSteps })` đã bind sẵn. */
  exec: (command: string) => Promise<ExecOnceResult>
  /** Tuỳ chọn dựng lệnh, trừ `sql`/`cnfPath` (probe tự điền). */
  options?: Omit<RemoteMysqlOptions, 'sql' | 'cnfPath'>
  /** Đổi được để test. Mặc định sinh ngẫu nhiên trong /tmp. */
  cnfPath?: () => string
}

export function makeCliProbe(deps: CliProbeDeps): ReplProbe {
  const makePath = deps.cnfPath ?? (() => randomCnfPath())
  return {
    mode: 'cli',
    async queryRows(sql: string) {
      const options = deps.options ?? {}
      const command = buildRemoteMysqlCommand({
        ...options,
        sql,
        cnfPath: options.password === undefined ? undefined : makePath()
      })
      const res = await deps.exec(command)
      if (res.status === 'error') throw new Error(res.error ?? 'Chạy lệnh trên server thất bại')
      const rows = parseVerticalG(res.stdout)
      if (rows.length > 0) return rows
      // Không có row: có thể là hợp lệ (server chưa làm replica) hoặc là lỗi. Phân biệt bằng stderr.
      const problem = cleanMysqlStderr(res.stderr)
      if (problem) throw new Error(problem)
      return []
    },
    close() {
      /* CLI không giữ tài nguyên gì — mỗi lần query là một exec riêng. */
    }
  }
}

// ---------------------------------------------------------------------------
// Probe qua driver mysql2
// ---------------------------------------------------------------------------

export interface DriverProbeOptions {
  host: string
  port: number
  user: string
  password: string
  database?: string
  connectTimeoutMs?: number
  /** Đóng thêm tài nguyên bên ngoài khi close() — thường là `forward.close`. */
  dispose?: () => void
}

/**
 * Mở kết nối mysql2 tới `host:port` (thường là đầu local của một `startForward`).
 * Nạp mysql2 bằng dynamic import để test thuần không phải kéo cả driver vào.
 */
export async function openDriverProbe(opts: DriverProbeOptions): Promise<ReplProbe> {
  const mysql = await import('mysql2/promise')
  const connection = await mysql.createConnection({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    database: opts.database,
    connectTimeout: opts.connectTimeoutMs ?? 10_000,
    // Vị trí binlog vượt 2^53 là không thể, nhưng để chuỗi thì toNum() xử lý an toàn tuyệt đối
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    // Chỉ đọc trạng thái — không bao giờ cần chạy nhiều câu một lượt, tắt cho chắc
    multipleStatements: false
  })
  return {
    mode: 'driver',
    async queryRows(sql: string) {
      const [rows] = await connection.query(sql)
      return Array.isArray(rows) ? (rows as unknown as Record<string, unknown>[]) : []
    },
    close() {
      void connection.destroy()
      opts.dispose?.()
    }
  }
}

/**
 * Chạy lần lượt các câu tương đương, lấy kết quả câu ĐẦU TIÊN mà server hiểu.
 * Lỗi cú pháp → thử câu sau (MySQL 8.4 đã xoá `SHOW SLAVE STATUS`). Lỗi khác (thiếu quyền,
 * mất kết nối) → ném ra ngay, KHÔNG được nuốt.
 */
export async function queryFirstSupported(
  probe: ReplProbe,
  sqls: readonly string[]
): Promise<Record<string, unknown>[]> {
  let lastError: unknown = null
  for (let i = 0; i < sqls.length; i += 1) {
    try {
      return await probe.queryRows(sqls[i])
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!isUnsupportedSyntaxError(message) || i === sqls.length - 1) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Không chạy được câu lệnh nào')
}
