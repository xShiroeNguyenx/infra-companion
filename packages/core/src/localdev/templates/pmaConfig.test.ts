import { describe, expect, test } from 'vitest'
import { renderPmaConfig, type PmaConfigModel } from './pmaConfig'

const M: PmaConfigModel = {
  host: '127.0.0.1',
  port: 3307,
  user: 'root',
  password: 'p4ss-w0rd',
  blowfishSecret: 'x'.repeat(43),
  tempDir: 'D:\\infra\\localdev\\tmp\\phpmyadmin'
}

describe('renderPmaConfig', () => {
  const out = renderPmaConfig(M)

  test('mở đầu bằng <?php (thiếu là pma in cả file ra như text)', () => {
    expect(out.startsWith('<?php\n')).toBe(true)
  })

  test('trỏ đúng host/cổng ĐỘNG của MariaDB do app cấp', () => {
    expect(out).toContain(`$cfg['Servers'][$i]['host'] = '127.0.0.1';`)
    // pma nhận port dạng chuỗi
    expect(out).toContain(`$cfg['Servers'][$i]['port'] = '3307';`)
    expect(out).toContain(`$cfg['Servers'][$i]['connect_type'] = 'tcp';`)
  })

  test(`auth_type 'config' + user/password ⇒ mở là vào, không phải gõ mật khẩu root ngẫu nhiên`, () => {
    expect(out).toContain(`$cfg['Servers'][$i]['auth_type'] = 'config';`)
    expect(out).toContain(`$cfg['Servers'][$i]['user'] = 'root';`)
    expect(out).toContain(`$cfg['Servers'][$i]['password'] = 'p4ss-w0rd';`)
    // Không mật khẩu là KHÔNG được, kể cả khi chỉ nghe loopback: site PHP có lỗ hổng cũng
    // nằm trên loopback (xem ensureRootPassword)
    expect(out).toContain(`$cfg['Servers'][$i]['AllowNoPassword'] = false;`)
  })

  test('escape literal PHP: password chứa nháy đơn / backslash không phá cú pháp', () => {
    const out2 = renderPmaConfig({ ...M, password: `a'b\\c` })
    expect(out2).toContain(`$cfg['Servers'][$i]['password'] = 'a\\'b\\\\c';`)
  })

  test('blowfish_secret ≥32 ký tự (ngắn hơn ⇒ pma hiện cảnh báo đỏ mọi trang)', () => {
    const m = /\$cfg\['blowfish_secret'] = '([^']*)';/.exec(out)
    expect(m).not.toBeNull()
    expect(m![1]!.length).toBeGreaterThanOrEqual(32)
  })

  test('TempDir dùng forward slash (path Windows có \\ dễ thành escape trong literal)', () => {
    expect(out).toContain(`$cfg['TempDir'] = 'D:/infra/localdev/tmp/phpmyadmin';`)
  })

  test('KHÔNG gọi ra ngoài: tắt check version + gửi báo lỗi', () => {
    expect(out).toContain(`$cfg['VersionCheck'] = false;`)
    expect(out).toContain(`$cfg['SendErrorReports'] = 'never';`)
  })
})
