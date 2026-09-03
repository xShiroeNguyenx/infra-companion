import { describe, expect, test } from 'vitest'
import { groupOf, needsReboot, summarizeFleet, summarizeUpdates } from '@infra/shared'
import {
  applySecurityNames,
  detectManagerCommand,
  parseManager,
  parseSecurityNames,
  parseUpdates,
  securityCount,
  securityListCommand,
  updatesCommand,
  type PackageManager,
  type PackageUpdate
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

  test('dnf/yum PHẢI có -C — không thì nó tự đi mạng tải metadata và chết vì timeout', () => {
    // Đã dính thật: `dnf check-update` trần refresh cache hết hạn → vượt 60s trên máy nhiều repo
    expect(updatesCommand('dnf')).toContain('-C')
    expect(updatesCommand('yum')).toContain('-C')
  })

  test('không lệnh nào tự làm mới metadata', () => {
    for (const m of ['apt', 'dnf', 'yum', 'apk'] as const) {
      expect(updatesCommand(m)!).not.toMatch(/\b(makecache|refresh)\b/)
      expect(updatesCommand(m)!).not.toMatch(/\b(apt|apt-get|apk) update\b/)
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

describe('bảo mật trên dnf — tên repo KHÔNG nói được', () => {
  test('dnf/yum có lệnh updateinfo riêng, apt/apk thì không cần', () => {
    // Repo RHEL chỉ là baseos/appstream → dò theo tên repo cho ra "435 gói, 0 bảo mật"
    expect(securityListCommand('dnf')).toContain('updateinfo list --security')
    expect(securityListCommand('yum')).toContain('updateinfo list --security')
    expect(securityListCommand('apt')).toBeNull()
    expect(securityListCommand('apk')).toBeNull()
  })

  test('lệnh updateinfo cũng phải -C, không đi mạng', () => {
    expect(securityListCommand('dnf')).toContain('-C')
  })

  test('bóc được tên gói khỏi NEVRA', () => {
    const out = `RHSA-2024:1234 Important/Sec. openssl-1:3.0.7-24.el9.x86_64
RHSA-2024:5678 Moderate/Sec.  kernel-core-5.14.0-427.el9.x86_64
`
    expect([...parseSecurityNames(out)].sort()).toEqual(['kernel-core', 'openssl'])
  })

  test('output rỗng / rác → tập rỗng, không ném', () => {
    expect(parseSecurityNames('').size).toBe(0)
    expect(parseSecurityNames('Khong co gi\n').size).toBe(0)
  })

  test('gán cờ security theo tên, gói khác giữ nguyên', () => {
    const updates = parseUpdates('dnf', 'openssl.x86_64 1:3.0.7-24.el9 baseos\nacl.x86_64 2.3.1-4.el9 baseos\n')
    const marked = applySecurityNames(updates, new Set(['openssl']))
    expect(marked.find((u) => u.name === 'openssl')!.security).toBe(true)
    expect(marked.find((u) => u.name === 'acl')!.security).toBe(false)
  })

  test('danh sách rỗng thì trả về nguyên mảng cũ', () => {
    const updates = parseUpdates('dnf', 'acl.x86_64 2.3.1-4.el9 baseos\n')
    expect(applySecurityNames(updates, new Set())).toBe(updates)
  })
})

describe('summarizeUpdates — trả lời "tình hình thế nào"', () => {
  const make = (names: string[], security: string[] = []): PackageUpdate[] =>
    names.map((name) => ({ name, current: null, candidate: '1.0', security: security.includes(name) }))

  test('xếp gói vào nhóm theo tên, nhận cả tên Debian lẫn RHEL', () => {
    expect(groupOf('kernel-core')).toBe('kernel')
    expect(groupOf('linux-image-amd64')).toBe('kernel')
    expect(groupOf('glibc')).toBe('core')
    expect(groupOf('libc6')).toBe('core')
    expect(groupOf('openssl')).toBe('core')
    expect(groupOf('nginx')).toBe('web')
    expect(groupOf('php-fpm')).toBe('web')
    expect(groupOf('mariadb-server')).toBe('db')
    expect(groupOf('python3-libs')).toBe('runtime')
    expect(groupOf('acl')).toBe('other')
  })

  test('kernel → phải khởi động lại; glibc/systemd cũng vậy', () => {
    // Vá kernel mà không reboot thì máy vẫn chạy bản cũ — tức là "đã vá" nhưng chưa hết lỗ hổng
    expect(needsReboot(make(['kernel-core']))).toBe(true)
    expect(needsReboot(make(['glibc']))).toBe(true)
    expect(needsReboot(make(['systemd']))).toBe(true)
    expect(needsReboot(make(['acl', 'nginx']))).toBe(false)
  })

  test('nhóm xếp theo mức đáng chú ý, kernel trước, other cuối', () => {
    const s = summarizeUpdates(make(['acl', 'nginx', 'kernel-core', 'glibc']))
    expect(s.groups.map((g) => g.group)).toEqual(['kernel', 'core', 'web', 'other'])
  })

  test('nhóm rỗng KHÔNG xuất hiện', () => {
    expect(summarizeUpdates(make(['acl'])).groups.map((g) => g.group)).toEqual(['other'])
  })

  test('đếm tổng và đếm bảo mật', () => {
    const s = summarizeUpdates(make(['openssl', 'acl', 'nginx'], ['openssl']))
    expect(s.total).toBe(3)
    expect(s.security).toBe(1)
  })

  test('tên trong mỗi nhóm sắp xếp ổn định', () => {
    const s = summarizeUpdates(make(['zlib', 'acl', 'bash']))
    expect(s.groups[0]!.names).toEqual(['acl', 'bash', 'zlib'])
  })

  test('không có gói nào → tóm tắt rỗng, không ném', () => {
    expect(summarizeUpdates([])).toEqual({ total: 0, security: 0, needsReboot: false, groups: [] })
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

describe('summarizeFleet — mấy con số đứng đầu màn hình', () => {
  const host = (names: string[], security: string[] = [], error?: string) => ({
    updates: names.map((name) => ({ name, current: null, candidate: '1.0', security: security.includes(name) })),
    error
  })

  test('đếm máy cần vá / đã đủ / lỗi tách bạch', () => {
    const s = summarizeFleet([host(['acl']), host([]), host([], [], 'mất kết nối')])
    expect(s).toMatchObject({ scanned: 3, needPatch: 1, clean: 1, failed: 1 })
  })

  test('máy lỗi KHÔNG bị tính là "đã cập nhật đủ"', () => {
    // Máy lỗi có updates = [] nên nếu chỉ xét độ dài mảng thì nó thành "đã đủ" — sai theo
    // hướng làm người ta yên tâm, đúng loại sai tệ nhất ở một màn hình về vá lỗi
    const s = summarizeFleet([host([], [], 'không dò được package manager')])
    expect(s.clean).toBe(0)
    expect(s.failed).toBe(1)
  })

  test('đếm cả số MÁY và số GÓI bảo mật', () => {
    const s = summarizeFleet([host(['openssl', 'acl'], ['openssl']), host(['glibc'], ['glibc']), host(['acl'])])
    expect(s.securityHosts).toBe(2)
    expect(s.securityPackages).toBe(2)
  })

  test('đếm số máy phải khởi động lại', () => {
    const s = summarizeFleet([host(['kernel-core']), host(['nginx']), host(['systemd'])])
    expect(s.rebootHosts).toBe(2)
  })

  test('chưa quét gì → toàn số 0, không ném', () => {
    expect(summarizeFleet([])).toMatchObject({ scanned: 0, needPatch: 0, clean: 0, failed: 0 })
  })
})
