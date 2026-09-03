import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '@infra/shared'
import { registerUpdaterIpc } from './ipc/updater'
import { registerAiIpc } from './ipc/ai'
import { registerBulkIpc } from './ipc/bulk'
import { registerDataIpc } from './ipc/data'
import { registerImportIpc } from './ipc/import'
import { registerExportIpc } from './ipc/export'
import { flushSecretClipboard, registerRevealIpc } from './ipc/reveal'
import { registerCopyIdIpc } from './ipc/copyId'
import { registerKnownHostsIpc } from './ipc/knownHosts'
import { registerDiagIpc } from './ipc/diag'
import { disposeLogTails, registerLogTailIpc } from './ipc/logTail'
import { registerMonitorIpc } from './ipc/monitor'
import { registerWatcherIpc } from './ipc/watcher'
import { registerHostToolsIpc } from './ipc/hostTools'
import { registerReplicationIpc } from './ipc/replication'
import { registerNetToolsIpc } from './ipc/nettools'
import { flushSyncOnQuit, registerSyncIpc } from './ipc/sync'
import { registerPromptIpc } from './ipc/prompts'
import { registerSftpIpc } from './ipc/sftp'
import { registerVncIpc } from './ipc/vnc'
import { registerRdpIpc } from './ipc/rdp'
import { registerTerminalIpc } from './ipc/terminal'
import { registerTunnelsIpc } from './ipc/tunnels'
import { registerLocalDevIpc } from './ipc/localdev'
import { registerHostMapIpc } from './ipc/hostmap'
import { registerFontsIpc } from './ipc/fonts'
import { registerHelpIpc } from './ipc/help'
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

/**
 * Cửa sổ "tách rời" dùng chung cho monitor và tunnel: nhỏ, KHÔNG khung, always-on-top, sống độc
 * lập với cửa sổ chính (app chính bị che/thu nhỏ vẫn theo dõi được). Nó nạp CÙNG renderer với
 * hash route riêng (`#monitor`, `#tunnels`) nên dùng lại toàn bộ store + preload sẵn có.
 */
function createDetachedWindow(opts: {
  hash: string
  title: string
  width: number
  height: number
  minWidth: number
  minHeight: number
}): BrowserWindow {
  const iconPath = windowIconPath()
  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    minWidth: opts.minWidth,
    minHeight: opts.minHeight,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: opts.title,
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
  loadRenderer(win, opts.hash)
  return win
}

function openDetachedMonitor(hosts: Array<{ id: string; label: string }>): void {
  detachedMonitorHosts = hosts
  if (detachedMonitorWin && !detachedMonitorWin.isDestroyed()) {
    detachedMonitorWin.focus()
    return
  }
  const win = createDetachedWindow({
    hash: 'monitor',
    title: 'Monitor — Infra Companion',
    width: 320,
    height: 440,
    minWidth: 220,
    minHeight: 150
  })
  detachedMonitorWin = win
  notifyDetachedState(true)
  win.on('closed', () => {
    detachedMonitorWin = null
    notifyDetachedState(false)
  })
}

// ── Cửa sổ tunnel tách rời: bảng tunnel + bật/tắt tại chỗ, không cần quay lại app chính.
//    KHÔNG có luồng dữ liệu riêng: `TUNNELS_EVENT` vốn đã broadcast tới MỌI cửa sổ, và các
//    IPC list/start/stop dùng vault đã mở khoá ở main → cửa sổ này gọi y như cửa sổ chính.
let detachedTunnelsWin: BrowserWindow | null = null

function notifyTunnelsDetachedState(open: boolean): void {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(IPC.TUNNELS_DETACHED_STATE, open)
}

