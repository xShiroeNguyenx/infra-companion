import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { SyncSnapshot, VaultService as VaultServiceType } from './VaultService'

/**
 * Test merge sync E2EE (LWW + tombstone). Cần `node:sqlite` (Node >= 22.5).
 * Node 20 (dev local) không có → tự skip; chạy đủ bằng Node của Electron:
 *   $env:ELECTRON_RUN_AS_NODE=1; node_modules\.bin\electron node_modules\vitest\vitest.mjs run
 * hoặc nâng Node hệ thống lên 22+.
 */
let VaultService: typeof VaultServiceType | null = null
try {
  await import('node:sqlite')
  VaultService = (await import('./VaultService')).VaultService
} catch {
  // node:sqlite không có trên runtime này
}

const tmpRoots: string[] = []
const openVaults: VaultServiceType[] = []
afterAll(() => {
  for (const vault of openVaults) vault.close() // SQLite còn mở thì rmSync dính EPERM trên Windows
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

function newVault(label: string): VaultServiceType {
  const dir = mkdtempSync(join(tmpdir(), `infra-vault-${label}-`))
  tmpRoots.push(dir)
  const vault = new VaultService!(join(dir, 'vault.db'))
  vault.setup(`master-${label}-12345678`)
  openVaults.push(vault)
  return vault
}

function emptySnapshot(): SyncSnapshot {
  return { version: 1, groups: [], keys: [], hosts: [], snippets: [], tunnels: [], knownHosts: [], tombstones: [] }
}

describe.skipIf(VaultService === null)('Sync merge (LWW + tombstone)', () => {
  test('host đồng bộ sang vault khác: secret được mã hoá lại bằng DEK local', () => {
    const a = newVault('a1')
    const b = newVault('b1')
    a.saveHost({ label: 'web', hostname: '10.0.0.1', port: 22, username: 'root', authType: 'password', password: 'p@ss-bí-mật' })

    const changed = b.importSnapshot(a.exportSnapshot())
    expect(changed).toBeGreaterThanOrEqual(1)

    const hostB = b.exportSnapshot().hosts[0]!
    expect(hostB.label).toBe('web')
    // password giải mã được bằng DEK của B (đã re-encrypt) — và đúng giá trị gốc
    expect(hostB.password_plain).toBe('p@ss-bí-mật')
  })

  test('secret_ref không bị mất khi merge (regression: thiếu cột trong importSnapshot)', () => {
    const a = newVault('a2')
    const b = newVault('b2')
    a.saveHost({ label: 'op-host', hostname: '10.0.0.2', port: 22, username: 'ops', authType: 'secret', secretRef: 'op://Vault/item/password' })

    b.importSnapshot(a.exportSnapshot())
    expect(b.exportSnapshot().hosts[0]!.secret_ref).toBe('op://Vault/item/password')
  })

  test('LWW: bản mới hơn thắng, bản cũ hơn không ghi đè', () => {
    const a = newVault('a3')
    const b = newVault('b3')
    a.saveHost({ label: 'v1', hostname: '10.0.0.3', port: 22, username: 'u', authType: 'password' })
    const snap = a.exportSnapshot()
    b.importSnapshot(snap)

    const base = snap.hosts[0]!
    const newer: SyncSnapshot = { ...emptySnapshot(), hosts: [{ ...base, label: 'v2-mới', updated_at: Number(base.updated_at) + 1000 }] }
    expect(b.importSnapshot(newer)).toBe(1)
    expect(b.exportSnapshot().hosts[0]!.label).toBe('v2-mới')

    const older: SyncSnapshot = { ...emptySnapshot(), hosts: [{ ...base, label: 'v0-cũ', updated_at: Number(base.updated_at) - 5000 }] }
    expect(b.importSnapshot(older)).toBe(0)
    expect(b.exportSnapshot().hosts[0]!.label).toBe('v2-mới')
  })

  test('tombstone: xoá lan sang máy khác và bản ghi cũ không "hồi sinh"', () => {
    const a = newVault('a4')
    const b = newVault('b4')
    const host = a.saveHost({ label: 'sắp-xoá', hostname: '10.0.0.4', port: 22, username: 'u', authType: 'password' })
    const snapWithHost = a.exportSnapshot()
    b.importSnapshot(snapWithHost)
    expect(b.exportSnapshot().hosts).toHaveLength(1)

    a.deleteHost(host.id)
    const snapDeleted = a.exportSnapshot()
    expect(snapDeleted.hosts).toHaveLength(0)
    expect(snapDeleted.tombstones.some((t) => t.recordId === host.id && t.table === 'hosts')).toBe(true)

    // xoá lan sang B
    b.importSnapshot(snapDeleted)
    expect(b.exportSnapshot().hosts).toHaveLength(0)

    // import lại snapshot CŨ (còn host, updated_at < deletedAt) → không hồi sinh
    b.importSnapshot(snapWithHost)
    expect(b.exportSnapshot().hosts).toHaveLength(0)
  })

  test('tombstone với tên bảng lạ bị từ chối (chống SQL injection) + rollback', () => {
    const b = newVault('b5')
    b.saveSnippet({ label: 's', script: 'echo 1' })
    const evil: SyncSnapshot = {
      ...emptySnapshot(),
      tombstones: [{ recordId: 'x', table: 'meta; DROP TABLE hosts;--', deletedAt: Date.now() }]
    }
    expect(() => b.importSnapshot(evil)).toThrow()
    // transaction rollback — dữ liệu cũ còn nguyên
    expect(b.exportSnapshot().snippets).toHaveLength(1)
  })

  test('snippet/tunnel/group cùng đi qua merge', () => {
    const a = newVault('a6')
    const b = newVault('b6')
    const group = a.saveGroup({ name: 'Sakura', username: 'vn_dev' })
    a.saveSnippet({ label: 'uptime', script: 'uptime' })
    const host = a.saveHost({ label: 'h', hostname: '1.1.1.1', port: 22, username: 'u', authType: 'password', groupId: group.id })
    a.saveTunnel({ hostId: host.id, type: 'D', bindPort: 1080, label: 'SOCKS5 :1080' })

    b.importSnapshot(a.exportSnapshot())
    const snapB = b.exportSnapshot()
    expect(snapB.groups.map((g) => g.name)).toContain('Sakura')
    expect(snapB.snippets).toHaveLength(1)
    expect(snapB.tunnels).toHaveLength(1)
  })
})
