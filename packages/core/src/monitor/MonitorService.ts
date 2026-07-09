import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import type { Client } from 'ssh2'
import { establishChain, type ChainEndpoint } from '../connection/establish'
import { deriveExecFromLoginSteps, type LoginStepLike } from '../connection/loginScript'
import type { HostKeyVerifier } from '../connection/types'

export interface MetricSample {
  hostId: string
  ts: number
  ok: boolean
  /** load average 1 phút. */
  load1: number | null
  loadText: string | null
  memUsedPct: number | null
  /** % dùng cao nhất trong các mount thật (bỏ tmpfs/devtmpfs…). */
  diskUsedPct: number | null
  /** Mount point của diskUsedPct (vd "/var"). */
  diskMount: string | null
  /** % inode dùng cao nhất — hết inode khi ổ còn trống là lỗi câm kinh điển. */
  inodeUsedPct: number | null
  uptimeSec: number | null
  cpuCount: number | null
  // ---- CPU thật từ delta /proc/stat giữa 2 lần poll (null ở lần poll đầu) ----
  /** % CPU bận = 100 − idle − iowait (gồm cả steal — công suất thực còn lại). */
  cpuPct: number | null
  cpuUserPct: number | null
  cpuSystemPct: number | null
  /** % chờ I/O — cao là nghẽn đĩa chứ không phải thiếu CPU. */
  cpuIowaitPct: number | null
  /** % CPU bị hypervisor lấy (VPS oversubscribed) — ≥10% kéo dài là bất thường. */
  cpuStealPct: number | null
  /** Số tiến trình đang chờ CPU (procs_running — cột r của vmstat). */
  runQueue: number | null
  swapUsedMb: number | null
  swapTotalMb: number | null
  // ---- Mạng: delta /proc/net/dev giữa 2 lần poll (null ở lần poll đầu) ----
  netRxKbps: number | null
  netTxKbps: number | null
  /** Số kết nối TCP ESTABLISHED — chỉ số "đang bị cào" trực tiếp nhất. */
  tcpConns: number | null
  tcpTimeWait: number | null
  /** Tên tiến trình ăn CPU nhất. */
  topProc: string | null
  /** Uptime các service quen thuộc đang chạy (httpd/nginx/java…) — tiến trình LÂU ĐỜI nhất
   *  mỗi tên; khác uptimeSec của server (service restart không đụng server). null = không đo được. */
  services: { name: string; uptimeSec: number }[] | null
  error?: string
}

export interface MonitorTarget {
  hostId: string
  chain: ChainEndpoint[]
  /** Host vào bằng login-script (ssh/su/sudo…) → đo metric xuyên qua máy đích bên trong. */
  loginSteps?: LoginStepLike[]
}

export interface MonitorServiceEvents {
  sample: [MetricSample]
}

// Một lệnh shell portable đọc /proc + df cho mọi distro Linux, ngăn cách bằng marker.
// CHỈ dùng double-quote (giữ nesting qua shq của login-script đơn giản); lệnh nào thiếu
// trên distro lạ thì 2>/dev/null cho section rỗng — parser tự bỏ qua metric đó.
// Đếm TCP bằng grep " 01 "/" 06 " (cột st của /proc/net/tcp có space 2 bên) thay vì awk.
const METRIC_CMD = [
  'cat /proc/loadavg 2>/dev/null',
  'echo "==STAT=="',
  'grep -E "^cpu |^procs_running" /proc/stat 2>/dev/null',
  'echo "==MEM=="',
  'grep -E "^(MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree):" /proc/meminfo 2>/dev/null',
  'echo "==DISK=="',
  'df -P 2>/dev/null',
  'echo "==INODE=="',
  'df -Pi 2>/dev/null',
  'echo "==NET=="',
  'cat /proc/net/dev 2>/dev/null',
  'echo "==TCP=="',
  'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -c " 01 "',
  'cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -c " 06 "',
  'echo "==TOP=="',
  'ps -eo pcpu,comm --sort=-pcpu 2>/dev/null | head -2 | tail -1',
  'echo "==UP=="',
  'cat /proc/uptime 2>/dev/null',
  'echo "==CPU=="',
  'nproc 2>/dev/null',
  // Uptime service quen thuộc (etimes giây + tên) — parser lấy tiến trình lâu đời nhất mỗi tên.
  // KHÔNG dùng $(...)/awk: login-script bọc lệnh qua nhiều lớp quote, $ sẽ nổ ở sai hop.
  'echo "==SVC=="',
  'ps -eo etimes=,comm= 2>/dev/null | grep -E " (httpd|apache2|nginx|java|node|php-fpm|mysqld|mariadbd|postgres|redis-server)$" | head -40'
].join('; ')

