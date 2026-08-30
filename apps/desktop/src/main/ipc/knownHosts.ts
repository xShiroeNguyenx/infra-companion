import { ipcMain } from 'electron'
import { IPC, type KnownHostDto } from '@infra/shared'
import { getVault, touchActivity } from './vault'

/**
 * F44 — xem / quên fingerprint đã TOFU.
 *
 * Không phải để gỡ bế tắc (prompt mismatch vẫn có nút "vẫn tin"), mà để RÀ SOÁT: trước đây
 * không có đường nào nhìn lại mình đã tin những gì, cũng không xoá được một mục sau khi dựng
 * lại server — mỗi lần nối lại phải bấm qua cảnh báo đỏ, và cảnh báo bị bấm quen thì hết tác dụng.
 */
export function registerKnownHostsIpc(): void {
  ipcMain.handle(IPC.KNOWN_HOSTS_LIST, (): KnownHostDto[] => {
    touchActivity()
    return getVault().listKnownHosts()
  })

  ipcMain.handle(IPC.KNOWN_HOSTS_DELETE, (_e, id: string): KnownHostDto[] => {
    touchActivity()
    getVault().deleteKnownHost(id)
    return getVault().listKnownHosts()
  })
}
