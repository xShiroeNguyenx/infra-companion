/* Smoke test Phase 1 — chạy bằng Electron-as-Node: node các mắt xích runtime quan trọng. */
const assert = require('node:assert')

// 1. @noble/hashes argon2id load được qua require (ESM interop của Node 24)
const { argon2id } = require('@noble/hashes/argon2.js')
const key = argon2id('test-password', Buffer.from('0123456789abcdef'), { m: 19456, t: 2, p: 1, dkLen: 32 })
assert.strictEqual(key.length, 32)
console.log('argon2id-OK')

// 2. AES-256-GCM round-trip
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')
const dek = randomBytes(32)
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', dek, iv)
const ct = Buffer.concat([cipher.update('bí mật'), cipher.final()])
const tag = cipher.getAuthTag()
const decipher = createDecipheriv('aes-256-gcm', dek, iv)
decipher.setAuthTag(tag)
assert.strictEqual(Buffer.concat([decipher.update(ct), decipher.final()]).toString(), 'bí mật')
console.log('aes-gcm-OK')

// 3. node:sqlite
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE t(a TEXT)')
db.prepare('INSERT INTO t VALUES (?)').run('x')
assert.strictEqual(db.prepare('SELECT a FROM t').get().a, 'x')
console.log('sqlite-OK')

// 4. Sinh key ed25519 (JWK → openssh-key-v1) + ssh2 parse + public key OpenSSH
const { generateKeyPairSync } = require('node:crypto')
const { utils } = require('ssh2')

function lpString(value) {
  const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  const len = Buffer.alloc(4)
  len.writeUInt32BE(buf.length, 0)
  return Buffer.concat([len, buf])
}
function toOpenSsh(seed, pub, comment) {
  const publicBlob = Buffer.concat([lpString('ssh-ed25519'), lpString(pub)])
  const check = randomBytes(4)
  const unpadded = Buffer.concat([
    check, check, lpString('ssh-ed25519'), lpString(pub),
    lpString(Buffer.concat([seed, pub])), lpString(comment)
  ])
  const padLen = (8 - (unpadded.length % 8)) % 8
  const privBlock = Buffer.concat([unpadded, Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1))])
  const numKeys = Buffer.alloc(4)
  numKeys.writeUInt32BE(1, 0)
  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'latin1'),
    lpString('none'), lpString('none'), lpString(''), numKeys,
    lpString(publicBlob), lpString(privBlock)
  ])
  const b64 = body.toString('base64').replace(/(.{70})/g, '$1\n')
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}${b64.endsWith('\n') ? '' : '\n'}-----END OPENSSH PRIVATE KEY-----\n`
}

const { privateKey } = generateKeyPairSync('ed25519')
const jwk = privateKey.export({ format: 'jwk' })
const openssh = toOpenSsh(Buffer.from(jwk.d, 'base64url'), Buffer.from(jwk.x, 'base64url'), 'test')
const parsed = utils.parseKey(openssh)
if (parsed instanceof Error) throw parsed
assert.strictEqual(parsed.type, 'ssh-ed25519')
const pubLine = `${parsed.type} ${parsed.getPublicSSH().toString('base64')} test`
assert.ok(pubLine.startsWith('ssh-ed25519 AAAA'))
console.log('keygen-OK', pubLine.slice(0, 40) + '…')

console.log('ALL-SMOKE-OK')
