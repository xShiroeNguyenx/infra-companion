import { ipcMain, app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { semverGt } from '@infra/core'
import { IPC, type UpdateCheckResultDto } from '@infra/shared'

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

  /**
   * User tự bấm "Kiểm tra cập nhật" → phải trả lời được thành câu trong MỌI trường hợp.
   *
   * `checkForUpdates()` chỉ bắn sự kiện khi CÓ bản mới; không có thì im lặng tuyệt đối, nên nếu
   * cứ trả `void` như trước thì bấm nút xong màn hình đứng im — user không phân biệt được "đã
   * mới nhất" với "hỏng mà không ai báo". Ở đây tự so version và trả kết quả tường minh.
   */
  ipcMain.handle(IPC.UPDATE_CHECK, async (): Promise<UpdateCheckResultDto> => {
    const current = app.getVersion()
    // Bản dev không có metadata update (dev-app-update.yml) → checkForUpdates ném lỗi khó hiểu
    if (!app.isPackaged) return { status: 'dev' }
    try {
      const result = await autoUpdater.checkForUpdates()
      const remote = result?.updateInfo.version
      if (!remote) return { status: 'latest', version: current }
      return semverGt(remote, current)
        ? { status: 'available', version: remote }
        : { status: 'latest', version: current }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[updater] check failed:', message)
      // Ngay sau khi push tag, GitHub đã trỏ "latest release" vào bản mới trong khi CI còn
      // đang tải asset lên — vài phút đầu `latest*.yml` chưa tồn tại và electron-updater ném
      // 404. Đã có user bấm kiểm tra đúng khoảng đó và nhận nguyên một trang stack trace.
      const assetsPending = /\.yml/.test(message) && /404/.test(message)
      return assetsPending ? { status: 'error', message, code: 'assetsPending' } : { status: 'error', message }
    }
  })
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
