import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { VaultService as VaultServiceType } from './VaultService'

/**
 * Xem lại bí mật đã lưu + xác thực lại master password.
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

function newVault(label: string): VaultServiceType {
  const dir = mkdtempSync(join(tmpdir(), `infra-reveal-${label}-`))
  tmpRoots.push(dir)
  const vault = new VaultService!(join(dir, 'vault.db'))
  vault.setup(MASTER)
  openVaults.push(vault)
  return vault
}

/**
 * Dùng chung vault giữa các test trong cùng nhóm.
 *
 * `setup()` và `verifyMasterPassword()` đều là argon2id 19 MiB pure-JS (~1s/lần). Tạo vault
 * riêng cho mỗi test làm file này ngốn CPU và khiến test argon2id ở file khác **timeout ở
 * 5000ms** khi cả suite chạy song song — đã dính đúng lỗi đó khi thêm suite sync. Test nào
 * đổi trạng thái khoá thì mới cần vault riêng, và phải trả lại trạng thái cũ.
 */
let shared: VaultServiceType | null = null
function sharedVault(): VaultServiceType {
  shared ??= newVault('shared')
  return shared
}

describe.skipIf(VaultService === null)('verifyMasterPassword', () => {
  test('đúng → true, sai → false, rỗng → false (không ném)', () => {
    const vault = sharedVault()
    expect(vault.verifyMasterPassword(MASTER)).toBe(true)
    expect(vault.verifyMasterPassword('sai-mat-khau-12345678')).toBe(false)
    expect(vault.verifyMasterPassword('')).toBe(false)
  })

  test('KHÔNG mở vault như tác dụng phụ khi gõ đúng lúc đang khoá', () => {
    // Đây là lý do tồn tại của hàm này: `unlock()` gán this.dek nên gọi nó để "kiểm tra"
    // sẽ mở vault ra — một hộp thoại xem mật khẩu không được phép làm thế.
    const vault = sharedVault()
    vault.lock()
    try {
      expect(vault.state()).toBe('locked')
      expect(vault.verifyMasterPassword(MASTER)).toBe(true)
      expect(vault.state()).toBe('locked')
    } finally {
      vault.unlock(MASTER) // trả lại trạng thái cho các test dùng chung vault này
    }
  })

  test('KHÔNG khoá vault khi gõ sai', () => {
    const vault = sharedVault()
    expect(vault.state()).toBe('unlocked')
    expect(vault.verifyMasterPassword('sai-mat-khau-12345678')).toBe(false)
    expect(vault.state()).toBe('unlocked')
  })
})

describe.skipIf(VaultService === null)('reveal bí mật đã lưu', () => {
  test('lấy đúng mật khẩu đã lưu của host', () => {
    const vault = sharedVault()
    const host = vault.saveHost({
      label: 'app-01',
      hostname: 'app-01',
      port: 22,
      username: 'deploy',
      authType: 'password',
      password: 'mật-khẩu-thật-01'
    })
    expect(vault.revealHostPassword(host.id)).toBe('mật-khẩu-thật-01')
  })

  test('host chưa lưu mật khẩu → null (không phải chuỗi rỗng)', () => {
    const vault = sharedVault()
    const host = vault.saveHost({ label: 'app-02', hostname: 'app-02', port: 22, username: 'deploy', authType: 'agent' })
    expect(vault.revealHostPassword(host.id)).toBeNull()
  })

  test('host không tồn tại → null', () => {
    expect(sharedVault().revealHostPassword('khong-co-id')).toBeNull()
  })

  test('lấy đúng passphrase đã lưu của key', () => {
    const vault = sharedVault()
    const key = vault.importKey({
      label: 'có-passphrase',
      privateKey: encryptedPem(KEY_PASSPHRASE),
      passphrase: KEY_PASSPHRASE
    })
    expect(vault.revealKeyPassphrase(key.id)).toBe(KEY_PASSPHRASE)
  })

  test('key sinh trong app (không passphrase) → null; key không tồn tại → null', () => {
    const vault = sharedVault()
    const key = vault.generateKey('khong-passphrase')
    expect(vault.revealKeyPassphrase(key.id)).toBeNull()
    expect(vault.revealKeyPassphrase('khong-co-id')).toBeNull()
  })

  test('vault khoá thì ném chứ không trả bí mật', () => {
    const vault = sharedVault()
    const host = vault.saveHost({
      label: 'app-03',
      hostname: 'app-03',
      port: 22,
      username: 'deploy',
      authType: 'password',
      password: 'khong-duoc-lo'
    })
    vault.lock()
    try {
      expect(() => vault.revealHostPassword(host.id)).toThrow()
    } finally {
      vault.unlock(MASTER)
    }
  })
})

const KEY_PASSPHRASE = 'passphrase-cua-key'

/**
 * Sinh MỘT key RSA đã mã hoá ngay lúc chạy test.
 *
 * Cố ý không nhúng key mẫu vào repo: repo public, và một khối PEM literal vừa làm gitleaks
 * đỏ (phải thêm allowlist) vừa tạo tiền lệ xấu. RSA chứ không phải ed25519 vì `ssh2.parseKey`
 * không đọc được PKCS8 ed25519 (xem ghi chú trong `generateKey`).
 */
function encryptedPem(passphrase: string): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase }
  }).privateKey
}
