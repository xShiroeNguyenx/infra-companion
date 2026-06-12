import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type SecretProvider = '1password' | 'bitwarden' | 'vault'

/** Nhận diện secret manager từ tiền tố tham chiếu. */
export function detectSecretProvider(ref: string): SecretProvider | null {
  const r = ref.trim()
  if (r.startsWith('op://')) return '1password'
  if (r.startsWith('bw://')) return 'bitwarden'
  if (r.startsWith('vault://')) return 'vault'
  return null
}

/**
 * Lấy secret từ secret manager qua CLI đã đăng nhập sẵn trên máy (F11):
 *   - op://vault/item/field        → 1Password CLI:  op read "op://..."
 *   - bw://<item-id-hoặc-tên>       → Bitwarden CLI:  bw get password <item> (cần BW_SESSION)
 *   - vault://<path>#<field>        → HashiCorp Vault: vault kv get -field=<field> <path>
 * Secret KHÔNG bao giờ lưu trong app — chỉ lưu tham chiếu, resolve lúc kết nối.
 */
export async function resolveSecret(ref: string): Promise<string> {
  const r = ref.trim()
  try {
    if (r.startsWith('op://')) {
      const { stdout } = await execFileAsync('op', ['read', r], { timeout: 20_000, windowsHide: true })
      return stdout.trim()
    }
    if (r.startsWith('bw://')) {
      const item = r.slice('bw://'.length)
      if (!item) throw new Error('Thiếu tên/ID item Bitwarden sau bw://')
      assertNotFlag(item)
      const { stdout } = await execFileAsync('bw', ['get', 'password', item], { timeout: 20_000, windowsHide: true })
      return stdout.trim()
    }
    if (r.startsWith('vault://')) {
      const body = r.slice('vault://'.length)
      const hashIdx = body.lastIndexOf('#')
      const path = hashIdx >= 0 ? body.slice(0, hashIdx) : body
      const field = hashIdx >= 0 ? body.slice(hashIdx + 1) : 'value'
      if (!path) throw new Error('Thiếu path sau vault://')
      assertNotFlag(path)
      const { stdout } = await execFileAsync('vault', ['kv', 'get', `-field=${field}`, path], {
        timeout: 20_000,
        windowsHide: true
      })
      return stdout.trim()
    }
    throw new Error('Tham chiếu không hợp lệ. Dùng op://vault/item/field, bw://<item>, hoặc vault://<path>#<field>')
  } catch (error) {
    const e = error as { code?: string; killed?: boolean; stderr?: string; message?: string }
    if (e.code === 'ENOENT') {
      throw new Error('Không tìm thấy CLI của secret manager (op / bw / vault) trong PATH — cài và đăng nhập trước')
    }
    if (e.killed) {
      throw new Error('CLI secret manager không phản hồi sau 20s (chưa đăng nhập / chờ xác nhận?)')
    }
    const detail = (e.stderr || e.message || '').toString().trim().slice(0, 200)
    throw new Error(`Lấy secret thất bại: ${detail || 'lỗi không rõ'}`)
  }
}

/** Item/path bắt đầu bằng "-" sẽ bị CLI hiểu nhầm là flag. */
function assertNotFlag(value: string): void {
  if (value.startsWith('-')) throw new Error(`Tham chiếu không hợp lệ (bắt đầu bằng "-"): ${value}`)
}