const POLL_INTERVAL_MS = 3_000
/** Quá hạn này mà exec chưa close → coi như treo, reset polling để không "chết im lặng". */
const POLL_WATCHDOG_MS = 10_000

/** Counter thô của lần poll trước — để tính delta CPU%/net rate giữa 2 lần poll. */
export interface RawCounters {
  ts: number
  /** Các cột dòng "cpu " của /proc/stat (jiffies, cộng dồn từ boot). */
  cpu: number[] | null
  rxBytes: number | null
  txBytes: number | null
}

interface ActiveMonitor {
  hostId: string
  /** Lệnh đo metric hoàn chỉnh — đã bọc qua login script nếu có. */
  metricCmd: string
  client: Client | null
  closeChain: (() => void) | null
  /** Tách riêng 2 timer — dùng chung 1 field sẽ leak setInterval cũ mỗi lần reconnect. */
  pollTimer: NodeJS.Timeout | null
  reconnectTimer: NodeJS.Timeout | null
  stopped: boolean
  polling: boolean
  /** Snapshot counter lần poll trước (null = poll đầu / vừa reconnect → chưa có delta). */
  prev: RawCounters | null
}

/**
 * Theo dõi tài nguyên nhiều host: giữ 1 kết nối SSH/host, mỗi 3s exec lệnh đọc /proc + df,
 * parse load/mem/disk/uptime rồi emit sample. Tự kết nối lại nếu rớt.
 */
export class MonitorService extends EventEmitter<MonitorServiceEvents> {
  private readonly monitors = new Map<string, ActiveMonitor>()

  async start(target: MonitorTarget, verifyHostKey: HostKeyVerifier): Promise<void> {
    if (this.monitors.has(target.hostId)) return
    const monitor: ActiveMonitor = {
      hostId: target.hostId,
      // Host vào bằng login-script → bọc lệnh đo để chạy trên máy đích bên trong
      metricCmd: (target.loginSteps?.length ? deriveExecFromLoginSteps(target.loginSteps, METRIC_CMD) : null) ?? METRIC_CMD,
      client: null,
      closeChain: null,
      pollTimer: null,
      reconnectTimer: null,
      stopped: false,
      polling: false,
      prev: null
    }
    this.monitors.set(target.hostId, monitor)
    await this.connect(monitor, target, verifyHostKey)
  }

  private clearTimers(monitor: ActiveMonitor): void {
    if (monitor.pollTimer) clearInterval(monitor.pollTimer)
    if (monitor.reconnectTimer) clearTimeout(monitor.reconnectTimer)
    monitor.pollTimer = null
    monitor.reconnectTimer = null
  }

  private async connect(monitor: ActiveMonitor, target: MonitorTarget, verifyHostKey: HostKeyVerifier): Promise<void> {
    if (monitor.stopped) return
    try {
      const { client, closeAll } = await establishChain(target.chain, verifyHostKey)
      if (monitor.stopped) return closeAll()
      monitor.client = client
      monitor.closeChain = closeAll
      client.on('close', () => {
        if (monitor.stopped) return
        monitor.client = null
        // đóng cả chain (hop còn sống) trước khi reconnect — tránh leak kết nối tới jump host
        monitor.closeChain?.()
        monitor.closeChain = null
        monitor.polling = false
        monitor.prev = null // reconnect → delta đầu tiên sau đó không tin được, bỏ
        this.emit('sample', errorSample(target.hostId, 'Mất kết nối — đang thử lại'))
        // thử kết nối lại sau 5s
        this.clearTimers(monitor)
        monitor.reconnectTimer = setTimeout(() => void this.connect(monitor, target, verifyHostKey), 5_000)
      })
      this.clearTimers(monitor)
      this.poll(monitor)
      monitor.pollTimer = setInterval(() => this.poll(monitor), POLL_INTERVAL_MS)
    } catch (error) {
      this.emit('sample', errorSample(target.hostId, error instanceof Error ? error.message : String(error)))
      if (!monitor.stopped) {
        this.clearTimers(monitor)
        monitor.reconnectTimer = setTimeout(() => void this.connect(monitor, target, verifyHostKey), 5_000)
      }
    }
  }

