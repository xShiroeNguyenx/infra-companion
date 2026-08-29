import { clipboard, ipcMain } from 'electron'
import { IPC, type RevealRequest, type RevealResult } from '@infra/shared'
import { getVault, touchActivity } from './vault'

/** Sai bấy nhiêu lần liên tiếp thì nghỉ — chặn người ngồi vào máy đang mở và đoán mò. */
const MAX_FAILURES = 5
const COOLDOWN_MS = 60_000
/** Clipboard tự xoá sau chừng này (F45), miễn là nội dung chưa bị thứ khác ghi đè. */
const CLIPBOARD_CLEAR_MS = 30_000

let failures = 0
let blockedUntil = 0
let clipboardTimer: NodeJS.Timeout | null = null
/**
 * Giá trị vừa chép, để chỉ xoá clipboard khi nó VẪN là thứ mình ghi. Không phải lộ thêm:
 * trong 30 giây đó closure của timer vốn đã giữ chuỗi này trong bộ nhớ main rồi.
 */
let clipboardValue: string | null = null

/** Xoá clipboard nếu nó vẫn đang giữ đúng bí mật vừa chép. */
function clearIfStillOurs(): void {
  if (clipboardValue !== null && clipboard.readText() === clipboardValue) clipboard.clear()
  clipboardValue = null
  if (clipboardTimer) {
    clearTimeout(clipboardTimer)
    clipboardTimer = null
  }
}

/**
 * Xem lại bí mật đã lưu.
 *
 * Đây là NGOẠI LỆ CÓ CHỦ ĐÍCH của quy tắc "mật khẩu không qua IPC sang renderer". Quy tắc đó
 * tồn tại để một lỗi phía renderer (output remote, panel plugin, noVNC, câu trả lời AI) không
 * quét được credential của cả fleet — nên cái phải giữ là **không bao giờ có bí mật trong DTO
 * dạng danh sách**. Ở đây mỗi lần chỉ một bản ghi, do người dùng chủ động yêu cầu.
 *
 * ⚠️ **Luôn bắt nhập lại master password, kể cả khi vault đang mở.** Bật "ghi nhớ" thì
 * `touchActivity()` thoát sớm nên vault KHÔNG BAO GIỜ auto-lock, và `tryAutoUnlock()` lại tự
 * mở bằng DPAPI lúc khởi động — tức trên máy đã ghi nhớ, vault gần như luôn mở. Không có
 * bước xác thực lại thì tính năng này biến "mở khoá máy" thành "mở khoá cả hạ tầng".
 */
export function registerRevealIpc(): void {
  /**
   * Xác thực lại + lấy bí mật. Phân biệt bằng cờ `granted` chứ không phải sự có mặt của
   * `value`: `RevealResult.value` là optional nên `'value' in result` không thu hẹp được kiểu.
   */
  type Authorized = { granted: true; value: string } | { granted: false; result: RevealResult }
  const denied = (result: RevealResult): Authorized => ({ granted: false, result })

  const authorize = (request: RevealRequest): Authorized => {
    const now = Date.now()
    if (now < blockedUntil) {
      return denied({ ok: false, cooldownSec: Math.ceil((blockedUntil - now) / 1000), error: 'Sai quá nhiều lần' })
    }
    if (getVault().state() !== 'unlocked') return denied({ ok: false, error: 'Vault đang khoá — mở khoá trước đã' })
    if (!request.masterPassword) return denied({ ok: false, error: 'Nhập master password để xem' })

    // verifyMasterPassword KHÔNG đổi trạng thái vault: gõ sai ở đây không được khoá/mở gì cả
    if (!getVault().verifyMasterPassword(request.masterPassword)) {
      failures += 1
      if (failures >= MAX_FAILURES) {
        blockedUntil = Date.now() + COOLDOWN_MS
        failures = 0
        return denied({ ok: false, cooldownSec: Math.ceil(COOLDOWN_MS / 1000), error: 'Sai quá nhiều lần' })
      }
      return denied({ ok: false, error: `Sai master password (còn ${MAX_FAILURES - failures} lần)` })
    }
    failures = 0

    const value =
      request.kind === 'host-password'
        ? getVault().revealHostPassword(request.id)
        : getVault().revealKeyPassphrase(request.id)
    if (value === null) return denied({ ok: false, error: 'Bản ghi này chưa lưu bí mật nào' })
    return { granted: true, value }
  }

  ipcMain.handle(IPC.SECRET_REVEAL, (_e, request: RevealRequest): RevealResult => {
    touchActivity()
    const auth = authorize(request)
    return auth.granted ? { ok: true, value: auth.value } : auth.result
  })

  ipcMain.handle(IPC.SECRET_COPY, (_e, request: RevealRequest): RevealResult => {
    touchActivity()
    const auth = authorize(request)
    if (!auth.granted) return auth.result

    // Đường này CỐ Ý không trả `value`: main tự ghi clipboard nên bí mật không hề vào renderer
    if (clipboardTimer) clearTimeout(clipboardTimer)
    clipboard.writeText(auth.value)
    clipboardValue = auth.value
    // Chỉ xoá nếu clipboard VẪN là thứ mình vừa ghi — người dùng có thể đã copy thứ khác
    // trong lúc chờ, xoá mù sẽ nuốt mất dữ liệu không liên quan của họ.
    clipboardTimer = setTimeout(clearIfStillOurs, CLIPBOARD_CLEAR_MS)
    clipboardTimer.unref()

    return { ok: true }
  })
}

/**
 * Gọi lúc thoát app. Không có bước này thì thoát trong vòng 30 giây sau khi chép sẽ để
 * mật khẩu nằm lại clipboard vĩnh viễn — đúng thứ mà UI vừa hứa là sẽ tự xoá.
 */
export function flushSecretClipboard(): void {
  clearIfStillOurs()
}
