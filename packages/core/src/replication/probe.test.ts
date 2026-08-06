import { describe, expect, it, vi } from 'vitest'
import type { ExecOnceResult } from '../connection/execOnce'
import {
  buildRemoteMysqlCommand,
  cleanMysqlStderr,
  isUnsupportedSyntaxError,
  makeCliProbe,
  queryFirstSupported,
  randomCnfPath,
  shq,
  type ReplProbe
} from './probe'

const CNF = '/tmp/.infra-companion-repl-deadbeef.cnf'
const ok = (stdout: string, stderr = ''): ExecOnceResult => ({ status: 'done', stdout, stderr, code: 0 })

describe('shq', () => {
  it('bọc nháy đơn', () => {
    expect(shq('abc')).toBe("'abc'")
  })

  it('nháy đơn bên trong được thoát đúng kiểu POSIX', () => {
    expect(shq("a'b")).toBe("'a'\\''b'")
  })

  it('ký tự shell nguy hiểm nằm trong nháy đơn là vô hại', () => {
    expect(shq('$(rm -rf /)')).toBe("'$(rm -rf /)'")
    expect(shq('a; rm -rf /')).toBe("'a; rm -rf /'")
  })
})

describe('buildRemoteMysqlCommand — chế độ mặc định (credential sẵn trên server)', () => {
  it('không có tuỳ chọn nào → lệnh tối giản, không đụng mật khẩu', () => {
    const cmd = buildRemoteMysqlCommand({ sql: 'SHOW SLAVE STATUS' })
    expect(cmd).toBe("mysql --batch --raw --connect-timeout=10 -e 'SHOW SLAVE STATUS\\G'")
  })

  it('luôn ép dạng dọc \\G', () => {
    expect(buildRemoteMysqlCommand({ sql: 'SHOW MASTER STATUS;' })).toContain("'SHOW MASTER STATUS\\G'")
    expect(buildRemoteMysqlCommand({ sql: 'SHOW MASTER STATUS\\G' })).toContain("'SHOW MASTER STATUS\\G'")
  })

  it('có host/port/user thì thêm cờ, vẫn không có mật khẩu', () => {
    const cmd = buildRemoteMysqlCommand({ sql: 'SELECT 1', host: '127.0.0.1', port: 3306, user: 'monitor' })
    expect(cmd).toContain("-h '127.0.0.1'")
    expect(cmd).toContain('-P 3306')
    expect(cmd).toContain("-u 'monitor'")
    expect(cmd).not.toContain('-p')
  })

  it('đổi được binary sang mariadb', () => {
    expect(buildRemoteMysqlCommand({ sql: 'SELECT 1', binary: 'mariadb' }).startsWith('mariadb ')).toBe(true)
  })

  it('binary có ký tự lạ → ném lỗi (chặn chèn lệnh)', () => {
    expect(() => buildRemoteMysqlCommand({ sql: 'SELECT 1', binary: 'mysql; rm -rf /' })).toThrow(/không hợp lệ/)
  })
})

