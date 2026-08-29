import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Tên file blob. Mọi máy phải khớp CHÍNH XÁC — lệch một ký tự là không thấy nhau. */
export const BLOB_NAME = 'infra-companion-vault.blob'

const BLOB_STEM = 'infra-companion-vault'

/** Nơi lưu blob vault đã mã hoá. Backend KHÔNG bao giờ thấy plaintext. */
export interface SyncBackend {
  /** Đọc blob; null nếu chưa có. */
  read(): Promise<string | null>
  write(blob: string): Promise<void>
  /** Mô tả ngắn để hiển thị. */
  describe(): string
  /**
   * Tên các file TRÔNG GIỐNG blob nhưng sai tên. Rỗng = không có gì đáng ngờ.
   * Dùng để phân biệt "thư mục thật sự chưa có dữ liệu" với "dữ liệu có đó nhưng app
   * không thấy" — hai trường hợp này nhìn giống hệt nhau nếu chỉ dựa vào `read()`.
   */
  listNearMisses(): Promise<string[]>
}

/**
 * Lọc tên file gần-giống blob. Hàm thuần để test được không cần fs.
 *
 * Vì sao cần: `read()` trả null có hai nghĩa hoàn toàn khác nhau — "thư mục trống thật" và
 * "file có đó nhưng tên bị đổi". Trình duyệt tải trùng tên thì thành `... (1).blob`,
 * Syncthing/Drive tạo bản conflict, tải dở thì `.part`/`.crdownload`. Không phân biệt được
 * thì app sẽ ghi đè blob rỗng lên dữ liệu thật mà không báo gì.
 */
export function findNearMissBlobs(fileNames: string[]): string[] {
  return fileNames.filter((name) => name !== BLOB_NAME && name.toLowerCase().includes(BLOB_STEM))
}

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

  async listNearMisses(): Promise<string[]> {
    try {
      return findNearMissBlobs(await readdir(this.folderPath))
    } catch {
      return [] // thư mục chưa tồn tại / không đọc được → không có gì để cảnh báo
    }
  }

  describe(): string {
    return `Thư mục: ${this.folderPath}`
  }
}

export function createBackend(type: string, folderPath: string): SyncBackend {
  if (type === 'folder') return new FolderBackend(folderPath)
  throw new Error(`Backend chưa hỗ trợ: ${type}`)
}
