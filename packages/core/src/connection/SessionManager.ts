import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { SessionStatus, ShellProfile } from '@infra/shared'
import { LocalSession } from './LocalSession'
import { SshSession, type SshSessionOptions } from './SshSession'
import { TelnetSession } from './TelnetSession'
import { SerialSession } from './SerialSession'
import type { SessionSink, TerminalSession } from './types'

export interface SessionManagerEvents {
  data: [sessionId: string, data: string]
  exit: [sessionId: string, exitCode: number | null, reason: string | undefined]
  status: [sessionId: string, status: SessionStatus, detail: string | undefined]
}

/** Quản lý tập trung mọi phiên terminal (local + SSH). */
export class SessionManager extends EventEmitter<SessionManagerEvents> {
  private readonly sessions = new Map<string, TerminalSession>()

  private readonly sink: SessionSink = {
    data: (id, data) => this.emit('data', id, data),
    exit: (id, exitCode, reason) => {
      this.sessions.delete(id)
      this.emit('exit', id, exitCode, reason)
    },
    status: (id, status, detail) => this.emit('status', id, status, detail)
  }

  createLocal(profile: ShellProfile, cols: number, rows: number, cwd?: string): string {
    const id = randomUUID()
    this.sessions.set(id, new LocalSession(id, profile, cols, rows, this.sink, cwd))
    return id
  }

  createSsh(options: SshSessionOptions, cols: number, rows: number): string {
    const id = randomUUID()
    this.sessions.set(id, new SshSession(id, options, cols, rows, this.sink))
    return id
  }

  createTelnet(host: string, port: number, cols: number, rows: number): string {
    const id = randomUUID()
    this.sessions.set(id, new TelnetSession(id, host, port, cols, rows, this.sink))
    return id
  }

  createSerial(path: string, baudRate: number, cols: number, rows: number): string {
    const id = randomUUID()
    this.sessions.set(id, new SerialSession(id, path, baudRate, this.sink))
    void cols
    void rows
    return id
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.resize(cols, rows)
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    session.kill()
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
