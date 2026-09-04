import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { VaultService as VaultServiceType } from './VaultService'

/**
 * SyncConfig nhiều kênh (v0.2.15) + migration lười từ cấu hình MỘT kênh của các bản trước.
 * Cần `node:sqlite` (Node >= 22.5) — Node 20 tự skip (xem hướng dẫn ở vaultMerge.test.ts).
 */
let VaultService: typeof VaultServiceType | null = null
let LEGACY_ID = ''
try {
  await import('node:sqlite')
  const mod = await import('./VaultService')
  VaultService = mod.VaultService
  LEGACY_ID = mod.LEGACY_SYNC_CHANNEL_ID
} catch {
  // node:sqlite không có trên runtime này
}

const tmpRoots: string[] = []
const openVaults: VaultServiceType[] = []
afterAll(() => {
  for (const vault of openVaults) vault.close()
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

/** Một vault DÙNG CHUNG cho cả file — setup() là argon2id ~1s, không tạo lại mỗi test. */
let shared: VaultServiceType | null = null
function sharedVault(): VaultServiceType {
  if (!shared) {
    const dir = mkdtempSync(join(tmpdir(), 'infra-sync-config-'))
    tmpRoots.push(dir)
    shared = new VaultService!(join(dir, 'vault.db'))
    shared.setup('master-password-12345678')
    openVaults.push(shared)
  }
  return shared
}

/** Ghi thẳng meta để DỰNG trạng thái cũ — private của TS chỉ là compile-time. */
function writeMeta(vault: VaultServiceType, key: string, value: string): void {
  ;(vault as unknown as { writeMeta(k: string, v: string): void }).writeMeta(key, value)
}

describe.skipIf(VaultService === null)('SyncConfig nhiều kênh', () => {
  test('chưa cấu hình → null', () => {
    expect(sharedVault().getSyncConfig()).toBeNull()
  })

  test('migration: cấu hình MỘT kênh cũ (field phẳng) → danh sách 1 kênh id "legacy", giữ đủ field', () => {
    const vault = sharedVault()
    writeMeta(
      vault,
      'sync_config',
      JSON.stringify({ backend: 'folder', folderPath: 'D:/sync-test', saltB64: 'salt1', autoMinutes: 30, seenRemoteAt: 123 })
    )
    const config = vault.getSyncConfig()
    expect(config).toEqual({
      channels: [
        { id: LEGACY_ID, backend: 'folder', folderPath: 'D:/sync-test', saltB64: 'salt1', gdriveFileId: undefined, seenRemoteAt: 123 }
      ],
      autoMinutes: 30
    })
    // Đã GHI LẠI dạng mới — đọc lần nữa không đi qua nhánh migration (idempotent)
    expect(vault.getSyncConfig()).toEqual(config)
  })

  test('thêm kênh thứ hai: hai kênh sống song song, mỗi kênh salt riêng', () => {
    const vault = sharedVault()
    const config = vault.getSyncConfig()!
    vault.setSyncConfig({
      ...config,
      channels: [...config.channels, { id: 'gd1', backend: 'gdrive', folderPath: '', saltB64: 'salt2', gdriveFileId: 'f9' }]
    })
    const next = vault.getSyncConfig()!
    expect(next.channels).toHaveLength(2)
    expect(next.channels.map((c) => c.backend)).toEqual(['folder', 'gdrive'])
    expect(next.channels[1]).toMatchObject({ saltB64: 'salt2', gdriveFileId: 'f9' })
    expect(next.autoMinutes).toBe(30)
  })

  test('JSON meta hỏng dạng (không phải kênh cũ, không phải danh sách) → null, không ném', () => {
    const vault = sharedVault()
    writeMeta(vault, 'sync_config', JSON.stringify({ hello: 1 }))
    expect(vault.getSyncConfig()).toBeNull()
    vault.clearSyncConfig()
    expect(vault.getSyncConfig()).toBeNull()
  })
})
