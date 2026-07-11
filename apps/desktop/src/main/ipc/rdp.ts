import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { startForward, type ForwardHandle } from '@infra/core'
import { IPC, type RdpOpenResultDto, type RdpSessionDto } from '@infra/shared'
import { makeHostKeyVerifier, prepareForward } from './connection'
import { getVault, touchActivity } from './vault'

interface ActiveRdp {
  sessionId: string
  label: string
  forward: ForwardHandle
  child: ChildProcess | null
}

/**
 * F13 — RDP qua tunnel: forward cổng 3389 của đích (xuyên jump host nếu có) ra 127.0.0.1
 * rồi mở client RDP hệ điều hành trỏ vào cổng local. KHÔNG nhúng FreeRDP — dùng client OS.
 * Windows: sinh file .rdp tạm + mở mstsc.exe (đóng cửa sổ RDP → child exit → tự đóng tunnel).
 * OS khác: chỉ mở tunnel + trả hint để user tự nối client.
 */
export function registerRdpIpc(): () => void {
  const active = new Map<string, ActiveRdp>()

  const broadcast = (): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.RDP_EVENT)
    }
  }

  const closeSession = (sessionId: string): void => {
    const s = active.get(sessionId)
    if (!s) return
    active.delete(sessionId)
    try {
      s.forward.close()
    } catch {
      /* đã đóng */
    }
    if (s.child && !s.child.killed) {
      try {
        s.child.kill()
      } catch {
        /* đã thoát */
      }
    }
    broadcast()
  }

  ipcMain.handle(IPC.RDP_OPEN, async (event, hostId: string): Promise<RdpOpenResultDto> => {
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
    const sessionId = randomUUID()

    let launched = false
    let hint: string | undefined
    let child: ChildProcess | null = null
    if (process.platform === 'win32') {
      const rdpFile = join(app.getPath('temp'), `infra-${sessionId}.rdp`)
      const lines = [`full address:s:127.0.0.1:${forward.port}`, 'prompt for credentials:i:1']
      if (prepared.user) lines.push(`username:s:${prepared.user}`)
      writeFileSync(rdpFile, lines.join('\r\n'), 'utf8')
      child = spawn('mstsc.exe', [rdpFile], { windowsHide: false })
      child.on('error', () => closeSession(sessionId)) // không có mstsc (hiếm) → dọn tunnel
      child.on('exit', () => closeSession(sessionId)) // đóng cửa sổ RDP → đóng tunnel
      launched = true
    } else {
      hint = `Tunnel mở tại 127.0.0.1:${forward.port} — mở client RDP (Microsoft Remote Desktop / xfreerdp / remmina) và nối vào địa chỉ này.`
    }

    active.set(sessionId, { sessionId, label: prepared.label, forward, child })
    broadcast()
    return { sessionId, localPort: forward.port, label: prepared.label, launched, hint }
  })

  ipcMain.on(IPC.RDP_CLOSE, (_e, sessionId: string) => closeSession(sessionId))

  ipcMain.handle(
    IPC.RDP_LIST,
    (): RdpSessionDto[] =>
      [...active.values()].map((s) => ({ sessionId: s.sessionId, label: s.label, localPort: s.forward.port }))
  )

  return () => {
    for (const id of [...active.keys()]) closeSession(id)
  }
}
