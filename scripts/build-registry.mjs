/**
 * Sinh registry marketplace (F52): quét docs/examples/<id>/ → docs/landing/registry/plugins.json.
 * Chạy: node scripts/build-registry.mjs   (chạy lại MỖI KHI sửa plugin mẫu rồi commit cùng nhau)
 *
 * Registry deploy tự động qua flow Pages (push main có thay đổi docs/landing/**):
 *   https://xshiroenguyenx.github.io/infra-companion/registry/plugins.json
 * URL file plugin trỏ raw.githubusercontent.com nhánh main — sha256 tính từ nội dung
 * local, nên registry + file plugin PHẢI được push trong cùng commit để checksum khớp.
 *
 * KÝ SỐ: mỗi entry được ký ed25519 bằng private key ~/.infra-companion/registry-signing-key.pem
 * (sinh bằng scripts/registry-keygen.mjs; override đường dẫn qua env INFRA_SIGNING_KEY).
 * Không có key → script DỪNG: app từ chối entry không có chữ ký hợp lệ.
 */
import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const examplesDir = join(root, 'docs', 'examples')
const outFile = join(root, 'docs', 'landing', 'registry', 'plugins.json')

const RAW_BASE = 'https://raw.githubusercontent.com/xShiroeNguyenx/infra-companion/main/docs/examples'
const AUTHOR = 'xShiroeNguyenx'

const keyPath = process.env.INFRA_SIGNING_KEY || join(homedir(), '.infra-companion', 'registry-signing-key.pem')
if (!existsSync(keyPath)) {
  console.error(`Thiếu private key ký registry: ${keyPath}\n→ chạy: node scripts/registry-keygen.mjs`)
  process.exit(1)
}
const signingKey = createPrivateKey(readFileSync(keyPath, 'utf8'))

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** Payload canonical — PHẢI khớp từng byte với pluginSigningPayload trong
 *  packages/core/src/plugins/signing.ts (test registry-file-check.test.ts là chốt chặn lệch). */
const signEntry = (entry) => {
  const files = [...entry.files].sort((a, b) => (a.name < b.name ? -1 : 1))
  const lines = ['infra-plugin-v1', entry.id, entry.version, ...files.map((f) => `${f.name}:${f.sha256}`)]
  return cryptoSign(null, Buffer.from(lines.join('\n'), 'utf8'), signingKey).toString('base64')
}

const plugins = []
for (const id of readdirSync(examplesDir).sort()) {
  const dir = join(examplesDir, id)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  } catch {
    console.warn(`bỏ qua ${id}: không đọc được manifest.json`)
    continue
  }
  if (manifest.id !== id) {
    console.error(`LỖI ${id}: manifest.id ("${manifest.id}") không trùng tên thư mục`)
    process.exitCode = 1
    continue
  }
  // Chỉ nhận file khớp luật registry: manifest.json hoặc *.js phẳng
  const files = readdirSync(dir)
    .filter((f) => f === 'manifest.json' || f.endsWith('.js'))
    .sort()
    .map((f) => ({
      name: f,
      url: `${RAW_BASE}/${id}/${f}`,
      sha256: sha256(readFileSync(join(dir, f)))
    }))
  const entry = {
    id,
    name: manifest.name ?? id,
    version: manifest.version ?? '0.0.0',
    description: manifest.description ?? null,
    author: AUTHOR,
    files
  }
  entry.signature = signEntry(entry)
  plugins.push(entry)
  console.log(`+ ${id} v${manifest.version} (${files.length} file, đã ký)`)
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify({ version: 1, updatedAt: new Date().toISOString().slice(0, 10), plugins }, null, 2) + '\n')
console.log(`\n→ ${outFile} (${plugins.length} plugin)`)
