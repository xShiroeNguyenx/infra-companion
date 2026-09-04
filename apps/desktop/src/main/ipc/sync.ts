import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, safeStorage } from 'electron'
import {
  BLOB_NAME,
  LEGACY_SYNC_CHANNEL_ID,
  SyncService,
  createBackend,
  deriveSyncKey,
  newSyncSalt,
  type SyncBackend,
  type SyncChannel,
  type SyncConfig
} from '@infra/core'
import {
  IPC,
  type S3ConfigInput,
  type SyncChannelStatusDto,
  type SyncRunResult,
  type SyncStatusDto,
  type WebdavConfigInput
} from '@infra/shared'
import { DriveBackend, gdriveLogin, gdriveLogout, gdriveStatus } from '../lib/googleDrive'
import { S3Backend, WebdavBackend } from '../lib/syncBackends'
import { getVault, touchActivity } from './vault'

/** Các mốc auto-sync cho phép (phút). 0 = tắt. Chặn giá trị lạ từ renderer. */
const AUTO_CHOICES = [0, 5, 15, 30, 60]
const DEFAULT_AUTO_MINUTES = 15

/** Trạng thái hiển thị của TỪNG kênh (thời điểm + thông điệp lượt gần nhất). */
const channelState = new Map<string, { at?: number; message?: string }>()
let autoTimer: NodeJS.Timeout | null = null
/** Một chu kỳ auto không được chồng lên lần trước (thư mục mạng chậm có thể lâu hơn interval). */
let running = false

/**
 * Sync key (32B) MỖI KÊNH, lưu mã hoá qua OS keychain để "Sync now" không cần nhập lại
 * passphrase. Kênh 'legacy' (chuyển từ cấu hình một-kênh cũ) đọc lùi về file tên cũ.
 */
function syncKeyPath(channelId: string): string {
  return join(app.getPath('userData'), `vault-sync-key-${channelId}.bin`)
}

const LEGACY_KEY_PATH = (): string => join(app.getPath('userData'), 'vault-sync-key.bin')

function rememberSyncKey(channelId: string, key: Buffer): void {
  if (!safeStorage.isEncryptionAvailable()) return
  writeFileSync(syncKeyPath(channelId), safeStorage.encryptString(key.toString('base64')))
}

function loadSyncKey(channelId: string): Buffer | null {
  try {
    let path = syncKeyPath(channelId)
    if (!existsSync(path) && channelId === LEGACY_SYNC_CHANNEL_ID) path = LEGACY_KEY_PATH()
    if (!existsSync(path)) return null
    return Buffer.from(safeStorage.decryptString(readFileSync(path)), 'base64')
  } catch {
    return null
  }
}

function dropSyncKey(channelId: string): void {
  rmSync(syncKeyPath(channelId), { force: true })
  if (channelId === LEGACY_SYNC_CHANNEL_ID) rmSync(LEGACY_KEY_PATH(), { force: true })
}

function channelStatus(channel: SyncChannel): SyncChannelStatusDto {
  const state = channelState.get(channel.id)
  return {
    id: channel.id,
    backend: channel.backend,
    folder: channel.backend === 'folder' ? channel.folderPath : undefined,
    gdriveEmail: channel.backend === 'gdrive' ? getVault().getGdriveEmail() : undefined,
    detail:
      channel.backend === 'webdav'
        ? channel.webdavUrl
        : channel.backend === 's3'
          ? `${channel.s3Bucket}${channel.s3Prefix ? `/${channel.s3Prefix}` : ''} @ ${safeHost(channel.s3Endpoint)}`
          : undefined,
    lastSyncAt: state?.at,
    lastMessage: state?.message
  }
}

function safeHost(endpoint: string | undefined): string {
  try {
    return new URL(endpoint ?? '').host
  } catch {
    return endpoint ?? ''
  }
}

function status(): SyncStatusDto {
  const config = getVault().getSyncConfig()
  if (!config || config.channels.length === 0) return { configured: false, channels: [] }
  return {
    configured: true,
    channels: config.channels.map(channelStatus),
    autoMinutes: config.autoMinutes ?? DEFAULT_AUTO_MINUTES
  }
}

