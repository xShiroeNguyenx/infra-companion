import { ipcMain, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { IPC } from '@infra/shared'

export function registerUpdaterIpc(win: BrowserWindow): void {
  // Không tự tải — hỏi người dùng trước
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    if (win.isDestroyed()) return
    win.webContents.send(IPC.UPDATE_AVAILABLE, info.version)
  })

  autoUpdater.on('download-progress', (progress) => {
    if (win.isDestroyed()) return
    win.webContents.send(IPC.UPDATE_PROGRESS, Math.round(progress.percent))
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (win.isDestroyed()) return
    win.webContents.send(IPC.UPDATE_DOWNLOADED, info.version)
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message)
  })

  ipcMain.handle(IPC.UPDATE_CHECK, () => autoUpdater.checkForUpdates())
  ipcMain.handle(IPC.UPDATE_DOWNLOAD, () => autoUpdater.downloadUpdate())
  ipcMain.on(IPC.UPDATE_INSTALL, () => {
    autoUpdater.quitAndInstall(false, true)
  })

  // Kiểm tra tự động sau 10 giây kể từ khi app sẵn sàng (chỉ bản đóng gói)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => console.error('[updater] check failed:', err))
    }, 10_000)
  }
}
