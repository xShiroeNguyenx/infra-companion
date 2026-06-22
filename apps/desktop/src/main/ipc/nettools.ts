import { ipcMain } from 'electron'
import { ping, dnsLookup, checkPort, scanCommonPorts, fetchImageAsDataUrl } from '@infra/core'
import { IPC } from '@infra/shared'

/** Network toolbox: ping / DNS / port check / port scan (thuần local, không cần vault). */
export function registerNetToolsIpc(): void {
  ipcMain.handle(IPC.NET_PING, (_e, host: string) => ping(host))
  ipcMain.handle(IPC.NET_DNS, (_e, host: string) => dnsLookup(host))
  ipcMain.handle(IPC.NET_PORT, (_e, host: string, port: number) => checkPort(host, port))
  ipcMain.handle(IPC.NET_SCAN, (_e, host: string) => scanCommonPorts(host))
  ipcMain.handle(IPC.NET_FETCH_IMAGE, (_e, url: string) => fetchImageAsDataUrl(url))
}