function broadcastPulled(pulled: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.SYNC_PULLED_EVENT, pulled)
  }
}

/** Nhãn ngắn của kênh cho thông điệp gộp khi chạy nhiều kênh một lượt. */
function channelLabel(channel: SyncChannel): string {
  if (channel.backend === 'gdrive') return 'Google Drive'
  if (channel.backend === 'webdav') return `WebDAV ${channel.webdavUrl ?? ''}`.trim()
  if (channel.backend === 's3') return `S3 ${channel.s3Bucket ?? ''}`.trim()
  return channel.folderPath || 'Thư mục'
}

/**
 * Backend theo kênh. DriveBackend dựng ở ĐÂY chứ không trong core `createBackend`:
 * nó cần net.fetch + shell của Electron, core phải chạy được bằng Node thuần.
 * `onFileId` ghi lại fileId của blob vào ĐÚNG kênh trong SyncConfig để lần sau update
 * đúng file cũ — Drive cho phép trùng tên nên cứ tạo mới là ra một rừng bản sao.
 */
function makeBackend(channel: SyncChannel): SyncBackend {
  if (channel.backend === 'gdrive') {
    return new DriveBackend({
      initialFileId: channel.gdriveFileId,
      email: getVault().getGdriveEmail(),
      onFileId: (id) => updateChannel(channel.id, (c) => (c.gdriveFileId === id ? c : { ...c, gdriveFileId: id }))
    })
  }
  if (channel.backend === 'webdav') {
    return new WebdavBackend({
      url: channel.webdavUrl ?? '',
      username: channel.webdavUsername ?? '',
      getPassword: () => getVault().getSyncChannelSecret(channel.id)
    })
  }
  if (channel.backend === 's3') {
    return new S3Backend({
      endpoint: channel.s3Endpoint ?? '',
      region: channel.s3Region ?? '',
      bucket: channel.s3Bucket ?? '',
      prefix: channel.s3Prefix ?? '',
      accessKeyId: channel.s3AccessKeyId ?? '',
      getSecret: () => getVault().getSyncChannelSecret(channel.id)
    })
  }
  return createBackend(channel.backend, channel.folderPath)
}

/** Sửa một kênh trong config theo id — no-op nếu kênh không còn (bị tắt giữa chừng). */
function updateChannel(channelId: string, fn: (c: SyncChannel) => SyncChannel): void {
  const config = getVault().getSyncConfig()
  if (!config) return
  const idx = config.channels.findIndex((c) => c.id === channelId)
  if (idx < 0) return
  const next = fn(config.channels[idx]!)
  if (next === config.channels[idx]) return
  const channels = [...config.channels]
  channels[idx] = next
  getVault().setSyncConfig({ ...config, channels })
}

/** Chạy một lượt cho MỘT kênh, cập nhật trạng thái hiển thị của kênh đó. */
async function syncChannel(
  service: SyncService,
  channel: SyncChannel,
  opts: { force?: boolean } = {}
): Promise<SyncRunResult> {
  const vault = getVault()
  const syncKey = loadSyncKey(channel.id)
  if (!syncKey) {
    const message = 'Mất sync key — hãy cấu hình lại kênh này'
    channelState.set(channel.id, { at: Date.now(), message })
    return { ok: false, pulled: 0, message }
  }

  const backend = makeBackend(channel)
  const result = await service.sync(vault, backend, syncKey, channel.saltB64, {
    syncedBefore: channel.seenRemoteAt !== undefined,
    force: opts.force
  })

  // Ghi nhớ "đã từng thấy blob thật" — lần sau blob biến mất thì biết là bất thường, không
  // phải lần đầu. Nhờ đó thư mục Drive chưa tải xong sẽ bị chặn thay vì bị ghi đè.
  if (result.hadRemote && channel.seenRemoteAt === undefined) {
    updateChannel(channel.id, (c) => ({ ...c, seenRemoteAt: Date.now() }))
  }

  let message: string
  if (result.ok && !result.wrote) {
    message = 'Chưa có gì để đồng bộ (vault trống và phía kia cũng chưa có dữ liệu)'
  } else if (result.ok) {
    message = `Đã đồng bộ (nhận ${result.pulled} thay đổi)`
  } else {
    message = result.error ?? 'Lỗi không rõ'
  }
  channelState.set(channel.id, { at: Date.now(), message })
  return { ok: result.ok, pulled: result.pulled, message, needsConfirm: result.needsConfirm }
}

