import { describe, expect, test } from 'vitest'
import type { GroupDto, HostDto, SshKeyDto } from '@infra/shared'
import { renderExport, resolveForExport, sshAlias, toCsv, toJson, toSshConfig } from './hostExport'

function host(over: Partial<HostDto> & { id: string; label: string }): HostDto {
  return {
    groupId: null,
    protocol: 'ssh',
    hostname: 'app-01',
    port: 22,
    username: null,
    authType: null,
    keyId: null,
    hasPassword: false,
    secretRef: null,
    favorite: false,
    lastConnectedAt: null,
    jumpChain: null,
    env: null,
    startupSnippetId: null,
    agentForward: false,
    tmux: false,
    notes: null,
    hasTotp: false,
    loginSteps: null,
    ...over
  }
}

function group(over: Partial<GroupDto> & { id: string; name: string }): GroupDto {
  return {
    parentId: null,
    username: null,
    authType: null,
    keyId: null,
    env: null,
    startupSnippetId: null,
    jumpChain: null,
    color: null,
    ...over
  }
}

const KEY: SshKeyDto = {
  id: 'k1',
  label: 'deploy key',
  keyType: 'ed25519',
  publicKey: 'ssh-ed25519 AAAA deploy',
  hasPassphrase: false,
  source: 'generated',
  createdAt: 0
}

describe('sshAlias', () => {
  test('khoảng trắng thành gạch nối', () => {
    expect(sshAlias('web 01')).toBe('web-01')
  })

  test('bỏ ký tự ssh_config hiểu thành wildcard/phủ định/comment', () => {
    // "web *" để nguyên sẽ thành pattern khớp MỌI host — đúng loại lỗi im lặng
    expect(sshAlias('web *')).toBe('web')
    expect(sshAlias('!web?')).toBe('web')
    expect(sshAlias('a#b"c')).toBe('abc')
  })

  test('giữ dấu tiếng Việt (OpenSSH khớp literal, bóp tên đi thì mất đối chiếu)', () => {
    expect(sshAlias('máy chủ')).toBe('máy-chủ')
  })

  test('nhãn rỗng hoặc toàn ký tự bị loại → vẫn ra alias dùng được', () => {
    expect(sshAlias('   ')).toBe('host')
    expect(sshAlias('***')).toBe('host')
  })
})

describe('resolveForExport — kế thừa group', () => {
  test('username/authType/key lấy từ group khi host để trống', () => {
    const rows = resolveForExport(
      [host({ id: 'h1', label: 'app-01', groupId: 'g1' })],
      [group({ id: 'g1', name: 'Production', username: 'deploy', authType: 'key', keyId: 'k1' })],
      [KEY]
    )
    expect(rows[0]!.username).toBe('deploy')
    expect(rows[0]!.authType).toBe('key')
    expect(rows[0]!.keyLabel).toBe('deploy key')
  })

  test('host tự khai thì thắng group', () => {
    const rows = resolveForExport(
      [host({ id: 'h1', label: 'app-01', groupId: 'g1', username: 'admin' })],
      [group({ id: 'g1', name: 'Production', username: 'deploy' })],
      []
    )
    expect(rows[0]!.username).toBe('admin')
  })

  test('group GẦN NHẤT thắng group gốc', () => {
    const rows = resolveForExport(
      [host({ id: 'h1', label: 'app-01', groupId: 'child' })],
      [
        group({ id: 'child', name: 'DB', parentId: 'root', username: 'admin' }),
        group({ id: 'root', name: 'Production', username: 'deploy' })
      ],
      []
    )
    expect(rows[0]!.username).toBe('admin')
    expect(rows[0]!.group).toBe('Production/DB')
  })

  test('parentId tạo vòng lặp thì không treo', () => {
    const rows = resolveForExport(
      [host({ id: 'h1', label: 'app-01', groupId: 'a' })],
      [group({ id: 'a', name: 'A', parentId: 'b' }), group({ id: 'b', name: 'B', parentId: 'a' })],
      []
    )
    expect(rows[0]!.group).toBe('B/A')
  })

  test('alias trùng nhau được đánh số, không đè lên nhau', () => {
    const rows = resolveForExport(
      [host({ id: 'h1', label: 'web 01' }), host({ id: 'h2', label: 'web-01' }), host({ id: 'h3', label: 'web*01' })],
      [],
      []
    )
    expect(rows.map((r) => r.alias)).toEqual(['web-01', 'web-01-2', 'web01'])
  })

  test('jumpChain host-id đổi thành alias, đúng thứ tự', () => {
    const rows = resolveForExport(
      [
        host({ id: 'gate', label: 'gate-01' }),
        host({ id: 'mid', label: 'gate-02' }),
        host({ id: 'h1', label: 'app-01', jumpChain: ['gate', 'mid'] })
      ],
      [],
      []
    )
    expect(rows[2]!.jumpAliases).toEqual(['gate-01', 'gate-02'])
  })

  test('hop trỏ tới host đã xoá hoặc trỏ vào chính nó thì bị loại', () => {
    const rows = resolveForExport([host({ id: 'h1', label: 'app-01', jumpChain: ['h1', 'khong-ton-tai'] })], [], [])
    expect(rows[0]!.jumpAliases).toEqual([])
  })

  test('jumpChain cũng kế thừa từ group', () => {
    const rows = resolveForExport(
      [host({ id: 'gate', label: 'gate-01' }), host({ id: 'h1', label: 'app-01', groupId: 'g1' })],
      [group({ id: 'g1', name: 'Production', jumpChain: ['gate'] })],
      []
    )
    expect(rows[1]!.jumpAliases).toEqual(['gate-01'])
  })
})

