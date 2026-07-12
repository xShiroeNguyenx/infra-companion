import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import * as net from 'node:net'
import { Transform, type TransformCallback } from 'node:stream'
import type { Client } from 'ssh2'
import type { TunnelRuleDto, TunnelStateDto, TunnelStatus } from '@infra/shared'
import { establishChain, type ChainEndpoint } from './establish'
import { deriveStreamExecFromLoginSteps, type LoginStepLike } from './loginScript'
import type { HostKeyVerifier } from './types'

export interface TunnelConnectionConfig {
  chain: ChainEndpoint[]
  verifyHostKey: HostKeyVerifier
  /** Login script của via host (nếu có): tunnel L sẽ đi QUA login-script (nc trên máy trong cùng)
   *  thay vì forwardOut — cho máy chỉ vào được bằng `ssh` trong shell, không nhận jump host `-J`. */
  loginSteps?: LoginStepLike[]
}

interface ActiveTunnel {
  rule: TunnelRuleDto
  client: Client | null
  server: net.Server | null
  closeChain: (() => void) | null
  status: TunnelStatus
  detail?: string
  stopping: boolean
  loginSteps?: LoginStepLike[]
}

export interface TunnelServiceEvents {
  state: [TunnelStateDto]
}

/**
 * Quản lý runtime các port forwarding rule:
 * - L (local):   listen local → forwardOut tới dest qua SSH
 * - D (dynamic): SOCKS5 proxy local → forwardOut tới đích bất kỳ
 * - R (remote):  forwardIn trên server → nối về dest local
 * Mỗi tunnel dùng một kết nối SSH riêng (đi qua jump chain nếu host có).
 */
export class TunnelService extends EventEmitter<TunnelServiceEvents> {
  private readonly active = new Map<string, ActiveTunnel>()

  states(): TunnelStateDto[] {
    return [...this.active.values()].map((t) => ({
      ruleId: t.rule.id,
      status: t.status,
      detail: t.detail
    }))
  }

  isRunning(ruleId: string): boolean {
    const tunnel = this.active.get(ruleId)
    return tunnel !== undefined && (tunnel.status === 'active' || tunnel.status === 'starting')
  }

  async start(rule: TunnelRuleDto, config: TunnelConnectionConfig): Promise<void> {
    if (this.isRunning(rule.id)) return
    const tunnel: ActiveTunnel = {
      rule,
      client: null,
      server: null,
      closeChain: null,
      status: 'starting',
      stopping: false,
      loginSteps: config.loginSteps
    }
    this.active.set(rule.id, tunnel)
    this.setState(tunnel, 'starting')

    try {
      const { client, closeAll } = await establishChain(config.chain, config.verifyHostKey)
      // User bấm stop/xóa rule trong lúc establishChain đang chạy → đóng ngay,
      // nếu không chain + server listen sẽ mồ côi (chiếm port tới khi thoát app)
      if (tunnel.stopping) {
        closeAll()
        return
      }
      tunnel.client = client
      tunnel.closeChain = closeAll

      client.on('close', () => {
        if (tunnel.stopping) return
        this.teardown(tunnel)
        this.setState(tunnel, 'error', 'Mất kết nối SSH')
      })

      if (rule.type === 'L') await this.startLocal(tunnel, client)
      else if (rule.type === 'D') await this.startDynamic(tunnel, client)
      else await this.startRemote(tunnel, client)

      if (tunnel.stopping) {
        this.teardown(tunnel)
        return
      }
      this.setState(tunnel, 'active')
    } catch (error) {
      this.teardown(tunnel)
      if (!tunnel.stopping) {
        this.setState(tunnel, 'error', error instanceof Error ? error.message : String(error))
      }
    }
  }

  stop(ruleId: string): void {
    const tunnel = this.active.get(ruleId)
    if (!tunnel) return
    tunnel.stopping = true
    this.teardown(tunnel)
    this.setState(tunnel, 'stopped')
    this.active.delete(ruleId)
  }

  stopAll(): void {
    for (const id of [...this.active.keys()]) this.stop(id)
  }

