import { describe, expect, test } from 'vitest'
import {
  checkVerifier,
  decryptField,
  deriveKek,
  deriveSyncKey,
  encryptField,
  generateDek,
  makeVerifier,
  newKdfParams,
  newSyncSalt,
  unwrapDek,
  wrapDek
} from './crypto'

describe('KDF (argon2id)', () => {
  test('cùng password + cùng salt → cùng KEK (mở được trên máy khác)', () => {
    const params = newKdfParams()
    const a = deriveKek('mật khẩu chủ 123', params)
    const b = deriveKek('mật khẩu chủ 123', params)
    expect(a.equals(b)).toBe(true)
    expect(a.length).toBe(32)
  })

  test('khác salt → khác KEK', () => {
    const a = deriveKek('password-123', newKdfParams())
    const b = deriveKek('password-123', newKdfParams())
    expect(a.equals(b)).toBe(false)
  })

  test('password được normalize NFKC (gõ Unicode tổ hợp vẫn mở được)', () => {
    const params = newKdfParams()
    // "ế" dạng dựng sẵn (U+1EBF) vs dạng tổ hợp (e + U+0302 + U+0301)
    const precomposed = deriveKek('kết', params)
    const combining = deriveKek('kết', params)
    expect(precomposed.equals(combining)).toBe(true)
  })

  test('sync key: cùng passphrase + cùng salt chia sẻ → cùng key giữa các thiết bị', () => {
    const salt = newSyncSalt()
    expect(deriveSyncKey('sync-pass-1', salt).equals(deriveSyncKey('sync-pass-1', salt))).toBe(true)
    expect(deriveSyncKey('sync-pass-1', salt).equals(deriveSyncKey('sync-pass-2', salt))).toBe(false)
  })
})

describe('Wrap/unwrap DEK', () => {
  test('roundtrip đúng KEK', () => {
    const kek = deriveKek('master-pass-123', newKdfParams())
    const dek = generateDek()
    const unwrapped = unwrapDek(wrapDek(dek, kek), kek)
    expect(unwrapped?.equals(dek)).toBe(true)
  })

  test('sai master password → null (không ném lỗi)', () => {
    const params = newKdfParams()
    const dek = generateDek()
    const wrapped = wrapDek(dek, deriveKek('đúng-mật-khẩu', params))
    expect(unwrapDek(wrapped, deriveKek('sai-mật-khẩu', params))).toBeNull()
  })
})

describe('Field encryption (AES-256-GCM)', () => {
  const dek = generateDek()

  test('roundtrip kể cả Unicode/emoji', () => {
    const plain = 'password tiếng Việt — 日本語 — 🔐'
    expect(decryptField(dek, encryptField(dek, plain))).toBe(plain)
  })

  test('mỗi lần mã hoá ra payload khác nhau (IV ngẫu nhiên)', () => {
    expect(encryptField(dek, 'x')).not.toBe(encryptField(dek, 'x'))
  })

  test('payload định dạng v1:iv:ct:tag', () => {
    const parts = encryptField(dek, 'abc').split(':')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
  })

  test('sai key → null', () => {
    expect(decryptField(generateDek(), encryptField(dek, 'secret'))).toBeNull()
  })

  test('dữ liệu bị sửa → null (GCM auth fail)', () => {
    const payload = encryptField(dek, 'secret')
    const [v, iv, ct, tag] = payload.split(':')
    const flipped = Buffer.from(ct!, 'base64')
    flipped[0] = flipped[0]! ^ 0xff
    expect(decryptField(dek, [v, iv, flipped.toString('base64'), tag].join(':'))).toBeNull()
  })

  test('payload rác / sai version → null', () => {
    expect(decryptField(dek, 'không phải payload')).toBeNull()
    expect(decryptField(dek, 'v2:a:b:c')).toBeNull()
  })
})

describe('Verifier', () => {
  test('đúng DEK → true, khác DEK → false', () => {
    const dek = generateDek()
    const verifier = makeVerifier(dek)
    expect(checkVerifier(dek, verifier)).toBe(true)
    expect(checkVerifier(generateDek(), verifier)).toBe(false)
  })
})
