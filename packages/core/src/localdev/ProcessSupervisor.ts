import { EventEmitter } from 'node:events'
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { nextDelayMs, pruneHistory, shouldGiveUp } from './backoff'
import { LogRing, splitLines } from './logLines'
import type { PlatformAdapter } from './platform/PlatformAdapter'
import type { LocalDevPaths, ServiceSpec, ServiceState, ServiceStatus, StrayProcess } from './types'

/**
 * Quản vòng đời các process daemon của local dev stack (nginx, php-cgi…).
 * Đây là thành phần RỦI RO CAO NHẤT của module: process con sống sót sau khi app tắt sẽ giữ
 * cổng và giữ lock data-dir, làm lần chạy sau thất bại một cách khó hiểu.
 *
 * PHÒNG THỦ CHỐNG ORPHAN — 5 lớp (không cần native addon / Job Object):
 *  1. gracefulStop riêng từng service (nginx -s quit, mariadb-admin shutdown).
 *  2. killTree (`taskkill /T /F`) khi graceful thất bại/hết giờ — nginx master sinh worker con.
 *  3. Journal `run/pids.json` ghi ĐỒNG BỘ ngay lúc spawn (trước khi kịp thành orphan).
 *  4. `reconcile()` lúc app khởi động: diệt process đang chạy TỪ TRONG thư mục runtimes —
 *     tiêu chí là ĐƯỜNG DẪN EXE, KHÔNG phải PID (Windows tái dùng PID rất nhanh ⇒ so PID
 *     sẽ có ngày giết oan process vô can của user).
 *  5. `stopAll()` cho `before-quit` + lệnh palette "Dừng mọi service" (escape hatch của user).
 *
 * Chính sách KHÔNG ADOPT: reconcile chỉ DIỆT orphan, không nhận nuôi. Nhờ vậy giữ được bất
 * biến "state==='running' ⟺ ta đang giữ một ChildProcess sống" — đơn giản hơn hẳn việc phải
 * poll PID ngoài.
 */

