import { join } from 'node:path'
import { app, ipcMain, Menu, nativeImage, Notification, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import {
  IPC,
  trayMenuModel,
  trayStrings,
  trayTooltip,
  type TrayPrefsDto,
  type TunnelRuleDto
} from '@infra/shared'
import { getTunnelService, onTunnelRulesChanged, startTunnelById } from './ipc/tunnels'
import { getVault } from './ipc/vault'

/**
 * F53 — icon khay hệ thống + "đóng cửa sổ là thu vào khay".
 *
 * Vì sao cần: tunnel, uptime watcher, monitoring đều sống ở MAIN process, nhưng trước đây bấm ✕
 * là app thoát và kéo theo tất cả — người dùng cả chục tunnel DB mỗi ngày phải để cửa sổ mở suốt.
 * Nay ✕ chỉ **ẩn** cửa sổ (renderer vẫn chạy, xterm vẫn giữ scrollback, không unmount gì);
 * icon khay giữ đường quay lại và một menu bật/tắt tunnel không cần mở app. Thoát hẳn nằm ở
 * menu khay (và vẫn đi qua `before-quit` để dọn dẹp như cũ).
 *
 * Phần "menu hiện gì" là hàm thuần ở `@infra/shared` (`trayMenuModel`) — có test; file này chỉ
 * nối nó vào Electron.
 */

interface TrayDeps {
  getWindow: () => BrowserWindow | null
  showWindow: () => void
  quit: () => void
}

let tray: Tray | null = null
let deps: TrayDeps | null = null
let prefs: TrayPrefsDto = { closeToTray: true, language: 'vi' }
let hiddenNoticeShown = false

const isDev = !app.isPackaged

/** Icon khay: Windows dùng .ico đa cỡ (hệ chọn 16px); mac/linux dùng PNG thu về cỡ khay. */
function trayImage(): Electron.NativeImage {
  if (process.platform === 'win32') {
    return nativeImage.createFromPath(isDev ? join(__dirname, '../../build/icon.ico') : join(process.resourcesPath, 'icon.ico'))
  }
  const png = nativeImage.createFromPath(isDev ? join(__dirname, '../../build/icon.png') : join(process.resourcesPath, 'icon.png'))
  if (png.isEmpty()) return png
  // mac menu bar ~18px, khay Linux thường 22px; không đưa ảnh 512px thẳng vào — vài DE vẽ nguyên cỡ.
  return png.resize({ width: process.platform === 'darwin' ? 18 : 22 })
}

/** Vault khoá → null: menu không liệt kê rule (bật cần credential), chỉ hiện dòng ghi chú. */
function rulesOrNull(): TunnelRuleDto[] | null {
  try {
    const vault = getVault()
    return vault.state() === 'unlocked' ? vault.listTunnels() : null
  } catch {
    return null
  }
}

function toggleTunnel(ruleId: string, running: boolean): void {
  const service = getTunnelService()
  if (running) {
    service.stop(ruleId)
    return
  }
  const win = deps?.getWindow()
  if (!win || win.isDestroyed()) return
  // Lỗi thật đã đi vào state (TunnelService nuốt) và lên menu ở lần dựng sau; catch chỉ để
  // `prepareConnection` ném (host đã xoá) không thành unhandledRejection.
  void startTunnelById(win.webContents, ruleId).catch((err: unknown) => {
    console.error('[tray] start tunnel failed', err)
  })
}

function buildMenu(): Menu {
  const model = trayMenuModel(rulesOrNull(), getTunnelService().states(), prefs.language)
  const template: MenuItemConstructorOptions[] = model.map((item) => {
    switch (item.kind) {
      case 'open':
        return { label: item.label, click: () => deps?.showWindow() }
      case 'separator':
        return { type: 'separator' }
      case 'tunnels-header':
      case 'note':
        return { label: item.label, enabled: false }
      case 'tunnel':
        return {
          label: item.label,
          type: 'checkbox',
          checked: item.checked,
          click: () => toggleTunnel(item.ruleId, item.checked)
        }
      case 'quit':
        return { label: item.label, click: () => deps?.quit() }
    }
  })
  return Menu.buildFromTemplate(template)
}

/** Dựng lại tooltip + menu (Linux: gán menu tĩnh vì AppIndicator không phát sự kiện click). */
function refresh(): void {
  if (!tray || tray.isDestroyed()) return
  tray.setToolTip(trayTooltip(rulesOrNull(), getTunnelService().states(), prefs.language))
  if (process.platform === 'linux') tray.setContextMenu(buildMenu())
}

export function createTray(d: TrayDeps): void {
  deps = d
  const image = trayImage()
  if (image.isEmpty()) {
    // Thiếu icon (build lỗi) → không có khay; `shouldHideOnClose` trả false nên ✕ vẫn thoát như cũ,
    // không được để user "đóng cửa sổ mà không có đường quay lại".
    console.error('[tray] icon not found — tray disabled')
    return
  }
  tray = new Tray(image)
  // Windows/mac: dựng menu MỚI ngay lúc bấm để trạng thái tunnel luôn tươi (không setContextMenu,
  // nếu không Windows tự mở menu cũ song song với menu ta popup).
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu()))
  tray.on('click', () => {
    if (process.platform === 'darwin') tray?.popUpContextMenu(buildMenu())
    else deps?.showWindow()
  })
  tray.on('double-click', () => deps?.showWindow())

  getTunnelService().on('state', refresh)
  onTunnelRulesChanged(refresh)
  ipcMain.on(IPC.APP_TRAY_PREFS, (_event, next: TrayPrefsDto) => {
    prefs = {
      closeToTray: typeof next?.closeToTray === 'boolean' ? next.closeToTray : prefs.closeToTray,
      language: next?.language === 'en' || next?.language === 'ja' || next?.language === 'vi' ? next.language : prefs.language
    }
    refresh()
  })
  refresh()
}

/** ✕ cửa sổ chính có nên ẩn thay vì đóng không: cần user bật tuỳ chọn VÀ khay đang thật sự tồn tại. */
export function shouldHideOnClose(): boolean {
  return prefs.closeToTray && tray !== null && !tray.isDestroyed()
}

/** Lần ẩn ĐẦU trong mỗi phiên: một thông báo nói app còn chạy và thoát ở đâu — kẻo tưởng đã tắt. */
export function notifyHiddenOnce(): void {
  if (hiddenNoticeShown) return
  hiddenNoticeShown = true
  if (!Notification.isSupported()) return
  const s = trayStrings(prefs.language)
  const n = new Notification({ title: s.hiddenTitle, body: s.hiddenBody, silent: true })
  n.on('click', () => deps?.showWindow())
  n.show()
}
