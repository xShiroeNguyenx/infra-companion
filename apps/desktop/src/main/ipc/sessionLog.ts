import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { SessionLogState } from '@infra/shared'

/**
 * Ghi log phiên terminal ra file: tee dữ liệu output vào <userData>/logs/.
 * Lọc escape sequence ANSI để file dễ đọc (giữ text thuần).
 */
class SessionLogger {
  private readonly streams = new Map<string, WriteStream>()

  logDir(): string {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  isActive(sessionId: string): boolean {
    return this.streams.has(sessionId)
  }

  toggle(sessionId: string, title: string): SessionLogState {
    if (this.streams.has(sessionId)) {
      this.stop(sessionId)
      return { sessionId, active: false }
    }
    const safeTitle = title.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'session'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = join(this.logDir(), `${stamp}_${safeTitle}.log`)
    const stream = createWriteStream(filePath, { flags: 'a' })
    stream.write(`# Infra Companion session log — ${title} — ${new Date().toISOString()}\n`)
    this.streams.set(sessionId, stream)
    return { sessionId, active: true, filePath }
  }

  /** Gọi từ luồng data của session; bỏ qua nếu không bật log. */
  append(sessionId: string, data: string): void {
    const stream = this.streams.get(sessionId)
    if (stream) stream.write(stripAnsi(data))
  }

  stop(sessionId: string): void {
    const stream = this.streams.get(sessionId)
    if (stream) {
      stream.end()
      this.streams.delete(sessionId)
    }
  }

  stopAll(): void {
    for (const id of [...this.streams.keys()]) this.stop(id)
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][AB0-2]|\x1b[=>]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g

function stripAnsi(data: string): string {
  return data.replace(ANSI_RE, (m) => (m === '\r' || m === '\n' || m === '\t' ? m : ''))
}

export const sessionLogger = new SessionLogger()