  private poll(monitor: ActiveMonitor): void {
    const client = monitor.client
    if (!client || monitor.polling || monitor.stopped) return
    monitor.polling = true
    // Watchdog: exec treo (ssh lồng nhau bị blackhole) sẽ kẹt polling=true mãi → monitor chết im lặng
    const watchdog = setTimeout(() => {
      if (!monitor.polling) return
      monitor.polling = false
      if (!monitor.stopped) this.emit('sample', errorSample(monitor.hostId, 'Lệnh đo metric không phản hồi'))
    }, POLL_WATCHDOG_MS)
    client.exec(monitor.metricCmd, (error, stream) => {
      if (error) {
        clearTimeout(watchdog)
        monitor.polling = false
        return
      }
      let out = ''
      let errOut = ''
      const decoder = new StringDecoder('utf8')
      const stderrDecoder = new StringDecoder('utf8')
      stream.on('data', (chunk: Buffer) => {
        out += decoder.write(chunk)
      })
      stream.stderr.on('data', (chunk: Buffer) => {
        errOut += stderrDecoder.write(chunk)
      })
      stream.on('close', () => {
        clearTimeout(watchdog)
        if (!monitor.polling) return // watchdog đã nổ — bỏ kết quả trễ
        monitor.polling = false
        if (monitor.stopped) return
        const parsed = parseMetrics(monitor.hostId, out + decoder.end())
        let sample = parsed.sample
        if (sample.ok) {
          // CPU%/net rate = delta so với poll trước; poll đầu (prev=null) để null
          applyCounterDeltas(sample, monitor.prev, parsed.counters)
          monitor.prev = parsed.counters
        }
        // Parse fail mà remote có báo lỗi → hiện lỗi thật (ssh hop chết, sshpass thiếu…)
        // thay vì đoán mò "không phải Linux?"
        if (!sample.ok) {
          const hint = (errOut + stderrDecoder.end())
            .split('\n')
            .filter((line) => !/^Warning: Permanently added/i.test(line.trim()))
            .join(' ')
            .trim()
          if (hint) sample = errorSample(monitor.hostId, `Không parse được metrics — ${hint.slice(0, 200)}`)
        }
        this.emit('sample', sample)
      })
    })
  }

  stop(hostId: string): void {
    const monitor = this.monitors.get(hostId)
    if (!monitor) return
    monitor.stopped = true
    this.clearTimers(monitor)
    monitor.closeChain?.()
    this.monitors.delete(hostId)
  }

  stopAll(): void {
    for (const id of [...this.monitors.keys()]) this.stop(id)
  }
}

function errorSample(hostId: string, error: string): MetricSample {
  return {
    hostId,
    ts: Date.now(),
    ok: false,
    load1: null,
    loadText: null,
    memUsedPct: null,
    diskUsedPct: null,
    diskMount: null,
    inodeUsedPct: null,
    uptimeSec: null,
    cpuCount: null,
    cpuPct: null,
    cpuUserPct: null,
    cpuSystemPct: null,
    cpuIowaitPct: null,
    cpuStealPct: null,
    runQueue: null,
    swapUsedMb: null,
    swapTotalMb: null,
    netRxKbps: null,
    netTxKbps: null,
    tcpConns: null,
    tcpTimeWait: null,
    topProc: null,
    services: null,
    error
  }
}

export interface ParsedMetrics {
  sample: MetricSample
  counters: RawCounters
}

/** Filesystem ảo cần bỏ khi tìm mount đầy nhất. */
const SKIP_FS = new Set(['tmpfs', 'devtmpfs', 'udev', 'overlay', 'shm', 'none', 'squashfs', 'efivarfs'])

/**
 * Parse output METRIC_CMD → sample (metric tức thời) + counters thô (CPU jiffies,
 * net bytes) để caller tính delta giữa 2 lần poll. THUẦN — export cho test.
 */
