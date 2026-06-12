import { BrowserWindow, ipcMain } from 'electron'
import { TunnelService } from '@infra/core'
import { IPC, type TunnelRuleInput } from '@infra/shared'
import { getVault, touchActivity } from './vault'
import { makeHostKeyVerifier, prepareConnection } from './connection'

/** CRUD tunnel rules + start/stop runtime. Trả về hàm dispose. */
export function registerTunnelsIpc(): () => void {
  const service = new TunnelService()

  service.on('state', (state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.TUNNELS_EVENT, state)
    }
  })

  ipcMain.handle(IPC.TUNNELS_LIST, () => {
    touchActivity()
    return getVault().listTunnels()
  })

  ipcMain.handle(IPC.TUNNELS_SAVE, (_event, input: TunnelRuleInput) => {
    touchActivity()
    return getVault().saveTunnel(input)
  })

  ipcMain.handle(IPC.TUNNELS_DELETE, (_event, id: string) => {
    touchActivity()
    service.stop(id)
    getVault().deleteTunnel(id)
  })

  ipcMain.handle(IPC.TUNNELS_START, async (event, id: string) => {
    touchActivity()
    const rule = getVault().getTunnel(id)
    if (!rule) throw new Error('Tunnel không tồn tại')
    const prepared = await prepareConnection(event.sender, rule.hostId)
    await service.start(rule, { chain: prepared.chain, verifyHostKey: makeHostKeyVerifier(event.sender) })
  })

  ipcMain.handle(IPC.TUNNELS_STOP, (_event, id: string) => {
    service.stop(id)
  })

  ipcMain.handle(IPC.TUNNELS_STATES, () => service.states())

  return () => service.stopAll()
}
