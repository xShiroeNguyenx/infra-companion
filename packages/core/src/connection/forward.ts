import * as net from 'node:net'
import { establishChain, type ChainEndpoint } from './establish'
import type { HostKeyVerifier } from './types'

export interface ForwardHandle {
  /** Cổng local (127.0.0.1) đang bắc cầu tới đích. */
  port: number
  close: () => void
}

/**
 * Mở local TCP listener trên 127.0.0.1:<cổng ngẫu nhiên> bắc cầu tới destHost:destPort — nền
 * cho tunnel cổng VNC(5900)/RDP(3389) của F13:
 * - Có jumps (jump chain SSH): SSH qua chuỗi hop rồi `forwardOut` tới đích. Máy ĐÍCH KHÔNG cần
 *   SSH (vd hộp Windows RDP / máy VNC) — chỉ các hop là SSH.
 * - Không jumps: `net.connect` thẳng tới đích (đích cùng mạng, không cần xuyên gate).
 * Trả { port, close }. close() đóng listener + (nếu có) chuỗi SSH.
 */
export async function startForward(
  jumps: ChainEndpoint[],
  destHost: string,
  destPort: number,
  verifyHostKey: HostKeyVerifier
): Promise<ForwardHandle> {
  if (jumps.length === 0) {
    const server = await listen((socket) => {
      const remote = net.connect(destPort, destHost)
      remote.on('connect', () => {
        socket.pipe(remote).pipe(socket)
      })
      remote.on('error', () => socket.destroy())
      socket.on('error', () => remote.destroy())
    })
    return { port: portOf(server), close: () => server.close() }
  }

  const { client, closeAll } = await establishChain(jumps, verifyHostKey)
  const server = await listen((socket) => {
    client.forwardOut(socket.remoteAddress ?? '127.0.0.1', socket.remotePort ?? 0, destHost, destPort, (error, stream) => {
      if (error) {
        socket.destroy()
        return
      }
      socket.pipe(stream).pipe(socket)
      stream.on('error', () => socket.destroy())
      socket.on('error', () => stream.destroy())
    })
  })
  return {
    port: portOf(server),
    close: () => {
      server.close()
      closeAll()
    }
  }
}

function listen(onConnection: (socket: net.Socket) => void): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(onConnection)
    let settled = false
    server.on('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    server.listen(0, '127.0.0.1', () => {
      settled = true
      resolve(server)
    })
  })
}

function portOf(server: net.Server): number {
  const addr = server.address()
  if (addr && typeof addr === 'object') return addr.port
  throw new Error('Không lấy được cổng local của tunnel')
}
