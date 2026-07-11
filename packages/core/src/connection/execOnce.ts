import { StringDecoder } from 'node:string_decoder'
import { establishChain, type ChainEndpoint } from './establish'
import { deriveExecFromLoginSteps, type LoginStepLike } from './loginScript'
import type { HostKeyVerifier } from './types'

export interface ExecOnceOptions {
  /** Host vào bằng login-script (ssh/su/sudo…) → bọc lệnh để chạy trên máy đích bên trong. */
  loginSteps?: LoginStepLike[]
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ExecOnceResult {
  status: 'done' | 'error'
  stdout: string
  stderr: string
  code: number | null
  error?: string
}

/**
 * Chạy MỘT lệnh qua kênh exec riêng: dựng chain (jump-aware) → `client.exec` → thu
 * stdout/stderr/exit code sạch, có timeout + AbortSignal. Đóng chain khi xong/timeout/cancel
 * (lệnh treo như `tail -f` không giữ kết nối sống sau khi caller đã bỏ). Dùng chung cho
 * Bulk (chạy nhiều host) và AI chẩn đoán F48 (chạy lệnh read-only từng bước).
 */
export function execOnce(
  chain: ChainEndpoint[],
  command: string,
  verifyHostKey: HostKeyVerifier,
  opts: ExecOnceOptions = {}
): Promise<ExecOnceResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  return new Promise((resolve) => {
    let settled = false
    // Giữ ref đóng kết nối ngoài closure .then — timeout/cancel phải đóng được chain,
    // nếu không lệnh treo (tail -f…) giữ kết nối + tiếp tục chạy trên remote sau khi UI báo lỗi
    let close: (() => void) | null = null
    const done = (r: ExecOnceResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      close?.()
      close = null
      resolve(r)
    }
    const timer = setTimeout(
      () => done({ status: 'error', stdout: '', stderr: '', code: null, error: `Timeout sau ${timeoutMs / 1000}s` }),
      timeoutMs
    )
    const onAbort = (): void => done({ status: 'error', stdout: '', stderr: '', code: null, error: 'Đã hủy' })
    if (opts.signal?.aborted) return onAbort()
    opts.signal?.addEventListener('abort', onAbort)

    // Host vào bằng login-script → bọc lệnh để chạy trên máy đích bên trong (exec trên gate)
    const effectiveCommand =
      (opts.loginSteps?.length ? deriveExecFromLoginSteps(opts.loginSteps, command) : null) ?? command
    establishChain(chain, verifyHostKey)
      .then(({ client, closeAll }) => {
        if (settled) {
          // timeout/cancel nổ trong lúc establishChain — KHÔNG exec để lệnh không chạy ngoài tầm quan sát
          closeAll()
          return
        }
        close = closeAll
        client.exec(effectiveCommand, (error, stream) => {
          if (error) {
            return done({ status: 'error', stdout: '', stderr: '', code: null, error: error.message })
          }
          let stdout = ''
          let stderr = ''
          let code: number | null = null
          const stdoutDecoder = new StringDecoder('utf8')
          const stderrDecoder = new StringDecoder('utf8')
          stream.on('data', (chunk: Buffer) => {
            stdout += stdoutDecoder.write(chunk)
          })
          stream.stderr.on('data', (chunk: Buffer) => {
            stderr += stderrDecoder.write(chunk)
          })
          stream.on('exit', (c: number | null) => {
            code = c
          })
          stream.on('close', () => {
            done({ status: 'done', stdout: stdout + stdoutDecoder.end(), stderr: stderr + stderrDecoder.end(), code })
          })
        })
      })
      .catch((error: unknown) => {
        done({
          status: 'error',
          stdout: '',
          stderr: '',
          code: null,
          error: error instanceof Error ? error.message : String(error)
        })
      })
  })
}