  // ---- L: local port → dest qua SSH -------------------------------------

  private startLocal(tunnel: ActiveTunnel, client: Client): Promise<void> {
    const { rule } = tunnel
    if (!rule.destHost || !rule.destPort) return Promise.reject(new Error('Tunnel local thiếu đích'))

    // Via host vào bằng login-script (máy đích chỉ ssh được trong shell, không nhận `-J`):
    // forwardOut sẽ thất bại → thay bằng `nc dest port` chạy trên máy TRONG CÙNG qua exec
    // (nested ssh do deriveExecFromLoginSteps dựng, y như Bulk/Monitor). Yêu cầu `nc` ở đầu cuối.
    if (tunnel.loginSteps && tunnel.loginSteps.length > 0) {
      if (!/^[A-Za-z0-9.-]+$/.test(rule.destHost)) {
        return Promise.reject(new Error('Địa chỉ đích không hợp lệ cho tunnel qua login-script'))
      }
      // In marker NGAY TRƯỚC khi exec nc: mọi rác (MOTD/banner/prompt của các hop ssh chạy qua
      // shell) đứng TRƯỚC marker → phía client cắt bỏ tới hết marker rồi mới coi phần sau là luồng
      // binary sạch của DB. (SFTP-over-exec không cần vì dùng subsystem, còn nc chạy qua shell.)
      const marker = `ICTUN${randomBytes(9).toString('hex')}`
      const inner = `printf %s ${marker}; exec nc ${rule.destHost} ${rule.destPort}`
      // deriveStreamExecFromLoginSteps: GIỮ stdin (`… | cat | …`) qua bước su/sudo — tunnel 2 chiều
      // cần byte client gửi lên vẫn tới nc (feedOneShot của Bulk/Monitor sẽ cắt stdin → gãy auth).
      const execCmd = deriveStreamExecFromLoginSteps(tunnel.loginSteps, inner) ?? inner
      const markerBuf = Buffer.from(marker)
      return this.listen(tunnel, (socket) => {
        client.exec(execCmd, (error, stream) => {
          if (error) {
            socket.destroy()
            return
          }
          // Gom stderr để lộ lỗi thật (sshpass thiếu, Permission denied, nc not found…) khi
          // kết nối chết mà CHƯA từng thấy marker (nested ssh/nc fail → luồng rỗng).
          let stderrBuf = ''
          stream.stderr.on('data', (d: Buffer) => {
            if (stderrBuf.length < 2_000) stderrBuf += d.toString('utf8')
          })
          const stripper = new StripUntilMarker(markerBuf)
          const onFail = (): void => {
            if (!stripper.matched && stderrBuf.trim()) {
              this.setState(tunnel, tunnel.status, `Tunnel login-script lỗi: ${stderrBuf.trim().slice(-300)}`)
            }
            socket.destroy()
          }
          socket.pipe(stream) // client → nc stdin (raw)
          stream.pipe(stripper).pipe(socket) // nc stdout → cắt rác tới marker → client
          stream.on('error', () => socket.destroy())
          stripper.on('error', onFail)
          socket.on('error', () => stream.destroy())
          stream.on('close', onFail)
        })
      })
    }

    return this.listen(tunnel, (socket) => {
      client.forwardOut(
        socket.remoteAddress ?? '127.0.0.1',
        socket.remotePort ?? 0,
        rule.destHost!,
        rule.destPort!,
        (error, stream) => {
          if (error) {
            socket.destroy()
            return
          }
          socket.pipe(stream).pipe(socket)
          stream.on('error', () => socket.destroy())
          socket.on('error', () => stream.destroy())
        }
      )
    })
  }

  // ---- D: SOCKS5 proxy ----------------------------------------------------

