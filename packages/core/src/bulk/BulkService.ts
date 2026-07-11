import { execOnce } from '../connection/execOnce'
import type { ChainEndpoint } from '../connection/establish'
import type { LoginStepLike } from '../connection/loginScript'
import type { HostKeyVerifier } from '../connection/types'

export interface BulkTarget {
  hostId: string
  label: string
  /** [hop1, …, target] đã phân giải (password đã sẵn). */
  chain: ChainEndpoint[]
  /** Nếu host vào bằng login-script (ssh/su/sudo…) — lệnh sẽ chạy trên máy đích bên trong. */
  loginSteps?: LoginStepLike[]
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
    return execOnce(target.chain, command, verifyHostKey, { loginSteps: target.loginSteps, timeoutMs, signal })
  }
}
