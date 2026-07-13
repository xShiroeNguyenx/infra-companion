import { describe, expect, it } from 'vitest'
import { deriveExecFromLoginSteps, deriveSftpExecFromLoginSteps } from './loginScript'

const OPTS = '-o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10'
const OPTS_PW =
  '-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o PreferredAuthentications=password,keyboard-interactive -o NumberOfPasswordPrompts=1'

describe('deriveExecFromLoginSteps (Bulk / Monitoring)', () => {
  it('trả null khi không có bước nào', () => {
    expect(deriveExecFromLoginSteps([], 'uptime')).toBeNull()
  })

  it('trả null khi login script không có hop ssh', () => {
    expect(deriveExecFromLoginSteps([{ send: 'export LANG=C' }], 'uptime')).toBeNull()
  })

  it('1 hop ssh không password → ssh <opts> <đích> <lệnh-đã-quote>', () => {
    expect(deriveExecFromLoginSteps([{ send: 'ssh web-01' }], 'uptime')).toBe(
      `ssh ${OPTS} web-01 'uptime'`
    )
  })

  it('KHÔNG được dính "-s sftp" (regression: monitoring từng bọc nhầm lệnh SFTP)', () => {
    const cmd = deriveExecFromLoginSteps([{ send: 'ssh web-01' }], 'cat /proc/loadavg')
    expect(cmd).not.toContain('-s sftp')
    expect(cmd).toBe(`ssh ${OPTS} web-01 'cat /proc/loadavg'`)
  })

  it('hop ssh có password → dùng sshpass với opts password', () => {
    const cmd = deriveExecFromLoginSteps(
      [{ send: 'ssh user@web-01' }, { send: 'PW', secret: true }],
      'uptime'
    )
    expect(cmd).toBe(`env LC_ALL=C sshpass -p 'PW' ssh ${OPTS_PW} user@web-01 'uptime'`)
  })

  it('2 hop ssh lồng nhau, quote từng lớp', () => {
    const cmd = deriveExecFromLoginSteps([{ send: 'ssh gate2' }, { send: 'ssh web-03' }], 'uptime')
    expect(cmd).toBe(`ssh ${OPTS} gate2 'ssh ${OPTS} web-03 '\\''uptime'\\'''`)
  })

  it('su có password → nạp một phát "echo PASS |" (không dùng cat giữ stdin)', () => {
    const cmd = deriveExecFromLoginSteps(
      [{ send: 'su - admin' }, { send: 'SUPW', secret: true }, { send: 'ssh web-03' }],
      'uptime'
    )
    expect(cmd).toBe(`echo 'SUPW' | su admin -c 'ssh ${OPTS} web-03 '\\''uptime'\\'''`)
    expect(cmd).not.toContain('cat')
  })

  it('lệnh chứa single-quote được escape an toàn', () => {
    const cmd = deriveExecFromLoginSteps([{ send: 'ssh web-01' }], "echo 'xin chào'")
    expect(cmd).toBe(`ssh ${OPTS} web-01 'echo '\\''xin chào'\\'''`)
  })
})

describe('deriveSftpExecFromLoginSteps (SFTP qua gate)', () => {
  it('1 hop ssh → mở subsystem sftp của máy đích', () => {
    expect(deriveSftpExecFromLoginSteps([{ send: 'ssh web-01' }])).toBe(`ssh ${OPTS} web-01 -s sftp`)
  })

  it('su có password → giữ stdin bằng "{ echo PASS; cat; } |" cho luồng dữ liệu SFTP', () => {
    const cmd = deriveSftpExecFromLoginSteps([
      { send: 'su admin' },
      { send: 'PW', secret: true },
      { send: 'ssh web-03' }
    ])
    expect(cmd).toBe(`{ echo 'PW'; cat; } | su admin -c 'ssh ${OPTS} web-03 -s sftp'`)
  })

  it('trả null khi không có hop ssh lẫn su/sudo', () => {
    expect(deriveSftpExecFromLoginSteps([{ send: 'export LANG=C' }])).toBeNull()
    expect(deriveSftpExecFromLoginSteps([])).toBeNull()
  })

  // su/sudo SAU hop ssh cuối từng bị BỎ QUA im lặng → SFTP chạy dưới user ssh,
  // sửa file của user su bị Permission denied (bug báo ở v0.1.18)
  describe('su/sudo sau hop ssh cuối → chạy sftp-server dưới user đích', () => {
    it('sudo -i không có ssh → sudo bash -c <probe> ngay trên endpoint', () => {
      const cmd = deriveSftpExecFromLoginSteps([{ send: 'sudo -i' }])
      expect(cmd).toContain('sudo bash -c')
      expect(cmd).toContain('sftp-server')
      expect(cmd).not.toContain('-s sftp')
    })

    it('su có password không có ssh → giữ stdin "{ echo PASS; cat; } | su … -c <probe>"', () => {
      const cmd = deriveSftpExecFromLoginSteps([{ send: 'su vn_root' }, { send: 'PW', secret: true }])
      expect(cmd).toMatch(/^\{ echo 'PW'; cat; \} \| su vn_root -c '/)
      expect(cmd).toContain('/usr/libexec/openssh/sftp-server')
      expect(cmd).not.toContain('-s sftp')
    })

    it('[ssh web-02, su admin+PW] → probe chạy qua su TRÊN web-02, không phải subsystem', () => {
      const cmd = deriveSftpExecFromLoginSteps([
        { send: 'ssh web-02' },
        { send: 'su admin' },
        { send: 'PW', secret: true }
      ])
      expect(cmd).toMatch(new RegExp(`^ssh ${OPTS} web-02 '`))
      expect(cmd).toContain('su admin -c')
      expect(cmd).toContain('sftp-server')
      expect(cmd).not.toContain('-s sftp')
    })

    it('su TRƯỚC ssh cuối vẫn dùng subsystem như cũ (không đổi hành vi)', () => {
      const cmd = deriveSftpExecFromLoginSteps([
        { send: 'su admin' },
        { send: 'PW', secret: true },
        { send: 'ssh web-03' }
      ])
      expect(cmd).toBe(`{ echo 'PW'; cat; } | su admin -c 'ssh ${OPTS} web-03 -s sftp'`)
      expect(cmd).not.toContain('sftp-server')
    })
  })
})
