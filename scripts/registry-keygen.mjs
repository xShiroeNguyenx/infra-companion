/**
 * Sinh cặp khóa ed25519 ký registry marketplace. Chạy 1 LẦN: node scripts/registry-keygen.mjs
 *
 * - PRIVATE key → ~/.infra-companion/registry-signing-key.pem (NGOÀI repo — không bao giờ commit).
 *   ⚠️ BACKUP file này (password manager / USB). Mất = không ký được registry mới,
 *   phải xoay khóa: sinh cặp mới + thay OFFICIAL_REGISTRY_PUBLIC_KEY_PEM trong
 *   packages/core/src/plugins/signing.ts + phát hành bản app mới.
 * - PUBLIC key → in ra màn hình để dán vào signing.ts (nhúng trong app).
 *
 * Từ chối chạy nếu private key đã tồn tại (chống ghi đè nhầm).
 */
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const keyPath = process.env.INFRA_SIGNING_KEY || join(homedir(), '.infra-companion', 'registry-signing-key.pem')

if (existsSync(keyPath)) {
  console.error(`Đã có private key: ${keyPath} — không ghi đè. Xoá tay nếu thật sự muốn xoay khóa.`)
  process.exit(1)
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })

mkdirSync(dirname(keyPath), { recursive: true })
writeFileSync(keyPath, privatePem, { mode: 0o600 })

console.log(`✓ Private key: ${keyPath}  (BACKUP NGAY — xem chú thích đầu file script)`)
console.log('\nPublic key — dán vào OFFICIAL_REGISTRY_PUBLIC_KEY_PEM (packages/core/src/plugins/signing.ts):\n')
console.log(publicPem)
