import { StringDecoder } from 'node:string_decoder'
import type { ClientChannel } from 'ssh2'
import type { LoginStep } from '@infra/shared'
import { applyTotpToken } from '../secrets/totp'
import { establishChain, type ChainEndpoint } from './establish'
import type { HostKeyVerifier, SessionSink, TerminalSession } from './types'

export interface SshSessionOptions {
  /** [hop1, hop2, …, target] — ít nhất 1 phần tử (target). */
  chain: ChainEndpoint[]
  agentForward?: boolean
  /** Env gửi sau khi shell mở (qua lệnh export — AcceptEnv phía server thường bị tắt). */
  env?: Record<string, string>
  /** Script chạy tự động sau khi login. */
  startupScript?: string
  /** Login script expect/send (vd su → ssh lồng nhau). Secret đã được resolve thành giá trị thật. */
  loginSteps?: LoginStep[]
  /** F41: TOTP seed (base32) — bước login script chứa {{totp}} được thay bằng mã TƯƠI lúc gửi
   *  (mã sống 30s; thay lúc prepare có thể hết hạn khi chain nhiều hop nối chậm). */
  totpSecret?: string
  /** Bật: sau login tự `tmux new-session -A` để phiên sống sót/khôi phục khi rớt mạng. */
  tmux?: boolean
  verifyHostKey: HostKeyVerifier
}

/** Tên tmux session dùng để attach-or-create (đặt riêng, tránh chiếm session có sẵn của user). */
const TMUX_SESSION = 'ic-main'

/** Thời gian chờ tối đa cho mỗi bước expect. */
const LOGIN_STEP_TIMEOUT_MS = 20_000
/** Delay trước khi gửi bước không có expect. */
const LOGIN_STEP_DELAY_MS = 800

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAYS_MS = [1_000, 3_000, 5_000]

/**
 * Phiên SSH shell (hỗ trợ jump chain), keep-alive và tự kết nối lại khi rớt mạng.
 */
export class SshSession implements TerminalSession {
  readonly kind = 'ssh' as const
  private closeChain: (() => void) | null = null
  private stream: ClientChannel | null = null
  private killed = false
  private everConnected = false
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private cols: number
  private rows: number

  constructor(
    readonly id: string,
    private readonly options: SshSessionOptions,
    cols: number,
    rows: number,
    private readonly sink: SessionSink
  ) {
    this.cols = cols
    this.rows = rows
    this.sink.status(this.id, 'connecting')
    void this.connect()
  }

  private async connect(): Promise<void> {
    if (this.killed) return
    try {
      const { client, closeAll } = await establishChain(
        this.options.chain,
        this.options.verifyHostKey,
        this.options.agentForward
      )
      if (this.killed) return closeAll()
      this.closeChain = closeAll

      client.on('close', () => {
        this.stream = null
        // Đóng cả chain (hop còn keepalive) — không đóng sẽ leak kết nối tới jump host mỗi lần rớt
        if (this.closeChain === closeAll) this.closeChain = null
        closeAll()
        if (this.killed) return
        if (this.everConnected) this.scheduleReconnect()
      })

      client.shell({ term: 'xterm-256color', cols: this.cols, rows: this.rows }, (error, stream) => {
        if (this.killed) return closeAll()
        if (error) {
          this.killed = true
          this.sink.exit(this.id, null, `Không mở được shell: ${error.message}`)
          closeAll()
          return
        }
        this.everConnected = true
        this.reconnectAttempt = 0
        this.stream = stream
        this.sink.status(this.id, 'connected')
        if (this.options.loginSteps && this.options.loginSteps.length > 0) {
          this.runLoginSteps(stream, this.options.loginSteps)
        } else {
          this.sendBootstrap(stream)
        }
        // StringDecoder giữ byte UTF-8 dở dang giữa 2 chunk — tránh vỡ ký tự multibyte tại ranh giới TCP
        const stdoutDecoder = new StringDecoder('utf8')
        const stderrDecoder = new StringDecoder('utf8')
        stream.on('data', (chunk: Buffer) => {
          const text = stdoutDecoder.write(chunk)
          if (text) this.sink.data(this.id, text)
        })
        stream.stderr.on('data', (chunk: Buffer) => {
          const text = stderrDecoder.write(chunk)
          if (text) this.sink.data(this.id, text)
        })
        stream.on('exit', (code: number | null) => {
          // Shell thoát chủ động (user gõ exit) → kết thúc phiên, không reconnect
          this.killed = true
          this.sink.exit(this.id, code)
          this.closeChain = null
          closeAll()
        })
        stream.on('close', () => {
          // Channel đóng không kèm exit-status (sshd phi chuẩn / thiết bị mạng) → coi như mất shell
          if (this.killed || this.stream !== stream) return
          this.stream = null
          if (this.closeChain === closeAll) this.closeChain = null
          closeAll()
          this.scheduleReconnect()
        })
      })
    } catch (error) {
      if (this.killed) return
      if (this.everConnected) {
        this.scheduleReconnect()
      } else {
        this.killed = true
        this.sink.exit(this.id, null, error instanceof Error ? error.message : String(error))
      }
    }
  }

