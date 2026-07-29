import { phpSingleQuoted } from '../wpConfig'
import { toFwd } from './escape'

/**
 * Sinh `config.inc.php` cho phpMyAdmin. Thuần → golden-string test.
 *
 * VÌ SAO PHẢI SINH (không dùng config.sample.inc.php): cổng MariaDB của app là ĐỘNG (3307+,
 * cấp lúc chạy) và root có mật khẩu sinh ngẫu nhiên trong `conf/mariadb/root.cnf`. Không có
 * file này, phpMyAdmin bắt user chạy wizard `setup/` rồi tự gõ host/cổng/mật khẩu — thứ mà
 * chính app mới biết.
 *
 * File này được ghi VÀO THƯ MỤC RUNTIME của phpMyAdmin (nơi duy nhất pma tìm config: hằng
 * `CONFIG_DIR` mặc định rỗng nghĩa là gốc app). Đây là ngoại lệ CÓ CHỦ Ý của quy ước
 * "runtimes/ read-only sau khi cài" — cách còn lại là vá `libraries/vendor_config.php` của
 * upstream, xâm lấn hơn nhiều. Vì config được regenerate mỗi lần apply, gỡ/cài lại runtime
 * không để lại config cũ trỏ vào cổng đã chết.
 */

export interface PmaConfigModel {
  /** Host MariaDB — luôn là 127.0.0.1 (mysqld chỉ bind loopback). */
  host: string
  port: number
  user: string
  password: string
  /** Chuỗi ≥32 ký tự để mã hoá cookie; giữ nguyên giữa các lần sinh (xem `pmaBlowfishSecret`). */
  blowfishSecret: string
  /** Thư mục ghi được cho cache template của pma — KHÔNG nằm trong runtimes/. */
  tempDir: string
}

/**
 * `auth_type = 'config'`: mở là vào luôn, không phải gõ mật khẩu root ngẫu nhiên (chính app
 * sinh ra nó, user không nhớ được). An toàn ở bối cảnh này vì nginx CHỈ listen 127.0.0.1 nên
 * máy khác trong LAN không tới được vhost này — cùng mức phơi bày với Adminer đang có.
 */
export function renderPmaConfig(m: PmaConfigModel): string {
  const q = (v: string): string => `'${phpSingleQuoted(v)}'`
  const L: string[] = []
  L.push('<?php')
  L.push('// File này do Infra Companion SINH RA mỗi lần apply — mọi thay đổi sẽ bị ghi đè.')
  L.push('declare(strict_types=1);')
  L.push('')
  L.push(`$cfg['blowfish_secret'] = ${q(m.blowfishSecret)};`)
  L.push('')
  L.push('$i = 1;')
  L.push(`$cfg['Servers'][$i]['host'] = ${q(m.host)};`)
  L.push(`$cfg['Servers'][$i]['port'] = ${q(String(m.port))};`)
  // 'tcp' tường minh: để 'socket' rỗng thì pma vẫn có thể thử socket và fail trên Windows
  L.push(`$cfg['Servers'][$i]['connect_type'] = 'tcp';`)
  L.push(`$cfg['Servers'][$i]['auth_type'] = 'config';`)
  L.push(`$cfg['Servers'][$i]['user'] = ${q(m.user)};`)
  L.push(`$cfg['Servers'][$i]['password'] = ${q(m.password)};`)
  L.push(`$cfg['Servers'][$i]['AllowNoPassword'] = false;`)
  L.push(`$cfg['Servers'][$i]['compress'] = false;`)
  L.push('')
  L.push(`$cfg['TempDir'] = ${q(toFwd(m.tempDir))};`)
  // Công cụ dev local: KHÔNG gọi ra ngoài (check version, gửi báo lỗi) — vừa chậm vừa lộ dữ liệu
  L.push(`$cfg['VersionCheck'] = false;`)
  L.push(`$cfg['SendErrorReports'] = 'never';`)
  // Cảnh báo "chưa cấu hình phpMyAdmin configuration storage" chỉ gây nhiễu cho dev local
  L.push(`$cfg['PmaNoRelation_DisableWarning'] = true;`)
  // Bấm xoá 1 bảng/DB thì hỏi lại — dev local rất hay bấm nhầm
  L.push(`$cfg['Confirm'] = true;`)
  L.push('')
  return `${L.join('\n')}\n`
}
