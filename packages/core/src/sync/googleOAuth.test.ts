import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  GOOGLE_DRIVE_SCOPES,
  buildGoogleAuthUrl,
  emailFromIdToken,
  newOAuthState,
  newPkce,
  parseLoopbackCallback,
  parseTokenResponse
} from './googleOAuth'

const B64URL = /^[A-Za-z0-9_-]+$/

describe('newPkce', () => {
  test('challenge = SHA-256(verifier) dạng base64url, không đệm =', () => {
    const { verifier, challenge } = newPkce()
    expect(verifier).toMatch(B64URL)
    expect(challenge).toMatch(B64URL)
    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
    expect(challenge).toBe(expected)
  })

  test('mỗi lần gọi ra cặp khác nhau', () => {
    expect(newPkce().verifier).not.toBe(newPkce().verifier)
    expect(newOAuthState()).not.toBe(newOAuthState())
  })
})

describe('buildGoogleAuthUrl', () => {
  test('đủ các tham số bắt buộc + offline + prompt=consent (bảo đảm có refresh token)', () => {
    const url = new URL(
      buildGoogleAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555', challenge: 'ch', state: 'st' })
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge')).toBe('ch')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toBe(GOOGLE_DRIVE_SCOPES.join(' '))
  })

  test('chỉ dùng scope non-sensitive: drive.file chứ KHÔNG PHẢI drive trần', () => {
    expect(GOOGLE_DRIVE_SCOPES).toContain('https://www.googleapis.com/auth/drive.file')
    expect(GOOGLE_DRIVE_SCOPES).not.toContain('https://www.googleapis.com/auth/drive')
  })
})

describe('parseLoopbackCallback', () => {
  test('code + state khớp → ok', () => {
    expect(parseLoopbackCallback('/?code=abc&state=st1', 'st1')).toEqual({ ok: true, code: 'abc' })
  })

  test('user bấm từ chối → denied (Google trả error=access_denied)', () => {
    expect(parseLoopbackCallback('/?error=access_denied&state=st1', 'st1')).toEqual({ ok: false, error: 'denied' })
  })

  test('state lệch → stateMismatch kể cả khi có code (chống request lạ bắn vào loopback)', () => {
    expect(parseLoopbackCallback('/?code=abc&state=WRONG', 'st1')).toEqual({ ok: false, error: 'stateMismatch' })
  })

  test('thiếu code → noCode (favicon request /favicon.ico cũng rơi vào đây, không crash)', () => {
    expect(parseLoopbackCallback('/favicon.ico', 'st1')).toEqual({ ok: false, error: 'stateMismatch' })
    expect(parseLoopbackCallback('/?state=st1', 'st1')).toEqual({ ok: false, error: 'noCode' })
  })
})

describe('parseTokenResponse', () => {
  test('phản hồi chuẩn: đọc đủ token, expiresAt trừ đệm 60s', () => {
    const now = 1_000_000
    const parsed = parseTokenResponse(
      { access_token: 'at', expires_in: 3600, refresh_token: 'rt', id_token: 'x.y.z' },
      now
    )
    expect(parsed).toEqual({
      ok: true,
      tokens: { accessToken: 'at', expiresAt: now + 3540 * 1000, refreshToken: 'rt', idToken: 'x.y.z' }
    })
  })

  test('đường refresh không có refresh_token mới → refreshToken null, vẫn ok', () => {
    const parsed = parseTokenResponse({ access_token: 'at', expires_in: 100 })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.tokens.refreshToken).toBeNull()
  })

  test('lỗi của Google (invalid_grant…) → ok:false kèm cả error_description', () => {
    const parsed = parseTokenResponse({ error: 'invalid_grant', error_description: 'Token has been revoked' })
    expect(parsed).toEqual({ ok: false, error: 'invalid_grant: Token has been revoked' })
  })

  test('JSON không phải object / thiếu access_token → ok:false', () => {
    expect(parseTokenResponse(null).ok).toBe(false)
    expect(parseTokenResponse('x').ok).toBe(false)
    expect(parseTokenResponse({}).ok).toBe(false)
  })
})

describe('emailFromIdToken', () => {
  const jwt = (payload: object): string =>
    `h.${Buffer.from(JSON.stringify(payload)).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}.s`

  test('đọc email từ payload JWT (không verify — chỉ để hiển thị)', () => {
    expect(emailFromIdToken(jwt({ email: 'deploy@example.com', sub: '1' }))).toBe('deploy@example.com')
  })

  test('payload không có email / token hỏng → null, không ném', () => {
    expect(emailFromIdToken(jwt({ sub: '1' }))).toBeNull()
    expect(emailFromIdToken('khong-phai-jwt')).toBeNull()
    expect(emailFromIdToken('a.%%%.c')).toBeNull()
  })
})
