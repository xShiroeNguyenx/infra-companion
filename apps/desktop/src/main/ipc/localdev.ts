import { BrowserWindow, app, dialog, ipcMain, net, shell } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ADMINER_DOMAIN,
  DbService,
  LocalDevStore,
  MARIADB_SERVICE_ID,
  ManagedStackProvider,
  PMA_DOMAIN,
  ProcessSupervisor,
  RUNTIME_SOURCES,
  RuntimeManager,
  WEB_PORT_PURPOSE,
  applyWpDbConfig,
  buildHostResolverRules,
  checkPort,
  createPlatformAdapter,
  detectSiteKindDetailed,
  isSafeSiteDomain,
  localDevPaths,
  looksLikeWpConfig,
  readWpDbConfig,
  siteUrl,
  uniqueDomain,
  uniqueSlug,
  wpDbHost,
  type DownloadStream,
  type LocalDevPaths,
  type RuntimeProgress,
  type SiteRow
} from '@infra/core'
import {
  IPC,
  type LdDbCredsDto,
  type LdDbStatusDto,
  type LdHealthDto,
  type LdLogSourceDto,
  type LdLogTailDto,
  type LdResultDto,
  type LdRuntimeDto,
  type LdServiceActionDto,
  type LdServiceDto,
  type LdSettingsDto,
  type LdShellEnvDto,
  type LdSiteDetectDto,
  type LdSiteDto,
  type LdSiteInputDto,
  type LdWpConfigDto
} from '@infra/shared'
import { browserProfileDir, openMappedBrowser } from '../lib/chromiumLaunch'

/**
 * Local dev stack (Laragon/LocalWP-style) — wiring THẬT của M1.
 *
 * Settings nằm ở JSON trong userData chứ KHÔNG trong vault: vault tự khoá sau 15 phút idle
 * (`vault.ts` AUTO_LOCK_MS) còn supervisor phải đọc cấu hình liên tục để restart service đã
 * crash. Cùng lập luận với `monitorSettings.ts`.
 *
 * M1 chỉ có PHP + nginx (site trỏ vào folder có sẵn). MariaDB/WordPress thuộc M2.
 */

const SETTINGS_FILE = 'localdev-settings.json'
/** Đọc N byte CUỐI của log (khác hostTools.readFile lấy ĐẦU file). */
const LOG_TAIL_BYTES = 256 * 1024

function defaultSettings(): LdSettingsDto {
  return {
    enabled: false,
    root: join(app.getPath('userData'), 'localdev-root'),
    httpPortFrom: 8080,
    httpPortTo: 8099,
    // Mặc định TẮT: cổng 80 hay bị IIS/http.sys giữ sẵn, và bật mặc định sẽ khiến lần chạy đầu
    // của nhiều máy rơi vào nhánh "lùi cổng" kèm cảnh báo — gây hoang mang hơn là tiện.
    usePort80: false,
    phpPoolSize: 4,
    autoStart: false
  }
}

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function sanitize(raw: unknown): LdSettingsDto {
  const d = defaultSettings()
  const s = (raw ?? {}) as Partial<LdSettingsDto>
  const from = clampInt(s.httpPortFrom, d.httpPortFrom, 1024, 65_000)
  const to = clampInt(s.httpPortTo, d.httpPortTo, from, 65_535)
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
    root: typeof s.root === 'string' && s.root.trim() ? s.root.trim() : d.root,
    httpPortFrom: from,
    httpPortTo: to,
    usePort80: typeof s.usePort80 === 'boolean' ? s.usePort80 : d.usePort80,
    phpPoolSize: clampInt(s.phpPoolSize, d.phpPoolSize, 1, 16),
    autoStart: typeof s.autoStart === 'boolean' ? s.autoStart : d.autoStart
  }
}

function readSettings(): LdSettingsDto {
  try {
    return sanitize(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return defaultSettings()
  }
}

function writeSettings(s: LdSettingsDto): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch (e) {
    // Log của main process ra console Windows (code page 437/1252) — dùng ASCII, nếu không
    // chữ có dấu sẽ hiện thành ký tự rác. Text hiển thị cho user thì vẫn tiếng Việt (UI render tốt).
    console.error('[localdev] cannot write localdev-settings.json:', e)
  }
}

/** Chỉ tạo cây thư mục khi tính năng ĐƯỢC BẬT — không bật thì không rác gì trên đĩa. */
function ensureDirs(paths: LocalDevPaths): void {
  for (const dir of [
    paths.root,
    paths.runtimes,
    paths.localdev,
    paths.confNginxSites,
    paths.confNginxExtra,
    paths.confPhp,
    paths.logs,
    paths.certs,
    paths.run,
    paths.tmp,
    paths.cache,
    paths.bin,
    paths.sites
  ]) {
    try {
      mkdirSync(dir, { recursive: true })
    } catch (e) {
      console.error(`[localdev] cannot create dir ${dir}:`, e)
    }
  }
}

