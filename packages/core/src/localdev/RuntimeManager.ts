import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { runtimeDir } from './paths'
import { verifyRuntimeEntry, type RuntimeManifestEntry } from './runtimeCatalog'
import type { LocalDevPaths } from './types'
import type { PlatformAdapter } from './platform/PlatformAdapter'

/**
 * Tải / verify / giải nén / gỡ runtime (PHP, nginx…).
 *
 * KHÁC `marketplace.ts` ở điểm cốt tử: `fetchBytes` ở đó buffer TOÀN BỘ body vào RAM
 * (`res.arrayBuffer()`, trần 5MB). MariaDB zip ~100MB nên phải **stream ra đĩa** và tính
 * sha256 cộng dồn theo chunk. Phần còn lại (verify sha256 TRƯỚC khi dùng, chữ ký ed25519)
 * giữ đúng tinh thần marketplace.
 *
 * Các bất biến an toàn:
 *  1. Chữ ký sai ⇒ dừng TRƯỚC khi tốn 1 byte mạng.
 *  2. sha256 sai ⇒ xoá file tải dở, KHÔNG bao giờ giải nén.
 *  3. Giải nén vào staging rồi mới `rename` sang thư mục thật ⇒ không bao giờ để lại runtime
 *     nửa vời khi mất điện/huỷ giữa đường.
 *  4. Ghi `.infra-runtime.json` là bước CUỐI ⇒ sự tồn tại của file này = "đã cài xong".
 */

export interface RuntimeProgress {
  id: string
  phase: 'download' | 'verify' | 'extract' | 'verify-exe' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number | null
  percent: number
  error?: string
}

/** Provenance ghi cạnh runtime — nguồn sự thật để biết đã cài gì, không suy diễn từ tên thư mục. */
export interface RuntimeProvenance {
  id: string
  version: string
  sha256: string
  /** URL thật đã tải (có thể là mirror) — để audit về sau. */
  sourceUrl: string
  installedAt: number
  verifiedAt: number | null
}

export interface DownloadStream {
  stream: AsyncIterable<Uint8Array>
  totalBytes: number | null
}

export interface RuntimeManagerDeps {
  paths: LocalDevPaths
  adapter: PlatformAdapter
  /** Mở stream tải — inject để test bằng fake, không cần mạng. */
  openStream(url: string, signal: AbortSignal): Promise<DownloadStream>
  /** Public key verify chữ ký manifest; bỏ trống = key chính chủ nhúng sẵn. */
  publicKeyPem?: string
}

export const PROVENANCE_FILE = '.infra-runtime.json'
/**
 * Trần dung lượng tải. MỤC ĐÍCH DUY NHẤT: chống server hỏng/ác ý stream vô hạn làm đầy ổ đĩa
 * TRƯỚC khi ta kịp kiểm sha256. Việc chống giả mạo là của sha256, KHÔNG phải của trần này.
 *
 * Vì vậy trần phải RỘNG RÃI: `sizeBytes` trong catalog là số ghi tay, lệch vài trăm KB là
 * chuyện thường (đã gặp: nginx khai 2.0MB nhưng thật 2.65MB → trần 1.25× chặn oan, cài fail).
 * Trần chặt biến một sai số vô hại thành lỗi cứng — sai mức bảo vệ.
 */
const SIZE_TOLERANCE = 2
/** Sàn: file nhỏ (nginx ~3MB) vẫn cần biên rộng để sai số tuyệt đối không thành lỗi. */
const MIN_SIZE_CAP_BYTES = 64 * 1024 * 1024
/** Trần tuyệt đối cho mọi lượt tải, kể cả khi spec không khai sizeBytes. */
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024

/** Trần cho 1 lượt tải: rộng rãi nhưng luôn hữu hạn. */
function downloadCap(sizeBytes?: number): number {
  const fromSpec = sizeBytes !== undefined && sizeBytes > 0 ? sizeBytes * SIZE_TOLERANCE : 0
  return Math.min(MAX_DOWNLOAD_BYTES, Math.max(MIN_SIZE_CAP_BYTES, fromSpec))
}
/** Không spam IPC: nhiều nhất 4 event tiến độ/giây. */
const PROGRESS_INTERVAL_MS = 250

