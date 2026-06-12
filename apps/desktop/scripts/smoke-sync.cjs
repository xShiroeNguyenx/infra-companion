/* Smoke test nền tảng sync E2EE: 2 "thiết bị" cùng passphrase + salt → cùng key → giải mã chéo. */
const assert = require('node:assert')
const { argon2id } = require('@noble/hashes/argon2.js')
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')

function deriveSyncKey(passphrase, saltB64) {
  const salt = Buffer.from(saltB64, 'base64')
  return Buffer.from(argon2id(passphrase.normalize('NFKC'), salt, { m: 19456, t: 2, p: 1, dkLen: 32 }))
}
function enc(key, text) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), ct.toString('base64'), c.getAuthTag().toString('base64')].join(':')
}
function dec(key, payload) {
  const [, iv, ct, tag] = payload.split(':')
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}

const salt = randomBytes(16).toString('base64')
const pass = 'team-sync-pass-123'

// Thiết bị A: tạo blob
const keyA = deriveSyncKey(pass, salt)
const snapshot = JSON.stringify({ hosts: [{ id: 'h1', label: 'web', password_plain: 'secret' }] })
const blob = `${salt}|${enc(keyA, snapshot)}`

// Thiết bị B: cùng passphrase, đọc salt từ blob → dẫn key → giải mã
const [readSalt, payload] = [blob.slice(0, blob.indexOf('|')), blob.slice(blob.indexOf('|') + 1)]
const keyB = deriveSyncKey(pass, readSalt)
assert.ok(keyA.equals(keyB), 'cùng pass+salt phải ra cùng key')
const decoded = JSON.parse(dec(keyB, payload))
assert.strictEqual(decoded.hosts[0].password_plain, 'secret')
console.log('sync-roundtrip-OK (device B giải mã được blob của device A)')

// Sai passphrase → không giải mã được (GCM auth fail)
const keyWrong = deriveSyncKey('wrong-pass', readSalt)
let failed = false
try { dec(keyWrong, payload) } catch { failed = true }
assert.ok(failed, 'sai passphrase phải fail')
console.log('sync-wrongpass-OK (sai passphrase không giải mã được)')

console.log('ALL-SYNC-SMOKE-OK')
