import { EventEmitter } from 'node:events'
import { discoverPlugins, type DiscoveredPlugin } from './discover'
import type { ApiMethod, HostToWorker, WorkerToHost } from './protocol'

/** Worker tối giản để PluginHost dùng — desktop bọc node:worker_threads, test dùng fake. */
export interface PluginWorkerLike {
  postMessage(msg: HostToWorker): void
  onMessage(cb: (msg: WorkerToHost) => void): void
  onExit(cb: (code: number) => void): void
  onError(cb: (err: Error) => void): void
  terminate(): void
}

export interface PluginHostAdapters {
  /** Thư mục userData/plugins. */
  pluginsDir: string
  /** Tạo worker mới (desktop: new Worker(workerPath); test: fake). */
  createWorker(): PluginWorkerLike
  /** Đọc/ghi trạng thái bật-tắt (state.json) — inject để test không đụng fs. */
  readState(): Record<string, { enabled: boolean }>
  writeState(state: Record<string, { enabled: boolean }>): void
  /** Gửi text vào 1 phiên terminal (qua SessionManager). */
  terminalWrite(sessionId: string, data: string): void | Promise<void>
  /** Phiên terminal đang active (null nếu không có). */
  getActiveSessionId(): string | null
  /** Đọc/ghi storage plugin-scoped (đã confine đường dẫn). */
  storageGet(pluginId: string, key: string): unknown
  storageSet(pluginId: string, key: string, value: unknown): void
}

export type PluginStatus = 'active' | 'disabled' | 'failed' | 'crashed' | 'loading'

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string | null
  enabled: boolean
  status: PluginStatus
  error: string | null
  commands: { id: string; title: string }[]
  permissions: string[]
  logTail: string[]
}

export interface ContributedCommand {
  pluginId: string
  commandId: string
  title: string
}

export interface PluginPanelPayload {
  pluginId: string
  title: string
  markdown?: string
  text?: string
}

export interface PluginNotifyPayload {
  pluginId: string
  message: string
}

interface PluginHostEvents {
  'contributions-changed': [ContributedCommand[]]
  panel: [PluginPanelPayload]
  notify: [PluginNotifyPayload]
}

interface PluginRuntime {
  id: string
  name: string
  version: string
  description: string | null
  permissions: string[]
  dir: string
  entry: string
  manifest: DiscoveredPlugin['manifest']
  enabled: boolean
  status: PluginStatus
  error: string | null
  /** Lệnh plugin đã register lúc activate (nguồn sự thật cho palette). */
  commands: { id: string; title: string }[]
  subscribesTerminal: boolean
  logTail: string[]
  activateTimer: ReturnType<typeof setTimeout> | null
}

const ACTIVATE_TIMEOUT_MS = 10_000
const LOG_TAIL_MAX = 200

/**
 * Quản lý vòng đời plugin chạy trong 1 worker_thread chung: discover → activate → định tuyến
 * lệnh/observe output → api-call → cleanup. Thuần Node + adapter inject (không phụ thuộc Electron)
 * nên test được bằng fake worker. Mọi truy cập app của plugin đều đi qua adapter ở đây.
 */
export class PluginHost extends EventEmitter<PluginHostEvents> {
  private readonly plugins = new Map<string, PluginRuntime>()
  /** Plugin lỗi từ lúc discover (manifest hỏng) — hiển thị trong UI, không activate. */
  private readonly invalid = new Map<string, { id: string; error: string }>()
  private worker: PluginWorkerLike | null = null
  private ready = false
  private disposing = false
  private respawnedOnce = false
  private readonly outbox: HostToWorker[] = []

  constructor(private readonly adapters: PluginHostAdapters) {
    super()
  }

  /** Discover + spawn worker + activate các plugin đang bật. */
  init(): void {
    this.discover()
    this.spawnWorker()
    for (const p of this.plugins.values()) {
      if (p.enabled) this.activate(p)
    }
  }

  private discover(): void {
    const state = this.safeReadState()
    const result = discoverPlugins(this.adapters.pluginsDir)
    this.invalid.clear()
    for (const inv of result.invalid) {
      this.invalid.set(inv.id, { id: inv.id, error: inv.errors.join('; ') })
    }
    const seen = new Set<string>()
    for (const d of result.valid) {
      seen.add(d.id)
      const enabled = state[d.id]?.enabled ?? true
      const existing = this.plugins.get(d.id)
      if (existing) {
        existing.dir = d.dir
        existing.entry = d.entry
        existing.manifest = d.manifest
        existing.name = d.manifest.name
        existing.version = d.manifest.version
        existing.description = d.manifest.description
        existing.permissions = d.manifest.permissions
        existing.enabled = enabled
      } else {
        this.plugins.set(d.id, {
          id: d.id,
          name: d.manifest.name,
          version: d.manifest.version,
          description: d.manifest.description,
          permissions: d.manifest.permissions,
          dir: d.dir,
          entry: d.entry,
          manifest: d.manifest,
          enabled,
          status: enabled ? 'loading' : 'disabled',
          error: null,
          commands: [],
          subscribesTerminal: false,
          logTail: [],
          activateTimer: null
        })
      }
    }
    // Bỏ runtime của plugin không còn trên đĩa
    for (const id of [...this.plugins.keys()]) {
      if (!seen.has(id)) this.plugins.delete(id)
    }
  }

