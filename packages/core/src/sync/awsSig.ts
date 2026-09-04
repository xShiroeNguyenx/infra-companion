import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4 — bản THUẦN, không SDK: app chỉ cần đúng 3 thao tác S3
 * (GET/PUT/LIST) và một lệnh EC2 DescribeInstances, kéo cả @aws-sdk vào vì từng đó là
 * quá đắt (bundle main + externalizeDepsPlugin + audit). SigV4 là thuật toán tài liệu
 * hoá kỹ và ổn định từ 2014; test đối chiếu với vector chính thức trong docs AWS.
 *
 * Dùng được cho MỌI dịch vụ S3-compatible (MinIO, Cloudflare R2, Backblaze B2, Wasabi…)
 * vì tất cả đều nhận SigV4.
 */

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

/** Encode theo RFC 3986 như AWS đòi (encode cả `!'()*` mà encodeURIComponent bỏ qua). */
export function awsUriEncode(value: string, keepSlash = false): string {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return keepSlash ? encoded.replaceAll('%2F', '/') : encoded
}

export interface AwsSignInput {
  method: string
  host: string
  /** Path đã encode sẵn từng segment (S3 key có thể chứa ký tự lạ) — bắt đầu bằng '/'. */
  path: string
  /** Query dạng cặp key/value CHƯA encode — hàm tự encode và sắp xếp theo chuẩn. */
  query?: Record<string, string>
  /** Header bổ sung sẽ được KÝ (ngoài host + x-amz-date + x-amz-content-sha256). */
  headers?: Record<string, string>
  /** sha256 hex của body ('' cho body rỗng). */
  payloadHash: string
  region: string
  service: string
  accessKeyId: string
  secretAccessKey: string
  /** Thời điểm ký — tham số để test tái lập được; mặc định now. */
  date?: Date
}

export interface AwsSignedRequest {
  /** Toàn bộ header cần gửi (gồm Authorization, x-amz-date, x-amz-content-sha256, host KHÔNG gồm). */
  headers: Record<string, string>
  /** Query string đã encode + sắp xếp — dùng đúng chuỗi này khi gửi để khớp chữ ký. */
  queryString: string
  /** Canonical request — export để test đối chiếu từng dòng với ví dụ trong docs AWS. */
  canonicalRequest: string
}

function amzDate(date: Date): { long: string; short: string } {
  const long = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { long, short: long.slice(0, 8) }
}

/** Ký một request theo SigV4 (header-based). */
export function signAwsRequest(input: AwsSignInput): AwsSignedRequest {
  const { long, short } = amzDate(input.date ?? new Date())

  const query = input.query ?? {}
  const queryString = Object.keys(query)
    .map((k) => [awsUriEncode(k), awsUriEncode(query[k]!)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  // Header ký: host + x-amz-* + header caller đưa vào — tên thường hoá, sắp theo alphabet
  const headersToSign: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': long,
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()]))
  }
  const signedHeaderNames = Object.keys(headersToSign).sort()
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headersToSign[name]}\n`).join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    queryString,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash
  ].join('\n')

  const scope = `${short}/${input.region}/${input.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', long, scope, sha256Hex(canonicalRequest)].join('\n')

  // Chuỗi dẫn xuất key: kDate → kRegion → kService → kSigning
  const kDate = hmac(`AWS4${input.secretAccessKey}`, short)
  const kRegion = hmac(kDate, input.region)
  const kService = hmac(kRegion, input.service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    headers: {
      ...(input.headers ?? {}),
      'x-amz-date': long,
      'x-amz-content-sha256': input.payloadHash,
      Authorization: authorization
    },
    queryString,
    canonicalRequest
  }
}