export interface InstalledRuntime {
  id: string
  dir: string
  provenance: RuntimeProvenance | null
  /** Thiếu provenance = thư mục có nhưng cài dở/bị sửa tay → coi là hỏng. */
  broken: boolean
}

export class RuntimeManager extends EventEmitter<{ progress: [RuntimeProgress] }> {
  private readonly aborts = new Map<string, AbortController>()

  constructor(private readonly deps: RuntimeManagerDeps) {
    super()
  }

  /**
   * Quét ĐĨA để biết runtime nào đã cài. Filesystem là nguồn chân lý: user xoá tay 1 thư mục
   * thì hàng DB nói "đã cài" là DỐI — nên không lưu trạng thái này ở DB.
   */
  async listInstalled(): Promise<InstalledRuntime[]> {
    let entries: string[]
    try {
      entries = (await readdir(this.deps.paths.runtimes, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
    } catch {
      return [] // chưa có thư mục runtimes → chưa cài gì
    }
    const out: InstalledRuntime[] = []
    for (const id of entries) {
      const dir = runtimeDir(this.deps.paths, id)
      if (!dir) continue
      const provenance = await this.readProvenance(dir)
      out.push({ id, dir, provenance, broken: provenance === null })
    }
    return out
  }

  async readProvenance(dir: string): Promise<RuntimeProvenance | null> {
    try {
      const raw = JSON.parse(await readFile(join(dir, PROVENANCE_FILE), 'utf8')) as RuntimeProvenance
      return typeof raw?.id === 'string' && typeof raw?.sha256 === 'string' ? raw : null
    } catch {
      return null
    }
  }

  /** Huỷ đang tải: dọn file tạm, phát event error. */
  cancel(id: string): void {
    this.aborts.get(id)?.abort()
  }

  /**
   * Cài 1 runtime từ entry manifest ĐÃ KÝ.
   * @param localFile nếu có: bỏ qua tải mạng, dùng file user tự tải về (escape hatch cho
   *   AV/mạng công ty chặn — user là trust anchor, nhưng sha256 VẪN phải khớp manifest).
   */
  async install(entry: RuntimeManifestEntry, localFile?: string): Promise<void> {
    const { paths } = this.deps
    // (1) Chữ ký trước tiên — không tốn byte mạng nào cho entry không đáng tin
    if (!verifyRuntimeEntry(entry, this.deps.publicKeyPem)) {
      const error = `Chữ ký của "${entry.id}" thiếu hoặc không hợp lệ — DỪNG cài`
      this.emitProgress({ id: entry.id, phase: 'error', receivedBytes: 0, totalBytes: null, percent: 0, error })
      throw new Error(error)
    }
    const dest = runtimeDir(paths, entry.id)
    if (!dest) throw new Error(`Id runtime không hợp lệ: ${entry.id}`)

    const ctrl = new AbortController()
    this.aborts.set(entry.id, ctrl)
    const tmpDir = paths.runtimesTmp
    const partFile = join(tmpDir, `${entry.id}-${entry.version}.part`)
    const staging = join(tmpDir, `${entry.id}-staging`)

    try {
      await mkdir(tmpDir, { recursive: true })
      await rm(staging, { recursive: true, force: true })

      // (2) Lấy file: tải streaming, hoặc dùng file local user cấp
      let archivePath: string
      if (localFile) {
        archivePath = localFile
        const digest = await this.hashFile(localFile)
        this.emitProgress({
          id: entry.id,
          phase: 'verify',
          receivedBytes: (await stat(localFile)).size,
          totalBytes: entry.sizeBytes,
          percent: 90
        })
        if (digest !== entry.sha256) {
          throw new Error(
            `Sai checksum: file bạn chọn không khớp manifest (mong ${entry.sha256.slice(0, 12)}…, ` +
              `nhận ${digest.slice(0, 12)}…) — DỪNG cài`
          )
        }
      } else {
        archivePath = await this.download(entry, partFile, ctrl.signal)
      }

      // (3)(4)(5) Giải nén vào staging → rename → smoke-test → ghi provenance
      await this.extractAndFinalize(entry, archivePath, staging, dest, {
        sha256: entry.sha256,
        sourceUrl: localFile ? `file:${localFile}` : entry.url
      })
    } catch (e) {
      const error = (e as Error).message
      this.emitProgress({ id: entry.id, phase: 'error', receivedBytes: 0, totalBytes: null, percent: 0, error })
      throw e
    } finally {
      this.aborts.delete(entry.id)
      await rm(partFile, { force: true }).catch(() => {})
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Cài từ 1 entry trong `RUNTIME_SOURCES` (ghim trong source app) — KHÔNG cần manifest ký.
   *
   * - Có `source.sha256` (PHP): verify NGHIÊM NGẶT, lệch là dừng.
   * - Không có (nginx, vì nginx.org chỉ công bố PGP): tính rồi GHI LẠI vào provenance;
   *   `pinned=false` trả về để UI nói rõ "checksum không ghim".
   *
   * @param localFile nếu có: dùng file user tự tải, không gọi mạng.
   */
  async installFromSource(
    source: {
      id: string
      version: string
      kind: 'php' | 'mariadb' | 'nginx' | 'tool'
      url: string
      mirrors?: string[]
      archive: 'zip' | 'tar.gz' | 'raw'
      rawFileName?: string
      stripComponents: number
      sha256?: string
      sizeBytes?: number
      verifyCmd?: string[]
    },
    localFile?: string
  ): Promise<{ sha256: string; pinned: boolean }> {
    const { paths } = this.deps
    const dest = runtimeDir(paths, source.id)
    if (!dest) throw new Error(`Id runtime không hợp lệ: ${source.id}`)

    const ctrl = new AbortController()
    this.aborts.set(source.id, ctrl)
    const partFile = join(paths.runtimesTmp, `${source.id}-${source.version}.part`)
    const staging = join(paths.runtimesTmp, `${source.id}-staging`)

    try {
      await mkdir(paths.runtimesTmp, { recursive: true })
      await rm(staging, { recursive: true, force: true })

      let archivePath: string
      let digest: string
      if (localFile) {
        archivePath = localFile
        this.emitProgress({ id: source.id, phase: 'verify', receivedBytes: 0, totalBytes: null, percent: 60 })
        digest = await this.hashFile(localFile)
        if (source.sha256 && digest !== source.sha256) {
          throw new Error(
            `Sai checksum: file bạn chọn không khớp bản ${source.version} ` +
              `(mong ${source.sha256.slice(0, 12)}…, nhận ${digest.slice(0, 12)}…) — DỪNG cài`
          )
        }
      } else {
        digest = await this.downloadWithMirrors(source, partFile, ctrl.signal)
        archivePath = partFile
      }

      await this.extractAndFinalize(source, archivePath, staging, dest, {
        sha256: digest,
        sourceUrl: localFile ? `file:${localFile}` : source.url
      })
      return { sha256: digest, pinned: source.sha256 !== undefined }
    } catch (e) {
      const error = (e as Error).message
      this.emitProgress({ id: source.id, phase: 'error', receivedBytes: 0, totalBytes: null, percent: 0, error })
      throw e
    } finally {
      this.aborts.delete(source.id)
      await rm(partFile, { force: true }).catch(() => {})
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Cài từ file user TỰ TẢI, KHÔNG có manifest đã ký.
   *
   * Vì sao cho phép: manifest đã ký là đường mặc định, nhưng nó cần hạ tầng (Pages + khoá) và
   * có thể bị AV/mạng công ty chặn. Ở đường này **user chính là trust anchor** — họ tự tải từ
   * nguồn chính thức. App KHÔNG bịa ra sự đảm bảo nào: nó tính sha256 và GHI LẠI vào
   * provenance để về sau đối chiếu/audit được, đồng thời vẫn smoke-test binary.
   *
   * UI phải nói rõ: "checksum không được đối chiếu với manifest (bạn tự tải)".
   */
  async installFromFile(
    source: {
      id: string
      version: string
      archive: 'zip' | 'tar.gz' | 'raw'
      rawFileName?: string
      stripComponents: number
      kind: 'php' | 'mariadb' | 'nginx' | 'tool'
      verifyCmd?: string[]
    },
    file: string
  ): Promise<{ sha256: string }> {
    const dest = runtimeDir(this.deps.paths, source.id)
    if (!dest) throw new Error(`Id runtime không hợp lệ: ${source.id}`)
    const staging = join(this.deps.paths.runtimesTmp, `${source.id}-staging`)
    try {
      await mkdir(this.deps.paths.runtimesTmp, { recursive: true })
      await rm(staging, { recursive: true, force: true })

      this.emitProgress({ id: source.id, phase: 'verify', receivedBytes: 0, totalBytes: null, percent: 40 })
      const sha256 = await this.hashFile(file)

      await this.extractAndFinalize(source, file, staging, dest, {
        sha256,
        sourceUrl: `file:${file}`
      })
      return { sha256 }
    } catch (e) {
      const error = (e as Error).message
      this.emitProgress({ id: source.id, phase: 'error', receivedBytes: 0, totalBytes: null, percent: 0, error })
      throw e
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Gỡ runtime: xoá thư mục. Caller phải bảo đảm không service nào đang dùng. */
  async remove(id: string): Promise<void> {
    const dir = runtimeDir(this.deps.paths, id)
    if (!dir) throw new Error(`Id runtime không hợp lệ: ${id}`)
    await rm(dir, { recursive: true, force: true })
  }

  /** Đường dẫn 1 file trong runtime đã cài; null nếu id sai hoặc chưa cài. */
  exeOf(id: string, rel: string): string | null {
    const dir = runtimeDir(this.deps.paths, id)
    return dir ? join(dir, rel) : null
  }

  /** Dọn thư mục tạm — gọi lúc app khởi động (file .part/staging sót lại từ lần crash). */
  async cleanTmp(): Promise<void> {
    await rm(this.deps.paths.runtimesTmp, { recursive: true, force: true }).catch(() => {})
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────

  /**
   * Phần chung của mọi đường cài: giải nén vào staging → `rename` sang thư mục thật →
   * smoke-test → ghi provenance CUỐI CÙNG.
   *
   * Thứ tự này là bất biến an toàn: rename là (gần như) atomic trên cùng volume nên không bao
   * giờ để lại runtime nửa vời; và sự tồn tại của `.infra-runtime.json` = "đã cài xong".
   */
  private async extractAndFinalize(
    src: {
      id: string
      version: string
      archive: 'zip' | 'tar.gz' | 'raw'
      rawFileName?: string
      stripComponents: number
      kind: 'php' | 'mariadb' | 'nginx' | 'tool'
      verifyCmd?: string[]
    },
    archivePath: string,
    staging: string,
    dest: string,
    meta: { sha256: string; sourceUrl: string }
  ): Promise<void> {
    const { paths, adapter } = this.deps

    this.emitProgress({ id: src.id, phase: 'extract', receivedBytes: 0, totalBytes: null, percent: 92 })
    // Tên file khi archive='raw'. Ưu tiên tên do source khai báo: Adminer là 1 file .php,
    // không phải .exe như mọi tool khác.
    let rawFileName: string | undefined
    if (src.archive === 'raw') {
      rawFileName = src.rawFileName ?? `${src.kind === 'tool' ? src.id : 'binary'}.exe`
    }
    await adapter.extractArchive(archivePath, staging, {
      archive: src.archive,
      stripComponents: src.stripComponents,
      rawFileName
    })

    await rm(dest, { recursive: true, force: true })
    await mkdir(paths.runtimes, { recursive: true })
    await rename(staging, dest)

    // Smoke-test: cài xong mà exe không chạy (thiếu VC++ Redistributable) thì phải báo NGAY,
    // không để user phát hiện lúc start service.
    let verifiedAt: number | null = null
    let verifyError: string | null = null
    if (src.verifyCmd && src.verifyCmd.length > 0) {
      this.emitProgress({ id: src.id, phase: 'verify-exe', receivedBytes: 0, totalBytes: null, percent: 97 })
      const [rel, ...args] = src.verifyCmd
      const exe = join(dest, rel!)
      const res = await adapter.runShort(exe, args, { cwd: dest, timeoutMs: 20_000 })
      if (res.code === 0) verifiedAt = Date.now()
      else verifyError = (res.stderr || res.stdout || 'không chạy được').trim().slice(0, 300)
    }

    const provenance: RuntimeProvenance = {
      id: src.id,
      version: src.version,
      sha256: meta.sha256,
      sourceUrl: meta.sourceUrl,
      installedAt: Date.now(),
      verifiedAt
    }
    await writeFile(join(dest, PROVENANCE_FILE), JSON.stringify(provenance, null, 2), 'utf8')

    if (verifyError) {
      const error = `Đã cài nhưng chạy thử thất bại: ${verifyError}`
      this.emitProgress({ id: src.id, phase: 'error', receivedBytes: 0, totalBytes: null, percent: 100, error })
      throw new Error(error)
    }
    this.emitProgress({ id: src.id, phase: 'done', receivedBytes: 0, totalBytes: null, percent: 100 })
  }

  private async download(entry: RuntimeManifestEntry, partFile: string, signal: AbortSignal): Promise<string> {
    await this.downloadWithMirrors(entry, partFile, signal)
    return partFile
  }

  /** Thử url chính rồi lần lượt mirror. Trả sha256 đã tính. Verify nếu spec có sha256 ghim. */
  private async downloadWithMirrors(
    spec: { id: string; url: string; mirrors?: string[]; sha256?: string; sizeBytes?: number },
    partFile: string,
    signal: AbortSignal
  ): Promise<string> {
    const urls = [spec.url, ...(spec.mirrors ?? [])]
    let lastError: Error | null = null
    for (const url of urls) {
      try {
        return await this.downloadFrom(spec, url, partFile, signal)
      } catch (e) {
        lastError = e as Error
        if (signal.aborted) throw lastError
        await rm(partFile, { force: true }).catch(() => {})
        // Link upstream CHẮC CHẮN sẽ rot theo thời gian → thử mirror tiếp theo
      }
    }
    throw lastError ?? new Error(`Không tải được ${spec.id}`)
  }

  /** Tải 1 URL ra `partFile`, trả sha256 đã tính. Throw nếu lệch `spec.sha256` (khi có ghim). */
  private async downloadFrom(
    spec: { id: string; sha256?: string; sizeBytes?: number },
    url: string,
    partFile: string,
    signal: AbortSignal
  ): Promise<string> {
    const { stream, totalBytes } = await this.deps.openStream(url, signal)
    const hash = createHash('sha256')
    const total = totalBytes ?? spec.sizeBytes ?? 0
    const maxBytes = downloadCap(spec.sizeBytes)
    let received = 0
    let lastEmit = 0

    const out = createWriteStream(partFile)
    // Tính hash CỘNG DỒN theo chunk — không đọc lại file sau khi tải (file 100MB)
    const tap = async function* (src: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
      for await (const chunk of src) {
        received += chunk.byteLength
        if (received > maxBytes) {
          throw new Error(
            `Dừng tải: đã nhận hơn ${String(Math.round(maxBytes / 1e6))}MB — vượt xa dung lượng ` +
              `dự kiến của ${spec.id}. Có thể nguồn tải đã đổi hoặc bị chặn/chuyển hướng sai.`
          )
        }
        hash.update(chunk)
        yield chunk
      }
    }
    const emitter = this
    const progressTap = async function* (src: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
      for await (const chunk of src) {
        const now = Date.now()
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now
          emitter.emitProgress({
            id: spec.id,
            phase: 'download',
            receivedBytes: received,
            totalBytes: total > 0 ? total : null,
            percent: total > 0 ? Math.min(89, Math.round((received / total) * 89)) : 0
          })
        }
        yield chunk
      }
    }

    await pipeline(stream, tap, progressTap, out, { signal })

    this.emitProgress({
      id: spec.id,
      phase: 'verify',
      receivedBytes: received,
      totalBytes: total > 0 ? total : null,
      percent: 90
    })
    const digest = hash.digest('hex')
    // Chỉ so khi CÓ sha256 ghim. Không ghim (nginx) ⇒ trả digest để ghi provenance + UI cảnh báo.
    if (spec.sha256 && digest !== spec.sha256) {
      throw new Error(
        `Sai checksum ${spec.id} — file tải về không khớp giá trị đã ghim ` +
          `(mong ${spec.sha256.slice(0, 12)}…, nhận ${digest.slice(0, 12)}…), DỪNG cài`
      )
    }
    return digest
  }

  private async hashFile(path: string): Promise<string> {
    const { createReadStream } = await import('node:fs')
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), async function (src) {
      for await (const chunk of src) hash.update(chunk as Uint8Array)
    })
    return hash.digest('hex')
  }

  private emitProgress(p: RuntimeProgress): void {
    this.emit('progress', p)
  }
}
