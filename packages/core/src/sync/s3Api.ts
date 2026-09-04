import { awsUriEncode } from './awsSig'

/**
 * S3 REST — phần THUẦN: dựng host/path/query cho 3 thao tác (GET/PUT object, ListObjectsV2)
 * và parse XML trả về. Ký request nằm ở `awsSig.ts`; phần gọi mạng ở main.
 *
 * Endpoint tuỳ ý (AWS, MinIO, R2, Backblaze…) — dùng PATH-STYLE (`endpoint/bucket/key`)
 * thay vì virtual-host để MinIO/self-host chạy được không cần wildcard DNS.
 */

export interface S3Target {
  /** vd `https://s3.ap-southeast-1.amazonaws.com` hoặc `https://minio.example.com:9000` */
  endpoint: string
  bucket: string
  /** Tiền tố key, vd `backup/infra/` — '' = gốc bucket. Tự thêm `/` cuối nếu thiếu. */
  prefix: string
}

export function normalizeS3Prefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, '')
  if (trimmed === '') return ''
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

/** host + path (đã encode) cho một object key. */
export function s3ObjectUrl(target: S3Target, key: string): { host: string; path: string } {
  const url = new URL(target.endpoint)
  const fullKey = `${normalizeS3Prefix(target.prefix)}${key}`
  return {
    host: url.host,
    // encode từng segment, GIỮ dấu '/' — SigV4 canonical path phải khớp từng byte với path gửi đi
    path: `${url.pathname.replace(/\/$/, '')}/${awsUriEncode(target.bucket)}/${awsUriEncode(fullKey, true)}`
  }
}

/** host + path + query cho ListObjectsV2 theo prefix (tìm file gần giống blob). */
export function s3ListUrl(target: S3Target, nameContains: string): {
  host: string
  path: string
  query: Record<string, string>
} {
  const url = new URL(target.endpoint)
  return {
    host: url.host,
    path: `${url.pathname.replace(/\/$/, '')}/${awsUriEncode(target.bucket)}`,
    query: {
      'list-type': '2',
      prefix: `${normalizeS3Prefix(target.prefix)}${nameContains}`,
      'max-keys': '100'
    }
  }
}

/**
 * Lấy danh sách `<Key>` từ XML ListObjectsV2 — parse hẹp bằng regex vì cấu trúc phản hồi
 * này phẳng và ổn định (Key không chứa XML lồng), khỏi kéo cả một thư viện XML vào.
 */
export function parseS3ListKeys(xml: string): string[] {
  const keys: string[] = []
  for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
    keys.push(decodeXmlEntities(match[1]!))
  }
  return keys
}

/** Tên file (bỏ prefix) từ key — để so với BLOB_NAME/near-miss. */
export function s3KeyBasename(key: string, prefix: string): string {
  const p = normalizeS3Prefix(prefix)
  return key.startsWith(p) ? key.slice(p.length) : key
}

export function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}