/**
 * Chạy một lượt sync: MỌI kênh (mặc định) hoặc đúng một kênh — tuần tự, kênh lỗi không làm
 * câm kênh còn lại. `auto` = do timer gọi: KHÔNG `touchActivity()` (sẽ vô hiệu auto-lock)
 * và tự báo renderer nạp lại khi có dữ liệu mới.
 */
async function runSync(
  service: SyncService,
  opts: { channelId?: string; force?: boolean; auto?: boolean } = {}
): Promise<SyncRunResult> {
  const config = getVault().getSyncConfig()
  if (!config || config.channels.length === 0) return { ok: false, pulled: 0, message: 'Chưa cấu hình sync' }
  const channels = opts.channelId ? config.channels.filter((c) => c.id === opts.channelId) : config.channels
  if (channels.length === 0) return { ok: false, pulled: 0, message: 'Kênh không còn tồn tại' }

  const results: Array<{ channel: SyncChannel; result: SyncRunResult }> = []
  for (const channel of channels) {
    results.push({ channel, result: await syncChannel(service, channel, { force: opts.force }) })
  }

  const pulled = results.reduce((n, r) => n + r.result.pulled, 0)
  const ok = results.every((r) => r.result.ok)
  const needsConfirm = results.some((r) => r.result.needsConfirm)
  const message =
    results.length === 1
      ? results[0]!.result.message
      : results.map((r) => `${channelLabel(r.channel)}: ${r.result.message}`).join('\n')

  if (opts.auto && pulled > 0) broadcastPulled(pulled)
  return { ok, pulled, message, needsConfirm }
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
  if (!config || config.channels.length === 0 || minutes <= 0) return

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
 * Đẩy blob lần cuối trước khi thoát app (mọi kênh).
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
    if (!config || config.channels.length === 0 || (config.autoMinutes ?? DEFAULT_AUTO_MINUTES) <= 0) return
    running = true
    await runSync(service, {})
  } catch {
    // Nuốt: thoát app quan trọng hơn lượt đẩy cuối
  } finally {
    running = false
  }
}

/**
 * Bật/cấu hình lại MỘT kênh: giữ tối đa một kênh mỗi loại backend (một thư mục + một Drive).
 * Kênh cùng loại đã có thì THAY THẾ nhưng GIỮ id — file sync key và trạng thái đi theo id.
 */
