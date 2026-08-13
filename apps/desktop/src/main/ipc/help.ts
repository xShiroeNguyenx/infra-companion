import { app, ipcMain, shell } from 'electron'
import { IPC } from '@infra/shared'

/**
 * Trợ giúp → Gỡ rối. Hiện chỉ một việc: mở thư mục dữ liệu app để user lấy file gửi kèm khi
 * báo lỗi (vault, log phiên, bản ghi, cấu hình đều nằm trong đó).
 *
 * Path do main TỰ TÍNH — renderer không được truyền path vào `shell.openPath`, nếu không thì
 * bất kỳ chỗ nào trong renderer cũng mở được file tuỳ ý trên máy.
 */
export function registerHelpIpc(): void {
  ipcMain.on(IPC.HELP_OPEN_USER_DATA, () => void shell.openPath(app.getPath('userData')))
}
