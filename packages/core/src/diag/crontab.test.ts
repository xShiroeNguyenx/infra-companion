import { describe, expect, test } from 'vitest'
import {
  CRON_OK_MARKER,
  buildCrontab,
  describeSchedule,
  parseCrontab,
  readCrontabCommand,
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