function upsertChannel(channel: Omit<SyncChannel, 'id'>): SyncChannel {
  const vault = getVault()
  const config = vault.getSyncConfig() ?? { channels: [] as SyncChannel[], autoMinutes: DEFAULT_AUTO_MINUTES }
  const existing = config.channels.find((c) => c.backend === channel.backend)
  const full: SyncChannel = { id: existing?.id ?? randomUUID(), ...channel }
  const channels = existing
    ? config.channels.map((c) => (c.id === full.id ? full : c))
    : [...config.channels, full]
  vault.setSyncConfig({ ...config, channels })
  return full
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

      const channel = upsertChannel({
        backend: 'folder',
        folderPath,
        saltB64,
        // Thư mục mới → lịch sử "đã từng thấy blob" của thư mục cũ không còn ý nghĩa
        seenRemoteAt: verdict === 'ok' ? Date.now() : undefined
      })
      rememberSyncKey(channel.id, syncKey)

      const result = await runSync(service, { channelId: channel.id, force })
      applyAutoTimer(service)
      return result
    }
  )

  ipcMain.handle(IPC.SYNC_NOW, async (_e, force = false, channelId?: string): Promise<SyncRunResult> => {
    touchActivity()
    return runSync(service, { force, channelId })
  })

  ipcMain.handle(IPC.SYNC_DISABLE, (_e, channelId?: string): SyncStatusDto => {
    const vault = getVault()
    const config = vault.getSyncConfig()
    if (config) {
      const doomed = channelId ? config.channels.filter((c) => c.id === channelId) : config.channels
      for (const channel of doomed) {
        dropSyncKey(channel.id)
        channelState.delete(channel.id)
        // Kênh WebDAV/S3 còn bí mật mã hoá trong vault — xoá kèm, đừng để bí mật mồ côi
        getVault().deleteSyncChannelSecret(channel.id)
      }
      const channels = channelId ? config.channels.filter((c) => c.id !== channelId) : []
      if (channels.length > 0) vault.setSyncConfig({ ...config, channels })
      else vault.clearSyncConfig()
    }
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
  // Google Drive — đăng nhập OAuth + bật kênh Drive (chạy SONG SONG với kênh thư mục).
  // Blob trên Drive vẫn E2EE bằng sync passphrase: login Google KHÔNG thay passphrase.
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC.SYNC_GDRIVE_STATUS, () => gdriveStatus())

  ipcMain.handle(IPC.SYNC_GDRIVE_LOGIN, async () => {
    touchActivity()
    return gdriveLogin()
  })

  ipcMain.handle(IPC.SYNC_GDRIVE_LOGOUT, async () => {
    touchActivity()
    return gdriveLogout()
  })

  ipcMain.handle(
    IPC.SYNC_CONFIGURE_GDRIVE,
    async (_e, passphrase: string, force = false): Promise<SyncRunResult> => {
      touchActivity()
      // Blob nằm trên cloud → passphrase là lớp bảo vệ DUY NHẤT, siết hơn mức 8 của thư mục
      // local (mức 8 đã bị ROADMAP đánh dấu là quá yếu cho cloud drive từ v0.2.8).
      if (passphrase.length < 12) {
        return { ok: false, pulled: 0, message: 'Blob sẽ nằm trên Google Drive — passphrase cần ít nhất 12 ký tự' }
      }
      if (getVault().state() !== 'unlocked') {
        return { ok: false, pulled: 0, message: 'Vault đang khoá — mở khoá trước đã' }
      }
      if (!gdriveStatus().connected) {
        return { ok: false, pulled: 0, message: 'Chưa đăng nhập Google — bấm "Đăng nhập Google" trước' }
      }

      // fileId phát hiện trong lúc verify được giữ lại để ghi vào kênh ngay từ đầu
      let discoveredFileId: string | undefined
      const backend = new DriveBackend({
        email: getVault().getGdriveEmail(),
        onFileId: (id) => {
          discoveredFileId = id
        }
      })
      const existingSalt = await SyncService.readRemoteSalt(backend)
      const saltB64 = existingSalt ?? newSyncSalt()
      const syncKey = deriveSyncKey(passphrase, saltB64)

      const verdict = await service.verify(backend, syncKey)
      if (verdict === 'wrong-pass') {
        return { ok: false, pulled: 0, message: 'Sai sync passphrase — không khớp blob đã có trên Drive' }
      }

      const channel = upsertChannel({
        backend: 'gdrive',
        folderPath: '',
        saltB64,
        gdriveFileId: discoveredFileId,
        seenRemoteAt: verdict === 'ok' ? Date.now() : undefined
      })
      rememberSyncKey(channel.id, syncKey)

      const result = await runSync(service, { channelId: channel.id, force })
      applyAutoTimer(service)
      return result
    }
  )

  // -------------------------------------------------------------------------
  // WebDAV + S3 — hai kênh remote thêm từ v0.2.16. Cùng khuôn với gdrive: passphrase ≥12
  // (blob nằm ngoài máy), verify credentials + passphrase TRƯỚC khi lưu kênh, bí mật
  // (mật khẩu/secret key) mã hoá DEK theo kênh, chỉ lưu sau khi kiểm chứng thành công.
  // -------------------------------------------------------------------------

  ipcMain.handle(
    IPC.SYNC_CONFIGURE_WEBDAV,
    async (_e, input: WebdavConfigInput, force = false): Promise<SyncRunResult> => {
      touchActivity()
      if (input.passphrase.length < 12) {
        return { ok: false, pulled: 0, message: 'Blob sẽ nằm trên server WebDAV — passphrase cần ít nhất 12 ký tự' }
      }
      if (getVault().state() !== 'unlocked') {
        return { ok: false, pulled: 0, message: 'Vault đang khoá — mở khoá trước đã' }
      }
      const url = input.url.trim().replace(/\/+$/, '')
      if (!/^https?:\/\//.test(url)) {
        return { ok: false, pulled: 0, message: 'URL WebDAV phải bắt đầu bằng http:// hoặc https://' }
      }

      const backend = new WebdavBackend({ url, username: input.username, getPassword: () => input.password })
      let existingSalt: string | null
      try {
        existingSalt = await SyncService.readRemoteSalt(backend)
      } catch (error) {
        // Sai URL/user/mật khẩu lộ ngay ở đây — chưa lưu gì cả, cứ báo thẳng
        return { ok: false, pulled: 0, message: error instanceof Error ? error.message : String(error) }
      }
      const saltB64 = existingSalt ?? newSyncSalt()
      const syncKey = deriveSyncKey(input.passphrase, saltB64)
      const verdict = await service.verify(backend, syncKey)
      if (verdict === 'wrong-pass') {
        return { ok: false, pulled: 0, message: 'Sai sync passphrase — không khớp blob đã có trên server này' }
      }

      const channel = upsertChannel({
        backend: 'webdav',
        folderPath: '',
        saltB64,
        webdavUrl: url,
        webdavUsername: input.username,
        seenRemoteAt: verdict === 'ok' ? Date.now() : undefined
      })
      getVault().setSyncChannelSecret(channel.id, input.password)
      rememberSyncKey(channel.id, syncKey)

      const result = await runSync(service, { channelId: channel.id, force })
      applyAutoTimer(service)
      return result
    }
  )

  ipcMain.handle(IPC.SYNC_CONFIGURE_S3, async (_e, input: S3ConfigInput, force = false): Promise<SyncRunResult> => {
    touchActivity()
    if (input.passphrase.length < 12) {
      return { ok: false, pulled: 0, message: 'Blob sẽ nằm trên S3 — passphrase cần ít nhất 12 ký tự' }
    }
    if (getVault().state() !== 'unlocked') {
      return { ok: false, pulled: 0, message: 'Vault đang khoá — mở khoá trước đã' }
    }
    const endpoint = input.endpoint.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//.test(endpoint)) {
      return { ok: false, pulled: 0, message: 'Endpoint S3 phải bắt đầu bằng http:// hoặc https://' }
    }
    if (!input.bucket.trim() || !input.region.trim() || !input.accessKeyId.trim() || !input.secretAccessKey) {
      return { ok: false, pulled: 0, message: 'Điền đủ region, bucket, access key và secret key' }
    }

    const backend = new S3Backend({
      endpoint,
      region: input.region.trim(),
      bucket: input.bucket.trim(),
      prefix: input.prefix.trim(),
      accessKeyId: input.accessKeyId.trim(),
      getSecret: () => input.secretAccessKey
    })
    let existingSalt: string | null
    try {
      existingSalt = await SyncService.readRemoteSalt(backend)
    } catch (error) {
      return { ok: false, pulled: 0, message: error instanceof Error ? error.message : String(error) }
    }
    const saltB64 = existingSalt ?? newSyncSalt()
    const syncKey = deriveSyncKey(input.passphrase, saltB64)
    const verdict = await service.verify(backend, syncKey)
    if (verdict === 'wrong-pass') {
      return { ok: false, pulled: 0, message: 'Sai sync passphrase — không khớp blob đã có trên bucket này' }
    }

    const channel = upsertChannel({
      backend: 's3',
      folderPath: '',
      saltB64,
      s3Endpoint: endpoint,
      s3Region: input.region.trim(),
      s3Bucket: input.bucket.trim(),
      s3Prefix: input.prefix.trim(),
      s3AccessKeyId: input.accessKeyId.trim(),
      seenRemoteAt: verdict === 'ok' ? Date.now() : undefined
    })
    getVault().setSyncChannelSecret(channel.id, input.secretAccessKey)
    rememberSyncKey(channel.id, syncKey)

    const result = await runSync(service, { channelId: channel.id, force })
    applyAutoTimer(service)
    return result
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

      // Dùng lại salt của kênh đầu tiên để file xuất ra và blob đang sync ăn CÙNG passphrase
      const saltB64 = getVault().getSyncConfig()?.channels[0]?.saltB64 ?? newSyncSalt()
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
