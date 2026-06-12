import * as os from 'node:os'
import { spawn, type IPty } from 'node-pty'
import type { ShellProfile } from '@infra/shared'
import type { SessionSink, TerminalSession } from './types'

/** Phiên shell local chạy qua node-pty (ConPTY trên Windows). */
export class LocalSession implements TerminalSession {
  readonly kind = 'local' as const
  private readonly pty: IPty
  private killed = false

  constructor(
    readonly id: string,
    profile: ShellProfile,
    cols: number,
    rows: number,
    private readonly sink: SessionSink,
    cwd?: string
  ) {
    this.pty = spawn(profile.shellPath, profile.args ?? [], {
      name: 'xterm-256color',
      cols: sanitizeDim(cols, 80),
      rows: sanitizeDim(rows, 24),
      cwd: cwd ?? profile.cwd ?? os.homedir(),
      env: cleanEnv()
    })
    this.pty.onData((data) => this.sink.data(this.id, data))
    this.pty.onExit(({ exitCode }) => {
      if (!this.killed) this.sink.exit(this.id, exitCode)
    })
    // Local PTY sẵn sàng ngay
    queueMicrotask(() => this.sink.status(this.id, 'connected'))
  }

  write(data: string): void {
    this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    try {
      this.pty.resize(sanitizeDim(cols, 80), sanitizeDim(rows, 24))
    } catch {
      // process vừa thoát — bỏ qua
    }
  }

  kill(): void {
    this.killed = true
    try {
      this.pty.kill()
    } catch {
      // đã chết
    }
  }
}

function sanitizeDim(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value < 10_000 ? value : fallback
}

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env['TERM_PROGRAM'] = 'InfraCompanion'
  return env
}
