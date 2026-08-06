import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { TunnelService } from '@infra/core'
import { IPC, type TunnelRuleDto, type TunnelRuleInput } from '@infra/shared'
import { getVault, touchActivity } from './vault'
import { makeHostKeyVerifier, prepareConnection } from './connection'

/**
 * Một TunnelService duy nhất cho cả app, ở scope module (không nằm trong `registerTunnelsIpc`) để
 * tính năng khác dùng lại được mà không phụ thuộc THỨ TỰ đăng ký IPC trong `main/index.ts`.
 * Khởi tạo rẻ và không side-effect (EventEmitter + Map).
 */
const service = new TunnelService()

export function getTunnelService(): TunnelService {
  return service
}

/** Bật một tunnel rule (idempotent — đang chạy thì bỏ qua). */
async function startRule(sender: WebContents, rule: TunnelRuleDto): Promise<void> {
  const prepared = await prepareConnection(sender, rule.hostId)
  // Via host vào bằng login-script → truyền loginSteps để tunnel L đi qua exec (nc trên máy trong),
  // vì máy chỉ vào được bằng `ssh` trong shell (không nhận jump host -J).
  await service.start(rule, {
    chain: prepared.chain,
    verifyHostKey: makeHostKeyVerifier(sender),
    loginSteps: prepared.loginSteps
  })
}

/**
 * Đảm bảo tunnel đang chạy rồi trả về rule — dùng cho F55 (đọc MySQL qua tunnel đã lưu).
 *
 * `TunnelService.start` NUỐT lỗi vào state chứ không throw, nên phải kiểm lại `isRunning` sau đó
 * và lấy `detail` ra để báo cho user lý do thật (thiếu `nc`, sai mật khẩu su, port bị chiếm…).
 */
export async function ensureTunnelRunning(sender: WebContents, ruleId: string): Promise<TunnelRuleDto> {
  touchActivity()
  const rule = getVault().getTunnel(ruleId)
  if (!rule) {
    throw new Error('Tunnel đã bị xoá — mở phần khai báo cặp và chọn lại tunnel (hoặc chuyển về host SSH)')
  }
  if (rule.type !== 'L') {
    throw new Error(`Tunnel "${rule.label}" không phải loại L (local forward) nên không nối MySQL vào được`)
  }
  if (service.isRunning(ruleId)) return rule

  await startRule(sender, rule)
  if (!service.isRunning(ruleId)) {
    const detail = service.states().find((s) => s.ruleId === ruleId)?.detail
    throw new Error(`Không bật được tunnel "${rule.label}"${detail ? ` — ${detail}` : ''}`)
  }
  return rule
}

/** CRUD tunnel rules + start/stop runtime. Trả về hàm dispose. */
export function registerTunnelsIpc(): () => void {
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
    await startRule(event.sender, rule)
  })

  ipcMain.handle(IPC.TUNNELS_STOP, (_event, id: string) => {
    service.stop(id)
  })

  ipcMain.handle(IPC.TUNNELS_STATES, () => service.states())

  return () => service.stopAll()
}
