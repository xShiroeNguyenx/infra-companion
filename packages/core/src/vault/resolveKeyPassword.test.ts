import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { VaultService as VaultServiceType } from './VaultService'

/**
 * Test nhánh auth 'key+password' (MFA: server đòi CẢ publickey LẪN password).
 * Cần `node:sqlite` (Node >= 22.5) — Node 20 dev local không có → tự skip
 * (chạy đủ bằng Node của Electron, xem hướng dẫn trong vaultMerge.test.ts).
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

function newVault(label: string): VaultServiceType {
  const dir = mkdtempSync(join(tmpdir(), `infra-vault-${label}-`))
  tmpRoots.push(dir)
  const vault = new VaultService!(join(dir, 'vault.db'))
  vault.setup(`master-${label}-12345678`)
  openVaults.push(vault)
  return vault
}

describe.skipIf(VaultService === null)("auth 'key+password' (MFA publickey,password)", () => {
  test('resolve: có cả privateKey lẫn password, không cần hỏi thêm', () => {
    const v = newVault('kp1')
    const key = v.generateKey('ci-key')
    const host = v.saveHost({
      label: 'mfa-host',
      hostname: '10.0.0.10',
      port: 22,
      username: 'ops',
      authType: 'key+password',
      keyId: key.id,
      password: 'p@ss-2-lớp'
    })

    const target = v.resolveConnection(host.id).target
    expect(target.authType).toBe('key+password')
    expect(target.privateKey).toBeTruthy() // key được nạp để trình publickey
    expect(target.password).toBe('p@ss-2-lớp') // password lưu sẵn → không hỏi
    expect(target.needsPassword).toBe(false)
  })

  test('resolve: chưa lưu password → needsPassword=true (main sẽ hỏi user)', () => {
    const v = newVault('kp2')
    const key = v.generateKey('ci-key')
    const host = v.saveHost({
      label: 'mfa-ask',
      hostname: '10.0.0.11',
      port: 22,
      username: 'ops',
      authType: 'key+password',
      keyId: key.id
    })

    const target = v.resolveConnection(host.id).target
    expect(target.privateKey).toBeTruthy()
    expect(target.password).toBeUndefined()
    expect(target.needsPassword).toBe(true)
  })

  test('resolve: thiếu key → báo lỗi', () => {
    const v = newVault('kp3')
    const host = v.saveHost({
      label: 'mfa-nokey',
      hostname: '10.0.0.12',
      port: 22,
      username: 'ops',
      authType: 'key+password',
      password: 'x'
    })
    expect(() => v.resolveConnection(host.id)).toThrow(/chưa chọn key/)
  })

  test('key kế thừa từ group, password trên host', () => {
    const v = newVault('kp4')
    const key = v.generateKey('grp-key')
    const group = v.saveGroup({ name: 'prod', authType: 'key+password', keyId: key.id })
    const host = v.saveHost({
      label: 'inherit-host',
      hostname: '10.0.0.13',
      port: 22,
      username: 'ops',
      groupId: group.id,
      password: 'từ-host'
    })

    const target = v.resolveConnection(host.id).target
    expect(target.authType).toBe('key+password')
    expect(target.privateKey).toBeTruthy() // key kế thừa từ group
    expect(target.password).toBe('từ-host')
    expect(target.needsPassword).toBe(false)
  })
})
