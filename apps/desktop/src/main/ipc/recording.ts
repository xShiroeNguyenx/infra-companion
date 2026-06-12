import { createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { RecordingInfoDto, SessionRecordState } from '@infra/shared'

interface ActiveRecording {
  stream: WriteStream
  start: number
  filePath: string
}

/**
 * Ghi hình phiên terminal theo định dạng asciicast v2 (chuẩn asciinema):
 *  - dòng 1: header JSON {version, width, height, timestamp}
 *  - các dòng sau: [elapsedSeconds, "o", "data"]
 * File .cast replay được trong app hoặc bằng asciinema/asciinema-player.
 */
class RecorderService {
  private readonly active = new Map<string, ActiveRecording>()

  dir(): string {
    const dir = join(app.getPath('userData'), 'recordings')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  isActive(sessionId: string): boolean {
    return this.active.has(sessionId)
  }

  toggle(sessionId: string, title: string, cols: number, rows: number): SessionRecordState {
    if (this.active.has(sessionId)) {
      this.stop(sessionId)
      return { sessionId, active: false }
    }
    const safeTitle = title.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'session'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = join(this.dir(), `${stamp}_${safeTitle}.cast`)
    const stream = createWriteStream(filePath, { flags: 'a' })
    const header = {
      version: 2,
      width: cols || 80,
      height: rows || 24,
      timestamp: Math.floor(Date.now() / 1000),
      title
    }
    stream.write(JSON.stringify(header) + '\n')
    this.active.set(sessionId, { stream, start: Date.now(), filePath })
    return { sessionId, active: true, filePath }
  }

  /** Gọi từ luồng data của phiên — ghi RAW (giữ mã màu) kèm mốc thời gian. */
  append(sessionId: string, data: string): void {
    const rec = this.active.get(sessionId)
    if (!rec) return
    const elapsed = (Date.now() - rec.start) / 1000
    rec.stream.write(JSON.stringify([Number(elapsed.toFixed(3)), 'o', data]) + '\n')
  }

  stop(sessionId: string): void {
    const rec = this.active.get(sessionId)
    if (rec) {
      rec.stream.end()
      this.active.delete(sessionId)
    }
  }

  stopAll(): void {
    for (const id of [...this.active.keys()]) this.stop(id)
  }

  list(): RecordingInfoDto[] {
    return readdirSync(this.dir())
      .filter((f) => f.endsWith('.cast'))
      .map((name) => {
        const path = join(this.dir(), name)
        const st = statSync(path)
        return { name, path, sizeBytes: st.size, mtimeMs: st.mtimeMs }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  read(name: string): string {
    return readFileSync(join(this.dir(), safeName(name)), 'utf8')
  }

  delete(name: string): void {
    rmSync(join(this.dir(), safeName(name)), { force: true })
  }
}

/** Chống path traversal: chỉ cho tên file .cast, không có dấu phân tách. */
function safeName(name: string): string {
  if (!/^[\w.-]+\.cast$/.test(name)) throw new Error('Tên file recording không hợp lệ')
  return name
}

export const recorder = new RecorderService()
