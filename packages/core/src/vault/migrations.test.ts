import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { VaultService as VaultServiceType } from './VaultService'

/**
 * Migration chạy được từ DB TRỐNG lên bản mới nhất, và v18 (dọn tàn dư VPN) không làm mất host.
 * Cần `node:sqlite` (Node >= 22.5) — Node 20 tự skip (xem hướng dẫn ở vaultMerge.test.ts).
 */
let VaultService: typeof VaultServiceType | null = null
let openDatabase: typeof import('./db').openDatabase | null = null
try {
  await import('node:sqlite')
  VaultService = (await import('./VaultService')).VaultService
  openDatabase = (await import('./db')).openDatabase
} catch {
  // node:sqlite không có trên runtime này
}

const tmpRoots: string[] = []
const openVaults: VaultServiceType[] = []
afterAll(() => {
  for (const vault of openVaults) vault.close()
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

function newDbPath(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `infra-mig-${label}-`))
  tmpRoots.push(dir)
  return join(dir, 'vault.db')
}

describe.skipIf(VaultService === null)('Migration vault', () => {
  test('DB trống chạy hết migration, không ném', () => {
    const db = openDatabase!(newDbPath('fresh'))
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    expect(version).toBeGreaterThanOrEqual(18)
    db.close()
  })

  test('v18 đã xoá hẳn tàn dư VPN', () => {
    const db = openDatabase!(newDbPath('vpn'))
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map(
      (r) => r.name
    )
    expect(tables).not.toContain('vpn_profiles')
    const hostCols = (db.prepare('PRAGMA table_info(hosts)').all() as Array<{ name: string }>).map((r) => r.name)
    expect(hostCols).not.toContain('vpn_profile_id')
    // Cột của v17 vẫn còn — chứng minh v18 không nuốt nhầm thứ khác
    const groupCols = (db.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>).map((r) => r.name)
    expect(groupCols).toContain('production')
    db.close()
  })

  test('host lưu TRƯỚC khi migrate vẫn còn nguyên sau khi migrate', () => {
    // Đây là điều duy nhất thật sự đáng lo khi bỏ một cột: SQLite phải giữ lại dữ liệu
    const path = newDbPath('keep')
    const vault = new VaultService!(path)
    vault.setup('master-migration-12345678')
    openVaults.push(vault)
    const host = vault.saveHost({
      label: 'app-01',
      hostname: 'app-01',
      port: 22,
      username: 'deploy',
      authType: 'agent'
    })
    vault.close()

    const reopened = new VaultService!(path)
    openVaults.push(reopened)
    expect(reopened.state()).toBe('locked')
    expect(reopened.unlock('master-migration-12345678')).toBe(true)
    expect(reopened.listHosts().map((h) => h.id)).toContain(host.id)
  })
})
