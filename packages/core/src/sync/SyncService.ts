import { decryptField, encryptField } from '../vault/crypto'
import type { SyncSnapshot, VaultService } from '../vault/VaultService'
import { createBackend, type SyncBackend } from './backends'

export interface SyncResult {
  pulled: number
  hadRemote: boolean
  ok: boolean
  error?: string
}

/**
 * Blob format: "<saltB64>|<encryptField output>".
 * Salt nằm plaintext ở header (không bí mật) để thiết bị khác dẫn xuất cùng sync key
 * từ cùng passphrase. Payload mã hoá AES-256-GCM bằng sync key.
 */
function splitBlob(blob: string): { saltB64: string; payload: string } | null {
  const idx = blob.indexOf('|')
  if (idx <= 0) return null
  return { saltB64: blob.slice(0, idx), payload: blob.slice(idx + 1) }
}

/**
 * Đồng bộ E2EE: pull blob remote → merge vào vault (LWW + tombstone) → push lại blob hợp nhất.
 * Backend chỉ thấy blob mã hoá; sync key không bao giờ rời thiết bị.
 */
export class SyncService {
  /** Đọc salt từ blob remote (để main dẫn xuất key đúng). null nếu chưa có blob. */
  static async readRemoteSalt(backend: SyncBackend): Promise<string | null> {
    const blob = await backend.read()
    if (!blob) return null
    return splitBlob(blob)?.saltB64 ?? null
  }

  async sync(vault: VaultService, backend: SyncBackend, syncKey: Buffer, saltB64: string): Promise<SyncResult> {
    try {
      const blob = await backend.read()
      let pulled = 0
      const hadRemote = blob !== null

      if (blob) {
        const parts = splitBlob(blob)
        if (!parts) return { pulled: 0, hadRemote: true, ok: false, error: 'Blob remote hỏng định dạng' }
        const json = decryptField(syncKey, parts.payload)
        if (json === null) {
          return { pulled: 0, hadRemote: true, ok: false, error: 'Sai sync passphrase (không giải mã được)' }
        }
        const remote = JSON.parse(json) as SyncSnapshot
        pulled = vault.importSnapshot(remote)
      }

      const merged = vault.exportSnapshot()
      await backend.write(`${saltB64}|${encryptField(syncKey, JSON.stringify(merged))}`)
      return { pulled, hadRemote, ok: true }
    } catch (error) {
      return { pulled: 0, hadRemote: false, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Kiểm tra sync key giải mã được blob hiện có. */
  async verify(backend: SyncBackend, syncKey: Buffer): Promise<'ok' | 'wrong-pass' | 'no-remote'> {
    const blob = await backend.read()
    if (!blob) return 'no-remote'
    const parts = splitBlob(blob)
    if (!parts) return 'wrong-pass'
    return decryptField(syncKey, parts.payload) === null ? 'wrong-pass' : 'ok'
  }
}

export { createBackend }
export type { SyncBackend }
