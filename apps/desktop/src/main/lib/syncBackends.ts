import { net } from 'electron'
import {
  BLOB_NAME,
  PROPFIND_BODY,
  findNearMissBlobs,
  parsePropfindNames,
  parseS3ListKeys,
  s3KeyBasename,
  s3ListUrl,
  s3ObjectUrl,
  sha256Hex,
  signAwsRequest,
  webdavJoin,
  type SyncBackend
} from '@infra/core'

/**
 * Hai backend sync CÓ MẠNG: WebDAV (Nextcloud/Seafile/Nginx dav…) và S3 (AWS/MinIO/R2/B2…).
 * Cùng interface 4 hàm với FolderBackend/DriveBackend → guard chống ghi đè của F65 dùng
 * lại nguyên trạng. Phần thuần (URL, ký SigV4, parse XML) ở `@infra/core` có test riêng;
 * ở đây chỉ còn fetch + phân loại lỗi thành câu nói được nguyên nhân (§8).
 *
 * Bí mật (mật khẩu WebDAV / secret key S3) lấy qua callback `getSecret` — giá trị nằm
 * mã hoá DEK trong vault (`sync_secret:<channelId>`), không nằm trong SyncChannel JSON.
 */

const FETCH_TIMEOUT_MS = 15_000

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await net.fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// WebDAV
// ---------------------------------------------------------------------------

export class WebdavBackend implements SyncBackend {
  constructor(
    private readonly opts: {
      url: string
      username: string
      getPassword: () => string | undefined
    }
  ) {}

  private authHeader(): string {
    const password = this.opts.getPassword()
    if (password === undefined) throw new Error('Mất mật khẩu WebDAV — cấu hình lại kênh này')
    return `Basic ${Buffer.from(`${this.opts.username}:${password}`).toString('base64')}`
  }

  private blobUrl(): string {
    return webdavJoin(this.opts.url, BLOB_NAME)
  }

  private fail(res: Response, action: string): Error {
    if (res.status === 401) return new Error('WebDAV: sai username/mật khẩu (401)')
    return new Error(`WebDAV: HTTP ${res.status} khi ${action}`)
  }

  async read(): Promise<string | null> {
    const res = await fetchWithTimeout(this.blobUrl(), { headers: { Authorization: this.authHeader() } })
    if (res.status === 404) return null
    if (!res.ok) throw this.fail(res, 'đọc blob')
    return res.text()
  }

  async write(blob: string): Promise<void> {
    const put = (): Promise<Response> =>
      fetchWithTimeout(this.blobUrl(), {
        method: 'PUT',
        headers: { Authorization: this.authHeader(), 'Content-Type': 'text/plain; charset=UTF-8' },
        body: blob
      })
    let res = await put()
    if (res.status === 404 || res.status === 409) {
      // Thư mục cha chưa tồn tại — thử MKCOL một lần rồi PUT lại
      await fetchWithTimeout(this.opts.url, { method: 'MKCOL', headers: { Authorization: this.authHeader() } })
      res = await put()
    }
    if (!res.ok) throw this.fail(res, 'ghi blob')
  }

  async listNearMisses(): Promise<string[]> {
    const res = await fetchWithTimeout(this.opts.url.replace(/\/+$/, '') + '/', {
      method: 'PROPFIND',
      headers: { Authorization: this.authHeader(), Depth: '1', 'Content-Type': 'application/xml' },
      body: PROPFIND_BODY
    })
    if (res.status === 404) return [] // thư mục chưa tồn tại → không có gì đáng ngờ
    if (!res.ok) throw this.fail(res, 'liệt kê thư mục')
    return findNearMissBlobs(parsePropfindNames(await res.text()))
  }

  describe(): string {
    return `WebDAV: ${this.opts.url}`
  }
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

export class S3Backend implements SyncBackend {
  private readonly protocol: string

  constructor(
    private readonly opts: {
      endpoint: string
      region: string
      bucket: string
      prefix: string
      accessKeyId: string
      getSecret: () => string | undefined
    }
  ) {
    // endpoint có thể là http:// (MinIO trong LAN) — giữ nguyên scheme user khai
    this.protocol = new URL(opts.endpoint).protocol
  }

  private target(): { endpoint: string; bucket: string; prefix: string } {
    return { endpoint: this.opts.endpoint, bucket: this.opts.bucket, prefix: this.opts.prefix }
  }

  private async send(
    method: string,
    where: { host: string; path: string; query?: Record<string, string> },
    body?: string
  ): Promise<Response> {
    const secretAccessKey = this.opts.getSecret()
    if (secretAccessKey === undefined) throw new Error('Mất secret key S3 — cấu hình lại kênh này')
    const signed = signAwsRequest({
      method,
      host: where.host,
      path: where.path,
      query: where.query,
      headers: body !== undefined ? { 'content-type': 'text/plain; charset=UTF-8' } : undefined,
      payloadHash: sha256Hex(body ?? ''),
      region: this.opts.region,
      service: 's3',
      accessKeyId: this.opts.accessKeyId,
      secretAccessKey
    })
    const url = `${this.protocol}//${where.host}${where.path}${signed.queryString ? `?${signed.queryString}` : ''}`
    return fetchWithTimeout(url, { method, headers: signed.headers, body })
  }

  private fail(res: Response, action: string): Error {
    if (res.status === 403) {
      // 403 của S3 nhập nhằng: sai key/chữ ký, THIẾU QUYỀN, và cả "file không tồn tại nhưng
      // key không có s3:ListBucket" — nói hết ra để user khỏi đoán mò
      return new Error(
        `S3: 403 khi ${action} — sai access/secret key, lệch region, hoặc key thiếu quyền ` +
          '(cần s3:GetObject + s3:PutObject + s3:ListBucket trên bucket này).'
      )
    }
    return new Error(`S3: HTTP ${res.status} khi ${action}`)
  }

  async read(): Promise<string | null> {
    const res = await this.send('GET', s3ObjectUrl(this.target(), BLOB_NAME))
    if (res.status === 404) return null
    if (!res.ok) throw this.fail(res, 'đọc blob')
    return res.text()
  }

  async write(blob: string): Promise<void> {
    const res = await this.send('PUT', s3ObjectUrl(this.target(), BLOB_NAME), blob)
    if (!res.ok) throw this.fail(res, 'ghi blob')
  }

  async listNearMisses(): Promise<string[]> {
    const res = await this.send('GET', s3ListUrl(this.target(), 'infra-companion-vault'))
    if (!res.ok) throw this.fail(res, 'liệt kê bucket')
    const keys = parseS3ListKeys(await res.text())
    return findNearMissBlobs(keys.map((key) => s3KeyBasename(key, this.opts.prefix)))
  }

  describe(): string {
    const host = new URL(this.opts.endpoint).host
    return `S3: ${this.opts.bucket}${this.opts.prefix ? `/${this.opts.prefix}` : ''} @ ${host}`
  }
}
