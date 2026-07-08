/**
 * Ký số entry marketplace bằng ed25519 (bước 2 sau F52 v1): chữ ký phủ id + version +
 * danh sách (tên file : sha256) — đổi BẤT KỲ thứ gì trong đó là chữ ký vô hiệu.
 * Chống kịch bản registry/CDN bị chiếm: kẻ tấn công thay được cả file lẫn checksum
 * trong plugins.json, nhưng không có PRIVATE key thì không giả được chữ ký,
 * app (giữ PUBLIC key nhúng sẵn) sẽ loại entry ngay từ lúc tải registry.
 *
 * Payload canonical (phải khớp từng byte với scripts/build-registry.mjs):
 *   infra-plugin-v1 \n id \n version \n (name:sha256 theo tên file tăng dần, mỗi dòng 1 file)
 * — không có newline cuối. Prefix "infra-plugin-v1" để chống dùng lại chữ ký sai ngữ cảnh.
 *
 * Khóa: sinh bằng scripts/registry-keygen.mjs — private nằm NGOÀI repo
 * (~/.infra-companion/registry-signing-key.pem), mất là phải xoay khóa (thay hằng
 * public key dưới đây + phát hành app mới).
 */
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import type { RegistryPluginEntry } from './registry'

/** Public key chính chủ của registry mặc định (Pages). */
export const OFFICIAL_REGISTRY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAH/QuYM3WmOQt75uA0aa3/8YbQ51jIhXK46BwFU+Bo3A=
-----END PUBLIC KEY-----
`

type SignablePluginEntry = Pick<RegistryPluginEntry, 'id' | 'version' | 'files'>

/** Payload canonical đem ký/verify. Sort theo tên file để không phụ thuộc thứ tự trong JSON. */
export function pluginSigningPayload(entry: SignablePluginEntry): Buffer {
  const files = [...entry.files].sort((a, b) => (a.name < b.name ? -1 : 1))
  const lines = ['infra-plugin-v1', entry.id, entry.version, ...files.map((f) => `${f.name}:${f.sha256}`)]
  return Buffer.from(lines.join('\n'), 'utf8')
}

/** Ký entry → chữ ký base64. Throw nếu PEM sai — chỉ dùng phía maintainer/test. */
export function signPluginEntry(entry: SignablePluginEntry, privateKeyPem: string): string {
  return cryptoSign(null, pluginSigningPayload(entry), createPrivateKey(privateKeyPem)).toString('base64')
}

/** Verify chữ ký của entry. KHÔNG throw: PEM/chữ ký hỏng, thiếu signature → false. */
export function verifyPluginEntry(
  entry: RegistryPluginEntry,
  publicKeyPem: string = OFFICIAL_REGISTRY_PUBLIC_KEY_PEM
): boolean {
  if (!entry.signature) return false
  try {
    return cryptoVerify(
      null,
      pluginSigningPayload(entry),
      createPublicKey(publicKeyPem),
      Buffer.from(entry.signature, 'base64')
    )
  } catch {
    return false
  }
}
