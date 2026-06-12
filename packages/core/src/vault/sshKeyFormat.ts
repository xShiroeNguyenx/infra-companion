import { randomBytes } from 'node:crypto'

/**
 * Đóng gói cặp khoá ed25519 (seed 32B + public 32B) theo định dạng OpenSSH private key
 * (openssh-key-v1, không mã hoá) — định dạng duy nhất ssh2 và OpenSSH đều đọc được với ed25519.
 * Tham khảo: PROTOCOL.key trong source OpenSSH.
 */
export function ed25519ToOpenSshPrivate(seed: Buffer, publicKey: Buffer, comment: string): string {
  const keyType = 'ssh-ed25519'
  const publicBlob = Buffer.concat([lpString(keyType), lpString(publicKey)])

  const check = randomBytes(4)
  const unpadded = Buffer.concat([
    check,
    check,
    lpString(keyType),
    lpString(publicKey),
    lpString(Buffer.concat([seed, publicKey])), // private = seed || public (64 byte)
    lpString(comment)
  ])
  // cipher "none" → pad tới bội số 8 bằng chuỗi 1,2,3,…
  const padLen = (8 - (unpadded.length % 8)) % 8
  const privateBlock = Buffer.concat([
    unpadded,
    Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1))
  ])

  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'latin1'),
    lpString('none'), // ciphername
    lpString('none'), // kdfname
    lpString(''), // kdfoptions
    uint32(1), // số lượng key
    lpString(publicBlob),
    lpString(privateBlock)
  ])

  const b64 = body.toString('base64').replace(/(.{70})/g, '$1\n')
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}${b64.endsWith('\n') ? '' : '\n'}-----END OPENSSH PRIVATE KEY-----\n`
}

/** length-prefixed string theo wire format SSH. */
function lpString(value: Buffer | string): Buffer {
  const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  return Buffer.concat([uint32(buf.length), buf])
}

function uint32(value: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(value, 0)
  return buf
}