export function parseMetrics(hostId: string, raw: string): ParsedMetrics {
  const sample = errorSample(hostId, '')
  sample.ok = true
  delete sample.error
  const counters: RawCounters = { ts: sample.ts, cpu: null, rxBytes: null, txBytes: null }
  try {
    const sec = splitSections(raw)
    // loadavg: "0.00 0.01 0.05 1/123 456" — nums[0] phải là số thật, tránh nuốt
    // dòng lỗi kiểu "command not found" thành load 0
    const nums = sec.load.trim().split(/\s+/)
    const l1 = Number(nums[0])
    if (nums.length >= 3 && Number.isFinite(l1)) {
      sample.load1 = l1
      sample.loadText = `${nums[0]} ${nums[1]} ${nums[2]}`
    }
    // /proc/stat: "cpu  us ni sy id io irq sirq st ..." (jiffies cộng dồn) + "procs_running N"
    const cpuLine = /^cpu\s+(.+)$/m.exec(sec.stat)
    if (cpuLine) {
      const t = cpuLine[1].trim().split(/\s+/).map(Number)
      if (t.length >= 4 && t.every((x) => Number.isFinite(x))) counters.cpu = t
    }
    const running = /^procs_running\s+(\d+)/m.exec(sec.stat)
    if (running) sample.runQueue = Number(running[1])
    // meminfo (kB)
    const memTotal = matchKb(sec.mem, 'MemTotal')
    const memAvail = matchKb(sec.mem, 'MemAvailable') ?? matchKb(sec.mem, 'MemFree')
    if (memTotal && memAvail !== null) sample.memUsedPct = Math.round(((memTotal - memAvail) / memTotal) * 100)
    const swapTotal = matchKb(sec.mem, 'SwapTotal')
    const swapFree = matchKb(sec.mem, 'SwapFree')
    if (swapTotal !== null && swapFree !== null) {
      sample.swapTotalMb = Math.round(swapTotal / 1024)
      sample.swapUsedMb = Math.round((swapTotal - swapFree) / 1024)
    }
    // df -P mọi mount: lấy % cao nhất trong các mount thật
    const disk = maxDfPct(sec.disk)
    if (disk) {
      sample.diskUsedPct = disk.pct
      sample.diskMount = disk.mount
    }
    const inode = maxDfPct(sec.inode)
    if (inode) sample.inodeUsedPct = inode.pct
    // /proc/net/dev: cộng rx/tx bytes mọi interface trừ lo
    const net = sumNetDev(sec.net)
    if (net) {
      counters.rxBytes = net.rx
      counters.txBytes = net.tx
    }
    // TCP: 2 dòng — số ESTABLISHED (" 01 ") và TIME_WAIT (" 06 ")
    // filter('') vì Number('') = 0 chứ không phải NaN — section rỗng sẽ thành 0 conn giả
    const tcpNums = sec.tcp.trim().split(/\s+/).filter((s) => s !== '').map(Number)
    if (tcpNums.length >= 1 && Number.isFinite(tcpNums[0])) sample.tcpConns = tcpNums[0]
    if (tcpNums.length >= 2 && Number.isFinite(tcpNums[1])) sample.tcpTimeWait = tcpNums[1]
    // ps: "12.3 httpd" → tên tiến trình ăn CPU nhất
    const topParts = sec.top.trim().split(/\s+/)
    if (topParts.length >= 2 && topParts[1] && topParts[1] !== 'COMMAND') sample.topProc = topParts.slice(1).join(' ')
    // uptime: "12345.67 9876.54" — check token khác rỗng trước (Number('') = 0, không phải NaN)
    const upTok = sec.up.trim().split(/\s+/)[0]
    if (upTok) {
      const up = Number(upTok)
      if (Number.isFinite(up)) sample.uptimeSec = Math.floor(up)
    }
    const n = Number(sec.cpuCount.trim())
    if (Number.isFinite(n) && n > 0) sample.cpuCount = n
    sample.services = parseServices(sec.svc)
  } catch {
    return { sample: errorSample(hostId, 'Không parse được metrics (không phải Linux?)'), counters }
  }
  // Không metric nào parse được (host BSD, shell lỗi…) → báo lỗi thay vì card "OK" rỗng
  if (sample.load1 === null && sample.memUsedPct === null && sample.uptimeSec === null) {
    return { sample: errorSample(hostId, 'Không parse được metrics (không phải Linux?)'), counters }
  }
  return { sample, counters }
}

/**
 * Điền CPU%/net rate vào sample từ delta giữa 2 bộ counter. prev null (poll đầu /
 * vừa reconnect) hoặc counter tụt (server reboot) → giữ null. THUẦN — export cho test.
 */