describe('buildRemoteMysqlCommand — chế độ app gửi credential', () => {
  const base = { sql: 'SHOW SLAVE STATUS', user: 'monitor', password: 'p@ss w0rd', cnfPath: CNF }

  it('MẬT KHẨU KHÔNG BAO GIỜ NẰM TRÊN COMMAND LINE CỦA MYSQL', () => {
    const cmd = buildRemoteMysqlCommand(base)
    // Có xuất hiện trong lệnh (ở vế printf ghi file) nhưng tuyệt đối không đi kèm cờ -p
    expect(cmd).not.toMatch(/-p\S/)
    expect(cmd).not.toContain('--password=')
    const mysqlPart = cmd.slice(cmd.indexOf('mysql --defaults-extra-file'))
    expect(mysqlPart).not.toContain('p@ss w0rd')
  })

  it('umask 077 đứng trước printf → file sinh ra đã là 0600', () => {
    expect(buildRemoteMysqlCommand(base).startsWith('umask 077; printf ')).toBe(true)
  })

  it('--defaults-extra-file là tham số ĐẦU TIÊN của client', () => {
    const cmd = buildRemoteMysqlCommand(base)
    expect(cmd).toContain(`mysql --defaults-extra-file=${CNF} --batch`)
  })

  it('luôn xoá file tạm sau khi chạy', () => {
    expect(buildRemoteMysqlCommand(base).endsWith(`rm -f ${CNF}`)).toBe(true)
  })

  it('không dùng $ hay heredoc — để sống sót qua login-script nhiều lớp quote', () => {
    const cmd = buildRemoteMysqlCommand(base)
    expect(cmd).not.toContain('$')
    expect(cmd).not.toContain('<<')
  })

  it('mật khẩu chứa ký tự shell hiểm vẫn an toàn', () => {
    const cmd = buildRemoteMysqlCommand({ ...base, password: "'; rm -rf / #" })
    expect(cmd).toContain(`'password='\\''; rm -rf / #'`)
  })

  it('có mật khẩu mà thiếu cnfPath → ném lỗi thay vì âm thầm rơi về -p', () => {
    expect(() => buildRemoteMysqlCommand({ sql: 'SELECT 1', password: 'x' })).toThrow(/cnfPath/)
  })

  it('cnfPath tương đối hoặc có ký tự lạ → ném lỗi', () => {
    expect(() => buildRemoteMysqlCommand({ ...base, cnfPath: 'tmp/a.cnf' })).toThrow(/không hợp lệ/)
    expect(() => buildRemoteMysqlCommand({ ...base, cnfPath: '/tmp/a.cnf; rm -rf /' })).toThrow(/không hợp lệ/)
  })

  it('mật khẩu có xuống dòng → ném lỗi (sẽ thành dòng cấu hình khác trong .cnf)', () => {
    expect(() => buildRemoteMysqlCommand({ ...base, password: 'a\nsocket=/evil.sock' })).toThrow(/xuống dòng/)
  })

  it('mật khẩu rỗng vẫn là "có mật khẩu" → đi đường .cnf', () => {
    expect(buildRemoteMysqlCommand({ ...base, password: '' })).toContain('--defaults-extra-file=')
  })
})

describe('randomCnfPath', () => {
  it('nằm trong /tmp, mỗi lần một khác, và khớp mẫu an toàn', () => {
    const a = randomCnfPath()
    const b = randomCnfPath()
    expect(a).not.toBe(b)
    expect(a.startsWith('/tmp/.infra-companion-repl-')).toBe(true)
    // Đường dẫn sinh ra phải tự nó hợp lệ với validate của buildRemoteMysqlCommand
    expect(() => buildRemoteMysqlCommand({ sql: 'SELECT 1', password: 'x', cnfPath: a })).not.toThrow()
  })
})

describe('cleanMysqlStderr', () => {
  it('bỏ cảnh báo vô hại', () => {
    expect(cleanMysqlStderr('mysql: [Warning] Using a password on the command line\n')).toBe('')
    expect(cleanMysqlStderr('Warning: Permanently added host\n')).toBe('')
  })

  it('giữ lại lỗi thật', () => {
    expect(cleanMysqlStderr("ERROR 1045 (28000): Access denied for user 'monitor'")).toContain('1045')
  })

  it('lọc cảnh báo nhưng vẫn giữ lỗi đi kèm', () => {
    const out = cleanMysqlStderr('mysql: [Warning] blah\nERROR 1227 (42000): Access denied; you need REPLICATION CLIENT')
    expect(out).toBe('ERROR 1227 (42000): Access denied; you need REPLICATION CLIENT')
  })
})

describe('isUnsupportedSyntaxError', () => {
  it('lỗi cú pháp 1064 → được phép thử câu thay thế', () => {
    expect(isUnsupportedSyntaxError("ERROR 1064 (42000): You have an error in your SQL syntax near 'SLAVE STATUS'")).toBe(true)
  })

  it('thiếu quyền KHÔNG được coi là lỗi cú pháp — phải báo lên cho user', () => {
    expect(isUnsupportedSyntaxError('ERROR 1227 (42000): Access denied; you need REPLICATION CLIENT')).toBe(false)
    expect(isUnsupportedSyntaxError('ERROR 1045 (28000): Access denied')).toBe(false)
    expect(isUnsupportedSyntaxError('connect ETIMEDOUT')).toBe(false)
  })
})

