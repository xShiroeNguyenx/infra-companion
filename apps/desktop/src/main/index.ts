import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '@infra/shared'
import { registerUpdaterIpc } from './ipc/updater'
import { registerAiIpc } from './ipc/ai'
import { registerBulkIpc } from './ipc/bulk'
import { registerDataIpc } from './ipc/data'
import { registerImportIpc } from './ipc/import'
import { registerMonitorIpc } from './ipc/monitor'
import { registerWatcherIpc } from './ipc/watcher'
import { registerHostToolsIpc } from './ipc/hostTools'
import { registerNetToolsIpc } from './ipc/nettools'
import { registerSyncIpc } from './ipc/sync'
import { registerPromptIpc } from './ipc/prompts'
import { registerSftpIpc } from './ipc/sftp'
import { registerVncIpc } from './ipc/vnc'
import { registerRdpIpc } from './ipc/rdp'
import { registerTerminalIpc } from './ipc/terminal'
import { registerTunnelsIpc } from './ipc/tunnels'
import { registerPluginsIpc } from './ipc/plugins'
import { registerMarketplaceIpc } from './ipc/marketplace'
import { getVault, registerVaultIpc } from './ipc/vault'

const isDev = !app.isPackaged

/** Đường dẫn icon cho WINDOW (nút taskbar + title bar). Dev: từ build/. Prod (win): từ
 *  extraResources (resources/icon.ico). Trả null khi để hệ điều hành tự lấy icon từ app bundle
 *  (mac/linux prod). Windows luôn set để nút taskbar của cửa sổ đang chạy KHÔNG dùng icon theo
 *  AUMID (dễ bị Windows cache sai từ các lần chạy trước). */
function windowIconPath(): string | null {
  if (process.platform === 'win32') {
    return isDev ? join(__dirname, '../../build/icon.ico') : join(process.resourcesPath, 'icon.ico')
  }
  if (isDev) return join(__dirname, '../../build/icon.png')
  return null
}

// Lưới an toàn: lỗi nền từ thư viện (ssh2, net…) không được phép làm app văng dialog đỏ.
// Lỗi kết nối thật đã được bắt và hiển thị trong từng tab; đây chỉ để chống crash sót.
process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

// Single-instance: mở lần 2 chỉ focus cửa sổ đang chạy (tránh 2 process cùng mở vault.db)
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

function createWindow(): BrowserWindow {
  const iconPath = windowIconPath()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Infra Companion',
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Ép window icon tường minh (Windows, cả dev lẫn prod): nút taskbar của cửa sổ ĐANG CHẠY sẽ dùng
  // icon này; nếu không set, Windows lấy icon theo AUMID → dễ hiện icon cũ bị cache (vd atom của
  // electron.exe từ các lần dev). .ico đa độ phân giải; constructor option đôi khi bị taskbar bỏ qua.
  if (iconPath && process.platform === 'win32') {
    const img = nativeImage.createFromPath(iconPath)
    if (!img.isEmpty()) win.setIcon(img)
  }

  // Link bên ngoài luôn mở bằng browser mặc định, không mở cửa sổ Electron mới
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Chặn điều hướng cửa sổ chính ra URL ngoài (chỉ cho reload cùng URL của app)
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  loadRenderer(win)

  return win
}

/** Nạp renderer (dev: URL Vite, prod: file). hash → route trong renderer (vd 'monitor' cho cửa sổ tách rời). */
function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

// ── Cửa sổ monitor tách rời (F04): nhỏ, không khung, always-on-top; sống cả khi app chính thu nhỏ.
//    Nhận sample qua cùng luồng broadcast của MonitorService (main), không tự mở SSH riêng.
let mainWin: BrowserWindow | null = null
let detachedMonitorWin: BrowserWindow | null = null
let detachedMonitorHosts: Array<{ id: string; label: string }> = []

function notifyDetachedState(open: boolean): void {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(IPC.MONITOR_DETACHED_STATE, open)
}

function openDetachedMonitor(hosts: Array<{ id: string; label: string }>): void {
  detachedMonitorHosts = hosts
  if (detachedMonitorWin && !detachedMonitorWin.isDestroyed()) {
    detachedMonitorWin.focus()
    return
  }
  const iconPath = windowIconPath()
  const win = new BrowserWindow({
    width: 320,
    height: 440,
    minWidth: 220,
    minHeight: 150,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'Monitor — Infra Companion',
    backgroundColor: '#0b0e14',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'floating') // nổi trên cả cửa sổ toàn màn hình của app khác
  win.setMenuBarVisibility(false)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadRenderer(win, 'monitor')
  detachedMonitorWin = win
  notifyDetachedState(true)
  win.on('closed', () => {
    detachedMonitorWin = null
    notifyDetachedState(false)
  })
}

function registerDetachedMonitorIpc(): void {
  ipcMain.handle(IPC.MONITOR_OPEN_DETACHED, (_e, hosts: Array<{ id: string; label: string }>) =>
    openDetachedMonitor(hosts)
  )
  ipcMain.on(IPC.MONITOR_CLOSE_DETACHED, () => detachedMonitorWin?.close())
  ipcMain.handle(IPC.MONITOR_DETACHED_INIT, () => ({ hosts: detachedMonitorHosts }))
  // Dừng theo dõi (từ bất kỳ cửa sổ nào) → đóng luôn cửa sổ tách rời cho khỏi hiển thị dữ liệu chết
  ipcMain.on(IPC.MONITOR_STOP_ALL, () => detachedMonitorWin?.close())
}

// AUMID custom: (1) bản đóng gói cần khớp appId đã cài để Windows toast (alert F04) hoạt động;
// (2) trong DEV, AUMID custom TÁCH taskbar button khỏi nhóm electron.exe → Windows dùng window
// icon (.ico đã setIcon) thay vì icon atom của electron.exe. Nên đặt cho CẢ dev lẫn packaged.
if (process.platform === 'win32') app.setAppUserModelId('com.nguyenkhanh.infracompanion')

registerPromptIpc()
registerVaultIpc()
registerDataIpc()
registerImportIpc()
registerBulkIpc()
registerAiIpc()
registerNetToolsIpc()
registerSyncIpc()
registerMarketplaceIpc()
const disposeMonitor = registerMonitorIpc()
const disposeWatcher = registerWatcherIpc()
registerHostToolsIpc()
const terminal = registerTerminalIpc()
const disposeSftp = registerSftpIpc()
const disposeVnc = registerVncIpc()
const disposeRdp = registerRdpIpc()
const disposeTunnels = registerTunnelsIpc()
let disposePlugins: (() => void) | null = null

void app.whenReady().then(() => {
  const win = createWindow()
  mainWin = win
  registerUpdaterIpc(win)
  registerDetachedMonitorIpc()
  // Đóng app chính → đóng luôn cửa sổ monitor tách rời (thu nhỏ thì KHÔNG — đó là mục đích của tính năng)
  win.on('closed', () => {
    mainWin = null
    detachedMonitorWin?.close()
  })
  // Plugin host: cần cửa sổ để gửi event panel/notify; bridge để observe/gửi output terminal
  disposePlugins = registerPluginsIpc(() => mainWin ?? BrowserWindow.getAllWindows()[0] ?? null, terminal.bridge)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  disposePlugins?.()
  terminal.dispose()
  disposeSftp()
  disposeVnc()
  disposeRdp()
  disposeTunnels()
  disposeMonitor()
  disposeWatcher()
  getVault().lock()
})
