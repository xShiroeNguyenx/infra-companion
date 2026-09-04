import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { VaultService as VaultServiceType } from './VaultService'
import { encryptField } from './crypto'

/**
 * F05 — danh bạ tài khoản DigitalOcean (nhiều token) + migration từ token đơn v0.2.13.
 * Cần `node:sqlite` (Node >= 22.5) — Node 20 tự skip (xem hướng dẫn ở vaultMerge.test.ts).
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
  for (const vault of openVaults) vault.close()
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

const MASTER = 'master-password-12345678'

/** Một vault DÙNG CHUNG cho cả file — setup() là argon2id ~1s, không tạo lại mỗi test. */
let shared: VaultServiceType | null = null
function sharedVault(): VaultServiceType {
  if (!shared) {
    const dir = mkdtempSync(join(tmpdir(), 'infra-do-accounts-'))
    tmpRoots.push(dir)
    shared = new VaultService!(join(dir, 'vault.db'))
    shared.setup(MASTER)
    openVaults.push(shared)
  }
  return shared
}

/** Truy cập hàm private để DỰNG trạng thái legacy của v0.2.13 — private của TS chỉ là compile-time. */
interface VaultPrivate {
  writeMeta(key: string, value: string): void
  readMeta(key: string): string | null
  requireDek(): Buffer
}
function privateApi(vault: VaultServiceType): VaultPrivate {
  return vault as unknown as VaultPrivate
}

describe.skipIf(VaultService === null)('danh bạ tài khoản DigitalOcean', () => {
  test('lưu nhiều tài khoản, mỗi tài khoản một token riêng; danh bạ KHÔNG chứa token', () => {
    const vault = sharedVault()
    const a = vault.saveDoAccount({ label: 'Cty A', token: 'token-a' })
    const b = vault.saveDoAccount({ label: 'Cá nhân', token: 'token-b' })

    const accounts = vault.listDoAccounts()
    expect(accounts.filter((x) => x.id === a.id || x.id === b.id)).toHaveLength(2)
    // DTO danh sách chỉ có id + label — token thật không được nằm ở đây (§4)
    for (const account of accounts) expect(Object.keys(account).sort()).toEqual(['id', 'label'])

    expect(vault.getDoToken(a.id)).toBe('token-a')
    expect(vault.getDoToken(b.id)).toBe('token-b')
  })

  test('save với id có sẵn = đổi tên; token undefined thì token cũ GIỮ NGUYÊN', () => {
    const vault = sharedVault()
    const a = vault.saveDoAccount({ label: 'Tên cũ', token: 'token-giu' })
    const renamed = vault.saveDoAccount({ id: a.id, label: 'Tên mới' })
    expect(renamed.id).toBe(a.id)
    expect(vault.listDoAccounts().find((x) => x.id === a.id)?.label).toBe('Tên mới')
    expect(vault.getDoToken(a.id)).toBe('token-giu')
    // và không đẻ thêm bản ghi thứ hai
    expect(vault.listDoAccounts().filter((x) => x.id === a.id)).toHaveLength(1)
  })

  test('label trống rơi về "DigitalOcean" thay vì tài khoản không tên', () => {
    const vault = sharedVault()
    const a = vault.saveDoAccount({ label: '   ', token: 'token-x' })
    expect(a.label).toBe('DigitalOcean')
  })

  test('xoá tài khoản là mất cả token của nó', () => {
    const vault = sharedVault()
    const a = vault.saveDoAccount({ label: 'Sắp xoá', token: 'token-doomed' })
    vault.deleteDoAccount(a.id)
    expect(vault.listDoAccounts().find((x) => x.id === a.id)).toBeUndefined()
    expect(vault.getDoToken(a.id)).toBeUndefined()
    // hàng meta của token cũng phải biến mất, không chỉ mất tham chiếu
    expect(privateApi(vault).readMeta(`do_token:${a.id}`)).toBeNull()
  })

  test('getDoToken với id không tồn tại → undefined, không ném', () => {
    const vault = sharedVault()
    expect(vault.getDoToken('id-khong-co')).toBeUndefined()
  })

  test('migration v0.2.13: token đơn ở "do_token" thành tài khoản "DigitalOcean", chạy đúng MỘT lần', () => {
    const vault = sharedVault()
    const priv = privateApi(vault)
    // Dựng trạng thái v0.2.13 để lại: một blob mã hoá DEK ở khoá 'do_token'
    priv.writeMeta('do_token', encryptField(priv.requireDek(), 'legacy-token'))

    // Lần đọc ĐẦU sau khi có khoá legacy → migrate ngay trong lần đọc đó
    const accounts = vault.listDoAccounts()
    const migrated = accounts.find((x) => x.label === 'DigitalOcean' && vault.getDoToken(x.id) === 'legacy-token')
    expect(migrated).toBeDefined()
    expect(priv.readMeta('do_token')).toBeNull()
    // Idempotent: đọc lại bao nhiêu lần cũng không đẻ thêm tài khoản
    expect(vault.listDoAccounts()).toHaveLength(accounts.length)
    expect(vault.listDoAccounts()).toHaveLength(accounts.length)
  })
})