export function applyCounterDeltas(sample: MetricSample, prev: RawCounters | null, cur: RawCounters): void {
  if (!prev) return
  if (prev.cpu && cur.cpu && cur.cpu.length >= 5 && prev.cpu.length >= 5) {
    const total = cur.cpu.reduce((a, b) => a + b, 0) - prev.cpu.reduce((a, b) => a + b, 0)
    if (total > 0) {
      const d = (i: number): number => Math.max(0, (cur.cpu![i] ?? 0) - (prev.cpu![i] ?? 0))
      const pct = (v: number): number => Math.round((v / total) * 100)
      const idle = d(3)
      const iowait = d(4)
      sample.cpuUserPct = pct(d(0) + d(1)) // user + nice
      sample.cpuSystemPct = pct(d(2) + d(5) + d(6)) // system + irq + softirq
      sample.cpuIowaitPct = pct(iowait)
      sample.cpuStealPct = cur.cpu.length >= 8 && prev.cpu.length >= 8 ? pct(d(7)) : null
      sample.cpuPct = Math.max(0, Math.min(100, 100 - pct(idle) - pct(iowait)))
    }
  }
  const dtSec = (cur.ts - prev.ts) / 1000
  if (dtSec > 0) {
    if (prev.rxBytes !== null && cur.rxBytes !== null && cur.rxBytes >= prev.rxBytes) {
      sample.netRxKbps = Math.round(((cur.rxBytes - prev.rxBytes) * 8) / 1000 / dtSec)
    }
    if (prev.txBytes !== null && cur.txBytes !== null && cur.txBytes >= prev.txBytes) {
      sample.netTxKbps = Math.round(((cur.txBytes - prev.txBytes) * 8) / 1000 / dtSec)
    }
  }
}

interface Sections {
  load: string
  stat: string
  mem: string
  disk: string
  inode: string
  net: string
  tcp: string
  top: string
  up: string
  cpuCount: string
  svc: string
}

function splitSections(raw: string): Sections {
  const cut = (text: string, marker: string): [string, string] => {
    const parts = text.split(`==${marker}==`)
    return [parts[0] ?? '', parts[1] ?? '']
  }
  const [load, r1] = cut(raw, 'STAT')
  const [stat, r2] = cut(r1, 'MEM')
  const [mem, r3] = cut(r2, 'DISK')
  const [disk, r4] = cut(r3, 'INODE')
  const [inode, r5] = cut(r4, 'NET')
  const [net, r6] = cut(r5, 'TCP')
  const [tcp, r7] = cut(r6, 'TOP')
  const [top, r8] = cut(r7, 'UP')
  const [up, r9] = cut(r8, 'CPU')
  const [cpuCount, svc] = cut(r9, 'SVC')
  return { load, stat, mem, disk, inode, net, tcp, top, up, cpuCount, svc }
}

/** "  1234 httpd" mỗi dòng → uptime tiến trình LÂU ĐỜI nhất theo tên, sort giảm dần, tối đa 4. */
function parseServices(text: string): { name: string; uptimeSec: number }[] | null {
  const best = new Map<string, number>()
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const etimes = Number(parts[0])
    const name = parts.slice(1).join(' ')
    if (!Number.isFinite(etimes) || !name) continue
    if ((best.get(name) ?? -1) < etimes) best.set(name, etimes)
  }
  if (best.size === 0) return null
  return [...best.entries()]
    .map(([name, uptimeSec]) => ({ name, uptimeSec }))
    .sort((a, b) => b.uptimeSec - a.uptimeSec)
    .slice(0, 4)
}

/** df -P output → { pct, mount } của mount thật có % cao nhất (bỏ fs ảo + header). */
function maxDfPct(text: string): { pct: number; mount: string } | null {
  let best: { pct: number; mount: string } | null = null
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 6) continue
    const fs = cols[0]
    if (SKIP_FS.has(fs)) continue
    const m = /^(\d+)%$/.exec(cols[4])
    if (!m) continue // header hoặc cột "-" (fs không hỗ trợ inode)
    const pct = Number(m[1])
    const mount = cols.slice(5).join(' ')
    if (!best || pct > best.pct) best = { pct, mount }
  }
  return best
}

/** /proc/net/dev → tổng rx/tx bytes mọi interface trừ loopback. */
function sumNetDev(text: string): { rx: number; tx: number } | null {
  let rx = 0
  let tx = 0
  let found = false
  for (const line of text.split('\n')) {
    const m = /^\s*([^:\s]+):\s*(.+)$/.exec(line)
    if (!m || m[1] === 'lo') continue
    const cols = m[2].trim().split(/\s+/).map(Number)
    // /proc/net/dev: rx bytes = cột 1, tx bytes = cột 9 (sau tên interface)
    if (cols.length >= 9 && Number.isFinite(cols[0]) && Number.isFinite(cols[8])) {
      rx += cols[0]
      tx += cols[8]
      found = true
    }
  }
  return found ? { rx, tx } : null
}

function matchKb(text: string, key: string): number | null {
  const m = new RegExp(`${key}:\\s*(\\d+)`).exec(text)
  return m ? Number(m[1]) : null
}
