import { StringDecoder } from 'node:string_decoder'
import { establishChain, type ChainEndpoint } from './establish'
import { deriveExecFromLoginSteps, type LoginStepLike } from './loginScript'
import type { HostKeyVerifier } from './types'

/**
 * Gom chunk thành DÒNG hoàn chỉnh.
 *
 * Chunk từ SSH cắt ở đâu là chuyện của tầng vận chuyển, không liên quan gì tới ranh giới
 * dòng: một dòng log dài thường về làm hai ba lần, và `tail -f` gửi từng mẩu ngay khi có.
 * Đẩy thẳng chunk lên UI thì dòng bị xé đôi và mọi bộ lọc theo dòng đều sai.
 *
 * Lớp thuần, không IO → test được.
 */
export class LineBuffer {
  private partial = ''

  /** Nhận thêm text, trả về các dòng ĐÃ TRỌN VẸN. Phần dở dang giữ lại cho lần sau. */
  push(text: string): string[] {
    // \r\n và \r đều quy về \n: log từ máy Windows/thiết bị mạng hay dùng CRLF
    const normalized = (this.partial + text).replace(/\r\n?/g, '\n')
    const parts = normalized.split('\n')
    this.partial = parts.pop() ?? ''
    return parts
  }

  /** Phần dở dang còn lại (gọi khi stream đóng) — dòng cuối thường không có `\n`. */
  flush(): string[] {
    if (this.partial === '') return []
    const last = this.partial
    this.partial = ''
    return [last]
  }
}

export interface ExecStreamOptions {
  /** Host vào bằng login-script (ssh/su/sudo…) → bọc lệnh để chạy trên máy đích bên trong. */
  loginSteps?: LoginStepLike[]
  /** Dòng stdout/stderr mới. `stderr` để UI tô khác — `tail` báo "file truncated" qua đó. */
  onLines: (lines: string[], source: 'stdout' | 'stderr') => void
  /** Kết thúc: lệnh tự thoát, lỗi, hoặc do `stop()`. Gọi ĐÚNG MỘT LẦN. */
  onClose: (info: { code: number | null; error?: string }) => void
}

export interface StreamHandle {
  /** Dừng lệnh và đóng chain. Gọi nhiều lần là vô hại. */
  stop: () => void
}

/**
 * Chạy một lệnh CHẠY DÀI và đẩy output ra theo dòng cho tới khi bị dừng.
 *
 * Khác `execOnce` ở chỗ cố ý KHÔNG có timeout: `tail -F` phải sống tới khi user tắt. Đổi lại,
 * `stop()` là bắt buộc phải chạy đúng — một exec channel bị bỏ quên sẽ giữ kết nối SSH mở và
 * để lệnh tiếp tục chạy trên remote sau khi UI đã đóng panel. Vì thế `closeAll` được giữ ở
 * ngoài closure `.then`, hệt như `execOnce`: dừng trong lúc `establishChain` còn dở vẫn đóng
 * được, và trường hợp đó KHÔNG exec gì cả.
 */
export function execStream(
  chain: ChainEndpoint[],
  command: string,
  verifyHostKey: HostKeyVerifier,
  opts: ExecStreamOptions
): StreamHandle {
  let stopped = false
  let closed = false
  let close: (() => void) | null = null

  const finish = (info: { code: number | null; error?: string }): void => {
    if (closed) return
    closed = true
    close?.()
    close = null
    opts.onClose(info)
  }

  const stop = (): void => {
    if (stopped) return
    stopped = true
    finish({ code: null })
  }

  const effectiveCommand =
    (opts.loginSteps?.length ? deriveExecFromLoginSteps(opts.loginSteps, command) : null) ?? command

  establishChain(chain, verifyHostKey)
    .then(({ client, closeAll }) => {
      if (stopped) {
        // Dừng nổ trong lúc đang dựng chain — KHÔNG exec, để lệnh không chạy ngoài tầm quan sát
        closeAll()
        return
      }
      close = closeAll
      client.exec(effectiveCommand, (error, stream) => {
        if (error) return finish({ code: null, error: error.message })

        const outBuf = new LineBuffer()
        const errBuf = new LineBuffer()
        const outDecoder = new StringDecoder('utf8')
        const errDecoder = new StringDecoder('utf8')
        let code: number | null = null

        stream.on('data', (chunk: Buffer) => {
          const lines = outBuf.push(outDecoder.write(chunk))
          if (lines.length > 0) opts.onLines(lines, 'stdout')
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          const lines = errBuf.push(errDecoder.write(chunk))
          if (lines.length > 0) opts.onLines(lines, 'stderr')
        })
        stream.on('exit', (c: number | null) => {
          code = c
        })
        stream.on('close', () => {
          // Dòng cuối thường không kết thúc bằng \n — bỏ qua là nuốt mất chính nó
          const tailOut = outBuf.flush()
          if (tailOut.length > 0) opts.onLines(tailOut, 'stdout')
          const tailErr = errBuf.flush()
          if (tailErr.length > 0) opts.onLines(tailErr, 'stderr')
          finish({ code })
        })
      })
    })
    .catch((error: unknown) => {
      finish({ code: null, error: error instanceof Error ? error.message : String(error) })
    })

  return { stop }
}
