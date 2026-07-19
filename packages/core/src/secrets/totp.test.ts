import { describe, expect, it } from 'vitest'
import { applyTotpToken, base32Decode, generateTotp, isValidTotpSecret, normalizeTotpSecret } from './totp'

// Seed chuẩn RFC 6238 (SHA-1): ASCII "12345678901234567890" = base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('base32Decode', () => {
  it('giải mã seed RFC ra đúng ASCII', () => {
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890')
  })
  it('chấp nhận chữ thường + khoảng trắng + padding', () => {
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq==').toString('ascii')).toBe(
      '12345678901234567890'
    )
  })
  it('ký tự lạ → throw', () => {
    expect(() => base32Decode('ABC!DEF')).toThrow()
  })
})

describe('generateTotp — test vector RFC 6238 (SHA-1, 8 số cắt còn 6)', () => {
  // Bảng RFC 6238 Appendix B cho 8 digits; 6 digits = 6 số cuối
  const vectors: Array<[number, string]> = [
    [59_000, '287082'], // RFC: 94287082
    [1_111_111_109_000, '081804'], // RFC: 07081804
    [1_234_567_890_000, '005924'], // RFC: 89005924
    [2_000_000_000_000, '279037'] // RFC: 69279037
  ]
  for (const [ms, expected] of vectors) {
    it(`T=${ms / 1000}s → ${expected}`, () => {
      expect(generateTotp(RFC_SECRET, ms)).toBe(expected)
    })
  }
})

describe('normalize/validate', () => {
  it('chuẩn hoá: bỏ space/gạch, viết hoa, bỏ =', () => {
    expect(normalizeTotpSecret('gezd-gnbv gy3t\tqojq==')).toBe('GEZDGNBVGY3TQOJQ')
  })
  it('seed hợp lệ', () => {
    expect(isValidTotpSecret(RFC_SECRET)).toBe(true)
    expect(isValidTotpSecret('gezd gnbv')).toBe(true)
  })
  it('seed rác/quá ngắn/ký tự sai → false', () => {
    expect(isValidTotpSecret('')).toBe(false)
    expect(isValidTotpSecret('ABC')).toBe(false)
    expect(isValidTotpSecret('hello world!')).toBe(false) // có ký tự ngoài base32 sau chuẩn hoá (0,1,8,9,!)
  })
})

describe('applyTotpToken', () => {
  it('thay {{totp}} bằng mã tại thời điểm chỉ định', () => {
    expect(applyTotpToken('{{totp}}', RFC_SECRET, 59_000)).toBe('287082')
    expect(applyTotpToken('code {{totp}} end {{totp}}', RFC_SECRET, 59_000)).toBe('code 287082 end 287082')
  })
  it('không seed / không token → giữ nguyên', () => {
    expect(applyTotpToken('{{totp}}', undefined, 59_000)).toBe('{{totp}}')
    expect(applyTotpToken('ls -la', RFC_SECRET, 59_000)).toBe('ls -la')
  })
})