  private startDynamic(tunnel: ActiveTunnel, client: Client): Promise<void> {
    return this.listen(tunnel, (socket) => {
      void import('./socks5').then(({ readSocks5Request, socks5Success, socks5Failure }) => {
        readSocks5Request(socket)
          .then(({ host, port, leftover }) => {
            client.forwardOut(socket.remoteAddress ?? '127.0.0.1', socket.remotePort ?? 0, host, port, (error, stream) => {
              if (error) {
                socks5Failure(socket)
                return
              }
              socks5Success(socket)
              if (leftover.length > 0) stream.write(leftover)
              socket.pipe(stream).pipe(socket)
              stream.on('error', () => socket.destroy())
              socket.on('error', () => stream.destroy())
            })
          })
          .catch(() => socket.destroy())
      })
    })
  }

  // ---- R: port trên server → dest local ----------------------------------

  private startRemote(tunnel: ActiveTunnel, client: Client): Promise<void> {
    const { rule } = tunnel
    if (!rule.destHost || !rule.destPort) return Promise.reject(new Error('Tunnel remote thiếu đích'))
    return new Promise((resolve, reject) => {
      client.on('tcp connection', (_info, accept) => {
        const channel = accept()
        const local = net.connect(rule.destPort!, rule.destHost!)
        local.on('connect', () => {
          channel.pipe(local).pipe(channel)
        })
        local.on('error', () => channel.close())
        channel.on('error', () => local.destroy())
      })
      client.forwardIn(rule.bindHost, rule.bindPort, (error) => {
        if (error) reject(new Error(`Server từ chối mở port ${rule.bindPort}: ${error.message}`))
        else resolve()
      })
    })
  }

  private listen(tunnel: ActiveTunnel, onConnection: (socket: net.Socket) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer(onConnection)
      tunnel.server = server
      let settled = false
      server.on('error', (error: NodeJS.ErrnoException) => {
        if (!settled) {
          settled = true
          reject(
            error.code === 'EADDRINUSE'
              ? new Error(`Port ${tunnel.rule.bindPort} đang được dùng bởi ứng dụng khác`)
              : error
          )
        } else {
          this.teardown(tunnel)
          this.setState(tunnel, 'error', error.message)
        }
      })
      server.listen(tunnel.rule.bindPort, tunnel.rule.bindHost, () => {
        settled = true
        resolve()
      })
    })
  }

  private teardown(tunnel: ActiveTunnel): void {
    tunnel.server?.close()
    tunnel.server = null
    tunnel.closeChain?.()
    tunnel.closeChain = null
    tunnel.client = null
  }

  private setState(tunnel: ActiveTunnel, status: TunnelStatus, detail?: string): void {
    tunnel.status = status
    tunnel.detail = detail
    this.emit('state', { ruleId: tunnel.rule.id, status, detail })
  }
}

/**
 * Transform cho tunnel qua login-script: nuốt mọi byte tới HẾT lần xuất hiện đầu của marker,
 * rồi cho phần còn lại đi qua nguyên vẹn (luồng binary DB sạch). Marker luôn được in ngay
 * trước `exec nc`, nên rác của mọi hop ssh (MOTD/banner) nằm trước nó.
 */
class StripUntilMarker extends Transform {
  private seen = false
  private head = Buffer.alloc(0)

  constructor(private readonly marker: Buffer) {
    super()
  }

  /** Đã tìm thấy marker chưa (đã bắt đầu forward dữ liệu binary sạch). */
  get matched(): boolean {
    return this.seen
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    if (this.seen) {
      cb(null, chunk)
      return
    }
    this.head = Buffer.concat([this.head, chunk])
    const idx = this.head.indexOf(this.marker)
    if (idx >= 0) {
      this.seen = true
      const rest = this.head.subarray(idx + this.marker.length)
      this.head = Buffer.alloc(0)
      cb(null, rest.length > 0 ? rest : undefined)
    } else if (this.head.length > 65_536) {
      // Không thấy marker trong 64KB đầu → chuỗi hỏng (nc/ssh lỗi), dừng
      cb(new Error('Không thấy marker tunnel — có thể thiếu nc hoặc một hop ssh lỗi'))
    } else {
      // Giữ lại 4KB đuôi phòng marker bị cắt ngang 2 chunk (marker ngắn hơn nhiều)
      cb()
    }
  }
}
