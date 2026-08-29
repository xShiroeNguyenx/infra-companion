import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, safeStorage } from 'electron'
import { BLOB_NAME, SyncService, createBackend, deriveSyncKey, newSyncSalt, type SyncConfig } from '@infra/core'
import { IPC, type SyncRunResult, type SyncStatusDto } from '@infra/shared'
import { getVault, touchActivity } from './vault'

/** Các mốc auto-sync cho phép (phút). 0 = tắt. Chặn giá trị lạ từ renderer. */
const AUTO_CHOICES = [0, 5, 15, 30, 60]
const DEFAULT_AUTO_MINUTES = 15

let lastSyncAt: number | undefined
let lastMessage: string | undefined
let autoTimer: NodeJS.Timeout | null = null
/** Một chu kỳ auto không được chồng lên lần trước (thư mục mạng chậm có thể lâu hơn interval). */
let running = false

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
  return {
    configured: true,
    backend: config.backend,
    folder: config.folderPath,
    autoMinutes: config.autoMinutes ?? DEFAULT_AUTO_MINUTES,
    lastSyncAt,
    lastMessage
  }
}

function broadcastPulled(pulled: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.SYNC_PULLED_EVENT, pulled)
  }
}

/**
 * Chạy một lượt sync và cập nhật trạng thái hiển thị.
 * `auto` = do timer gọi: KHÔNG `touchActivity()` (sẽ vô hiệu auto-lock) và tự báo renderer nạp lại.
 */
async function runSync(service: SyncService, opts: { force?: boolean; auto?: boolean } = {}): Promise<SyncRunResult> {
  const vault = getVault()
  const config = vault.getSyncConfig()
  if (!config) return { ok: false, pulled: 0, message: 'Chưa cấu hình sync' }
  const syncKey = loadSyncKey()
  if (!syncKey) return { ok: false, pulled: 0, message: 'Mất sync key — hãy cấu hình lại sync' }

  const backend = createBackend(config.backend, config.folderPath)
  const result = await service.sync(vault, backend, syncKey, config.saltB64, {
    syncedBefore: config.seenRemoteAt !== undefined,
    force: opts.force
  })

  // Ghi nhớ "đã từng thấy blob thật" — lần sau blob biến mất thì biết là bất thường, không
  // phải lần đầu. Nhờ đó thư mục Drive chưa tải xong sẽ bị chặn thay vì bị ghi đè.
  if (result.hadRemote && config.seenRemoteAt === undefined) {
    vault.setSyncConfig({ ...config, seenRemoteAt: Date.now() })
  }

  lastSyncAt = Date.now()
  if (result.ok && !result.wrote) {
    lastMessage = 'Chưa có gì để đồng bộ (vault trống và thư mục cũng chưa có dữ liệu)'
  } else if (result.ok) {
    lastMessage = `Đã đồng bộ (nhận ${result.pulled} thay đổi)`
  } else {
    lastMessage = result.error
  }

  if (opts.auto && result.pulled > 0) broadcastPulled(result.pulled)
  return { ok: result.ok, pulled: result.pulled, message: lastMessage ?? '', needsConfirm: result.needsConfirm }
}

/**
 * Đặt lại timer theo cấu hình hiện tại. Gọi mỗi khi cấu hình đổi và lúc khởi động.
 *
 * ⚠️ Lúc khởi động hàm này chạy TRƯỚC khi user đụng vào vault, nên không được để nó có tác
 * dụng phụ: `getSyncConfig()` mở DB (tạo file + chạy migration) — gọi thẳng trên máy mới sẽ
 * sinh ra `vault.db` trước cả màn hình đặt master password, và nếu mở DB lỗi thì ném ngay
 * trong `registerSyncIpc()` làm app không boot được. `state()` trả sớm khi chưa có file nên
 * kiểm nó trước là đủ; try/catch là lớp chặn cuối.
 */
function applyAutoTimer(service: SyncService): void {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
  let config: SyncConfig | null = null
  try {
    if (getVault().state() === 'uninitialized') return
    config = getVault().getSyncConfig()
  } catch {
    return // vault hỏng/không mở được: cứ để user tự bấm, đừng làm chết đường khởi động
  }
  const minutes = config ? (config.autoMinutes ?? DEFAULT_AUTO_MINUTES) : 0
  if (!config || minutes <= 0) return

  autoTimer = setInterval(() => {
    void (async () => {
      if (running) return
      // Vault khoá thì exportSnapshot sẽ ném — bỏ lượt này, mở khoá xong lượt sau tự chạy.
      if (getVault().state() !== 'unlocked') return
      running = true
      try {
        await runSync(service, { auto: true })
      } catch {
        // Lỗi bất ngờ trong lượt tự động không được làm sập main process
      } finally {
        running = false
      }
    })()
  }, minutes * 60_000)
  autoTimer.unref()
}

/** Một instance dùng chung cho cả IPC lẫn lượt đẩy lúc thoát (SyncService không giữ state). */
const service = new SyncService()

/**
 * Đẩy blob lần cuối trước khi thoát app.
 *
 * Vì sao cần: auto-sync chạy theo chu kỳ, nên thay đổi nằm giữa hai lượt vẫn còn ở máy này.
 * Đóng app rồi máy khác sửa cùng bản ghi và sync trước → lần sau mở lại, LWW thấy bản kia
 * mới hơn và **bỏ im lặng** bản của mình. Đẩy lúc thoát không xoá được LWW, nhưng thu hẹp
 * cửa sổ đó xuống còn đúng phiên đang mở.
 *
 * Tôn trọng cài đặt: auto-sync để "Tắt" thì user muốn tự bấm, đừng đẩy sau lưng họ.
 * Không bao giờ ném ra ngoài — đường thoát app không được phụ thuộc vào một thư mục mạng.
 */
