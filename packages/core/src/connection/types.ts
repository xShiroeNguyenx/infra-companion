import type { SessionKind, SessionStatus } from '@infra/shared'

/** Một phiên terminal (local PTY hoặc SSH shell) do SessionManager quản lý. */
export interface TerminalSession {
  readonly id: string
  readonly kind: SessionKind
  write(data: string): void
  resize(cols: number, rows: number): void
  /** Đóng phiên theo yêu cầu user — không trigger auto-reconnect. */
  kill(): void
}

/** Callbacks mà session dùng để báo sự kiện lên SessionManager. */
export interface SessionSink {
  data(sessionId: string, data: string): void
  exit(sessionId: string, exitCode: number | null, reason?: string): void
  status(sessionId: string, status: SessionStatus, detail?: string): void
}

/** Thông tin host key đưa ra ngoài để xác minh (TOFU / mismatch). */
export interface HostKeyInfo {
  host: string
  port: number
  keyType: string
  /** "SHA256:base64…" — cùng format với OpenSSH. */
  fingerprint: string
}

/** Hỏi người dùng (qua UI) có chấp nhận host key không. */
export type HostKeyVerifier = (info: HostKeyInfo) => Promise<boolean>
