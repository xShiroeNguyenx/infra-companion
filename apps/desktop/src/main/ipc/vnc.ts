import { randomBytes, randomUUID } from 'node:crypto'
import * as net from 'node:net'
import { ipcMain } from 'electron'
import { WebSocketServer, type WebSocket } from 'ws'
import { startForward, type ForwardHandle } from '@infra/core'
import { IPC, type VncOpenResultDto } from '@infra/shared'
import { makeHostKeyVerifier, prepareForward } from './connection'
import { getVault, touchActivity } from './vault'

interface ActiveVnc {
  forward: ForwardHandle
  wss: WebSocketServer
  token: string
}

/**
 * F13 — VNC nhúng: forward cổng VNC (5900) của đích ra 127.0.0.1 (xuyên jump host nếu có),
 * rồi mở một WebSocketServer local làm cầu ws↔tcp để noVNC (renderer) nối vào. Token 1 phiên
 * + bind 127.0.0.1 → không lộ ra LAN. RFB nói giao thức nhị phân trực tiếp qua ws.
 */
export function registerVncIpc(): () => void {
  const active = new Map<string, ActiveVnc>()

  const closeSession = (sessionId: string): void => {
    const s = active.get(sessionId)
    if (!s) return
    active.delete(sessionId)
    try {
      s.wss.close()
    } catch {
      /* đã đóng */
    }
    try {
      s.forward.close()
    } catch {
      /* đã đóng */
    }
  }

  ipcMain.handle(IPC.VNC_OPEN, async (event, hostId: string): Promise<VncOpenResultDto> => {
    touchActivity()
    const host = getVault().getHost(hostId)
    if (!host) throw new Error('Host không tồn tại')
    const prepared = await prepareForward(event.sender, hostId)
    const forward = await startForward(
      prepared.jumps,
      prepared.destHost,
      prepared.destPort,
      makeHostKeyVerifier(event.sender)
    )
    const token = randomBytes(18).toString('hex')
    const sessionId = randomUUID()

    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve)
      wss.once('error', reject)
    })
    wss.on('error', () => {
      /* lỗi runtime của ws server — bỏ qua, phiên sẽ tự dọn khi đóng tab */
    })

    wss.on('connection', (socket: WebSocket, req) => {
      // Chỉ nhận kết nối có token đúng (chống trang/khác nối vào cổng ws local)
      const url = new URL(req.url ?? '/', 'ws://127.0.0.1')
      if (url.searchParams.get('token') !== token) {
        socket.close()
        return
      }
      const tcp = net.connect(forward.port, '127.0.0.1')
      tcp.on('data', (chunk) => {
        if (socket.readyState === socket.OPEN) socket.send(chunk)
      })
      socket.on('message', (data) => tcp.write(data as Buffer))
      tcp.on('close', () => socket.close())
      tcp.on('error', () => socket.close())
      socket.on('close', () => tcp.destroy())
      socket.on('error', () => tcp.destroy())
    })

    const wsPort = (wss.address() as net.AddressInfo).port
    active.set(sessionId, { forward, wss, token })
    return { sessionId, wsPort, token, title: prepared.label }
  })

  ipcMain.on(IPC.VNC_CLOSE, (_e, sessionId: string) => closeSession(sessionId))

  return () => {
    for (const id of [...active.keys()]) closeSession(id)
  }
}
