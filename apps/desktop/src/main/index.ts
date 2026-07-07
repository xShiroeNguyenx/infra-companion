import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerUpdaterIpc } from './ipc/updater'
import { registerAiIpc } from './ipc/ai'
import { registerBulkIpc } from './ipc/bulk'
import { registerDataIpc } from './ipc/data'
import { registerImportIpc } from './ipc/import'
import { registerMonitorIpc } from './ipc/monitor'
import { registerNetToolsIpc } from './ipc/nettools'
import { registerSyncIpc } from './ipc/sync'
import { registerPromptIpc } from './ipc/prompts'
import { registerSftpIpc } from './ipc/sftp'
import { registerTerminalIpc } from './ipc/terminal'
import { registerTunnelsIpc } from './ipc/tunnels'
import { registerPluginsIpc } from './ipc/plugins'
import { registerMarketplaceIpc } from './ipc/marketplace'
import { getVault, registerVaultIpc } from './ipc/vault'

const isDev = !app.isPackaged

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
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Infra Companion',
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

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

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

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
const terminal = registerTerminalIpc()
const disposeSftp = registerSftpIpc()
const disposeTunnels = registerTunnelsIpc()
let disposePlugins: (() => void) | null = null

void app.whenReady().then(() => {
  const win = createWindow()
  registerUpdaterIpc(win)
  // Plugin host: cần cửa sổ để gửi event panel/notify; bridge để observe/gửi output terminal
  disposePlugins = registerPluginsIpc(() => BrowserWindow.getAllWindows()[0] ?? null, terminal.bridge)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  disposePlugins?.()
  terminal.dispose()
  disposeSftp()
  disposeTunnels()
  disposeMonitor()
  getVault().lock()
})