function openDetachedTunnels(): void {
  if (detachedTunnelsWin && !detachedTunnelsWin.isDestroyed()) {
    detachedTunnelsWin.focus()
    return
  }
  const win = createDetachedWindow({
    hash: 'tunnels',
    title: 'Tunnels — Infra Companion',
    width: 380,
    height: 460,
    minWidth: 280,
    minHeight: 160
  })
  detachedTunnelsWin = win
  notifyTunnelsDetachedState(true)
  win.on('closed', () => {
    detachedTunnelsWin = null
    notifyTunnelsDetachedState(false)
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

  ipcMain.handle(IPC.TUNNELS_OPEN_DETACHED, () => openDetachedTunnels())
  ipcMain.on(IPC.TUNNELS_CLOSE_DETACHED, () => detachedTunnelsWin?.close())
}

// AUMID custom: (1) bản đóng gói cần khớp appId đã cài để Windows toast (alert F04) hoạt động;
// (2) trong DEV, AUMID custom TÁCH taskbar button khỏi nhóm electron.exe → Windows dùng window
// icon (.ico đã setIcon) thay vì icon atom của electron.exe.
// QUAN TRỌNG: dev PHẢI dùng AUMID KHÁC bản đóng gói. Nếu dùng chung, lỡ pin bản dev vào
// Start Menu sẽ tạo shortcut "Electron" (trỏ node_modules/electron.exe) mang cùng AUMID với
// bản cài → Windows lẫn định danh: nút taskbar bản cài hiện tên/icon "Electron" và pin ra
// welcome screen. Tách AUMID dev để bản cài luôn giữ định danh sạch của riêng nó.
if (process.platform === 'win32') {
  app.setAppUserModelId(isDev ? 'com.nguyenkhanh.infracompanion.dev' : 'com.nguyenkhanh.infracompanion')
}

registerPromptIpc()
registerVaultIpc()
registerDataIpc()
registerImportIpc()
registerExportIpc()
registerRevealIpc()
registerCopyIdIpc()
registerKnownHostsIpc()
registerDiagIpc()
registerLogTailIpc()
registerBulkIpc()
registerAiIpc()
registerNetToolsIpc()
registerSyncIpc()
registerMarketplaceIpc()
const disposeMonitor = registerMonitorIpc()
const disposeWatcher = registerWatcherIpc()
registerHostToolsIpc()
const disposeReplication = registerReplicationIpc()
const terminal = registerTerminalIpc()
const disposeSftp = registerSftpIpc()
const disposeVnc = registerVncIpc()
const disposeRdp = registerRdpIpc()
const disposeTunnels = registerTunnelsIpc()
const localDev = registerLocalDevIpc()
registerHostMapIpc()
registerHelpIpc()
const disposeFonts = registerFontsIpc()
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

  // Local dev: dọn tiến trình (nginx/php-cgi) còn sót từ lần chạy trước — phải chạy SAU
  // whenReady vì cần userData, và TRƯỚC khi user kịp bấm start bất cứ gì.
  void localDev.initIfEnabled()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** Trần cứng cho phần dọn BẤT ĐỒNG BỘ khi quit: bấm X mà app treo lâu là lỗi nghiêm trọng
 *  hơn việc tắt service không đàng hoàng. */
const QUIT_GRACE_MS = 8_000
let quitting = false

app.on('before-quit', (event) => {
  // Lần gọi thứ 2 (do app.exit bên dưới) phải đi thẳng, nếu không sẽ lặp vô hạn.
  if (quitting) return
  quitting = true
  // Giữ app sống đủ lâu để dừng stack local dev (MariaDB shutdown đàng hoàng mất vài giây;
  // kill cứng = mất điện giữa transaction → InnoDB crash recovery lần sau).
  event.preventDefault()

  disposePlugins?.()
  terminal.dispose()
  disposeSftp()
  disposeVnc()
  disposeRdp()
  disposeTunnels()
  disposeMonitor()
  disposeReplication()
  disposeWatcher()
  disposeFonts()
  flushSecretClipboard()
  disposeLogTails()

  // Đẩy blob sync lần cuối TRƯỚC khi lock vault (`exportSnapshot` cần DEK), và nằm trong
  // cùng cửa sổ chờ QUIT_GRACE_MS: một thư mục mạng treo không được giữ app lại mãi.
  void Promise.race([
    Promise.all([localDev.dispose(), flushSyncOnQuit()]),
    new Promise((resolve) => setTimeout(resolve, QUIT_GRACE_MS))
  ]).finally(() => {
    getVault().lock() // lock cuối cùng, giữ đúng thứ tự cũ
    // Gọi app.quit() (KHÔNG phải app.exit): lần này cờ `quitting` cho đi thẳng nên chuỗi quit
    // chạy bình thường và các event 'will-quit'/'quit' VẪN được phát.
    // ⚠️ app.exit(0) sẽ bỏ qua chúng → electron-updater (autoInstallOnAppQuit = true, xem
    // ipc/updater.ts) sẽ KHÔNG cài bản update đã tải khi user thoát app.
    app.quit()
  })
})
