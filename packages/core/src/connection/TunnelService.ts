import { EventEmitter } from 'node:events'
import * as net from 'node:net'
import type { Client } from 'ssh2'
import type { TunnelRuleDto, TunnelStateDto, TunnelStatus } from '@infra/shared'
import { establishChain, type ChainEndpoint } from './establish'
import type { HostKeyVerifier } from './types'

export interface TunnelConnectionConfig {
  chain: ChainEndpoint[]
  verifyHostKey: HostKeyVerifier
}

interface ActiveTunnel {
  rule: TunnelRuleDto
  client: Client | null
  server: net.Server | null
  closeChain: (() => void) | null
  status: TunnelStatus
  detail?: string
  stopping: boolean
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
      stopping: false
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
