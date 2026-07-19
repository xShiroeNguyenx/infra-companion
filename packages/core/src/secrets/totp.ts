import { createHmac } from 'node:crypto'

/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 số, chu kỳ 30s) — đủ cho Google Authenticator/mọi server
 * SSH dùng google-authenticator PAM. Không dùng thư viện ngoài: HMAC từ node:crypto.
 * Seed lưu mã hoá trong vault (hosts.totp_enc); login script dùng token `{{totp}}` —
 * SshSession thay bằng mã TƯƠI ngay lúc gửi (mã chỉ sống 30s nên không thay sớm hơn).
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Chuẩn hoá seed user dán vào: bỏ khoảng trắng/gạch nối, viết hoa, bỏ '=' padding. */
export function normalizeTotpSecret(raw: string): string {
  return raw.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
}

/** Seed hợp lệ: base32 (A-Z, 2-7), tối thiểu 8 ký tự (5 byte). */
export function isValidTotpSecret(raw: string): boolean {
  const s = normalizeTotpSecret(raw)
  return s.length >= 8 && /^[A-Z2-7]+$/.test(s)
}

/** Giải mã base32 (RFC 4648, không padding) → Buffer. Ký tự lạ → throw. */
export function base32Decode(input: string): Buffer {
  const s = normalizeTotpSecret(input)
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of s) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error(`Ký tự base32 không hợp lệ: "${ch}"`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return Buffer.from(out)
}

/**
 * Sinh mã TOTP 6 số tại thời điểm `nowMs` (mặc định Date.now()).
 * Seed sai định dạng → throw (caller nên validate bằng isValidTotpSecret khi lưu).
 */
export function generateTotp(secret: string, nowMs = Date.now(), periodSec = 30, digits = 6): string {
  const key = base32Decode(secret)
  const counter = Math.floor(nowMs / 1000 / periodSec)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(msg).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const code =
    (((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!) %
    10 ** digits
  return String(code).padStart(digits, '0')
}

/** Token trong login script được thay bằng mã TOTP tươi lúc gửi. */
export const TOTP_TOKEN = '{{totp}}'

/** Thay mọi `{{totp}}` trong chuỗi bằng mã hiện tại. Không có seed → giữ nguyên. */
export function applyTotpToken(text: string, secret: string | undefined, nowMs = Date.now()): string {
  if (!secret || !text.includes(TOTP_TOKEN)) return text
  return text.replaceAll(TOTP_TOKEN, generateTotp(secret, nowMs))
}