  /**
   * Engine expect/send: chờ chuỗi xuất hiện trong output rồi gửi bước tiếp theo.
   * Cho phép chuỗi đăng nhập kiểu: su <user> → nhập password → ssh server-B.
   * Sau bước cuối mới gửi env/startup (áp vào shell đích cuối cùng).
   */
  private runLoginSteps(stream: ClientChannel, steps: LoginStep[]): void {
    let index = 0
    let tail = ''
    const tailDecoder = new StringDecoder('utf8')
    let delayTimer: NodeJS.Timeout | null = null
    let timeoutTimer: NodeJS.Timeout | null = null
    let finished = false

    const cleanup = (): void => {
      if (finished) return
      finished = true
      if (delayTimer) clearTimeout(delayTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      stream.off('data', onData)
      stream.off('close', onStreamClose)
    }

    // Kết nối rớt giữa chừng login script: hủy timer, nếu không cảnh báo 20s sẽ
    // bắn nhầm vào terminal của phiên đã reconnect (cùng session id)
    const onStreamClose = (): void => cleanup()

    const sendCurrent = (): void => {
      if (finished) return
      const step = steps[index]!
      // {{totp}} → mã 2FA tươi ngay lúc gửi (host có lưu TOTP seed — F41)
      stream.write(applyTotpToken(step.send, this.options.totpSecret) + '\n')
      index += 1
      tail = ''
      armNext()
    }

    const armNext = (): void => {
      if (finished) return
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (index >= steps.length) {
        cleanup()
        this.sendBootstrap(stream)
        return
      }
      const step = steps[index]!
      if (!step.expect) {
        delayTimer = setTimeout(sendCurrent, LOGIN_STEP_DELAY_MS)
        return
      }
      timeoutTimer = setTimeout(() => {
        cleanup()
        this.sink.data(
          this.id,
          `\r\n\x1b[33m[Login script: hết ${LOGIN_STEP_TIMEOUT_MS / 1000}s chờ "${step.expect}" — dừng ở bước ${index + 1}/${steps.length}]\x1b[0m\r\n`
        )
      }, LOGIN_STEP_TIMEOUT_MS)
    }

    const onData = (chunk: Buffer): void => {
      if (finished) return
      const step = steps[index]
      if (!step?.expect) return
      tail = (tail + tailDecoder.write(chunk)).slice(-4_000)
      if (tail.includes(step.expect)) {
        if (timeoutTimer) clearTimeout(timeoutTimer)
        sendCurrent()
      }
    }

    stream.on('data', onData)
    stream.on('close', onStreamClose)
    armNext()
  }

  /** Gửi env exports + startup script ngay sau khi shell sẵn sàng. */
  private sendBootstrap(stream: ClientChannel): void {
    const lines: string[] = []
    for (const [key, value] of Object.entries(this.options.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
      lines.push(`export ${key}=${shellQuote(value)}`)
    }
    if (this.options.startupScript) lines.push(this.options.startupScript)
    // tmux LẦN CUỐI: attach-or-create. Chạy lại ở mỗi lần (re)connect → re-attach session
    // còn sống trên server (resume). CHỈ thêm khi bật — host không bật bootstrap y hệt như cũ.
    if (this.options.tmux) lines.push(`tmux new-session -A -s ${TMUX_SESSION}`)
    if (lines.length > 0) stream.write(lines.join('\n') + '\n')
  }

  private scheduleReconnect(): void {
    if (this.killed) return
    if (this.reconnectTimer) return // đã có lịch reconnect (stream close + client close cùng bắn)
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.killed = true
      this.closeChain?.()
      this.closeChain = null
      this.sink.exit(this.id, null, 'Mất kết nối — đã thử kết nối lại 3 lần không thành công')
      return
    }
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt] ?? 5_000
    this.reconnectAttempt += 1
    this.sink.status(this.id, 'reconnecting', `Thử lại lần ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}`)
    this.sink.data(
      this.id,
      `\r\n\x1b[33m[Mất kết nối — đang kết nối lại (${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})…]\x1b[0m\r\n`
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  write(data: string): void {
    this.stream?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.stream?.setWindow(rows, cols, 0, 0)
  }

  kill(): void {
    this.killed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.stream?.end()
    this.closeChain?.()
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