/** Stream tải bằng net.fetch của Electron (tôn trọng proxy hệ thống — quan trọng ở máy công ty). */
async function openStream(url: string, signal: AbortSignal): Promise<DownloadStream> {
  const res = await net.fetch(url, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${String(res.status)} khi tải ${url}`)
  const len = res.headers.get('content-length')
  const totalBytes = len !== null && /^\d+$/.test(len) ? Number(len) : null
  const body = res.body
  if (!body) throw new Error(`Không đọc được nội dung từ ${url}`)
  const reader = body.getReader()
  const stream = (async function* (): AsyncGenerator<Uint8Array> {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) yield value
    }
  })()
  return { stream, totalBytes }
}

/**
 * Tìm `wp-config.php` của site. WordPress cũng đọc được file này ở THƯ MỤC CHA của docroot
 * (cách đặt phổ biến để nó nằm ngoài web root), nên phải thử cả hai chỗ — nếu chỉ thử docroot
 * thì với những site đặt kiểu đó ta sẽ tưởng là "không phải WordPress".
 */
async function findWpConfig(site: SiteRow): Promise<string | null> {
  const candidates = [join(site.docRoot, 'wp-config.php'), join(site.rootPath, 'wp-config.php')]
  for (const f of candidates) {
    if (await stat(f).then((s) => s.isFile(), () => false)) return f
  }
  return null
}

/**
 * `webPort`: cổng nginx ĐANG dùng. Bắt buộc truyền vào chứ không lấy `s.httpPort`: cột đó được
 * ghi lúc THÊM site, nên sau khi user đổi dải cổng / bật cổng 80 thì URL trên card trỏ vào cổng
 * đã chết (bấm vào ra trang lỗi) — đúng loại bug làm user nghĩ site hỏng.
 */
function toSiteDto(s: SiteRow, webPort?: number | null): LdSiteDto {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    domain: s.domain,
    rootPath: s.rootPath,
    docRoot: s.docRoot,
    phpVersion: s.phpVersion,
    httpPort: webPort ?? s.httpPort,
    https: s.https,
    kind: s.kind,
    status: s.status,
    createdByApp: s.createdByApp,
    lastError: s.lastError,
    dbName: s.dbName,
    dbUser: s.dbUser,
    dbPass: s.dbPass,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  }
}

export function registerLocalDevIpc(): { dispose: () => Promise<void>; initIfEnabled: () => Promise<void> } {
  let settings = readSettings()
  let paths = localDevPaths(settings.root)
  const adapter = createPlatformAdapter()

  // Các thành phần nặng chỉ dựng khi cần (tính năng mặc định TẮT → không tốn gì)
  let store: LocalDevStore | null = null
  let supervisor: ProcessSupervisor | null = null
  let runtime: RuntimeManager | null = null
  let stack: ManagedStackProvider | null = null
  let db: DbService | null = null
  let reapedLastInit = 0
  /** Lỗi mới nhất khi sinh config/reload — thuộc tầng STACK, hiện ở health chứ không gắn vào site. */
  let lastApplyError: string | null = null
  /**
   * Cache kết quả `ensureReady()` của MariaDB.
   *
   * Renderer poll trạng thái mỗi 3s; mỗi lần `ensureReady` là một lần spawn `mariadb.exe` +
   * mở TCP tới 3307 ⇒ hàng chục socket TIME_WAIT và 20 process/phút cho một thông tin gần như
   * không đổi. Cache 15s, và reset ngay khi service dừng/khởi động lại.
   */
  let dbReadyCache: { at: number; running: boolean; ok: boolean } | null = null
  const DB_READY_TTL_MS = 15_000
  const cachedDbReady = async (dbs: DbService, running: boolean): Promise<{ ok: boolean }> => {
    const now = Date.now()
    if (dbReadyCache && dbReadyCache.running === running && now - dbReadyCache.at < DB_READY_TTL_MS) {
      return { ok: dbReadyCache.ok }
    }
    const res = await dbs.ensureReady()
    dbReadyCache = { at: now, running, ok: res.ok }
    return { ok: res.ok }
  }

  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  const ensureStack = (): {
    store: LocalDevStore
    supervisor: ProcessSupervisor
    runtime: RuntimeManager
    stack: ManagedStackProvider
    db: DbService
  } => {
    if (store && supervisor && runtime && stack && db) return { store, supervisor, runtime, stack, db }
    ensureDirs(paths)
    store = new LocalDevStore(paths.db)
    supervisor = new ProcessSupervisor({
      paths,
      adapter,
      checkPort: (port) => checkPort('127.0.0.1', port, 1500).then((r) => r.open)
    })
    supervisor.on('status', (s) => broadcast(IPC.LOCALDEV_SERVICE_EVENT, s satisfies LdServiceDto))
    runtime = new RuntimeManager({ paths, adapter, openStream })
    runtime.on('progress', (p: RuntimeProgress) => broadcast(IPC.LOCALDEV_RUNTIME_PROGRESS, p))
    const localStore = store
    stack = new ManagedStackProvider({
      paths,
      adapter,
      supervisor,
      installedRuntimes: () => runtime!.listInstalled(),
      sites: () => localStore.listSites(),
      ports: {
        takenPorts: () => localStore.takenPorts(),
        getPort: (p) => localStore.getPort(p),
        setPort: (p, port) => localStore.setPort(p, port)
      },
      settings: () => ({
        phpPoolSize: settings.phpPoolSize,
        httpPortFrom: settings.httpPortFrom,
        httpPortTo: settings.httpPortTo,
        usePort80: settings.usePort80,
        timezone: 'Asia/Ho_Chi_Minh'
      }),
      cleanTmp: () => runtime!.cleanTmp()
    })
    const localStack = stack
    db = new DbService({
      adapter,
      target: () => localStack.mariadbTarget(),
      running: () => localStack.mariadbRunning(),
      tmpDir: join(paths.tmp, 'db-cli'),
      trashDir: join(paths.trash, 'db')
    })
    supervisor.startHealthLoop()
    return { store, supervisor, runtime, stack, db }
  }

  /**
   * Sinh lại config + reload, RỒI đồng bộ lại `lastError` của các site.
   *
   * Vì sao cần bước dọn lastError: lỗi ở tầng STACK (vd chưa cài nginx lúc vừa thêm site) từng
   * bị ghi vào `site.lastError` và không bao giờ xoá ⇒ cài nginx xong rồi mà card site vẫn báo
   * "Chưa cài nginx" mãi. Lỗi stack thuộc về health/services, không thuộc về site.
   */
  const applyAndSync = async (): Promise<LdResultDto> => {
    const { stack: sk, store: st, runtime: rt } = ensureStack()
    // Có thay đổi (site/runtime/settings) ⇒ buộc sinh lại config, không dùng bản đã cache
    sk.markDirty()

    // Backfill phpVersion cho site được thêm TRƯỚC khi cài PHP (lúc đó không có runtime nào để
    // chọn nên bị chốt null). Config đã tự chọn PHP lúc sinh, nhưng vẫn cập nhật DB cho khớp
    // với thực tế — nếu không, UI hiện site "không có PHP" trong khi nó đang chạy PHP.
    try {
      const phpIds = (await rt.listInstalled()).filter((r) => !r.broken && r.id.startsWith('php-')).map((r) => r.id)
      if (phpIds.length > 0) {
        for (const s of st.listSites()) {
          if (s.kind !== 'static' && (s.phpVersion === null || !phpIds.includes(s.phpVersion))) {
            st.updateSite(s.id, { phpVersion: phpIds[0]! })
          }
        }
      }
    } catch {
      // Backfill là tiện nghi — không được làm apply thất bại
    }

    let res: LdResultDto
    try {
      res = await sk.applySites()
    } catch (e) {
      res = { ok: false, error: (e as Error).message }
    }
    if (res.ok) {
      for (const s of st.listSites()) {
        if (s.lastError !== null) st.updateSite(s.id, { lastError: null })
      }
    }
    lastApplyError = res.ok ? null : (res.error ?? null)
    return res
  }

  /** Đóng mọi thứ đang mở (đổi thư mục gốc / tắt tính năng). */
  const teardown = async (): Promise<void> => {
    if (supervisor) await supervisor.stopAll(6_000).catch(() => {})
    supervisor?.stopHealthLoop()
    // close() BẮT BUỘC: WAL còn mở thì trên Windows đổi/xoá thư mục gốc sẽ EPERM
    store?.close()
    store = null
    supervisor = null
    runtime = null
    stack = null
    db = null
  }

  const applySettings = async (next: LdSettingsDto): Promise<LdSettingsDto> => {
    const rootChanged = next.root !== settings.root
    const disabled = settings.enabled && !next.enabled
    if (rootChanged || disabled) await teardown()
    settings = next
    paths = localDevPaths(settings.root)
    writeSettings(settings)
    if (settings.enabled) ensureDirs(paths)
    return settings
  }

  if (settings.enabled) ensureDirs(paths)

  // ── Cài đặt / trạng thái ────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOCALDEV_ENABLED, (): boolean => settings.enabled)
  ipcMain.handle(IPC.LOCALDEV_SETTINGS_GET, (): LdSettingsDto => settings)
  ipcMain.handle(IPC.LOCALDEV_SETTINGS_SET, async (_e, raw: unknown): Promise<LdSettingsDto> =>
    applySettings(sanitize({ ...settings, ...((raw ?? {}) as Partial<LdSettingsDto>) }))
  )

  ipcMain.handle(IPC.LOCALDEV_HEALTH, async (): Promise<LdHealthDto> => {
    const warnings: string[] = []
    if (process.platform !== 'win32') {
      warnings.push('Bản hiện tại chỉ hỗ trợ Windows — các nền tảng khác sẽ được thêm sau.')
    }
    // nginx & MariaDB rất hay lỗi với path lạ; đổi gốc VỀ SAU phải migrate cả runtime lẫn site
    if (/[^\u0020-\u007e]/.test(paths.root)) {
      warnings.push('Đường dẫn gốc có ký tự không phải ASCII — nên đổi sang ví dụ C:\\infra-localdev')
    }
    if (paths.root.includes(' ')) {
      warnings.push('Đường dẫn gốc có dấu cách — nên đổi sang ví dụ C:\\infra-localdev')
    }
    if (!settings.enabled) {
      return { root: paths.root, runtimesInstalled: 0, servicesRunning: 0, sites: 0, reaped: 0, warnings }
    }
    const { runtime: rt, supervisor: sup, store: st } = ensureStack()
    const installed = await rt.listInstalled()
    const broken = installed.filter((r) => r.broken)
    if (broken.length > 0) {
      warnings.push(
        `${String(broken.length)} runtime cài dở hoặc bị sửa tay (${broken.map((b) => b.id).join(', ')}) — hãy cài lại.`
      )
    }
    // Thiếu runtime là lỗi tầng STACK — nói ở đây, không gắn vào từng site
    const usable = installed.filter((r) => !r.broken)
    const siteCount = st.listSites().length
    if (!usable.some((r) => r.id.startsWith('nginx-'))) {
      warnings.push('Chưa cài nginx — vào tab Runtime bấm Cài để site chạy được.')
    }
    if (!usable.some((r) => r.id.startsWith('php-')) && siteCount > 0) {
      warnings.push('Chưa cài PHP — site PHP/WordPress sẽ không chạy.')
    }
    // WordPress không có DB thì trang chỉ báo "Error establishing a database connection" —
    // nói thẳng ở đây để user không phải tự suy ra từ màn hình trắng.
    const wpSites = st.listSites().filter((s) => s.kind === 'wordpress')
    if (wpSites.length > 0 && !usable.some((r) => r.id.startsWith('mariadb-'))) {
      warnings.push('Chưa cài MariaDB — site WordPress sẽ báo lỗi kết nối database.')
    } else if (wpSites.some((s) => s.dbName === null)) {
      const names = wpSites.filter((s) => s.dbName === null).map((s) => s.name).join(', ')
      warnings.push(`Site chưa có database: ${names} — mở site rồi bấm "Cấp database".`)
    }
    if (lastApplyError !== null) warnings.push(`Lỗi cấu hình nginx: ${lastApplyError}`)
    // Bật "dùng cổng 80" mà 80 bị chiếm: phải nói ra, nếu không user thấy URL vẫn còn :8080 và
    // tưởng cài đặt không có tác dụng. Thủ phạm thường là IIS / World Wide Web Publishing Service.
    if (settings.usePort80) {
      const { port, port80Fallback } = await ensureStack().stack.webPortInfo()
      if (port80Fallback || (port !== null && port !== 80)) {
        warnings.push(
          `Cổng 80 đang bị tiến trình khác giữ (thường là IIS / "World Wide Web Publishing Service" hoặc http.sys) — ` +
            `app đang dùng cổng ${String(port ?? settings.httpPortFrom)}. Tắt dịch vụ đó rồi Chạy lại stack, ` +
            `hoặc dùng nút "Mở (bỏ cổng)" trên site.`
        )
      }
    }
    if (siteCount > 0 && sup.status().filter((s) => s.state === 'running').length === 0) {
      warnings.push('Stack đang dừng — vào tab Dịch vụ bấm ▶ để chạy nginx và PHP.')
    }
    return {
      root: paths.root,
      runtimesInstalled: usable.length,
      servicesRunning: sup.status().filter((s) => s.state === 'running').length,
      sites: siteCount,
      reaped: reapedLastInit,
      warnings
    }
  })

  ipcMain.handle(IPC.LOCALDEV_OPEN_FOLDER, (_e, what: string, siteId?: string): void => {
    // 'site': main tự tra path từ store — renderer KHÔNG được truyền đường dẫn tuỳ ý vào openPath
    if (what === 'site') {
      if (!settings.enabled || !siteId) return
      const site = ensureStack().store.getSite(siteId)
      if (site) void shell.openPath(site.rootPath)
      return
    }
    const map: Record<string, string> = {
      root: paths.root,
      runtimes: paths.runtimes,
      conf: paths.conf,
      logs: paths.logs,
      certs: paths.certs,
      sites: paths.sites
    }
    const dir = map[what] ?? paths.root
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      /* mở thư mục là best-effort */
    }
    void shell.openPath(dir)
  })

  // ── Runtime ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOCALDEV_RUNTIME_CATALOG, async (): Promise<LdRuntimeDto[]> => {
    if (!settings.enabled) return []
    const { runtime: rt } = ensureStack()
    const installed = new Map((await rt.listInstalled()).map((r) => [r.id, r]))
    // M1: catalog = danh sách nguồn chính thức cho nền tảng này. Không có sha256 ở đây nên
    // cài qua mạng cần manifest đã ký (M1g); "cài từ file có sẵn" thì dùng được ngay.
    const sources = RUNTIME_SOURCES.filter((s) => s.os === process.platform && s.arch === process.arch)
    const out: LdRuntimeDto[] = sources.map((s) => {
      const got = installed.get(s.id)
      // Không có sha256 ghim (nginx: nginx.org chỉ công bố PGP) → nói rõ cho user biết
      const unpinned = s.sha256 === undefined ? 'Upstream không công bố checksum — app tự tính và ghi lại.' : ''
      return {
        id: s.id,
        kind: s.kind,
        version: got?.provenance?.version ?? s.version,
        label: s.label,
        sizeBytes: s.sizeBytes ?? 0,
        installed: got !== undefined && !got.broken,
        state: got === undefined ? 'not-installed' : got.broken ? 'broken' : 'ok',
        ...(s.eol ? { eol: true } : {}),
        ...(s.note || unpinned ? { note: [s.note, unpinned].filter(Boolean).join(' ') } : {})
      }
    })
    // Runtime đã cài nhưng không nằm trong danh sách nguồn (user tự thêm) vẫn phải hiện
    for (const [id, got] of installed) {
      if (out.some((o) => o.id === id)) continue
      out.push({
        id,
        kind: id.startsWith('php-')
          ? 'php'
          : id.startsWith('nginx-')
            ? 'nginx'
            : id.startsWith('mariadb-')
              ? 'mariadb'
              : 'tool',
        version: got.provenance?.version ?? '?',
        label: id,
        sizeBytes: 0,
        installed: !got.broken,
        state: got.broken ? 'broken' : 'ok'
      })
    }
    return out
  })

  ipcMain.handle(
    IPC.LOCALDEV_RUNTIME_INSTALL,
    async (event, id: string, fromFile?: boolean): Promise<LdResultDto> => {
      if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
      const source = RUNTIME_SOURCES.find((s) => s.id === id)
      if (!source) return { ok: false, error: `Không biết runtime "${id}"` }

      // Mặc định tải qua mạng (sha256 ghim trong source app nên verify được ngay, không cần
      // manifest). `fromFile` là escape hatch khi AV/mạng công ty chặn tải.
      let localFile: string | undefined
      if (fromFile === true) {
        const win = BrowserWindow.fromWebContents(event.sender)
        // Đuôi file lấy từ `rawFileName` chứ không mặc định 'exe': tool raw có thể là .phar
        // (Composer, WP-CLI) hay .php (Adminer) — lọc sai thì file cần chọn bị ẩn khỏi hộp thoại.
        const rawExt = source.archive === 'raw' ? (/\.([a-z0-9]+)$/i.exec(source.rawFileName ?? '')?.[1] ?? 'exe') : null
        const pick = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0]!, {
          title: `Chọn file đã tải cho ${source.label}`,
          message: `Nguồn chính thức: ${source.url}`,
          properties: ['openFile'],
          filters: [{ name: 'Archive', extensions: rawExt !== null ? [rawExt] : ['zip'] }]
        })
        if (pick.canceled || pick.filePaths.length === 0) return { ok: false, error: 'Đã huỷ' }
        localFile = pick.filePaths[0]
      }

      try {
        const { runtime: rt } = ensureStack()
        await rt.installFromSource(source, localFile)
        // Cài xong runtime mới ⇒ regenerate config (có upstream/vhost đúng) + dọn lỗi cũ của site
        await applyAndSync()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  ipcMain.on(IPC.LOCALDEV_RUNTIME_CANCEL, (_e, id: string) => {
    runtime?.cancel(id)
  })

  ipcMain.handle(IPC.LOCALDEV_RUNTIME_REMOVE, async (_e, id: string): Promise<LdResultDto> => {
    if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
    try {
      const { runtime: rt, supervisor: sup } = ensureStack()
      // Không được xoá runtime khi service của nó còn chạy (file đang bị khoá + orphan)
      const running = sup.status().filter((s) => s.state === 'running' && (s.groupId === id || s.id === id))
      if (running.length > 0) {
        return { ok: false, error: `Hãy dừng ${running.map((r) => r.label).join(', ')} trước khi gỡ` }
      }
      for (const s of sup.status().filter((x) => x.groupId === id)) sup.unregister(s.id)
      await rt.remove(id)
      // Gỡ xong phải sinh lại config: vhost của công cụ vừa gỡ phải mất đi, và shim
      // bin/composer.cmd trỏ vào .phar không còn phải bị xoá (nếu không nó báo lỗi tối nghĩa).
      await applyAndSync()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ── Service ─────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOCALDEV_SERVICES, async (): Promise<LdServiceDto[]> => {
    if (!settings.enabled) return []
    const { stack: sk } = ensureStack()
    // ensurePrepared (KHÔNG applySites): renderer poll đường này mỗi 3s. Trước đây nó gọi
    // applySites ⇒ mỗi 3 giây ghi đè toàn bộ config + spawn `nginx -t` + `nginx -s reload`
    // (log nginx đầy "signal process started", và mỗi reload là 1 lần drop worker cũ).
    await sk.ensurePrepared()
    return sk.services()
  })

  ipcMain.handle(
    IPC.LOCALDEV_SERVICE_ACTION,
    async (_e, id: string, action: LdServiceActionDto): Promise<LdResultDto> => {
      if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
      try {
        const { stack: sk } = ensureStack()
        // Config phải mới TRƯỚC khi start, nếu không nginx load vhost cũ
        const applied = await applyAndSync()
        if (action === 'reload') return applied
        // Config lỗi thì start nginx cũng sẽ fail — báo ngay lý do thật thay vì để nó crash
        if (!applied.ok && id === 'nginx') return applied
        if (action === 'start') await sk.start(id)
        else if (action === 'stop') await sk.stop(id)
        else await sk.restart(id)
        // Bật/tắt/restart MariaDB làm kết quả ensureReady cũ vô nghĩa
        if (id.startsWith(MARIADB_SERVICE_ID)) dbReadyCache = null
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.LOCALDEV_STOP_ALL, async (): Promise<LdResultDto> => {
    try {
      if (supervisor) await supervisor.stopAll(6_000)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ── Site ────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOCALDEV_SITES, (): LdSiteDto[] => {
    if (!settings.enabled) return []
    const { store } = ensureStack()
    const webPort = store.getPort(WEB_PORT_PURPOSE)
    return store.listSites().map((s) => toSiteDto(s, webPort))
  })

  ipcMain.handle(IPC.LOCALDEV_SITE_SAVE, async (_e, input: LdSiteInputDto): Promise<LdSiteDto> => {
    if (!settings.enabled) throw new Error('Local dev đang tắt')
    const { store: st, runtime: rt } = ensureStack()
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('Tên site không được để trống')

    if (input.id) {
      const current = st.getSite(input.id)
      if (!current) throw new Error('Site không tồn tại')

      // ── Domain: user sửa được sang domain bất kỳ ──
      let domain: string | undefined
      const wanted = input.domain?.trim()
      if (wanted !== undefined && wanted.length > 0 && wanted !== current.domain) {
        if (!isSafeSiteDomain(wanted)) {
          throw new Error(`Domain không hợp lệ: ${wanted} (cần dạng ten-mien.tld, không dấu cách)`)
        }
        // Không cho trùng domain của site khác — nginx sẽ chọn vhost đầu tiên khớp, site kia
        // "biến mất" một cách không thể hiểu nổi.
        if (st.takenDomains().has(wanted) ) throw new Error(`Domain "${wanted}" đã dùng cho site khác`)
        // Cũng không được đụng 2 domain của công cụ DB (Adminer/phpMyAdmin) do stack tự sinh
        if (wanted === ADMINER_DOMAIN || wanted === PMA_DOMAIN) {
          throw new Error(`"${wanted}" là domain dành cho công cụ database của app — chọn tên khác`)
        }
        domain = wanted
      }

      // ── Loại site: 'auto' = dò lại từ đĩa, còn lại là user ép cứng khi app đoán sai ──
      let kind: SiteRow['kind'] | undefined
      let docRootFromKind: string | undefined
      if (input.kind !== undefined) {
        if (input.kind === 'auto') {
          const guess = detectSiteKindDetailed(await readdir(current.rootPath).catch(() => [] as string[]))
          kind = guess.kind
          docRootFromKind = guess.docRootSub ? join(current.rootPath, guess.docRootSub) : current.rootPath
        } else {
          kind = input.kind
        }
      }
      // phpVersion phải nhất quán với kind: site tĩnh không cần PHP, mà site php/wordpress
      // không có PHP thì nginx chỉ trả về mã nguồn dạng text.
      let phpVersion: string | null | undefined = input.phpVersion
      if (kind === 'static') phpVersion = null
      else if (kind !== undefined && current.phpVersion === null && phpVersion === undefined) {
        const installed = await rt.listInstalled()
        phpVersion = installed.find((r) => r.id.startsWith('php-') && !r.broken)?.id ?? null
      }

      const updated = st.updateSite(input.id, {
        name,
        ...(domain !== undefined ? { domain } : {}),
        ...(kind !== undefined ? { kind } : {}),
        ...(input.docRoot ? { docRoot: input.docRoot } : docRootFromKind ? { docRoot: docRootFromKind } : {}),
        ...(phpVersion !== undefined ? { phpVersion } : {})
      })
      if (!updated) throw new Error('Site không tồn tại')
      await applyAndSync()
      return toSiteDto(st.getSite(input.id) ?? updated, st.getPort(WEB_PORT_PURPOSE))
    }

    const rootPath = String(input.rootPath ?? '').trim()
    if (!rootPath) throw new Error('Chưa chọn thư mục site')
    const info = await stat(rootPath).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`Không phải thư mục: ${rootPath}`)
    // Chặn trỏ docroot vào chính thư mục stack (sẽ phơi config/runtime ra web)
    if (rootPath.toLowerCase().startsWith(paths.root.toLowerCase())) {
      throw new Error('Không thể dùng thư mục bên trong khu vực Local dev làm site')
    }

    const entries = await readdir(rootPath).catch(() => [] as string[])
    const guess = detectSiteKindDetailed(entries)
    // User ép loại ngay lúc thêm (hiếm) thì tôn trọng; docroot vẫn theo gợi ý của bản dò
    const detected = {
      kind: input.kind !== undefined && input.kind !== 'auto' ? input.kind : guess.kind,
      docRootSub: guess.docRootSub
    }
    const slug = uniqueSlug(name, st.takenSlugs())
    const wantedDomain = input.domain?.trim()
    if (wantedDomain !== undefined && wantedDomain.length > 0 && !isSafeSiteDomain(wantedDomain)) {
      throw new Error(`Domain không hợp lệ: ${wantedDomain} (cần dạng ten-mien.tld, không dấu cách)`)
    }
    const domain = wantedDomain || uniqueDomain(slug, st.takenDomains())
    const docRoot = input.docRoot?.trim() || (detected.docRootSub ? join(rootPath, detected.docRootSub) : rootPath)
    const installed = await rt.listInstalled()
    const php =
      input.phpVersion !== undefined
        ? input.phpVersion
        : (installed.find((r) => r.id.startsWith('php-') && !r.broken)?.id ?? null)

    const created = st.insertSite({
      name,
      slug,
      domain,
      rootPath,
      docRoot,
      phpVersion: detected.kind === 'static' ? null : php,
      httpPort: st.getPort(WEB_PORT_PURPOSE) ?? settings.httpPortFrom,
      https: false,
      kind: detected.kind,
      status: 'ready',
      // Site trỏ vào folder CÓ SẴN của user ⇒ app TUYỆT ĐỐI không xoá file
      createdByApp: false
    })
    // KHÔNG ghi lỗi tầng stack (vd "chưa cài nginx") vào site.lastError — nó không phải lỗi của
    // site này, và sẽ dính vĩnh viễn trên card. Lỗi stack hiện ở health/services.
    await applyAndSync()
    return toSiteDto(st.getSite(created.id) ?? created, st.getPort(WEB_PORT_PURPOSE))
  })

  ipcMain.handle(
    IPC.LOCALDEV_SITE_DELETE,
    async (_e, id: string, removeFiles: boolean): Promise<LdResultDto> => {
      if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
      try {
        const { store: st, db: dbs } = ensureStack()
        const site = st.getSite(id)
        if (!site) return { ok: false, error: 'Site không tồn tại' }
        if (removeFiles && !site.createdByApp) {
          // Hàng rào chống thảm hoạ: app chỉ được xoá thứ CHÍNH NÓ tạo ra
          return {
            ok: false,
            error: 'Thư mục này do bạn tạo, app không xoá. Hãy bỏ site khỏi danh sách rồi tự xoá nếu muốn.'
          }
        }
        // CHỈ xoá database khi user chọn xoá cả file. "Bỏ khỏi danh sách" phải giữ nguyên dữ
        // liệu: file trên đĩa vẫn còn `wp-config.php` trỏ vào DB đó, thêm site lại là chạy tiếp.
        // Dump vào trash/ trước khi drop (DbService tự làm).
        if (removeFiles && site.dbName) {
          const dropped = await dbs.dropSite(site)
          if (!dropped.ok) return { ok: false, error: dropped.error }
        }
        st.deleteSite(id)
        await applyAndSync()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  ipcMain.on(IPC.LOCALDEV_SITE_OPEN, (_e, id: string) => {
    if (!settings.enabled) return
    const site = ensureStack().store.getSite(id)
    if (!site) return
    const port = ensureStack().store.getPort(WEB_PORT_PURPOSE) ?? site.httpPort
    // siteUrl bỏ ':80' → URL sạch khi user đã bật cổng 80
    void shell.openExternal(siteUrl(site.domain, port, site.https))
  })

  /**
   * Mở site bằng browser Chromium có DNS override `MAP <domain> 127.0.0.1:<cổng>`.
   *
   * Giải quyết 2 việc cùng lúc mà KHÔNG cần cổng 80 và KHÔNG cần hosts entry:
   *  - URL không còn `:port` (browser tưởng là cổng 80, thực tế nối vào cổng nginx đang dùng);
   *  - domain custom (`.test`, `.local`, domain thật) chạy được dù resolver máy không biết nó.
   * Đánh đổi: chỉ có tác dụng trong cửa sổ browser do app mở (giống tính năng HostMap).
   */
  ipcMain.handle(IPC.LOCALDEV_SITE_OPEN_NOPORT, async (_e, id: string): Promise<LdResultDto> => {
    if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
    try {
      const { store: st } = ensureStack()
      const site = st.getSite(id)
      if (!site) return { ok: false, error: 'Site không tồn tại' }
      const port = st.getPort(WEB_PORT_PURPOSE) ?? site.httpPort
      const scheme = site.https ? 'https' : 'http'
      return await openMappedBrowser({
        rules: buildHostResolverRules([site.domain], `127.0.0.1:${String(port)}`),
        url: `${scheme}://${site.domain}/`,
        profileDir: browserProfileDir('site', site.id)
      })
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  /** Dò lại loại site từ nội dung thư mục + LÝ DO (form sửa site hiện ra để user đối chiếu). */
  ipcMain.handle(IPC.LOCALDEV_SITE_DETECT, async (_e, rootPath: string): Promise<LdSiteDetectDto> => {
    try {
      const dir = String(rootPath ?? '').trim()
      if (!dir) return { ok: false, error: 'Chưa có đường dẫn' }
      const info = await stat(dir).catch(() => null)
      if (!info?.isDirectory()) return { ok: false, error: `Không phải thư mục: ${dir}` }
      const guess = detectSiteKindDetailed(await readdir(dir))
      return { ok: true, kind: guess.kind, docRootSub: guess.docRootSub, reason: guess.reason }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.LOCALDEV_SITE_PICK_FOLDER, async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const res = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0]!, {
      properties: ['openDirectory']
    })
    return res.canceled || res.filePaths.length === 0 ? null : (res.filePaths[0] ?? null)
  })

  /** cwd + env để renderer mở tab terminal tại site (renderer KHÔNG tự dựng path runtime). */
  ipcMain.handle(IPC.LOCALDEV_SITE_SHELL_ENV, async (_e, id: string): Promise<LdShellEnvDto> => {
    if (!settings.enabled) return { ok: false, cwd: '', env: {}, title: '', error: 'Local dev đang tắt' }
    try {
      const { store: st, runtime: rt } = ensureStack()
      const site = st.getSite(id)
      if (!site) return { ok: false, cwd: '', env: {}, title: '', error: 'Site không tồn tại' }
      const installed = await rt.listInstalled()
      const phpDir = installed.find((r) => r.id === site.phpVersion && !r.broken)?.dir
      // Tool khai `addToPath` (Node → node/npm/npx, mkcert → mkcert) chạy trực tiếp từ thư mục
      // runtime nên nối thẳng vào PATH; Composer/WP-CLI là .phar nên đi qua shim trong bin/.
      const toolDirs = RUNTIME_SOURCES.filter((s) => s.addToPath === true).map(
        (s) => installed.find((r) => r.id === s.id && !r.broken)?.dir
      )
      const pathEntries = [phpDir, ...toolDirs, paths.bin].filter((x): x is string => typeof x === 'string')
      return {
        ok: true,
        cwd: site.rootPath,
        env: {
          // Nối vào PATH sẵn có để user vẫn dùng được git/node của họ
          PATH: [...pathEntries, process.env.PATH ?? ''].filter(Boolean).join(';'),
          INFRA_SITE: site.slug,
          ...(phpDir ? { INFRA_PHP: join(phpDir, 'php.exe') } : {})
        },
        title: site.slug
      }
    } catch (e) {
      return { ok: false, cwd: '', env: {}, title: '', error: (e as Error).message }
    }
  })

  // ── Database (MariaDB) ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOCALDEV_DB_STATUS, async (): Promise<LdDbStatusDto> => {
    const off: LdDbStatusDto = { installed: false, running: false, ready: false, port: null, host: '127.0.0.1' }
    if (!settings.enabled) return { ...off, error: 'Local dev đang tắt' }
    try {
      const { stack: sk, db: dbs } = ensureStack()
      const target = await sk.mariadbTarget()
      if (!target) return { ...off, error: 'Chưa cài runtime MariaDB' }
      const running = sk.mariadbRunning()
      return {
        installed: true,
        running,
        ready: running ? (await cachedDbReady(dbs, sk.mariadbRunning())).ok : false,
        port: target.port,
        host: '127.0.0.1',
        ...(running ? {} : { error: 'MariaDB chưa chạy' })
      }
    } catch (e) {
      return { ...off, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.LOCALDEV_DB_PROVISION, async (_e, siteId: string): Promise<LdDbCredsDto> => {
    if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
    try {
      const { store: st, stack: sk, db: dbs } = ensureStack()
      const site = st.getSite(siteId)
      if (!site) return { ok: false, error: 'Site không tồn tại' }
      // Tiện cho user: MariaDB đã cài mà chưa chạy thì tự bật (đây là hành động họ vừa yêu cầu)
      if (!sk.mariadbRunning() && (await sk.mariadbTarget()) !== null) {
        await sk.start(MARIADB_SERVICE_ID)
      }
      const res = await dbs.provisionSite(site)
      if (!res.ok) return { ok: false, error: res.error }
      st.updateSite(site.id, { dbName: res.creds.dbName, dbUser: res.creds.dbUser, dbPass: res.creds.dbPass })
      broadcast(IPC.LOCALDEV_SITE_EVENT, {
        siteId: site.id,
        phase: 'done',
        percent: 100,
        message: `Đã cấp database ${res.creds.dbName}`
      })
      return { ok: true, ...res.creds }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.LOCALDEV_DB_DUMP, async (event, siteId: string): Promise<LdResultDto> => {
    if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
    try {
      const { store: st, db: dbs } = ensureStack()
      const site = st.getSite(siteId)
      if (!site) return { ok: false, error: 'Site không tồn tại' }
      if (!site.dbName) return { ok: false, error: 'Site này chưa có database' }
      const win = BrowserWindow.fromWebContents(event.sender)
      const pick = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0]!, {
        title: `Lưu dump của ${site.name}`,
        defaultPath: `${site.slug}.sql`,
        filters: [{ name: 'SQL', extensions: ['sql'] }]
      })
      if (pick.canceled || !pick.filePath) return { ok: false, error: 'Đã huỷ' }
      const res = await dbs.dumpDatabase(site.dbName, pick.filePath)
      return res.ok ? { ok: true } : { ok: false, error: res.error }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.LOCALDEV_DB_IMPORT, async (event, siteId: string): Promise<LdResultDto> => {
    if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
    try {
      const { store: st, db: dbs } = ensureStack()
      const site = st.getSite(siteId)
      if (!site) return { ok: false, error: 'Site không tồn tại' }
      if (!site.dbName) return { ok: false, error: 'Site này chưa có database — bấm "Cấp database" trước' }
      const win = BrowserWindow.fromWebContents(event.sender)
      const pick = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0]!, {
        title: `Chọn file .sql để nạp vào ${site.dbName}`,
        message: 'Dump xuất từ phpMyAdmin / mysqldump / XAMPP đều dùng được.',
        properties: ['openFile'],
        filters: [
          { name: 'SQL dump', extensions: ['sql'] },
          { name: 'Tất cả', extensions: ['*'] }
        ]
      })
      if (pick.canceled || pick.filePaths.length === 0) return { ok: false, error: 'Đã huỷ' }
      const res = await dbs.importDump(site.dbName, pick.filePaths[0]!)
      if (!res.ok) return { ok: false, error: res.error }
      const tables = await dbs.countTables(site.dbName)
      broadcast(IPC.LOCALDEV_SITE_EVENT, {
        siteId: site.id,
        phase: 'done',
        percent: 100,
        message: `Đã nạp dump — ${String(tables)} bảng`
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.LOCALDEV_DB_LIST, async (): Promise<string[]> => {
    if (!settings.enabled) return []
    try {
      const { stack: sk, db: dbs } = ensureStack()
      if (!sk.mariadbRunning()) return []
      return await dbs.listDatabases()
    } catch {
      return []
    }
  })

  /**
   * Mở 1 công cụ DB (Adminer / phpMyAdmin) trong browser. Cùng 4 bước cho cả hai:
   * đã cài? → reload nginx (vhost của nó là vhost MỚI, không reload thì 404 hoặc vào site khác)
   * → bật MariaDB nếu đang tắt (đây chính là việc user vừa yêu cầu) → mở URL.
   */
  const openDbTool = async (
    tool: 'adminer' | 'phpmyadmin',
    siteId: string | undefined
  ): Promise<LdResultDto> => {
    if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
    try {
      const { stack: sk, store: st } = ensureStack()
      const name = tool === 'adminer' ? 'Adminer' : 'phpMyAdmin'
      const ready = tool === 'adminer' ? await sk.adminerReady() : await sk.phpMyAdminReady()
      if (!ready) {
        return { ok: false, error: `Chưa cài ${name} (hoặc chưa cài PHP) — vào tab Runtime bấm Cài.` }
      }
      const applied = await applyAndSync()
      if (!applied.ok) return applied
      if (!sk.mariadbRunning() && (await sk.mariadbTarget()) !== null) await sk.start(MARIADB_SERVICE_ID)
      const dbName = siteId ? (st.getSite(siteId)?.dbName ?? undefined) : undefined
      const url = tool === 'adminer' ? await sk.adminerUrl(dbName) : await sk.phpMyAdminUrl(dbName)
      if (url === null) return { ok: false, error: `Chưa cấp được cổng web cho ${name}` }
      await shell.openExternal(url)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  ipcMain.handle(IPC.LOCALDEV_DB_ADMINER, (_e, siteId?: string) => openDbTool('adminer', siteId))
  ipcMain.handle(IPC.LOCALDEV_DB_PMA, (_e, siteId?: string) => openDbTool('phpmyadmin', siteId))

  // ── wp-config.php ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOCALDEV_SITE_WP_CONFIG_READ, async (_e, siteId: string): Promise<LdWpConfigDto> => {
    if (!settings.enabled) return { exists: false, error: 'Local dev đang tắt' }
    try {
      const { store: st, db: dbs } = ensureStack()
      const site = st.getSite(siteId)
      if (!site) return { exists: false, error: 'Site không tồn tại' }
      const file = await findWpConfig(site)
      if (file === null) return { exists: false }
      const text = await readFile(file, 'utf8').catch(() => null)
      if (text === null || !looksLikeWpConfig(text)) return { exists: false }
      const cur = readWpDbConfig(text)
      const port = (await ensureStack().stack.mariadbTarget())?.port ?? null
      const want =
        site.dbName && site.dbUser && port !== null
          ? { dbName: site.dbName, dbUser: site.dbUser, dbHost: wpDbHost(port) }
          : null
      return {
        exists: true,
        path: file,
        ...(cur.dbName !== undefined ? { dbName: cur.dbName } : {}),
        ...(cur.dbUser !== undefined ? { dbUser: cur.dbUser } : {}),
        ...(cur.dbHost !== undefined ? { dbHost: cur.dbHost } : {}),
        matches:
          want !== null &&
          cur.dbName === want.dbName &&
          cur.dbUser === want.dbUser &&
          cur.dbHost === want.dbHost &&
          cur.dbPassword === site.dbPass,
        ...(site.dbName ? { tables: await dbs.countTables(site.dbName) } : {})
      }
    } catch (e) {
      return { exists: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.LOCALDEV_SITE_WP_CONFIG, async (_e, siteId: string): Promise<LdResultDto> => {
    if (!settings.enabled) return { ok: false, error: 'Local dev đang tắt' }
    try {
      const { store: st, stack: sk } = ensureStack()
      const site = st.getSite(siteId)
      if (!site) return { ok: false, error: 'Site không tồn tại' }
      if (!site.dbName || !site.dbUser || site.dbPass === null) {
        return { ok: false, error: 'Site này chưa có database — bấm "Cấp database" trước' }
      }
      const target = await sk.mariadbTarget()
      if (!target) return { ok: false, error: 'Chưa cài runtime MariaDB' }

      const file = await findWpConfig(site)
      if (file === null) {
        return { ok: false, error: `Không tìm thấy wp-config.php trong ${site.docRoot}` }
      }
      const text = await readFile(file, 'utf8').catch(() => null)
      if (text === null) return { ok: false, error: `Không đọc được ${file}` }
      // Chống ghi vào file trùng tên nhưng không phải wp-config của WordPress
      if (!looksLikeWpConfig(text)) {
        return { ok: false, error: `${file} không giống wp-config.php của WordPress — không ghi.` }
      }

      // BACKUP TRƯỚC KHI GHI. wp-config.php chứa salt + hằng số user tự thêm; dù applyWpDbConfig
      // chỉ thay 4 dòng, một bản copy vài KB là cái giá quá nhỏ cho thứ không hoàn tác được.
      const backupDir = join(paths.trash, 'wp-config')
      await mkdir(backupDir, { recursive: true })
      const backup = join(backupDir, `${site.slug}-${String(Date.now())}.php`)
      await writeFile(backup, text, 'utf8')

      const res = applyWpDbConfig(text, {
        dbName: site.dbName,
        dbUser: site.dbUser,
        dbPassword: site.dbPass,
        dbHost: wpDbHost(target.port)
      })
      await writeFile(file, res.text, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ── Log ─────────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.LOCALDEV_LOG_TAIL, async (_e, siteId: string, which: LdLogSourceDto): Promise<LdLogTailDto> => {
    if (!settings.enabled) return { ok: false, text: '', error: 'Local dev đang tắt' }
    try {
      const { store: st } = ensureStack()
      let file: string
      if (siteId) {
        const site = st.getSite(siteId)
        if (!site) return { ok: false, text: '', error: 'Site không tồn tại' }
        // PHẢI khớp nơi ManagedStackProvider.writeSiteConfs ghi log: <logs>/sites/<slug>/.
        // Trước đây đọc ở <rootPath>/logs — mà site là folder CÓ SẴN của user nên app không
        // ghi log vào đó ⇒ panel log luôn trống.
        const logs = join(paths.logs, 'sites', site.slug)
        file =
          which === 'nginx-access'
            ? join(logs, 'access.log')
            : which === 'wp-debug'
              ? join(site.docRoot, 'wp-content', 'debug.log')
              : join(logs, 'error.log')
      } else {
        // siteId rỗng = log của stack (nginx/php dùng chung)
        file = which === 'php-error' ? join(paths.logs, 'php-error.log') : join(paths.logs, 'nginx-error.log')
      }
      return { ok: true, text: await tailFile(file, LOG_TAIL_BYTES) }
    } catch (e) {
      return { ok: false, text: '', error: (e as Error).message }
    }
  })

  return {
    /** Gọi sau app.whenReady: dọn orphan lần chạy trước (nếu tính năng đang bật). */
    initIfEnabled: async (): Promise<void> => {
      if (!settings.enabled) return
      try {
        const { stack: sk } = ensureStack()
        const res = await sk.init()
        reapedLastInit = res.reaped
        if (res.reaped > 0) {
          console.log(`[localdev] reaped ${String(res.reaped)} leftover process(es) from previous run`)
        }
        if (settings.autoStart) await sk.startAll()
      } catch (e) {
        console.error('[localdev] init failed:', e)
      }
    },
    dispose: async (): Promise<void> => {
      await teardown()
    }
  }
}

/** Đọc N byte CUỐI của file (log cần đuôi, khác READ_FILE của hostTools lấy đầu). */
async function tailFile(file: string, maxBytes: number): Promise<string> {
  const fh = await open(file, 'r').catch(() => null)
  if (!fh) return ''
  try {
    const { size } = await fh.stat()
    const start = Math.max(0, size - maxBytes)
    const len = size - start
    if (len <= 0) return ''
    const buf = Buffer.alloc(Number(len))
    await fh.read(buf, 0, buf.length, start)
    const text = buf.toString('utf8')
    // Bỏ dòng đầu có thể bị cắt ngang khi đọc từ giữa file
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await fh.close()
  }
}
