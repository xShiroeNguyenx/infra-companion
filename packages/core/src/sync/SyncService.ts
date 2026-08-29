import { decryptField, encryptField } from '../vault/crypto'
import type { SyncSnapshot, VaultService } from '../vault/VaultService'
import { BLOB_NAME, createBackend, findNearMissBlobs, type SyncBackend } from './backends'

export interface SyncResult {
  pulled: number
  hadRemote: boolean
  ok: boolean
  /** Đã ghi blob mới lên backend hay chưa. false = bị chặn, hoặc không có gì để ghi. */
  wrote: boolean
  /** Bị chặn vì nghi ngờ mất dữ liệu — user xác nhận rồi gọi lại với `force`. */
  needsConfirm?: boolean
  error?: string
}

/** Blob giải mã được nhưng không dùng được — phân biệt để báo đúng nguyên nhân. */
export type BlobError = 'corrupt' | 'wrong-pass'

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

/** Vault chưa có gì đồng bộ được — ghi blob rỗng đè lên backend là hành động chỉ có hại. */
export function isEmptySnapshot(snapshot: SyncSnapshot): boolean {
  return (
    snapshot.groups.length === 0 &&
    snapshot.keys.length === 0 &&
    snapshot.hosts.length === 0 &&
    snapshot.snippets.length === 0 &&
    snapshot.tunnels.length === 0 &&
    snapshot.knownHosts.length === 0 &&
    snapshot.tombstones.length === 0
  )
}

/**
 * Đồng bộ E2EE: pull blob remote → merge vào vault (LWW + tombstone) → push lại blob hợp nhất.
 * Backend chỉ thấy blob mã hoá; sync key không bao giờ rời thiết bị.
 */
export class SyncService {
  /** Đọc salt từ blob (để dẫn xuất đúng key). null nếu blob hỏng định dạng. */
  static saltOf(blob: string): string | null {
    return splitBlob(blob)?.saltB64 ?? null
  }

  /** Đọc salt từ blob remote (để main dẫn xuất key đúng). null nếu chưa có blob. */
  static async readRemoteSalt(backend: SyncBackend): Promise<string | null> {
    const blob = await backend.read()
    if (!blob) return null
    return SyncService.saltOf(blob)
  }

  /** Đóng gói vault thành blob: salt plaintext ở header + snapshot mã hoá bằng sync key. */
  buildBlob(vault: VaultService, syncKey: Buffer, saltB64: string): string {
    return `${saltB64}|${encryptField(syncKey, JSON.stringify(vault.exportSnapshot()))}`
  }

  /** Giải blob rồi merge vào vault. Trả số bản ghi nhận được, hoặc lý do thất bại. */
  applyBlob(vault: VaultService, blob: string, syncKey: Buffer): number | BlobError {
    const parts = splitBlob(blob)
    if (!parts) return 'corrupt'
    const json = decryptField(syncKey, parts.payload)
    if (json === null) return 'wrong-pass'
    return vault.importSnapshot(JSON.parse(json) as SyncSnapshot)
  }

  /**
   * Backend không có blob. Trước khi ghi đè phải phân biệt "chưa từng có" với "có mà không
   * thấy" — ghi nhầm ở trường hợp sau là xoá sạch vault của mọi máy khác.
   * Trả về SyncResult để dừng lại, hoặc null nếu ghi tiếp là an toàn.
   */
  private async guardMissingRemote(
    vault: VaultService,
    backend: SyncBackend,
    syncedBefore: boolean
  ): Promise<SyncResult | null> {
    const blocked = (error: string): SyncResult => ({
      pulled: 0,
      hadRemote: false,
      ok: false,
      wrote: false,
      needsConfirm: true,
      error
    })

    const nearMisses = await backend.listNearMisses()
    if (nearMisses.length > 0) {
      return blocked(
        `Không thấy "${BLOB_NAME}" nhưng thư mục có file gần giống: ${nearMisses.join(', ')}. ` +
          `Nhiều khả năng file bị đổi tên lúc tải về — đổi lại đúng tên rồi thử lại. Đã DỪNG để không ghi đè.`
      )
    }
    if (syncedBefore) {
      return blocked(
        `Máy này từng đồng bộ thành công với thư mục đó, nhưng bây giờ "${BLOB_NAME}" không còn. ` +
          `Dịch vụ lưu trữ có thể chưa tải xong, hoặc thư mục đã bị đổi. Đã DỪNG để không ghi đè.`
      )
    }
    if (isEmptySnapshot(vault.exportSnapshot())) {
      // Vault trống + backend trống → không có gì để làm. Ghi blob rỗng chỉ tạo rủi ro
      // đè lên dữ liệu thật đang trên đường tải về.
      return { pulled: 0, hadRemote: false, ok: true, wrote: false }
    }
    return null
  }

  async sync(
    vault: VaultService,
    backend: SyncBackend,
    syncKey: Buffer,
    saltB64: string,
    opts: { syncedBefore?: boolean; force?: boolean } = {}
  ): Promise<SyncResult> {
    try {
      const blob = await backend.read()
      const hadRemote = blob !== null
      let pulled = 0

      if (blob !== null) {
        const applied = this.applyBlob(vault, blob, syncKey)
        if (applied === 'corrupt') {
          return { pulled: 0, hadRemote: true, ok: false, wrote: false, error: 'Blob remote hỏng định dạng' }
        }
        if (applied === 'wrong-pass') {
          return {
            pulled: 0,
            hadRemote: true,
            ok: false,
            wrote: false,
            error: 'Sai sync passphrase (không giải mã được)'
          }
        }
        pulled = applied
      } else if (!opts.force) {
        const guard = await this.guardMissingRemote(vault, backend, opts.syncedBefore === true)
        if (guard) return guard
      }

      await backend.write(this.buildBlob(vault, syncKey, saltB64))
      return { pulled, hadRemote, ok: true, wrote: true }
    } catch (error) {
      return {
        pulled: 0,
        hadRemote: false,
        ok: false,
        wrote: false,
        error: error instanceof Error ? error.message : String(error)
      }
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

export { BLOB_NAME, createBackend, findNearMissBlobs }
export type { SyncBackend }
