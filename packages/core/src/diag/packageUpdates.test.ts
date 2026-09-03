import { describe, expect, test } from 'vitest'
import {
  detectManagerCommand,
  parseManager,
  parseUpdates,
  securityCount,
  updatesCommand,
  type PackageManager
} from './packageUpdates'

describe('dò package manager', () => {
  test('dùng `command -v` chứ không phải `which` (image tối giản không có which)', () => {
    expect(detectManagerCommand()).toContain('command -v')
    expect(detectManagerCommand()).not.toContain('which ')
  })

  test('KHÔNG dùng $(…) hay backtick — hop login-script bóc mất một lớp quote', () => {
    const cmds = [detectManagerCommand(), ...(['apt', 'dnf', 'yum', 'apk'] as const).map((m) => updatesCommand(m) ?? '')]
    for (const cmd of cmds) {
      expect(cmd).not.toContain('$(')
      expect(cmd).not.toContain('`')
    }
  })

  test('đọc tên đầu tiên in ra', () => {
    expect(parseManager('apt\n')).toBe('apt')
    expect(parseManager(' dnf \n')).toBe('dnf')
    expect(parseManager('unknown\n')).toBe('unknown')
  })

  test('output lạ / rỗng → unknown chứ không ném', () => {
    expect(parseManager('')).toBe('unknown')
    expect(parseManager('bash: command not found\n')).toBe('unknown')
  })

  test('không dò được thì KHÔNG có lệnh nào để chạy', () => {
    expect(updatesCommand('unknown' as PackageManager)).toBeNull()
  })

  test('apt CỐ Ý không chạy `apt update` trước — đó là lệnh ghi, cần root', () => {
    const cmd = updatesCommand('apt')!
    expect(cmd).toContain('--upgradable')
    expect(cmd).not.toContain('apt update')
    expect(cmd).not.toContain('apt-get update')
  })

  test('không lệnh nào thật sự CÀI gì', () => {
    for (const m of ['apt', 'dnf', 'yum', 'apk'] as const) {
      const cmd = updatesCommand(m)!
      expect(cmd).not.toMatch(/\b(install|upgrade|dist-upgrade)\b/)
    }
  })
})

describe('parseUpdates — apt', () => {
  const OUT = `Listing...
nginx/jammy-updates 1.18.0-6ubuntu14.4 amd64 [upgradable from: 1.18.0-6ubuntu14.3]
openssl/jammy-security 3.0.2-0ubuntu1.15 amd64 [upgradable from: 3.0.2-0ubuntu1.14]
curl/jammy-updates 7.81.0-1ubuntu1.16 amd64 [upgradable from: 7.81.0-1ubuntu1.15]
`

  test('đọc tên, bản đang cài và bản mới', () => {
    const rows = parseUpdates('apt', OUT)
    expect(rows).toHaveLength(3)
    const nginx = rows.find((r) => r.name === 'nginx')!
    expect(nginx.current).toBe('1.18.0-6ubuntu14.3')
    expect(nginx.candidate).toBe('1.18.0-6ubuntu14.4')
  })

  test('repo `-security` được đánh dấu và xếp lên đầu', () => {
    const rows = parseUpdates('apt', OUT)
    expect(rows[0]!.name).toBe('openssl')
    expect(rows[0]!.security).toBe(true)
    expect(securityCount(rows)).toBe(1)
  })

  test('dòng "Listing..." không thành một gói ma', () => {
    expect(parseUpdates('apt', OUT).some((r) => r.name.startsWith('Listing'))).toBe(false)
  })

  test('gói chưa cài (không có "upgradable from") vẫn đọc được, current = null', () => {
    const rows = parseUpdates('apt', 'foo/jammy 1.2.3 amd64\n')
    expect(rows[0]).toMatchObject({ name: 'foo', candidate: '1.2.3', current: null })
  })
})

describe('parseUpdates — dnf/yum', () => {
  const OUT = `
nginx.x86_64                 1:1.20.1-14.el9_2            appstream
openssl-libs.x86_64          1:3.0.7-24.el9_3             baseos-security
tzdata.noarch                2024a-1.el9                  baseos
`

  test('bóc kiến trúc khỏi tên gói', () => {
    const rows = parseUpdates('dnf', OUT)
    expect(rows.map((r) => r.name).sort()).toEqual(['nginx', 'openssl-libs', 'tzdata'])
  })

  test('repo có "security" được đánh dấu', () => {
    expect(parseUpdates('dnf', OUT).find((r) => r.name === 'openssl-libs')!.security).toBe(true)
  })

  test('yum dùng chung parser với dnf', () => {
    expect(parseUpdates('yum', OUT)).toHaveLength(3)
  })

  test('dnf không nói bản đang cài → current = null, không bịa', () => {
    expect(parseUpdates('dnf', OUT).every((r) => r.current === null)).toBe(true)
  })
})

describe('parseUpdates — apk', () => {
  test('đọc dạng `pkg-1.2.3 < 1.2.4`', () => {
    const rows = parseUpdates('apk', 'nginx-1.24.0-r6 < 1.24.0-r7\nbusybox-1.36.1-r5 < 1.36.1-r7\n')
    expect(rows.find((r) => r.name === 'nginx')).toMatchObject({ current: '1.24.0-r6', candidate: '1.24.0-r7' })
  })
})

describe('parseUpdates — chung', () => {
  test('cùng gói ở nhiều repo chỉ tính một lần', () => {
    const dup = `nginx/jammy-updates 1.18.0-2 amd64 [upgradable from: 1.18.0-1]
nginx/jammy-backports 1.18.0-3 amd64 [upgradable from: 1.18.0-1]
`
    expect(parseUpdates('apt', dup)).toHaveLength(1)
  })

  test('output rỗng → mảng rỗng (máy đã vá đủ, không phải lỗi)', () => {
    expect(parseUpdates('apt', '')).toEqual([])
    expect(parseUpdates('dnf', '')).toEqual([])
  })

  test('manager unknown → rỗng, không cố parse bừa', () => {
    expect(parseUpdates('unknown', 'nginx/jammy 1.2.3 amd64\n')).toEqual([])
  })

  test('output rác không sinh ra gói nào', () => {
    expect(parseUpdates('apt', 'bash: apt: command not found\nsudo: a password is required\n')).toEqual([])
  })

  test('không có bản bảo mật nào → securityCount = 0', () => {
    expect(securityCount(parseUpdates('apt', 'curl/jammy 1.2.3 amd64\n'))).toBe(0)
  })
})