describe('makeCliProbe', () => {
  const SLAVE_G = [
    '*************************** 1. row ***************************',
    '   Slave_IO_Running: Yes',
    '  Slave_SQL_Running: Yes'
  ].join('\n')

  it('parse output \\G thành row', async () => {
    const probe = makeCliProbe({ exec: async () => ok(SLAVE_G) })
    await expect(probe.queryRows('SHOW SLAVE STATUS')).resolves.toEqual([
      { Slave_IO_Running: 'Yes', Slave_SQL_Running: 'Yes' }
    ])
  })

  it('không row + không stderr → mảng rỗng (server chưa làm replica, KHÔNG phải lỗi)', async () => {
    const probe = makeCliProbe({ exec: async () => ok('') })
    await expect(probe.queryRows('SHOW SLAVE STATUS')).resolves.toEqual([])
  })

  it('không row + stderr có lỗi thật → ném lỗi kèm nguyên văn', async () => {
    const probe = makeCliProbe({ exec: async () => ok('', 'ERROR 1227 (42000): Access denied') })
    await expect(probe.queryRows('SHOW SLAVE STATUS')).rejects.toThrow(/1227/)
  })

  it('cảnh báo vô hại trên stderr không bị coi là lỗi', async () => {
    const probe = makeCliProbe({ exec: async () => ok('', 'mysql: [Warning] blah') })
    await expect(probe.queryRows('SHOW SLAVE STATUS')).resolves.toEqual([])
  })

  it('exec thất bại (SSH đứt) → ném lỗi', async () => {
    const probe = makeCliProbe({
      exec: async () => ({ status: 'error', stdout: '', stderr: '', code: null, error: 'Timeout sau 30s' })
    })
    await expect(probe.queryRows('SHOW SLAVE STATUS')).rejects.toThrow(/Timeout/)
  })

  it('chế độ mặc định KHÔNG tạo file .cnf nào', async () => {
    const exec = vi.fn(async (_command: string) => ok(SLAVE_G))
    await makeCliProbe({ exec }).queryRows('SHOW SLAVE STATUS')
    expect(exec.mock.calls[0][0]).not.toContain('.cnf')
  })

  it('có mật khẩu → mỗi lần query sinh file .cnf tạm MỚI', async () => {
    const exec = vi.fn(async (_command: string) => ok(SLAVE_G))
    const probe = makeCliProbe({ exec, options: { user: 'monitor', password: 'secret' } })
    await probe.queryRows('SHOW SLAVE STATUS')
    await probe.queryRows('SHOW MASTER STATUS')
    const first = /--defaults-extra-file=(\S+)/.exec(exec.mock.calls[0][0])?.[1]
    const second = /--defaults-extra-file=(\S+)/.exec(exec.mock.calls[1][0])?.[1]
    expect(first).toBeTruthy()
    expect(first).not.toBe(second)
  })
})

describe('queryFirstSupported', () => {
  const probeThat = (impl: (sql: string) => Promise<Record<string, unknown>[]>): ReplProbe => ({
    mode: 'cli',
    queryRows: impl,
    close: () => {}
  })

  it('câu đầu chạy được → không thử câu sau', async () => {
    const seen: string[] = []
    const probe = probeThat(async (sql) => {
      seen.push(sql)
      return [{ ok: 1 }]
    })
    await queryFirstSupported(probe, ['SHOW SLAVE STATUS', 'SHOW REPLICA STATUS'])
    expect(seen).toEqual(['SHOW SLAVE STATUS'])
  })

  it('MySQL 8.4: câu cũ lỗi cú pháp → tự rơi sang câu mới', async () => {
    const probe = probeThat(async (sql) => {
      if (sql === 'SHOW SLAVE STATUS') throw new Error('ERROR 1064 (42000): You have an error in your SQL syntax')
      return [{ Replica_IO_Running: 'Yes' }]
    })
    await expect(queryFirstSupported(probe, ['SHOW SLAVE STATUS', 'SHOW REPLICA STATUS'])).resolves.toEqual([
      { Replica_IO_Running: 'Yes' }
    ])
  })

  it('thiếu quyền → ném ra NGAY, không thử câu khác rồi báo lỗi sai chỗ', async () => {
    const seen: string[] = []
    const probe = probeThat(async (sql) => {
      seen.push(sql)
      throw new Error('ERROR 1227 (42000): Access denied; you need REPLICATION CLIENT')
    })
    await expect(queryFirstSupported(probe, ['SHOW SLAVE STATUS', 'SHOW REPLICA STATUS'])).rejects.toThrow(/1227/)
    expect(seen).toEqual(['SHOW SLAVE STATUS'])
  })

  it('mọi câu đều lỗi cú pháp → ném lỗi cuối cùng', async () => {
    const probe = probeThat(async () => {
      throw new Error('ERROR 1064: syntax')
    })
    await expect(queryFirstSupported(probe, ['A', 'B'])).rejects.toThrow(/1064/)
  })
})
