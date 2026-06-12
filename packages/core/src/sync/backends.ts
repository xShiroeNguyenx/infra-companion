import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Nơi lưu blob vault đã mã hoá. Backend KHÔNG bao giờ thấy plaintext. */
export interface SyncBackend {
  /** Đọc blob; null nếu chưa có. */
  read(): Promise<string | null>
  write(blob: string): Promise<void>
  /** Mô tả ngắn để hiển thị. */
  describe(): string
}

const BLOB_NAME = 'infra-companion-vault.blob'

/**
 * Backend thư mục local — dùng được với mọi thư mục đồng bộ sẵn:
 * Syncthing, Dropbox, Google Drive, OneDrive, network share…
 */
export class FolderBackend implements SyncBackend {
  constructor(private readonly folderPath: string) {}

  private blobPath(): string {
    return join(this.folderPath, BLOB_NAME)
  }

  async read(): Promise<string | null> {
    const path = this.blobPath()
    if (!existsSync(path)) return null
    return readFile(path, 'utf8')
  }

  async write(blob: string): Promise<void> {
    const path = this.blobPath()
    await mkdir(dirname(path), { recursive: true })
    // Ghi qua file tạm rồi rename → atomic, tránh hỏng blob nếu app tắt giữa chừng
    const tmp = `${path}.tmp`
    await writeFile(tmp, blob, 'utf8')
    await rename(tmp, path)
  }

  describe(): string {
    return `Thư mục: ${this.folderPath}`
  }
}

export function createBackend(type: string, folderPath: string): SyncBackend {
  if (type === 'folder') return new FolderBackend(folderPath)
  throw new Error(`Backend chưa hỗ trợ: ${type}`)
}
