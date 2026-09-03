import { describe, expect, test } from 'vitest'
import { detectUserColumn } from '@infra/shared'
import {
  CRON_OK_MARKER,
  buildCrontab,
  describeSchedule,
  parseCrontab,
  isScopeWritable,
  readCrontabCommand,
  sudoDenied,
  writeCrontabCommand,
  writeSucceeded
} from './crontab'

const SAMPLE = `# quan tri he thong
MAILTO=admin@example.com
PATH=/usr/local/bin:/usr/bin:/bin

*/5 * * * * /usr/local/bin/health-check
0 3 * * * /usr/local/bin/backup.sh --full
@reboot /usr/local/bin/warm-cache
`

describe('parseCrontab', () => {
  test('phân loại đủ comment / env / job / dòng trống', () => {
    const lines = parseCrontab(SAMPLE)
    expect(lines.filter((l) => l.kind === 'comment')).toHaveLength(1)
    expect(lines.filter((l) => l.kind === 'env')).toHaveLength(2)
    expect(lines.filter((l) => l.kind === 'job')).toHaveLength(3)
    expect(lines.filter((l) => l.kind === 'blank')).toHaveLength(1)
  })

  test('tách lịch và lệnh', () => {
    const job = parseCrontab(SAMPLE).find((l) => l.kind === 'job')!
    expect(job.schedule).toBe('*/5 * * * *')
    expect(job.command).toBe('/usr/local/bin/health-check')
  })

  test('lệnh có nhiều khoảng trắng vẫn giữ nguyên vẹn', () => {
    const job = parseCrontab('0 3 * * * /bin/sh -c "a  b"\n').find((l) => l.kind === 'job')!
    expect(job.command).toBe('/bin/sh -c "a  b"')
  })

  test('@reboot và các @special đọc được', () => {
    const job = parseCrontab('@reboot /x\n').find((l) => l.kind === 'job')!
    expect(job.schedule).toBe('@reboot')
  })

  test('env đọc được tên và giá trị', () => {
    const env = parseCrontab('MAILTO=admin@example.com\n').find((l) => l.kind === 'env')!
    expect(env).toMatchObject({ name: 'MAILTO', value: 'admin@example.com' })
  })

  test('dòng không hiểu được GIỮ LẠI (giữ như comment) chứ không bị vứt', () => {
    // Dựng lại file chỉ từ những gì mình hiểu là cách chắc chắn xoá mất thứ của người khác
    const lines = parseCrontab('day la rac khong phai cron\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]!.raw).toBe('day la rac khong phai cron')
  })

  test('CRLF quy về một dòng', () => {
    expect(parseCrontab('a\r\nb\r\n').filter((l) => l.raw !== '')).toHaveLength(2)
  })
})

describe('buildCrontab — vòng tròn parse→build', () => {
  test('dựng lại ĐÚNG NGUYÊN VĂN, không xáo trộn gì', () => {
    expect(buildCrontab(parseCrontab(SAMPLE))).toBe(SAMPLE)
  })

  test('luôn kết thúc bằng \\n — thiếu là cron bỏ dòng cuối', () => {
    expect(buildCrontab(parseCrontab('0 3 * * * /x'))).toBe('0 3 * * * /x\n')
  })

  test('lưu đi lưu lại không cộng dồn dòng trống ở cuối', () => {
    const once = buildCrontab(parseCrontab(SAMPLE))
    expect(buildCrontab(parseCrontab(once))).toBe(once)
  })
})

describe('describeSchedule', () => {
  test('@special', () => {
    expect(describeSchedule('@reboot')).toEqual({ key: 'cron.atReboot' })
    expect(describeSchedule('@daily')).toEqual({ key: 'cron.daily' })
    expect(describeSchedule('@midnight')).toEqual({ key: 'cron.daily' })
  })

  test('mỗi N phút', () => {
    expect(describeSchedule('*/5 * * * *')).toEqual({ key: 'cron.everyNMin', params: { n: '5' } })
  })

  test('mỗi giờ vào phút M', () => {
    expect(describeSchedule('30 * * * *')).toEqual({ key: 'cron.hourlyAt', params: { m: '30' } })
  })

  test('mỗi ngày lúc HH:MM, có đệm số 0', () => {
    expect(describeSchedule('5 3 * * *')).toEqual({ key: 'cron.dailyAt', params: { time: '03:05' } })
  })

  test('mỗi tuần / mỗi tháng', () => {
    expect(describeSchedule('0 4 * * 1')).toEqual({ key: 'cron.weeklyAt', params: { dow: '1', time: '04:00' } })
    expect(describeSchedule('0 4 1 * *')).toEqual({ key: 'cron.monthlyAt', params: { dom: '1', time: '04:00' } })
  })

  test('biểu thức phức tạp → null, UI hiện nguyên văn (đoán sai còn tệ hơn không đoán)', () => {
    expect(describeSchedule('0 2,14 * * 1-5')).toBeNull()
    expect(describeSchedule('*/7 1-5 * * *')).toBeNull()
  })

  test('không đủ 5 trường → null, không ném', () => {
    expect(describeSchedule('0 3 * *')).toBeNull()
    expect(describeSchedule('')).toBeNull()
  })
})

describe('phạm vi (scope) — lỗi user gặp thật: đọc đúng lệnh nhưng SAI CHỖ', () => {
  // Máy có job chạy thật, mà `crontab -l` của user đăng nhập lại trống: job nằm ở root
  // và ở /etc/crontab — hai chỗ `crontab -l` không đụng tới.
  const SYSTEM = `==> /etc/crontab <==
0 5 * * * deploy /usr/local/cron/backup.sh
30 1 * * * root /usr/local/cron/httpd_log_rotate.sh

==> /etc/cron.d/oem <==
*/10 * * * * deploy sh /usr/local/cron/update.sh 2>&1
`

  test('scope system tách được cột USER — thiếu bước này thì lệnh hiện ra kèm cả tên user', () => {
    const jobs = parseCrontab(SYSTEM, 'system').filter((l) => l.kind === 'job')
    expect(jobs[0]).toMatchObject({
      schedule: '0 5 * * *',
      user: 'deploy',
      command: '/usr/local/cron/backup.sh'
    })
    expect(jobs[1]).toMatchObject({ user: 'root', command: '/usr/local/cron/httpd_log_rotate.sh' })
  })

  test('cùng nội dung đọc ở scope user thì KHÔNG tách cột (crontab cá nhân vốn 5 trường)', () => {
    const job = parseCrontab('0 5 * * * deploy /usr/local/cron/x.sh\n', 'user').find((l) => l.kind === 'job')!
    expect(job.user).toBeUndefined()
    expect(job.command).toBe('deploy /usr/local/cron/x.sh')
  })

  test('dấu phân cách file của tail thành dòng riêng, không bị coi là job', () => {
    const files = parseCrontab(SYSTEM, 'system').filter((l) => l.kind === 'file')
    expect(files.map((f) => f.path)).toEqual(['/etc/crontab', '/etc/cron.d/oem'])
  })

  test('@special ở scope system cũng có cột user', () => {
    const job = parseCrontab('@reboot root /usr/local/bin/warm.sh\n', 'system').find((l) => l.kind === 'job')!
    expect(job).toMatchObject({ schedule: '@reboot', user: 'root', command: '/usr/local/bin/warm.sh' })
  })

  test('lệnh đọc khác nhau theo scope, và root PHẢI dùng sudo -n', () => {
    // Kênh exec không có TTY → `sudo` không -n sẽ treo chờ mật khẩu tới lúc timeout
    expect(readCrontabCommand('user')).toContain('crontab -l')
    expect(readCrontabCommand('root')).toContain('sudo -n crontab -l')
    expect(readCrontabCommand('system')).toContain('/etc/crontab')
    expect(readCrontabCommand('system')).toContain('/etc/cron.d/')
  })

  test('lệnh system dùng tail -n +1 (tự in dấu file) chứ không vòng for', () => {
    const cmd = readCrontabCommand('system')
    expect(cmd).toContain('tail -n +1')
    expect(cmd).not.toContain('for ')
    expect(cmd).not.toContain('$(')
  })

  test('nhận ra sudo từ chối, để không báo nhầm thành "chưa có crontab"', () => {
    expect(sudoDenied('sudo: a password is required')).toBe(true)
    expect(sudoDenied('sudo: no tty present and no askpass program specified')).toBe(true)
    expect(sudoDenied('deploy is not allowed to run sudo on app-01')).toBe(true)
    expect(sudoDenied('0 5 * * * /usr/local/bin/x.sh')).toBe(false)
    expect(sudoDenied('')).toBe(false)
  })

  test('dò được cột user trong crontab của ROOT viết theo định dạng hệ thống', () => {
    // Ca thật trên máy user: `sudo crontab -l` trả về 6 trường dù crontab cá nhân vốn 5 trường
    const rootCrontab = `0 5 * * * deploy /usr/local/cron/backup.sh
30 1 * * * root /usr/local/cron/rotate.sh
0 23 * * * root /usr/local/cron/cleanup.sh
`
    expect(detectUserColumn(rootCrontab)).toBe(true)
  })

  test('crontab 5 trường bình thường KHÔNG bị nhận nhầm là có cột user', () => {
    // `sh`, `php`… đứng đầu lệnh trông y hệt một tên user — nên phải thấy `root` mới kết luận
    expect(detectUserColumn('*/5 * * * * sh /usr/local/bin/check.sh\n0 3 * * * php /srv/app/cron.php\n')).toBe(false)
  })

  test('lệnh là đường dẫn tuyệt đối → không có cột user', () => {
    expect(detectUserColumn('0 3 * * * /usr/local/bin/backup.sh --full\n')).toBe(false)
  })

  test('rỗng / chỉ comment → false, không ném', () => {
    expect(detectUserColumn('')).toBe(false)
    expect(detectUserColumn('# chi co comment\nMAILTO=admin@example.com\n')).toBe(false)
  })

  test('chỉ một dòng lẻ có "root" giữa nhiều dòng 5 trường thì KHÔNG đủ để kết luận', () => {
    const mixed = `0 1 * * * /usr/local/bin/a.sh
0 2 * * * /usr/local/bin/b.sh
0 3 * * * /usr/local/bin/c.sh
0 4 * * * root /usr/local/bin/d.sh
`
    expect(detectUserColumn(mixed)).toBe(false)
  })

  test('ghi được ở user/root, KHÔNG ghi ở system (nhiều file)', () => {
    expect(isScopeWritable('user')).toBe(true)
    expect(isScopeWritable('root')).toBe(true)
    expect(isScopeWritable('system')).toBe(false)
    expect(writeCrontabCommand('x\n', 'root')).toContain('sudo -n crontab')
    expect(() => writeCrontabCommand('x\n', 'system')).toThrow()
  })
})

describe('lệnh shell', () => {
  test('đọc: không có crontab cũng không thành lỗi', () => {
    expect(readCrontabCommand()).toContain('2>/dev/null')
    expect(readCrontabCommand()).toContain('true')
  })

  test('ghi KHÔNG dùng $?, heredoc, $() hay backtick — hop login-script bóc mất lớp quote', () => {
    const cmd = writeCrontabCommand('0 3 * * * /x\n')
    expect(cmd).not.toContain('$?')
    expect(cmd).not.toContain('<<')
    expect(cmd).not.toContain('$(')
    expect(cmd).not.toContain('`')
  })

  test('ghi dùng umask 077 và luôn dọn file tạm', () => {
    const cmd = writeCrontabCommand('x\n')
    expect(cmd).toContain('umask 077')
    // `rm -f` sau dấu `;` nên chạy cả khi crontab thất bại — không để lại rác
    expect(cmd).toMatch(/;\s*rm -f /)
  })

  test('nội dung được bọc nháy đơn, nháy đơn bên trong bị trung hoà', () => {
    expect(writeCrontabCommand("0 3 * * * echo 'hi'\n")).toContain(`'\\''`)
  })

  test('thiếu \\n cuối được thêm vào', () => {
    expect(writeCrontabCommand('0 3 * * * /x')).toContain('/x\n')
  })

  test('thành công nhận biết bằng marker, không bằng exit code (bị rm che mất)', () => {
    expect(writeCrontabCommand('x')).toContain(CRON_OK_MARKER)
    expect(writeSucceeded(`${CRON_OK_MARKER}\n`)).toBe(true)
    expect(writeSucceeded('crontab: installing new crontab\n')).toBe(false)
    expect(writeSucceeded('')).toBe(false)
  })
})
