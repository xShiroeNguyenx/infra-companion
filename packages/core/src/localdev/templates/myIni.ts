import { iniPath, toFwd } from './escape'

/**
 * Sinh my.ini cho MariaDB portable. Thuần → golden-string test.
 *
 * ⚠️ ĐIỂM SỐNG CÒN: mysqld PHẢI được chạy với `--defaults-file=<file này>`.
 * `--defaults-file` (khác `--defaults-extra-file`) khiến mysqld đọc DUY NHẤT file đó và BỎ QUA
 * mọi my.ini ở `C:\`, `%WINDIR%`, `%PROGRAMDATA%` và trong datadir. Máy user rất hay đã có
 * XAMPP/Laragon với my.ini toàn cục — không có cờ này thì cấu hình lẫn nhau, lỗi cực khó truy.
 */

export interface MyIniModel {
  /** Thư mục runtime MariaDB (chứa bin/, share/). */
  basedir: string
  /** Nơi chứa dữ liệu — TUYỆT ĐỐI không nằm trong basedir (gỡ runtime là mất sạch DB). */
  datadir: string
  tmpdir: string
  logError: string
  port: number
  /** Buffer pool: local dev không cần lớn; 256M đủ cho WordPress/Laravel. */
  innodbBufferPool?: string
}

export function renderMyIni(m: MyIniModel): string {
  if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65_535) {
    throw new Error(`Cổng MariaDB không hợp lệ: ${String(m.port)}`)
  }
  const L: string[] = []
  L.push('# File này do Infra Companion SINH RA — mọi thay đổi sẽ bị ghi đè.')
  L.push('# mysqld được chạy với --defaults-file nên file này là cấu hình DUY NHẤT có hiệu lực.')
  L.push('')
  L.push('[mysqld]')
  L.push(`basedir = ${iniPath(m.basedir)}`)
  L.push(`datadir = ${iniPath(m.datadir)}`)
  L.push(`tmpdir = ${iniPath(m.tmpdir)}`)
  L.push(`log_error = ${iniPath(m.logError)}`)
  L.push(`port = ${String(m.port)}`)
  L.push('')
  L.push('# Chỉ nghe loopback — DB local dev không được phơi ra mạng LAN')
  L.push('bind_address = 127.0.0.1')
  L.push('# Bỏ tra DNS ngược cho mỗi kết nối (nhanh hơn, và grant theo IP mới đúng)')
  L.push('skip_name_resolve = 1')
  L.push('# Không mở cổng cho named pipe / shared memory: mọi thứ đi qua TCP loopback cho đơn giản')
  L.push('skip_named_pipe = 1')
  L.push('')
  L.push('character_set_server = utf8mb4')
  L.push('collation_server = utf8mb4_general_ci')
  L.push('')
  L.push(`innodb_buffer_pool_size = ${m.innodbBufferPool ?? '256M'}`)
  // Trên Windows, 'normal' tránh vấn đề O_DIRECT không được hỗ trợ đầy đủ
  L.push('innodb_flush_method = normal')
  L.push('innodb_file_per_table = 1')
  L.push('')
  L.push('# WordPress/Laravel hay import dump lớn')
  L.push('max_allowed_packet = 256M')
  L.push('max_connections = 100')
  L.push('# Dev: nới sql_mode để dump/plugin cũ không vỡ vì STRICT (giống mặc định của XAMPP)')
  L.push("sql_mode = NO_ENGINE_SUBSTITUTION")
  L.push('')
  L.push('[client]')
  L.push('port = ' + String(m.port))
  L.push('host = 127.0.0.1')
  L.push('protocol = tcp')
  L.push('default_character_set = utf8mb4')
  L.push('')
  return L.join('\n')
}

/**
 * File credential TẠM cho CLI (mariadb.exe / mariadb-dump.exe).
 *
 * Vì sao cần: KHÔNG BAO GIỜ truyền `-p<password>` trên command line — nó hiện trong Task
 * Manager / `wmic process get commandline` cho mọi process trên máy đọc được.
 * `--defaults-extra-file=<file>` phải là tham số ĐẦU TIÊN của lệnh, và file phải được xoá
 * ngay sau khi dùng (finally).
 */
export function renderClientCnf(m: { port: number; user: string; password: string }): string {
  return ['[client]', 'host = 127.0.0.1', 'protocol = tcp', `port = ${String(m.port)}`, `user = ${m.user}`, `password = ${m.password}`, ''].join(
    '\n'
  )
}

/** Đường dẫn binary trong runtime MariaDB — tên đổi theo version nên phải probe. */
export const MARIADB_BIN_CANDIDATES = {
  /** Server. */
  server: ['bin/mariadbd.exe', 'bin/mysqld.exe'],
  /** Client CLI. MariaDB ≥11 đặt tên mariadb.exe; mysql.exe chỉ là alias và đã bị bỏ ở bản mới. */
  client: ['bin/mariadb.exe', 'bin/mysql.exe'],
  /** Dump (cho deploy ở M3). */
  dump: ['bin/mariadb-dump.exe', 'bin/mysqldump.exe'],
  /** Admin (dùng để shutdown ĐÀNG HOÀNG — cách sạch duy nhất). */
  admin: ['bin/mariadb-admin.exe', 'bin/mysqladmin.exe'],
  /** Khởi tạo datadir lần đầu. */
  installDb: ['bin/mariadb-install-db.exe', 'bin/mysql_install_db.exe']
} as const

/** Trả `toFwd` của path — dùng khi cần nhúng vào chuỗi không qua ini/nginx. */
export function fwd(p: string): string {
  return toFwd(p)
}
