import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { argon2id } from '@noble/hashes/argon2.js'

/**
 * Mô hình khoá 2 tầng:
 *   master password ──argon2id──▶ KEK ──AES-256-GCM──▶ mở DEK (random 32 byte)
 *   DEK dùng mã hoá field-level mọi secret trong DB.
 * Đổi master password chỉ cần wrap lại DEK, không phải mã hoá lại dữ liệu.
 */

export interface KdfParams {
  algo: 'argon2id'
  /** memory cost tính bằng KiB */
  m: number
  /** số vòng lặp */
  t: number
  /** độ song song */
  p: number
  saltB64: string
}

// Baseline OWASP cho argon2id (19 MiB, t=2, p=1) — pure-JS (@noble/hashes) chạy < 1s
export function newKdfParams(): KdfParams {
  return { algo: 'argon2id', m: 19_456, t: 2, p: 1, saltB64: randomBytes(16).toString('base64') }
}

/** Salt riêng cho sync (không bí mật — lưu kèm cấu hình, chia sẻ qua backend). */
export function newSyncSalt(): string {
  return randomBytes(16).toString('base64')
}

/**
 * Sync key: argon2id từ sync passphrase + salt dùng chung giữa các thiết bị.
 * Tách biệt với master password (KEK/DEK local) — backend chỉ thấy blob mã hoá bằng key này.
 */
export function deriveSyncKey(passphrase: string, saltB64: string): Buffer {
  return deriveKek(passphrase, { algo: 'argon2id', m: 19_456, t: 2, p: 1, saltB64 })
}

export function deriveKek(masterPassword: string, params: KdfParams): Buffer {
  const salt = Buffer.from(params.saltB64, 'base64')
  const key = argon2id(masterPassword.normalize('NFKC'), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: 32
  })
  return Buffer.from(key)
}

export function generateDek(): Buffer {
  return randomBytes(32)
}

const PAYLOAD_VERSION = 'v1'

function encryptRaw(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PAYLOAD_VERSION, iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join(':')
}

function decryptRaw(key: Buffer, payload: string): Buffer | null {
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== PAYLOAD_VERSION) return null
  try {
    const [, ivB64, ctB64, tagB64] = parts
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64!, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64!, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ctB64!, 'base64')), decipher.final()])
  } catch {
    return null // sai key hoặc dữ liệu bị sửa — GCM auth fail
  }
}

export function wrapDek(dek: Buffer, kek: Buffer): string {
  return encryptRaw(kek, dek)
}

/** Trả về null nếu master password sai. */
export function unwrapDek(wrapped: string, kek: Buffer): Buffer | null {
  return decryptRaw(kek, wrapped)
}

export function encryptField(dek: Buffer, plaintext: string): string {
  return encryptRaw(dek, Buffer.from(plaintext, 'utf8'))
}

/** Trả về null nếu payload hỏng/sai key (không ném lỗi để caller tự xử lý). */
export function decryptField(dek: Buffer, payload: string): string | null {
  const result = decryptRaw(dek, payload)
  return result ? result.toString('utf8') : null
}

/** Verifier để kiểm tra DEK đúng mà không cần thử giải mã dữ liệu thật. */
export function makeVerifier(dek: Buffer): string {
  return encryptRaw(dek, Buffer.from('infra-companion-vault-verifier'))
}

export function checkVerifier(dek: Buffer, verifier: string): boolean {
  const result = decryptRaw(dek, verifier)
  if (!result) return false
  const expected = Buffer.from('infra-companion-vault-verifier')
  return result.length === expected.length && timingSafeEqual(result, expected)
}
