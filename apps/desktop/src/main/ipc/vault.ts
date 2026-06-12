import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, safeStorage, BrowserWindow } from 'electron'
import { VaultService } from '@infra/core'
import { IPC, type VaultStatus } from '@infra/shared'

const AUTO_LOCK_MS = 15 * 60 * 1000

let vault: VaultService | null = null
let autoLockTimer: NodeJS.Timeout | null = null

export function getVault(): VaultService {
  vault ??= new VaultService(join(app.getPath('userData'), 'vault.db'))
  return vault
}

function dekFilePath(): string {
  return join(app.getPath('userData'), 'vault-dek.bin')
}

function isRemembered(): boolean {
  return existsSync(dekFilePath())
}

/** Lưu DEK qua OS keychain (DPAPI trên Windows) để mở vault không cần gõ master password. */
function rememberDek(): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const dek = getVault().currentDek()
  writeFileSync(dekFilePath(), safeStorage.encryptString(dek.toString('base64')))
}

function forgetDek(): void {
  rmSync(dekFilePath(), { force: true })
}

function tryAutoUnlock(): void {
  const service = getVault()
  if (service.state() !== 'locked' || !isRemembered()) return
  try {
    const encrypted = readFileSync(dekFilePath())
    const dekB64 = safeStorage.decryptString(encrypted)
    if (!service.unlockWithDek(Buffer.from(dekB64, 'base64'))) forgetDek()
  } catch {
    forgetDek() // file hỏng hoặc DPAPI đổi (đổi user Windows) → bỏ remember
  }
}

function status(): VaultStatus {
  return { state: getVault().state(), remembered: isRemembered() }
}

/** Reset đồng hồ auto-lock mỗi khi user thao tác. Không auto-lock khi đã bật remember. */
export function touchActivity(): void {
  if (autoLockTimer) clearTimeout(autoLockTimer)
  if (isRemembered()) return
  autoLockTimer = setTimeout(() => {
    const service = getVault()
    if (service.state() === 'unlocked') {
      service.lock()
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.VAULT_LOCKED_EVENT)
      }
    }
  }, AUTO_LOCK_MS)
}

export function registerVaultIpc(): void {
  ipcMain.handle(IPC.VAULT_STATUS, () => {
    tryAutoUnlock()
    touchActivity()
    return status()
  })

  ipcMain.handle(IPC.VAULT_SETUP, (_event, masterPassword: string, remember: boolean) => {
    getVault().setup(masterPassword)
    if (remember) rememberDek()
    touchActivity()
    return status()
  })

  ipcMain.handle(IPC.VAULT_UNLOCK, (_event, masterPassword: string, remember: boolean) => {
    if (!getVault().unlock(masterPassword)) {
      throw new Error('Sai master password')
    }
    if (remember) rememberDek()
    else forgetDek()
    touchActivity()
    return status()
  })

  ipcMain.handle(IPC.VAULT_LOCK, () => {
    getVault().lock()
    forgetDek() // khoá thủ công = muốn bảo vệ → bỏ luôn remember
    return status()
  })
}
