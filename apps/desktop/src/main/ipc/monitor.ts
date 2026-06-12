import { ipcMain, type WebContents } from 'electron'
import { MonitorService, deriveSshArgsFromLoginSteps } from '@infra/core'
import { IPC } from '@infra/shared'
import { touchActivity } from './vault'
import { makeHostKeyVerifier, prepareConnection } from './connection'

/** Theo dõi tài nguyên host (CPU load/mem/disk/uptime) qua SSH. Trả về hàm dispose. */
export function registerMonitorIpc(): () => void {
  const service = new MonitorService()
  // Set thay vì 1 biến — biến đơn bị ghi đè khi có 2 cửa sổ/2 nơi cùng start
  const subscribers = new Set<WebContents>()

  service.on('sample', (sample) => {
    for (const subscriber of subscribers) {
      if (!subscriber.isDestroyed()) subscriber.send(IPC.MONITOR_SAMPLE, sample)
    }
  })

  ipcMain.handle(IPC.MONITOR_START, async (event, hostIds: string[]) => {
    touchActivity()
    if (!subscribers.has(event.sender)) {
      const sender = event.sender
      subscribers.add(sender)
      sender.once('destroyed', () => subscribers.delete(sender))
    }
    const verify = makeHostKeyVerifier(event.sender)
    for (const hostId of hostIds) {
      try {
        const prepared = await prepareConnection(event.sender, hostId)
        const sshArgs = deriveSshArgsFromLoginSteps(prepared.loginSteps) ?? undefined
        await service.start({ hostId, chain: prepared.chain, sshArgs }, verify)
      } catch (error) {
        event.sender.send(IPC.MONITOR_SAMPLE, {
          hostId,
          ts: Date.now(),
          ok: false,
          load1: null,
          loadText: null,
          memUsedPct: null,
          diskUsedPct: null,
          uptimeSec: null,
          cpuCount: null,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  })

  ipcMain.on(IPC.MONITOR_STOP, (_e, hostId: string) => service.stop(hostId))
  ipcMain.on(IPC.MONITOR_STOP_ALL, () => service.stopAll())

  return () => service.stopAll()
}
