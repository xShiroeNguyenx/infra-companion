import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog, ipcMain, safeStorage } from 'electron'
import { SyncService, createBackend, deriveSyncKey, newSyncSalt } from '@infra/core'
import { IPC, type SyncRunResult, type SyncStatusDto } from '@infra/shared'
import { getVault, touchActivity } from './vault'

let lastSyncAt: number | undefined
let lastMessage: string | undefined

function syncKeyPath(): string {
  return join(app.getPath('userData'), 'vault-sync-key.bin')
}

/** Sync key (32B) lưu mã hoá qua OS keychain để "Sync now" không cần nhập lại passphrase. */
function rememberSyncKey(key: Buffer): void {
  if (!safeStorage.isEncryptionAvailable()) return
  writeFileSync(syncKeyPath(), safeStorage.encryptString(key.toString('base64')))
}

function loadSyncKey(): Buffer | null {
  try {
    if (!existsSync(syncKeyPath())) return null
    return Buffer.from(safeStorage.decryptString(readFileSync(syncKeyPath())), 'base64')
  } catch {
    return null
  }
}

function status(): SyncStatusDto {
  const config = getVault().getSyncConfig()
  if (!config) return { configured: false }
  return { configured: true, backend: config.backend, folder: config.folderPath, lastSyncAt, lastMessage }
}

export function registerSyncIpc(): void {
  const service = new SyncService()

  ipcMain.handle(IPC.SYNC_STATUS, () => status())

  ipcMain.handle(IPC.SYNC_PICK_FOLDER, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn thư mục đồng bộ (Syncthing/Drive/Dropbox/OneDrive…)',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
  })

  ipcMain.handle(
    IPC.SYNC_CONFIGURE,
    async (_e, folderPath: string, passphrase: string): Promise<SyncRunResult> => {
      touchActivity()
      if (passphrase.length < 8) return { ok: false, pulled: 0, message: 'Sync passphrase cần ít nhất 8 ký tự' }
      const backend = createBackend('folder', folderPath)
      // Salt: dùng lại từ blob có sẵn (để khớp key giữa các máy), nếu chưa có thì tạo mới
      const existingSalt = await SyncService.readRemoteSalt(backend)
      const saltB64 = existingSalt ?? newSyncSalt()
      const syncKey = deriveSyncKey(passphrase, saltB64)

      // Nếu đã có blob remote → passphrase phải giải mã được
      const verdict = await service.verify(backend, syncKey)
      if (verdict === 'wrong-pass') {
        return { ok: false, pulled: 0, message: 'Sai sync passphrase — không khớp dữ liệu đã có trên thư mục này' }
      }

      getVault().setSyncConfig({ backend: 'folder', folderPath, saltB64 })
      rememberSyncKey(syncKey)

      // Sync ngay lần đầu
      const result = await service.sync(getVault(), backend, syncKey, saltB64)
      lastSyncAt = Date.now()
      lastMessage = result.ok ? `Đã đồng bộ (nhận ${result.pulled} thay đổi)` : result.error
      return { ok: result.ok, pulled: result.pulled, message: lastMessage ?? '' }
    }
  )

  ipcMain.handle(IPC.SYNC_NOW, async (): Promise<SyncRunResult> => {
    touchActivity()
    const config = getVault().getSyncConfig()
    if (!config) return { ok: false, pulled: 0, message: 'Chưa cấu hình sync' }
    const syncKey = loadSyncKey()
    if (!syncKey) return { ok: false, pulled: 0, message: 'Mất sync key — hãy cấu hình lại sync' }
    const backend = createBackend(config.backend, config.folderPath)
    const result = await service.sync(getVault(), backend, syncKey, config.saltB64)
    lastSyncAt = Date.now()
    lastMessage = result.ok ? `Đã đồng bộ (nhận ${result.pulled} thay đổi)` : result.error
    return { ok: result.ok, pulled: result.pulled, message: lastMessage ?? '' }
  })

  ipcMain.handle(IPC.SYNC_DISABLE, (): SyncStatusDto => {
    getVault().clearSyncConfig()
    rmSync(syncKeyPath(), { force: true })
    lastSyncAt = undefined
    lastMessage = undefined
    return status()
  })
}