export async function flushSyncOnQuit(): Promise<void> {
  try {
    if (running) return // một lượt auto đang chạy dở đã đẩy rồi
    if (getVault().state() !== 'unlocked') return
    const config = getVault().getSyncConfig()
    if (!config || (config.autoMinutes ?? DEFAULT_AUTO_MINUTES) <= 0) return
    running = true
    await runSync(service, {})
  } catch {
    // Nuốt: thoát app quan trọng hơn lượt đẩy cuối
  } finally {
    running = false
  }
}

export function registerSyncIpc(): void {

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
    async (_e, folderPath: string, passphrase: string, force = false): Promise<SyncRunResult> => {
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

      const previous = getVault().getSyncConfig()
      const config: SyncConfig = {
        backend: 'folder',
        folderPath,
        saltB64,
        autoMinutes: previous?.autoMinutes ?? DEFAULT_AUTO_MINUTES,
        // Thư mục mới → lịch sử "đã từng thấy blob" của thư mục cũ không còn ý nghĩa
        seenRemoteAt: verdict === 'ok' ? Date.now() : undefined
      }
      getVault().setSyncConfig(config)
      rememberSyncKey(syncKey)

      const result = await runSync(service, { force })
      applyAutoTimer(service)
      return result
    }
  )

  ipcMain.handle(IPC.SYNC_NOW, async (_e, force = false): Promise<SyncRunResult> => {
    touchActivity()
    return runSync(service, { force })
  })

  ipcMain.handle(IPC.SYNC_DISABLE, (): SyncStatusDto => {
    getVault().clearSyncConfig()
    rmSync(syncKeyPath(), { force: true })
    lastSyncAt = undefined
    lastMessage = undefined
    applyAutoTimer(service)
    return status()
  })

  ipcMain.handle(IPC.SYNC_SET_AUTO, (_e, minutes: number): SyncStatusDto => {
    touchActivity()
    const config = getVault().getSyncConfig()
    if (config) {
      const safe = AUTO_CHOICES.includes(minutes) ? minutes : DEFAULT_AUTO_MINUTES
      getVault().setSyncConfig({ ...config, autoMinutes: safe })
      applyAutoTimer(service)
    }
    return status()
  })

  // -------------------------------------------------------------------------
  // Xuất / nhập blob dạng FILE — không cần bật sync, không cần Drive for Desktop.
  // Kịch bản: quên đem máy → tải blob từ web về máy khác → nhập thẳng file đó.
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.SYNC_EXPORT_FILE, async (_e, passphrase: string): Promise<SyncRunResult> => {
    touchActivity()
    if (passphrase.length < 8) return { ok: false, pulled: 0, message: 'Sync passphrase cần ít nhất 8 ký tự' }
    if (getVault().state() !== 'unlocked') return { ok: false, pulled: 0, message: 'Vault đang khoá — mở khoá trước đã' }
    try {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = {
        title: 'Xuất vault đã mã hoá ra file',
        defaultPath: BLOB_NAME,
        filters: [{ name: 'Infra Companion vault', extensions: ['blob'] }]
      }
      const pick = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (pick.canceled || !pick.filePath) return { ok: false, pulled: 0, message: 'Đã huỷ' }

      // Dùng lại salt đang cấu hình để file xuất ra và blob trong thư mục ăn CÙNG passphrase
      const saltB64 = getVault().getSyncConfig()?.saltB64 ?? newSyncSalt()
      const blob = service.buildBlob(getVault(), deriveSyncKey(passphrase, saltB64), saltB64)
      await writeFile(pick.filePath, blob, 'utf8')
      return {
        ok: true,
        pulled: 0,
        message: `Đã xuất ra ${pick.filePath} — file đã mã hoá, nhưng ai có passphrase là đọc được toàn bộ key và mật khẩu.`
      }
    } catch (error) {
      return { ok: false, pulled: 0, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.SYNC_IMPORT_FILE, async (_e, passphrase: string): Promise<SyncRunResult> => {
    touchActivity()
    if (passphrase.length < 8) return { ok: false, pulled: 0, message: 'Sync passphrase cần ít nhất 8 ký tự' }
    if (getVault().state() !== 'unlocked') return { ok: false, pulled: 0, message: 'Vault đang khoá — mở khoá trước đã' }
    try {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = {
        title: 'Chọn file vault đã mã hoá',
        properties: ['openFile' as const],
        filters: [
          { name: 'Infra Companion vault', extensions: ['blob'] },
          { name: 'Tất cả', extensions: ['*'] }
        ]
      }
      const pick = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      if (pick.canceled || pick.filePaths.length === 0) return { ok: false, pulled: 0, message: 'Đã huỷ' }

      const blob = await readFile(pick.filePaths[0]!, 'utf8')
      const saltB64 = SyncService.saltOf(blob)
      if (!saltB64) {
        return { ok: false, pulled: 0, message: 'File không phải blob của Infra Companion (sai định dạng)' }
      }
      const applied = service.applyBlob(getVault(), blob, deriveSyncKey(passphrase, saltB64))
      if (applied === 'wrong-pass') {
        return { ok: false, pulled: 0, message: 'Sai sync passphrase — không giải mã được file' }
      }
      if (applied === 'corrupt') return { ok: false, pulled: 0, message: 'File hỏng định dạng' }
      return { ok: true, pulled: applied, message: `Đã nhập ${applied} thay đổi từ file` }
    } catch (error) {
      return { ok: false, pulled: 0, message: error instanceof Error ? error.message : String(error) }
    }
  })

  applyAutoTimer(service)
}