describe('toSshConfig', () => {
  test('sinh khối Host đủ HostName/Port/User/ProxyJump', () => {
    const rows = resolveForExport(
      [
        host({ id: 'gate', label: 'gate-01', hostname: 'gate.example.com', username: 'admin' }),
        host({ id: 'h1', label: 'app-01', hostname: '203.0.113.10', port: 2222, username: 'deploy', jumpChain: ['gate'] })
      ],
      [],
      []
    )
    const text = toSshConfig(rows)
    expect(text).toContain('Host app-01')
    expect(text).toContain('    HostName 203.0.113.10')
    expect(text).toContain('    Port 2222')
    expect(text).toContain('    User deploy')
    expect(text).toContain('    ProxyJump gate-01')
  })

  test('host không phải SSH bị bỏ nhưng ĐƯỢC ĐẾM, không biến mất im lặng', () => {
    const rows = resolveForExport(
      [host({ id: 'h1', label: 'app-01' }), host({ id: 'h2', label: 'màn hình', protocol: 'vnc' })],
      [],
      []
    )
    const text = toSshConfig(rows)
    expect(text).toContain('Đã bỏ 1 host không phải SSH')
    expect(text).not.toContain('Host màn-hình')
  })

  test('dùng key → nhắc IdentityFile nhưng ĐỂ COMMENT (key nằm trong vault, không có path thật)', () => {
    const rows = resolveForExport([host({ id: 'h1', label: 'app-01', authType: 'key', keyId: 'k1' })], [], [KEY])
    const text = toSshConfig(rows)
    expect(text).toContain('# IdentityFile ~/.ssh/deploy-key')
    // Không được sinh dòng IdentityFile CHẠY THẬT: nó trỏ vào file không tồn tại
    expect(text).not.toMatch(/^\s*IdentityFile/m)
  })

  test('không dùng key thì không có dòng IdentityFile nào', () => {
    const rows = resolveForExport([host({ id: 'h1', label: 'app-01', authType: 'password' })], [], [])
    expect(toSshConfig(rows)).not.toContain('IdentityFile')
  })

  test('mọi dòng đều là comment, chỉ thị hợp lệ hoặc dòng trống', () => {
    const rows = resolveForExport([host({ id: 'h1', label: 'app *01', username: 'deploy' })], [], [])
    for (const line of toSshConfig(rows).split('\n')) {
      if (line.trim() === '' || line.trim().startsWith('#')) continue
      expect(line).toMatch(/^(Host |\s{4}(HostName|Port|User|ProxyJump) )/)
    }
  })
})

describe('toCsv', () => {
  test('có dòng tiêu đề và phân cách CRLF', () => {
    const csv = toCsv(resolveForExport([host({ id: 'h1', label: 'app-01' })], [], []))
    const [header, first] = csv.split('\r\n')
    expect(header).toBe('alias,label,group,protocol,hostname,port,username,auth_type,key_label,proxy_jump')
    expect(first).toContain('app-01')
  })

  test('nhãn có dấu phẩy/nháy kép được quote đúng RFC 4180', () => {
    const csv = toCsv(resolveForExport([host({ id: 'h1', label: 'web, "chính"' })], [], []))
    expect(csv).toContain('"web, ""chính"""')
  })

  test('trường null thành ô rỗng chứ không phải chữ "null"', () => {
    const csv = toCsv(resolveForExport([host({ id: 'h1', label: 'app-01' })], [], []))
    expect(csv).not.toContain('null')
  })
})

describe('toJson', () => {
  test('parse lại được và giữ đủ trường', () => {
    const rows = resolveForExport([host({ id: 'h1', label: 'app-01', username: 'deploy' })], [], [])
    const parsed = JSON.parse(toJson(rows)) as { version: number; hosts: Array<Record<string, unknown>> }
    expect(parsed.version).toBe(1)
    expect(parsed.hosts[0]!.username).toBe('deploy')
    expect(parsed.hosts[0]!.alias).toBe('app-01')
  })
})

describe('không rò bí mật ra bản xuất', () => {
  const secretHost = host({
    id: 'h1',
    label: 'app-01',
    username: 'deploy',
    authType: 'password',
    hasPassword: true,
    notes: 'mật khẩu WordPress: hunter2',
    env: { API_TOKEN: 'tok_bi_mat' },
    secretRef: 'op://vault/item/field'
  })

  test.each(['ssh_config', 'csv', 'json'] as const)('%s không chứa notes/env/secretRef', (format) => {
    const text = renderExport(resolveForExport([secretHost], [], []), format)
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('tok_bi_mat')
    expect(text).not.toContain('API_TOKEN')
    expect(text).not.toContain('op://')
  })

  test('publicKey của key cũng không đi kèm — chỉ có nhãn', () => {
    const rows = resolveForExport([host({ id: 'h1', label: 'app-01', authType: 'key', keyId: 'k1' })], [], [KEY])
    const text = renderExport(rows, 'json')
    expect(text).toContain('deploy key')
    expect(text).not.toContain('AAAA')
  })
})