  private spawnWorker(): void {
    const worker = this.adapters.createWorker()
    this.worker = worker
    this.ready = false
    worker.onMessage((msg) => this.handleWorkerMessage(msg))
    worker.onError((err) => {
      // Lỗi cấp worker (không gắn được plugin nào) — ghi log chung, không kéo main.
      for (const p of this.plugins.values()) this.pushLog(p, 'error', `[worker] ${err.message}`)
    })
    worker.onExit((code) => this.handleWorkerExit(code))
  }

  private handleWorkerExit(code: number): void {
    if (this.disposing) return
    for (const p of this.plugins.values()) {
      if (p.status === 'active' || p.status === 'loading') {
        p.status = 'crashed'
        p.error = `worker thoát (code ${code})`
        p.commands = []
        p.subscribesTerminal = false
        this.clearActivateTimer(p)
      }
    }
    this.emitContributions()
    if (!this.respawnedOnce) {
      this.respawnedOnce = true
      this.spawnWorker()
      for (const p of this.plugins.values()) {
        if (p.enabled) {
          p.status = 'loading'
          p.error = null
          this.activate(p)
        }
      }
    }
  }

  private handleWorkerMessage(msg: WorkerToHost): void {
    switch (msg.t) {
      case 'ready': {
        this.ready = true
        for (const m of this.outbox.splice(0)) this.worker?.postMessage(m)
        break
      }
      case 'activated': {
        const p = this.plugins.get(msg.pluginId)
        if (p) {
          this.clearActivateTimer(p)
          p.status = 'active'
          p.error = null
        }
        break
      }
      case 'activate-error': {
        const p = this.plugins.get(msg.pluginId)
        if (p) {
          this.clearActivateTimer(p)
          p.status = 'failed'
          p.error = msg.message
          p.commands = []
          this.pushLog(p, 'error', msg.stack ?? msg.message)
          this.emitContributions()
        }
        break
      }
      case 'register': {
        const p = this.plugins.get(msg.pluginId)
        if (p) {
          p.commands = msg.contributions.commands
          this.emitContributions()
        }
        break
      }
      case 'subscribe-terminal': {
        const p = this.plugins.get(msg.pluginId)
        if (p) p.subscribesTerminal = msg.on
        break
      }
      case 'api-call':
        void this.handleApiCall(msg.callId, msg.pluginId, msg.method, msg.args)
        break
      case 'log': {
        const p = this.plugins.get(msg.pluginId)
        if (p) this.pushLog(p, msg.level, msg.line)
        break
      }
    }
  }

  private async handleApiCall(
    callId: string,
    pluginId: string,
    method: ApiMethod,
    args: unknown[]
  ): Promise<void> {
    try {
      let value: unknown
      switch (method) {
        case 'terminal.write':
          await this.adapters.terminalWrite(String(args[0]), String(args[1]))
          break
        case 'terminal.getActiveSessionId':
          value = this.adapters.getActiveSessionId()
          break
        case 'ui.showPanel': {
          const opts = (args[0] ?? {}) as { title?: string; markdown?: string; text?: string }
          this.emit('panel', {
            pluginId,
            title: opts.title ?? pluginId,
            markdown: opts.markdown,
            text: opts.text
          })
          break
        }
        case 'ui.notify':
          this.emit('notify', { pluginId, message: String(args[0]) })
          break
        case 'storage.get':
          value = this.adapters.storageGet(pluginId, String(args[0]))
          break
        case 'storage.set':
          this.adapters.storageSet(pluginId, String(args[0]), args[1])
          break
        default:
          throw new Error(`method không hỗ trợ: ${String(method)}`)
      }
      this.send({ t: 'api-result', callId, ok: true, value })
    } catch (e) {
      this.send({ t: 'api-result', callId, ok: false, error: (e as Error).message })
    }
  }

  private activate(p: PluginRuntime): void {
    p.status = 'loading'
    p.error = null
    this.clearActivateTimer(p)
    p.activateTimer = setTimeout(() => {
      if (p.status === 'loading') {
        p.status = 'failed'
        p.error = 'activate quá hạn (timeout)'
        this.pushLog(p, 'error', p.error)
      }
    }, ACTIVATE_TIMEOUT_MS)
    this.send({ t: 'activate', pluginId: p.id, dir: p.dir, entry: p.entry, manifest: p.manifest })
  }