/** Phần giao diện process con mà supervisor cần — để test inject fake, không spawn thật. */
export interface SpawnedProcess {
  readonly pid: number | undefined
  readonly stdout: { on(event: 'data', cb: (chunk: unknown) => void): unknown } | null
  readonly stderr: { on(event: 'data', cb: (chunk: unknown) => void): unknown } | null
  on(event: 'exit', cb: (code: number | null, signal: string | null) => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
}

export interface SpawnOptions {
  cwd: string
  env: Record<string, string>
  windowsHide: boolean
  /** LUÔN false: chạy qua shell là mở cửa cho path có dấu cách/ký tự lạ phá lệnh. */
  shell: false
  /** Trên Windows detached KHÔNG làm con chết theo cha → vì thế lớp 3+4 là bắt buộc. */
  detached: false
  stdio: ['ignore', 'pipe', 'pipe']
}

export type SpawnFn = (exe: string, args: string[], opts: SpawnOptions) => SpawnedProcess

export interface SupervisorDeps {
  paths: LocalDevPaths
  adapter: PlatformAdapter
  /** Inject để test; mặc định node:child_process.spawn. */
  spawn?: SpawnFn
  /** Hẹn giờ (inject để test không phải chờ thật). Trả hàm cancel. */
  schedule?: (fn: () => void, ms: number) => () => void
  /** Kiểm cổng còn phục vụ được không (health probe). Inject để test. */
  checkPort?: (port: number) => Promise<boolean>
  now?: () => number
  /** Số lần probe fail liên tiếp trước khi coi là unhealthy. */
  healthFailThreshold?: number
}

interface Managed {
  spec: ServiceSpec
  state: ServiceState
  child: SpawnedProcess | null
  pid: number | null
  since: number | null
  /** Lần restart (mọi lần), để hiện cho user. */
  restarts: number
  /** Mốc thời gian các lần restart — dùng cửa sổ trượt để quyết định bỏ cuộc. */
  history: number[]
  lastError: string | null
  /** true = user chủ động dừng ⇒ exit KHÔNG được coi là crash. */
  stopping: boolean
  bootstrapped: boolean
  log: LogRing
  /** Phần dòng chưa hoàn chỉnh của stdout/stderr. */
  restOut: string
  restErr: string
  /** 20 dòng stderr cuối — để lastError nói được LÝ DO THẬT khi crash. */
  stderrTail: string[]
  healthFails: number
  cancelRestart: (() => void) | null
}

/** 1 dòng trong journal pids.json. */
interface PidRecord {
  serviceId: string
  pid: number
  exe: string
  startedAt: number
}

const DEFAULT_GRACE_MS = 5_000
const STDERR_TAIL_LINES = 20

export class ProcessSupervisor extends EventEmitter<{
  status: [ServiceStatus]
  log: [{ serviceId: string; lines: string[] }]
}> {
  private readonly services = new Map<string, Managed>()
  private readonly spawnFn: SpawnFn
  private readonly schedule: (fn: () => void, ms: number) => () => void
  private readonly now: () => number
  private readonly checkPort: ((port: number) => Promise<boolean>) | null
  private readonly healthThreshold: number
  private healthTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: SupervisorDeps) {
    super()
    this.spawnFn = deps.spawn ?? ((exe, args, opts) => nodeSpawn(exe, args, opts) as unknown as SpawnedProcess)
    this.schedule =
      deps.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms)
        return () => clearTimeout(t)
      })
    this.now = deps.now ?? (() => Date.now())
    this.checkPort = deps.checkPort ?? null
    this.healthThreshold = deps.healthFailThreshold ?? 3
  }

  register(spec: ServiceSpec): void {
    const existing = this.services.get(spec.id)
    if (existing) {
      // Đăng ký lại (vd đổi cổng/config) — giữ nguyên process đang chạy, chỉ cập nhật spec
      existing.spec = spec
      return
    }
    this.services.set(spec.id, {
      spec,
      state: 'stopped',
      child: null,
      pid: null,
      since: null,
      restarts: 0,
      history: [],
      lastError: null,
      stopping: false,
      bootstrapped: false,
      log: new LogRing(500),
      restOut: '',
      restErr: '',
      stderrTail: [],
      healthFails: 0,
      cancelRestart: null
    })
    this.emitStatus(spec.id)
  }

  unregister(id: string): void {
    this.services.delete(id)
  }

  status(id?: string): ServiceStatus[] {
    const list = id ? [this.services.get(id)].filter((x): x is Managed => x !== undefined) : [...this.services.values()]
    return list.map((m) => this.toStatus(m))
  }

  tail(id: string, lines: number): string[] {
    return this.services.get(id)?.log.tail(lines) ?? []
  }

  async start(id: string): Promise<void> {
    const m = this.services.get(id)
    if (!m) throw new Error(`Service chưa đăng ký: ${id}`)
    if (m.state === 'running' || m.state === 'starting') return
    m.cancelRestart?.()
    m.cancelRestart = null
    m.stopping = false
    m.lastError = null
    this.setState(m, 'starting')

    if (m.spec.bootstrap && !m.bootstrapped) {
      try {
        await m.spec.bootstrap()
        m.bootstrapped = true
      } catch (e) {
        m.lastError = `Bootstrap thất bại: ${(e as Error).message}`
        this.setState(m, 'crashed')
        throw e
      }
    }
    this.spawnOne(m)
  }

  async stop(id: string, opts?: { graceMs?: number }): Promise<void> {
    const m = this.services.get(id)
    if (!m) return
    m.cancelRestart?.()
    m.cancelRestart = null
    m.stopping = true
    if (m.state === 'stopped' || m.pid === null) {
      this.setState(m, 'stopped')
      return
    }
    this.setState(m, 'stopping')
    const pid = m.pid
    const graceMs = opts?.graceMs ?? m.spec.graceMs ?? DEFAULT_GRACE_MS

    // Lớp 1: dừng đàng hoàng
    let done = false
    if (m.spec.gracefulStop) {
      try {
        done = await Promise.race([
          m.spec.gracefulStop(pid),
          new Promise<boolean>((resolve) => this.schedule(() => resolve(false), graceMs))
        ])
      } catch {
        done = false
      }
    }
    // Lớp 2: killTree — /T để không để lại worker con giữ cổng
    if (!done || m.pid !== null) {
      await this.deps.adapter.killTree(pid)
    }
    this.removePidRecord(id)
    m.child = null
    m.pid = null
    this.setState(m, 'stopped')
  }

  async restart(id: string): Promise<void> {
    await this.stop(id)
    await this.start(id)
  }

  async startGroup(groupId: string): Promise<void> {
    for (const m of this.services.values()) {
      if (m.spec.groupId === groupId) await this.start(m.spec.id)
    }
  }

  async stopGroup(groupId: string): Promise<void> {
    for (const m of this.services.values()) {
      if (m.spec.groupId === groupId) await this.stop(m.spec.id)
    }
  }

  /** Reset đếm crash để user bấm "Thử lại" sau khi supervisor đã bỏ cuộc. */
  resetRestarts(id: string): void {
    const m = this.services.get(id)
    if (!m) return
    m.history = []
    m.restarts = 0
    m.lastError = null
    this.emitStatus(id)
  }

  /**
   * Dừng MỌI service. Gọi từ `before-quit` (và lệnh palette "Dừng mọi service").
   * Chạy song song để không cộng dồn thời gian chờ khi có nhiều service.
   */
  async stopAll(graceMs = 6_000): Promise<void> {
    this.stopHealthLoop()
    await Promise.all([...this.services.keys()].map((id) => this.stop(id, { graceMs }).catch(() => {})))
  }

  /**
   * Dọn orphan còn sống từ lần chạy trước. Gọi 1 LẦN lúc app khởi động, TRƯỚC mọi start.
   * Không dựa vào PID trong journal để quyết định diệt (PID reuse) — journal chỉ để BÁO CÁO.
   */
  async reconcile(): Promise<{ killed: StrayProcess[]; fromJournal: number }> {
    const journal = this.readJournal()
    let strays: StrayProcess[] = []
    try {
      strays = await this.deps.adapter.findStrayProcesses(this.deps.paths.runtimes)
    } catch {
      strays = []
    }
    for (const s of strays) {
      await this.deps.adapter.killTree(s.pid).catch(() => {})
    }
    this.writeJournal([])
    return { killed: strays, fromJournal: journal.length }
  }

  /** Bắt đầu vòng health probe (chỉ khi có checkPort được inject/mặc định). */
  startHealthLoop(intervalMs = 5_000): void {
    if (!this.checkPort || this.healthTimer) return
    this.healthTimer = setInterval(() => void this.probeAll(), intervalMs)
    this.healthTimer.unref()
  }

  stopHealthLoop(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  /** Chạy 1 lượt probe (export riêng để test gọi trực tiếp, không cần chờ timer). */
  async probeAll(): Promise<void> {
    if (!this.checkPort) return
    for (const m of this.services.values()) {
      const port = m.spec.healthPort
      if (port === null || (m.state !== 'running' && m.state !== 'unhealthy')) continue
      const ok = await this.checkPort(port).catch(() => false)
      if (ok) {
        m.healthFails = 0
        if (m.state === 'unhealthy') this.setState(m, 'running')
        continue
      }
      m.healthFails++
      if (m.healthFails >= this.healthThreshold && m.state === 'running') {
        // KHÔNG tự restart: máy đang tải nặng cũng làm probe fail → restart-bão còn tệ hơn.
        m.lastError = `Không phản hồi trên cổng ${port} (${m.healthFails} lần liên tiếp)`
        this.setState(m, 'unhealthy')
      }
    }
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────

  private spawnOne(m: Managed): void {
    const { spec } = m
    let child: SpawnedProcess
    try {
      child = this.spawnFn(spec.exe, spec.args, {
        cwd: spec.cwd,
        // env TRẮNG có kiểm soát: không kế thừa process.env để không rò token AI/AWS sang con
        env: spec.env,
        windowsHide: true,
        shell: false,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (e) {
      this.onSpawnError(m, e as NodeJS.ErrnoException)
      return
    }

    m.child = child
    m.pid = child.pid ?? null
    m.since = this.now()
    m.healthFails = 0
    m.stderrTail = []

    // Journal ghi ĐỒNG BỘ ngay lúc spawn: nếu app crash 1ms sau đây, lần mở kế tiếp vẫn
    // biết đã từng có process này (để báo cho user, còn việc diệt thì dựa vào exePath).
    if (m.pid !== null) this.addPidRecord({ serviceId: spec.id, pid: m.pid, exe: spec.exe, startedAt: m.since })

    child.stdout?.on('data', (chunk) => this.onOutput(m, String(chunk), false))
    child.stderr?.on('data', (chunk) => this.onOutput(m, String(chunk), true))
    child.on('error', (err) => this.onSpawnError(m, err as NodeJS.ErrnoException))
    child.on('exit', (code, signal) => this.onExit(m, code, signal))

    this.setState(m, 'running')
  }

  private onSpawnError(m: Managed, err: NodeJS.ErrnoException): void {
    m.child = null
    m.pid = null
    if (err.code === 'ENOENT') {
      // Runtime bị gỡ tay khỏi đĩa — restart bao nhiêu lần cũng vô nghĩa
      m.lastError = `Không tìm thấy chương trình: ${m.spec.exe}`
      this.setState(m, 'missing-runtime')
      return
    }
    m.lastError = err.message
    this.setState(m, 'crashed')
  }

  private onOutput(m: Managed, chunk: string, isErr: boolean): void {
    const prev = isErr ? m.restErr : m.restOut
    const { lines, rest } = splitLines(prev, chunk)
    if (isErr) m.restErr = rest
    else m.restOut = rest
    if (lines.length === 0) return
    m.log.push(lines)
    if (isErr) {
      m.stderrTail = [...m.stderrTail, ...lines].slice(-STDERR_TAIL_LINES)
    }
    this.emit('log', { serviceId: m.spec.id, lines })
  }

  private onExit(m: Managed, code: number | null, signal: string | null): void {
    if (m.child === null && m.state === 'stopped') return // đã dọn xong ở stop()
    m.child = null
    const pid = m.pid
    m.pid = null
    if (pid !== null) this.removePidRecord(m.spec.id)

    // Phân biệt USER DỪNG với CRASH — nếu lẫn, mỗi lần user bấm Dừng sẽ bị auto-restart lại
    if (m.stopping || m.state === 'stopping' || m.state === 'stopped') {
      this.setState(m, 'stopped')
      return
    }

    const cleanExit = code === 0
    if (cleanExit && !m.spec.restartOnCleanExit) {
      // Thoát sạch và spec nói đó là bất thường (nginx master) → coi là dừng, không restart
      this.setState(m, 'stopped')
      return
    }

    const reason = cleanExit
      ? 'thoát bình thường (sẽ khởi động lại)'
      : `thoát với code ${String(code)}${signal ? ` signal ${signal}` : ''}`
    const tail = m.stderrTail.join('\n').trim()
    m.lastError = tail ? `${reason}: ${tail.slice(-500)}` : reason

    const now = this.now()
    m.history = pruneHistory([...m.history, now], now, m.spec.restartWindowMs)
    if (shouldGiveUp(m.history, now, m.spec.maxRestarts, m.spec.restartWindowMs)) {
      // Crash loop 500 lần/phút tệ hơn service chết hẳn: đứng lại, để user bấm "Thử lại"
      m.lastError = `${m.lastError ?? ''} — đã thử lại ${m.history.length} lần, tạm dừng`.trim()
      this.setState(m, 'crashed')
      return
    }

    m.restarts++
    const delay = nextDelayMs(m.history.length - 1, Math.random())
    this.setState(m, 'restarting')
    m.cancelRestart = this.schedule(() => {
      m.cancelRestart = null
      if (m.stopping) return
      this.spawnOne(m)
    }, delay)
  }

  private setState(m: Managed, state: ServiceState): void {
    m.state = state
    if (state !== 'running') m.since = state === 'stopped' ? null : m.since
    this.emitStatus(m.spec.id)
  }

  private emitStatus(id: string): void {
    const m = this.services.get(id)
    if (m) this.emit('status', this.toStatus(m))
  }

  private toStatus(m: Managed): ServiceStatus {
    return {
      id: m.spec.id,
      groupId: m.spec.groupId,
      label: m.spec.label,
      state: m.state,
      pid: m.pid,
      ports: m.spec.healthPort === null ? [] : [m.spec.healthPort],
      since: m.state === 'running' ? m.since : null,
      restarts: m.restarts,
      lastError: m.lastError,
      runtimeId: null
    }
  }

  // ── journal pids.json ───────────────────────────────────────────────────────

  private journalPath(): string {
    return join(this.deps.paths.run, 'pids.json')
  }

  private readJournal(): PidRecord[] {
    try {
      const raw = JSON.parse(readFileSync(this.journalPath(), 'utf8')) as unknown
      if (!Array.isArray(raw)) return []
      return raw.filter(
        (r): r is PidRecord =>
          !!r && typeof r === 'object' && typeof (r as PidRecord).pid === 'number' && typeof (r as PidRecord).exe === 'string'
      )
    } catch {
      return []
    }
  }

  /** Ghi ĐỒNG BỘ — cố ý: async ở đây là mở cửa cho orphan không được ghi nhận. */
  private writeJournal(records: PidRecord[]): void {
    const path = this.journalPath()
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(records, null, 2), 'utf8')
    } catch {
      // Journal chỉ là lưới an toàn phụ (reconcile dựa vào exePath) → không được làm start fail
    }
  }

  private addPidRecord(rec: PidRecord): void {
    const list = this.readJournal().filter((r) => r.serviceId !== rec.serviceId)
    list.push(rec)
    this.writeJournal(list)
  }

  private removePidRecord(serviceId: string): void {
    this.writeJournal(this.readJournal().filter((r) => r.serviceId !== serviceId))
  }
}
