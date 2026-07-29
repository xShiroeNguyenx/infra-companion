import { describe, expect, test } from 'vitest'
import { DEFAULT_PHP_EXTENSIONS, renderPhpIni, type PhpIniModel } from './phpIni'

const M: PhpIniModel = {
  runtimeRoot: 'D:\\infra\\runtimes\\php-8.3',
  tmpDir: 'D:\\infra\\localdev\\tmp\\php-8.3',
  extConfDir: 'D:\\infra\\localdev\\conf\\php\\php-8.3\\conf.d',
  errorLog: 'D:\\infra\\localdev\\logs\\php-8.3-error.log',
  timezone: 'Asia/Ho_Chi_Minh',
  memoryLimit: '512M',
  extensions: DEFAULT_PHP_EXTENSIONS
}

describe('renderPhpIni', () => {
  const out = renderPhpIni(M)

  test('cgi.force_redirect = 0 — BẮT BUỘC, thiếu là php-cgi từ chối chạy sau nginx', () => {
    expect(out).toContain('cgi.force_redirect = 0')
  })

  test('extension_dir trỏ đúng ext/ của runtime, forward slash + quote', () => {
    expect(out).toContain('extension_dir = "D:/infra/runtimes/php-8.3/ext"')
  })

  test('không in lỗi ra response nhưng vẫn log đủ (tránh phá JSON/HTML khi dev)', () => {
    expect(out).toContain('error_reporting = E_ALL')
    expect(out).toContain('display_errors = Off')
    expect(out).toContain('log_errors = On')
    expect(out).toContain('error_log = "D:/infra/localdev/logs/php-8.3-error.log"')
  })

  test('dùng thư mục tạm RIÊNG của app, không phải C:\\Windows\\Temp', () => {
    for (const key of ['upload_tmp_dir', 'sys_temp_dir', 'session.save_path']) {
      expect(out, key).toContain(`${key} = "D:/infra/localdev/tmp/php-8.3"`)
    }
  })

  test('opcache bật nhưng revalidate ngay — sửa code phải thấy liền khi dev', () => {
    expect(out).toContain('opcache.enable = 1')
    expect(out).toContain('opcache.revalidate_freq = 0')
    expect(out).toContain('opcache.validate_timestamps = 1')
  })

  test('nạp đủ extension cho WordPress/Laravel', () => {
    for (const ext of ['mbstring', 'openssl', 'curl', 'pdo_mysql', 'mysqli', 'gd', 'intl', 'zip']) {
      expect(out, ext).toContain(`extension = ${ext}`)
    }
  })

  test('scan_dir (user override) nằm CUỐI để thắng mọi giá trị phía trên', () => {
    const iScan = out.indexOf('scan_dir')
    const iOpcache = out.indexOf('opcache.enable')
    expect(iScan).toBeGreaterThan(iOpcache)
  })

  test('timezone + memory_limit theo tham số', () => {
    expect(out).toContain('date.timezone = Asia/Ho_Chi_Minh')
    expect(out).toContain('memory_limit = 512M')
  })

  test('path có dấu cách vẫn quote đúng', () => {
    const o = renderPhpIni({ ...M, runtimeRoot: 'C:\\Program Files\\Infra\\php-8.3' })
    expect(o).toContain('extension_dir = "C:/Program Files/Infra/php-8.3/ext"')
  })

  test('KHÔNG còn backslash trong mọi giá trị quote', () => {
    for (const m of out.match(/"[^"]*"/g) ?? []) expect(m, m).not.toContain('\\')
  })
})