  /** Bật/tắt plugin: lưu state + activate/deactivate. Trả về danh sách mới. */
  setEnabled(id: string, enabled: boolean): PluginInfo[] {
    const p = this.plugins.get(id)
    if (p && p.enabled !== enabled) {
      p.enabled = enabled
      this.persistState()
      if (enabled) {
        this.activate(p)
      } else {
        this.send({ t: 'deactivate', pluginId: id })
        this.clearActivateTimer(p)
        p.status = 'disabled'
        p.error = null
        p.commands = []
        p.subscribesTerminal = false
        this.emitContributions()
      }
    }
    return this.list()
  }

  /** Quét lại thư mục plugins: nạp plugin MỚI, gỡ plugin đã xoá — không cần khởi động lại app. */
  rescan(): PluginInfo[] {
    const before = new Set(this.plugins.keys())
    this.discover()
    // Plugin đã xoá khỏi đĩa → gỡ trong worker
    for (const id of before) {
      if (!this.plugins.has(id)) this.send({ t: 'deactivate', pluginId: id })
    }
    // Plugin đang bật nhưng chưa chạy (mới thêm / từng lỗi) → activate
    for (const p of this.plugins.values()) {
      if (p.enabled && p.status !== 'active') this.activate(p)
    }
    this.emitContributions()
    return this.list()
  }

  /** Nạp lại 1 plugin (đọc lại code + manifest). */
  reload(id: string): PluginInfo[] {
    const p = this.plugins.get(id)
    if (p) {
      this.send({ t: 'deactivate', pluginId: id })
      this.clearActivateTimer(p)
      p.commands = []
      p.subscribesTerminal = false
    }
    this.discover()
    const fresh = this.plugins.get(id)
    if (fresh && fresh.enabled) this.activate(fresh)
    this.emitContributions()
    return this.list()
  }

  invokeCommand(pluginId: string, commandId: string, activeSessionId: string | null): void {
    const p = this.plugins.get(pluginId)
    if (!p || p.status !== 'active') return
    this.send({
      t: 'invokeCommand',
      pluginId,
      commandId,
      ctx: { activeSessionId: activeSessionId ?? undefined }
    })
  }

  /** Gọi từ luồng output terminal — chỉ forward khi có plugin đang subscribe. */
  onTerminalData(sessionId: string, data: string): void {
    if (!this.hasTerminalSubscribers()) return
    this.send({ t: 'terminalData', sessionId, data })
  }

  hasTerminalSubscribers(): boolean {
    for (const p of this.plugins.values()) {
      if (p.subscribesTerminal && p.status === 'active') return true
    }
    return false
  }

  contributions(): ContributedCommand[] {
    const out: ContributedCommand[] = []
    for (const p of this.plugins.values()) {
      if (p.status !== 'active') continue
      for (const c of p.commands) out.push({ pluginId: p.id, commandId: c.id, title: c.title })
    }
    return out
  }

  list(): PluginInfo[] {
    const out: PluginInfo[] = []
    for (const p of this.plugins.values()) {
      out.push({
        id: p.id,
        name: p.name,
        version: p.version,
        description: p.description,
        enabled: p.enabled,
        status: p.status,
        error: p.error,
        commands: p.commands,
        permissions: p.permissions,
        logTail: [...p.logTail]
      })
    }
    for (const inv of this.invalid.values()) {
      out.push({
        id: inv.id,
        name: inv.id,
        version: '—',
        description: null,
        enabled: false,
        status: 'failed',
        error: inv.error,
        commands: [],
        permissions: [],
        logTail: []
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  disposeAll(): void {
    this.disposing = true
    for (const p of this.plugins.values()) {
      this.clearActivateTimer(p)
      this.send({ t: 'deactivate', pluginId: p.id })
    }
    this.worker?.terminate()
    this.worker = null
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  private send(msg: HostToWorker): void {
    if (this.ready && this.worker) this.worker.postMessage(msg)
    else this.outbox.push(msg)
  }

  private emitContributions(): void {
    this.emit('contributions-changed', this.contributions())
  }

  private pushLog(p: PluginRuntime, level: 'log' | 'warn' | 'error', line: string): void {
    p.logTail.push(`[${level}] ${line}`)
    if (p.logTail.length > LOG_TAIL_MAX) p.logTail.splice(0, p.logTail.length - LOG_TAIL_MAX)
  }

  private clearActivateTimer(p: PluginRuntime): void {
    if (p.activateTimer) {
      clearTimeout(p.activateTimer)
      p.activateTimer = null
    }
  }

  private safeReadState(): Record<string, { enabled: boolean }> {
    try {
      return this.adapters.readState()
    } catch {
      return {}
    }
  }

  private persistState(): void {
    const state: Record<string, { enabled: boolean }> = {}
    for (const p of this.plugins.values()) state[p.id] = { enabled: p.enabled }
    try {
      this.adapters.writeState(state)
    } catch {
      // ghi state lỗi (đĩa) — không chặn vận hành
    }
  }
}
