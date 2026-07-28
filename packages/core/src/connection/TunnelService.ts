import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import * as net from 'node:net'
import { Transform, type Duplex, type TransformCallback } from 'node:stream'
import type { Client } from 'ssh2'
import type { TunnelRuleDto, TunnelStateDto, TunnelStatus } from '@infra/shared'
import { establishChain, type ChainEndpoint } from './establish'
import {
  deriveStreamExecFromLoginSteps,
  loginScriptEntersAnotherHost,
  type LoginStepLike
} from './loginScript'
import type { HostKeyVerifier } from './types'

/** Đích chỉ được nhúng vào lệnh shell (`nc`) khi là hostname/IP đơn giản — chặn shell injection. */
const SHELL_SAFE_HOST = /^[A-Za-z0-9.:-]+$/
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|::1)$/i
/** Trần đệm byte client giữ để phát lại khi đổi đường (nc chết → direct-tcpip). */
const REPLAY_CAP_BYTES = 256 * 1024
/** direct-tcpip không xác nhận trong khoảng này = coi như treo (firewall drop SYN). */
const NATIVE_OPEN_TIMEOUT_MS = 15_000

/** Đường đi của một tunnel L. */
export type LocalForwardRoute =
  /** direct-tcpip từ endpoint SSH (kênh nhị phân sạch, nhanh nhất). */
  | 'native'
  /** `nc` chạy trên máy SÂU của login script — không có đường lui. */
  | 'script'
  /** `nc` trên máy SÂU trước, hỏng thì thử direct-tcpip từ endpoint SSH. */
  | 'script-then-native'

/**
 * Chọn đường đi cho tunnel L — mấu chốt là ĐÍCH ĐƯỢC HIỂU THEO MÁY NÀO.
 *
 * Login script có hop `ssh` (vd gate `133.x` → `ssh jpap06`) thì máy user thấy trong terminal là
 * máy SÂU, và địa chỉ đích user nhập (vd `192.168.1.71:3306`) là địa chỉ theo mạng của máy sâu đó.
 * direct-tcpip lại luôn xuất phát từ ENDPOINT SSH (gate): dải riêng như 192.168.x.x rất dễ tồn tại
 * ở CẢ HAI mạng nên gate có thể mở nhầm sang máy khác, hoặc bị firewall drop gói SYN — sshd chỉ xác
 * nhận kênh SAU khi connect() xong nên kênh treo im, tunnel vẫn xanh còn client DB chờ tới timeout
 * ("reading initial communication packet"). Vì vậy có hop ssh → đi `nc` trên máy sâu TRƯỚC, chỉ khi
 * đường đó chết mới thử direct-tcpip (ca đích chỉ gate với tới được, đã sửa ở v0.1.31).
 */
