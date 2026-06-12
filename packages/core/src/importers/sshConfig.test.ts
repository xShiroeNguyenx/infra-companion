import { describe, expect, test } from 'vitest'
import { parseSshConfig } from './sshConfig'

describe('parseSshConfig', () => {
  test('parse block cơ bản: hostname/port/user/identityfile/proxyjump', () => {
    const entries = parseSshConfig(`
# comment đầu file
Host web
  HostName 10.0.0.1
  Port 2222
  User deploy
  IdentityFile ~/.ssh/id_a
  ProxyJump bastion
`)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      alias: 'web',
      hostname: '10.0.0.1',
      port: 2222,
      user: 'deploy',
      identityFile: '~/.ssh/id_a',
      proxyJump: 'bastion'
    })
  })

  test('nhiều alias trên một dòng Host → mỗi alias một entry, cùng props', () => {
    const entries = parseSshConfig(`
Host db1 db2
  User dbadmin
  HostName 10.0.0.5
`)
    expect(entries.map((e) => e.alias)).toEqual(['db1', 'db2'])
    expect(entries[0]!.user).toBe('dbadmin')
    expect(entries[1]!.hostname).toBe('10.0.0.5')
  })

  test('bỏ alias wildcard (Host * / web-*)', () => {
    const entries = parseSshConfig(`
Host *
  User ignored
Host web-* thật
  HostName 1.2.3.4
`)
    expect(entries.map((e) => e.alias)).toEqual(['thật'])
  })

  test('keyword không phân biệt hoa thường; giá trị trong nháy kép được strip', () => {
    const entries = parseSshConfig(`
HOST quoted
  hostname "10.9.9.9"
  USER "ops user"
`)
    expect(entries[0]!.hostname).toBe('10.9.9.9')
    expect(entries[0]!.user).toBe('ops user')
  })

  test('IdentityFile đầu tiên thắng (giống hành vi ssh)', () => {
    const entries = parseSshConfig(`
Host multi
  IdentityFile ~/.ssh/first
  IdentityFile ~/.ssh/second
`)
    expect(entries[0]!.identityFile).toBe('~/.ssh/first')
  })

  test('ProxyJump nhiều bậc giữ nguyên chuỗi (kể cả user@host:port)', () => {
    const entries = parseSshConfig(`
Host deep
  ProxyJump gate1,admin@10.0.0.9:2200,gate3
`)
    expect(entries[0]!.proxyJump).toBe('gate1,admin@10.0.0.9:2200,gate3')
  })

  test('Port không phải số → mặc định 22; dòng trước Host đầu tiên bị bỏ', () => {
    const entries = parseSshConfig(`
User lạc-lõng
Host badport
  Port abc
`)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.port).toBe(22)
    expect(entries[0]!.user).toBeUndefined()
  })

  test('file rỗng / chỉ comment → không có entry', () => {
    expect(parseSshConfig('')).toHaveLength(0)
    expect(parseSshConfig('# chỉ comment\n\n')).toHaveLength(0)
  })
})
