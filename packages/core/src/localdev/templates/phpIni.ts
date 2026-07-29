import { iniPath, toFwd } from './escape'

/**
 * Sinh php.ini cho 1 runtime PHP. Thuần → golden-string test.
 *
 * SINH TỪ ZERO, KHÔNG copy php.ini-development: copy nghĩa là phải parse/sửa file của người
 * khác, format đổi giữa các version PHP là vỡ. Ta chỉ khai đúng những gì cần.
 */

export interface PhpIniModel {
  /** Thư mục runtime PHP (ext/ và các DLL ICU nằm cạnh php-cgi.exe). */
  runtimeRoot: string
  /** Thư mục tạm RIÊNG của app (không dùng C:\Windows\Temp — dễ bị dọn/khoá quyền). */
  tmpDir: string
  /** conf.d/ cho user tự thêm .ini (xdebug…) — app không bao giờ ghi đè. */
  extConfDir: string
  errorLog: string
  timezone: string
  memoryLimit: string
  extensions: string[]
}

/** Extension mặc định đủ chạy WordPress/Laravel. */
export const DEFAULT_PHP_EXTENSIONS = [
  'mbstring',
  'openssl',
  'curl',
  'pdo_mysql',
  'mysqli',
  'fileinfo',
  'gd',
  'intl',
  'zip',
  'exif',
  'sodium'
]

export function renderPhpIni(m: PhpIniModel): string {
  const L: string[] = []
  L.push('; File này do Infra Companion SINH RA — mọi thay đổi sẽ bị ghi đè.')
  L.push(`; Thêm cấu hình riêng bằng file .ini trong ${toFwd(m.extConfDir)}`)
  L.push('')
  L.push(`extension_dir = ${iniPath(`${toFwd(m.runtimeRoot)}/ext`)}`)
  L.push('')
  L.push('; ── FastCGI (nginx + php-cgi) ────────────────────────────────────────────')
  // BẮT BUỘC = 0, nếu không php-cgi từ chối chạy sau nginx với
  // "Security Alert! The PHP CGI cannot be accessed directly"
  L.push('cgi.force_redirect = 0')
  L.push('cgi.fix_pathinfo = 1')
  L.push('fastcgi.impersonate = 1')
  L.push('')
  L.push('; ── Lỗi: hiện ĐỦ khi dev, nhưng không in ra response (tránh phá JSON/HTML) ──')
  L.push('error_reporting = E_ALL')
  L.push('display_errors = Off')
  L.push('display_startup_errors = Off')
  L.push('log_errors = On')
  L.push(`error_log = ${iniPath(m.errorLog)}`)
  L.push('')
  L.push('; ── Giới hạn thoáng cho dev ─────────────────────────────────────────────')
  L.push(`memory_limit = ${m.memoryLimit}`)
  L.push('max_execution_time = 300')
  L.push('upload_max_filesize = 128M')
  L.push('post_max_size = 128M')
  L.push('max_file_uploads = 50')
  L.push(`date.timezone = ${m.timezone}`)
  L.push('')
  L.push('; ── Thư mục tạm riêng của app ───────────────────────────────────────────')
  L.push(`upload_tmp_dir = ${iniPath(m.tmpDir)}`)
  L.push(`sys_temp_dir = ${iniPath(m.tmpDir)}`)
  L.push(`session.save_path = ${iniPath(m.tmpDir)}`)
  L.push('')
  L.push('; ── Extension ───────────────────────────────────────────────────────────')
  for (const ext of m.extensions) L.push(`extension = ${ext}`)
  L.push('')
  L.push('zend_extension = opcache')
  L.push('opcache.enable = 1')
  L.push('opcache.enable_cli = 0')
  // Dev: sửa code phải thấy ngay, không chờ hết TTL cache
  L.push('opcache.revalidate_freq = 0')
  L.push('opcache.validate_timestamps = 1')
  L.push('')
  L.push(`; User override (đọc sau cùng nên thắng mọi giá trị trên)`)
  L.push(`scan_dir = ${iniPath(m.extConfDir)}`)
  L.push('')
  return L.join('\n')
}
