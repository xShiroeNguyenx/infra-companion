import { StringDecoder } from 'node:string_decoder'
import { establishChain, wrapSshCommand, type ChainEndpoint } from '../connection/establish'
import type { HostKeyVerifier } from '../connection/types'

export interface BulkTarget {
  hostId: string
  label: string
  /** [hop1, …, target] đã phân giải (password đã sẵn). */
  chain: ChainEndpoint[]
  /** Nếu host vào bằng login-script "ssh …" — lệnh sẽ chạy xuyên qua: ssh <sshArgs> '<cmd>'. */
  sshArgs?: string
}

export interface BulkResult {
  hostId: string
  status: 'done' | 'error'
  stdout: string
  stderr: string
  code: number | null
  error?: string
  durationMs: number
}

/**
 * Chạy 1 lệnh trên nhiều host SONG SONG (có giới hạn concurrency), mỗi host một
 * kết nối SSH + exec riêng. Không tương tác (dùng credential đã lưu / key / agent).
 */
export class BulkService {
  async run(
    targets: BulkTarget[],
    command: string,
    verifyHostKey: HostKeyVerifier,
    onStart: (hostId: string) => void,
    onResult: (result: BulkResult) => void,
    opts: { concurrency?: number; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<void> {
    const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 32))
    const timeoutMs = opts.timeoutMs ?? 60_000
    const queue = [...targets]

    const worker = async (): Promise<void> => {
      for (;;) {
        if (opts.signal?.aborted) return
        const target = queue.shift()
        if (!target) return
        onStart(target.hostId)
        const start = Date.now()
        const result = await this.runOne(target, command, verifyHostKey, timeoutMs, opts.signal)
        onResult({ ...result, hostId: target.hostId, durationMs: Date.now() - start })
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()))
  }

  private runOne(
    target: BulkTarget,
    command: string,
    verifyHostKey: HostKeyVerifier,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<Omit<BulkResult, 'hostId' | 'durationMs'>> {
    return new Promise((resolve) => {
      let settled = false
      // Giữ ref đóng kết nối ngoài closure .then — timeout/cancel phải đóng được chain,
      // nếu không lệnh treo (tail -f…) giữ kết nối + tiếp tục chạy trên remote sau khi UI báo lỗi
      let close: (() => void) | null = null
      const done = (r: Omit<BulkResult, 'hostId' | 'durationMs'>): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        close?.()
        close = null
        resolve(r)
      }
      const timer = setTimeout(
        () => done({ status: 'error', stdout: '', stderr: '', code: null, error: `Timeout sau ${timeoutMs / 1000}s` }),
        timeoutMs
      )
      const onAbort = (): void => done({ status: 'error', stdout: '', stderr: '', code: null, error: 'Đã hủy' })
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort)

      // Host vào bằng login-script "ssh …" → chạy lệnh xuyên qua: ssh <args> '<cmd>' trên gate
      const effectiveCommand = target.sshArgs ? wrapSshCommand(target.sshArgs, command) : command
      establishChain(target.chain, verifyHostKey)
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
}
