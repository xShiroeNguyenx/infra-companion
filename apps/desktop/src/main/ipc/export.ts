import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { renderExport, resolveForExport } from '@infra/core'
import { IPC, type HostExportFormat, type HostExportResult } from '@infra/shared'
import { getVault, touchActivity } from './vault'

/** Đuôi file + nhãn bộ lọc cho từng định dạng. ssh_config theo lệ không có đuôi. */
const FORMATS: Record<HostExportFormat, { file: string; ext: string[]; label: string }> = {
  ssh_config: { file: 'ssh_config', ext: ['*'], label: 'ssh_config' },
  csv: { file: 'infra-companion-hosts.csv', ext: ['csv'], label: 'CSV' },
  json: { file: 'infra-companion-hosts.json', ext: ['json'], label: 'JSON' }
}

/**
 * P30 — xuất hosts ra định dạng đọc được.
 *
 * ⚠️ Bản xuất là file PHẲNG, ai đọc được file là đọc được hết — nên nó **cố ý chỉ chứa
 * topology kết nối**: không mật khẩu, không key material, không ghi chú, không biến môi
 * trường (xem `packages/core/src/exporters/hostExport.ts`). Muốn mang theo cả bí mật thì
 * dùng blob mã hoá của Sync.
 */
export function registerExportIpc(): void {
  ipcMain.handle(IPC.EXPORT_HOSTS, async (_e, format: HostExportFormat): Promise<HostExportResult> => {
    touchActivity()
    const spec = FORMATS[format]
    if (!spec) return { ok: false, exported: 0, skipped: 0, message: `Định dạng không hợp lệ: ${String(format)}` }
    // listHosts/listGroups không cần DEK, nhưng vault chưa mở thì DB có thể chưa sẵn sàng
    if (getVault().state() !== 'unlocked') {
      return { ok: false, exported: 0, skipped: 0, message: 'Vault đang khoá — mở khoá trước đã' }
    }

    try {
      const vault = getVault()
      const rows = resolveForExport(vault.listHosts(), vault.listGroups(), vault.listKeys())
      if (rows.length === 0) return { ok: false, exported: 0, skipped: 0, message: 'Chưa có host nào để xuất' }

      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = {
        title: `Xuất hosts ra ${spec.label}`,
        defaultPath: spec.file,
        filters: [{ name: spec.label, extensions: spec.ext }]
      }
      const pick = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (pick.canceled || !pick.filePath) return { ok: false, exported: 0, skipped: 0, message: 'Đã huỷ' }

      await writeFile(pick.filePath, renderExport(rows, format), 'utf8')

      // ssh_config không mô tả được telnet/serial/vnc/rdp — báo số bị bỏ thay vì để user
      // tự phát hiện thiếu host (file có ghi chú, nhưng thông báo thì đọc ngay)
      const skipped = format === 'ssh_config' ? rows.filter((r) => r.protocol !== 'ssh').length : 0
      return {
        ok: true,
        exported: rows.length - skipped,
        skipped,
        path: pick.filePath,
        message: `Đã xuất ${rows.length - skipped} host ra ${pick.filePath}`
      }
    } catch (error) {
      return {
        ok: false,
        exported: 0,
        skipped: 0,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
}
