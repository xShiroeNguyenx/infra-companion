import { createHash, randomBytes } from 'node:crypto'

/**
 * OAuth 2.0 cho ứng dụng DESKTOP (Google) — phần THUẦN, test được không cần mạng/trình duyệt.
 *
 * Flow: main mở listener loopback ở cổng ephemeral → mở TRÌNH DUYỆT HỆ THỐNG với URL từ
 * `buildGoogleAuthUrl` → user đồng ý → Google redirect về loopback → `parseLoopbackCallback`
 * lấy code → main đổi code lấy token → `parseTokenResponse`. PKCE (S256) + `state` là lớp
 * bảo vệ chính; client_secret của installed app KHÔNG phải bí mật theo tài liệu Google.
 *
 * Phần có IO (server loopback, net.fetch, shell.openExternal) nằm ở
 * `apps/desktop/src/main/lib/googleDrive.ts`.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

/**
 * Chỉ scope NON-SENSITIVE (không cần thẩm định bảo mật của Google):
 * - drive.file: đọc/ghi CHỈ file do chính app tạo — đủ cho một blob sync.
 * - openid + email: hiện "đã kết nối tài khoản nào" trên UI.
 * Tuyệt đối không thêm scope rộng hơn (drive/drive.readonly là Restricted → CASA assessment).
 */
export const GOOGLE_DRIVE_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/drive.file']

function base64url(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Cặp PKCE: verifier ngẫu nhiên 32B + challenge = SHA-256(verifier) dạng base64url. */
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** `state` chống CSRF trên loopback — redirect về không khớp là vứt. */
export function newOAuthState(): string {
  return base64url(randomBytes(16))
}

export function buildGoogleAuthUrl(opts: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  scopes?: string[]
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: (opts.scopes ?? GOOGLE_DRIVE_SCOPES).join(' '),
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    state: opts.state,
    // offline → có refresh token; prompt=consent để CHẮC CHẮN được cấp refresh token cả khi
    // user từng đồng ý rồi (thiếu nó thì lần đăng nhập lại có thể không nhận refresh token
    // → app "đăng nhập thành công" nhưng chết sau 1 giờ, đúng kiểu lỗi im lặng §8).
    access_type: 'offline',
    prompt: 'consent'
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export type LoopbackCallback =
  | { ok: true; code: string }
  | { ok: false; error: 'denied' | 'stateMismatch' | 'noCode' }

/**
 * Phân tích request Google redirect về loopback (`/?code=…&state=…` hoặc `/?error=…`).
 * `rawUrl` là `req.url` của node:http (path + query, không có host).
 */
export function parseLoopbackCallback(rawUrl: string, expectedState: string): LoopbackCallback {
  const query = new URL(rawUrl, 'http://127.0.0.1').searchParams
  if (query.get('error')) return { ok: false, error: 'denied' }
  if (query.get('state') !== expectedState) return { ok: false, error: 'stateMismatch' }
  const code = query.get('code')
  if (!code) return { ok: false, error: 'noCode' }
  return { ok: true, code }
}

export interface GoogleTokens {
  accessToken: string
  /** Epoch ms hết hạn — trừ sẵn 60s đệm để không dùng token sát giờ chết. */
  expiresAt: number
  refreshToken: string | null
  idToken: string | null
}

export type TokenParse = { ok: true; tokens: GoogleTokens } | { ok: false; error: string }

/** Phân tích phản hồi của endpoint token (cả đường đổi code lẫn đường refresh). */
export function parseTokenResponse(json: unknown, now = Date.now()): TokenParse {
  const data = json as Record<string, unknown> | null
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'Phản hồi token không phải JSON object' }
  if (typeof data.error === 'string') {
    return { ok: false, error: `${data.error}${typeof data.error_description === 'string' ? `: ${data.error_description}` : ''}` }
  }
  if (typeof data.access_token !== 'string' || data.access_token === '') {
    return { ok: false, error: 'Phản hồi token thiếu access_token' }
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  return {
    ok: true,
    tokens: {
      accessToken: data.access_token,
      expiresAt: now + Math.max(0, expiresIn - 60) * 1000,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
      idToken: typeof data.id_token === 'string' ? data.id_token : null
    }
  }
}

/**
 * Lấy email từ id_token (JWT) — CHỈ decode payload, không verify chữ ký: token này vừa nhận
 * trực tiếp từ Google qua TLS trong cùng một request, và chỉ dùng để HIỂN THỊ tài khoản nào
 * đang kết nối, không dùng làm quyết định bảo mật nào.
 */
export function emailFromIdToken(idToken: string): string | null {
  const parts = idToken.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8')
    ) as { email?: unknown }
    return typeof payload.email === 'string' ? payload.email : null
  } catch {
    return null
  }
}