export function chooseLocalForwardRoute(destHost: string, loginSteps: LoginStepLike[]): LocalForwardRoute {
  // Không login script, hoặc script chỉ su/sudo → máy sâu CHÍNH LÀ endpoint SSH → native.
  if (!loginScriptEntersAnotherHost(loginSteps)) return 'native'
  // Đích không nhúng an toàn vào lệnh shell được → chỉ còn đường native.
  if (!SHELL_SAFE_HOST.test(destHost)) return 'native'
  // Loopback = localhost của MÁY SÂU: direct-tcpip trỏ sang máy khác hẳn → cấm fallback.
  if (LOOPBACK_HOST.test(destHost)) return 'script'
  return 'script-then-native'
}

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

    const route = chooseLocalForwardRoute(rule.destHost, tunnel.loginSteps ?? [])
    if (route === 'native') {
      return this.listen(tunnel, (socket) => this.forwardNative(tunnel, client, socket))
    }
    return this.listen(tunnel, (socket) => {
      // Relay giữ bản sao byte client gửi lên để phát lại nguyên vẹn nếu phải đổi sang native.
      const relay = new UpstreamRelay(socket)
      this.forwardViaLoginScript(
        tunnel,
        client,
        socket,
        relay,
        route === 'script-then-native'
          ? () => this.forwardNative(tunnel, client, socket, relay)
          : undefined
      )
    })
  }

  /** Native direct-tcpip (forwardOut) từ endpoint SSH — kênh nhị phân sạch, không qua shell.
   *  relay (nếu có) là đường lui từ nc: byte client đã gửi được phát lại vào kênh mới. */
  private forwardNative(
    tunnel: ActiveTunnel,
    client: Client,
    socket: net.Socket,
    relay?: UpstreamRelay
  ): void {
    const { rule } = tunnel
    const dest = `${rule.destHost}:${rule.destPort}`
    let settled = false
    // sshd chỉ xác nhận kênh SAU khi connect() tới đích xong; firewall drop gói SYN → connect()
    // treo tới TCP timeout của OS (hàng phút) và ssh2 KHÔNG có timeout riêng → callback không bao
    // giờ chạy, client DB ngồi chờ không một byte. Tự cắt + báo lỗi thay vì treo im.
    const openTimer = setTimeout(() => {
      if (settled) return
      settled = true
      this.setState(tunnel, tunnel.status, `Không mở được kết nối tới ${dest} — quá ${NATIVE_OPEN_TIMEOUT_MS / 1000}s không phản hồi (firewall chặn giữa đường?)`)
      socket.destroy()
    }, NATIVE_OPEN_TIMEOUT_MS)
    // Client bỏ đi trong lúc chờ mở kênh → dừng đồng hồ, đừng báo "firewall chặn" oan
    socket.once('close', () => {
      if (settled) return
      settled = true
      clearTimeout(openTimer)
    })

    client.forwardOut(
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      rule.destHost!,
      rule.destPort!,
      (error, stream) => {
        clearTimeout(openTimer)
        if (settled) {
          stream?.destroy() // đã báo treo trước đó → kênh về muộn thì bỏ
          return
        }
        settled = true
        if (error) {
          // forwardOut lỗi = sshd via-host từ chối mở direct-tcpip (AllowTcpForwarding no /
          // PermitOpen), hoặc via-host không route được tới đích. Hiện lỗi thật thay vì nuốt im.
          this.setState(tunnel, tunnel.status, `Không mở được kết nối tới ${dest} — ${error.message}`)
          socket.destroy()
          return
        }
        if (relay) relay.attach(stream)
        else socket.pipe(stream)
        stream.pipe(socket)
        stream.on('error', (streamErr: Error) => {
          this.setState(tunnel, tunnel.status, `Kết nối tới ${dest} lỗi: ${streamErr.message}`)
          socket.destroy()
        })
        socket.on('error', () => stream.destroy())
        // Client cắt ngang (destroy, không FIN) → đóng kênh, tránh rò kênh SSH tới khi dừng tunnel
        socket.on('close', () => stream.destroy())
      }
    )
  }

  /** Forward qua `nc dest port` chạy trên máy TRONG CÙNG (dựng bởi login-script) — đích được hiểu
   *  theo mạng của máy đó. Cần `nc` ở đầu cuối. Marker cắt rác MOTD/banner. onFallback (nếu có)
   *  chạy khi đường này chết mà CHƯA nhận được byte nào từ đích. */
  private forwardViaLoginScript(
    tunnel: ActiveTunnel,
    client: Client,
    socket: net.Socket,
    relay: UpstreamRelay,
    onFallback?: () => void
  ): void {
    const { rule } = tunnel
    // In marker NGAY TRƯỚC khi exec nc: mọi rác (MOTD/banner/prompt các hop ssh chạy qua shell)
    // đứng TRƯỚC marker → client cắt bỏ tới hết marker rồi mới coi phần sau là luồng binary sạch.
    const marker = `ICTUN${randomBytes(9).toString('hex')}`
    const inner = `printf %s ${marker}; exec nc ${rule.destHost} ${rule.destPort}`
    // deriveStreamExecFromLoginSteps: GIỮ stdin (`… | cat | …`) qua bước su/sudo — tunnel 2 chiều
    // cần byte client gửi lên vẫn tới nc (feedOneShot của Bulk/Monitor sẽ cắt stdin → gãy auth).
    const execCmd = deriveStreamExecFromLoginSteps(tunnel.loginSteps ?? [], inner) ?? inner
    const markerBuf = Buffer.from(marker)
    const dest = `${rule.destHost}:${rule.destPort}`
    client.exec(execCmd, (error, stream) => {
      if (error) {
        if (onFallback) {
          onFallback()
          return
        }
        this.setState(tunnel, tunnel.status, `Không mở được kênh exec cho tunnel: ${error.message}`)
        socket.destroy()
        return
      }
      if (socket.destroyed) {
        stream.destroy() // client bỏ đi trong lúc dựng kênh → đừng để nc chạy mồ côi
        return
      }
      // Gom stderr để lộ lỗi thật (sshpass thiếu, Permission denied, nc not found, nc: connect
      // refused…) khi kết nối chết mà chưa nhận được byte nào của đích.
      let stderrBuf = ''
      stream.stderr.on('data', (d: Buffer) => {
        if (stderrBuf.length < 2_000) stderrBuf += d.toString('utf8')
      })
      const stripper = new StripUntilMarker(markerBuf)
      let delivered = 0
      let settled = false
      const finish = (fatal: boolean): void => {
        if (settled) return
        settled = true
        if (delivered > 0) {
          // Đường đã sống rồi mới đóng → kết thúc bình thường (pipe đã end socket khi luồng end).
          if (fatal) socket.destroy()
          else socket.end()
          return
        }
        // Chưa một byte nào từ đích. Lưu ý marker được in TRƯỚC khi exec nc, nên "thấy marker"
        // KHÔNG có nghĩa nc nối được — nc không nối được cũng cho luồng rỗng y hệt.
        stream.destroy() // giải phóng kênh exec (ca marker-lỗi: luồng còn sống)
        if (onFallback && relay.replayable) {
          relay.detach()
          stripper.unpipe(socket)
          onFallback() // đích có thể chỉ endpoint SSH với tới được → thử direct-tcpip
          return
        }
        const why = stderrBuf.trim()
          ? stderrBuf.trim().slice(-300)
          : stripper.matched
            ? `'nc' trên máy trong cùng không nối được tới ${dest}`
            : `luồng đóng sớm — kiểm tra 'nc' trên máy trong cùng + đích ${dest} có mở`
        this.setState(tunnel, tunnel.status, `Tunnel login-script lỗi: ${why}`)
        socket.destroy()
      }
      relay.attach(stream) // client → nc stdin (raw, có giữ bản sao để phát lại)
      stripper.on('data', (chunk: Buffer) => {
        delivered += chunk.length
        relay.confirm() // đích đã nói → đường sống, thôi giữ bản sao
      })
      // { end: false }: luồng nc kết thúc KHÔNG được tự đóng chiều ghi của socket — nếu nc chết
      // sớm ta còn phải đổi sang direct-tcpip trên chính socket này (socket.end() sẽ khiến client
      // đóng nốt chiều còn lại, đường mới có mở cũng không gửi được gì). finish() tự đóng khi cần.
      stream.pipe(stripper).pipe(socket, { end: false }) // nc stdout → cắt rác tới marker → client
      stream.on('error', () => finish(true))
      stripper.on('error', () => finish(false))
      socket.on('error', () => stream.destroy())
      // Client cắt ngang (destroy, không FIN) → đóng kênh exec, tránh rò kênh + tiến trình nc
      socket.on('close', () => stream.destroy())
      // 'end' (nc/hop ssh thoát) tới TRƯỚC 'close' → phát hiện đường chết sớm hơn; đăng ký SAU
      // pipe để stripper đã flush xong, `delivered` chắc chắn đúng.
      stream.on('end', () => finish(false))
      stream.on('close', () => finish(false))
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
 * Cầu nối chiều client → tunnel, GIỮ bản sao byte đầu luồng để phát lại khi phải đổi đường
 * (nc trên máy sâu chết → direct-tcpip từ endpoint SSH).
 *
 * MySQL/PostgreSQL server nói trước nên lúc đổi đường thường chưa có byte nào của client; nhưng
 * protocol client-nói-trước (HTTP, Redis…) thì có — phát lại giữ cho việc đổi đường trong suốt
 * với client. Quá REPLAY_CAP_BYTES thì bỏ bản sao (replayable = false) và không đổi đường nữa.
 */
class UpstreamRelay {
  private target: Duplex | null = null
  private replay: Buffer[] = []
  private buffered = 0
  private confirmed = false
  private ended = false

  constructor(private readonly socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      if (!this.confirmed) {
        this.buffered += chunk.length
        if (this.buffered <= REPLAY_CAP_BYTES) this.replay.push(chunk)
        else this.replay = []
      }
      if (this.target && !this.target.write(chunk)) socket.pause()
    })
    socket.on('end', () => {
      this.ended = true
      this.target?.end()
    })
  }

  /** Còn đủ bản sao để đổi đường mà không mất byte nào? */
  get replayable(): boolean {
    return !this.confirmed && this.buffered <= REPLAY_CAP_BYTES
  }

  /** Nối vào đích mới: xả bản sao đã đệm trước, rồi luồng chảy tiếp. */
  attach(target: Duplex): void {
    this.target = target
    target.on('drain', () => {
      if (this.target === target) this.socket.resume()
    })
    for (const chunk of this.replay) target.write(chunk)
    if (this.ended) target.end()
  }

  detach(): void {
    this.target = null
  }

  /** Đích đã trả byte về → đường sống, khỏi giữ bản sao. */
  confirm(): void {
    if (this.confirmed) return
    this.confirmed = true
    this.replay = []
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
