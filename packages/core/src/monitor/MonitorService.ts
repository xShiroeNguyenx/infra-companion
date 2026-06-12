import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import type { Client } from 'ssh2'
import { establishChain, wrapSshCommand, type ChainEndpoint } from '../connection/establish'
import type { HostKeyVerifier } from '../connection/types'

export interface MetricSample {
  hostId: string
  ts: number
  ok: boolean
  /** load average 1 phút. */
  load1: number | null
  loadText: string | null
  memUsedPct: number | null
  diskUsedPct: number | null
  uptimeSec: number | null
  cpuCount: number | null
  error?: string
}

export interface MonitorTarget {
  hostId: string
  chain: ChainEndpoint[]
  /** Host vào bằng login-script "ssh …" → đo metric xuyên qua máy đích bên trong. */
  sshArgs?: string
}

export interface MonitorServiceEvents {
  sample: [MetricSample]
}

// Một lệnh shell portable đọc /proc + df cho mọi distro Linux, ngăn cách bằng marker
const METRIC_CMD = [
  'cat /proc/loadavg 2>/dev/null',
  'echo "==MEM=="',
  'cat /proc/meminfo 2>/dev/null | head -3',
  'echo "==DISK=="',
  'df -P / 2>/dev/null | tail -1',
  'echo "==UP=="',
  'cat /proc/uptime 2>/dev/null',
  'echo "==CPU=="',
  'nproc 2>/dev/null'
].join('; ')

const POLL_INTERVAL_MS = 3_000
/** Quá hạn này mà exec chưa close → coi như treo, reset polling để không "chết im lặng". */
const POLL_WATCHDOG_MS = 10_000

interface ActiveMonitor {
  hostId: string
  sshArgs?: string
  client: Client | null
  closeChain: (() => void) | null
  /** Tách riêng 2 timer — dùng chung 1 field sẽ leak setInterval cũ mỗi lần reconnect. */
  pollTimer: NodeJS.Timeout | null
  reconnectTimer: NodeJS.Timeout | null
  stopped: boolean
  polling: boolean
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
      sshArgs: target.sshArgs,
      client: null,
      closeChain: null,
      pollTimer: null,
      reconnectTimer: null,
      stopped: false,
      polling: false
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
    // Host vào bằng login-script "ssh …" → đo metric xuyên qua: ssh <args> '<metric cmd>'
    const cmd = monitor.sshArgs ? wrapSshCommand(monitor.sshArgs, METRIC_CMD) : METRIC_CMD
    client.exec(cmd, (error, stream) => {
      if (error) {
        clearTimeout(watchdog)
        monitor.polling = false
        return
      }
      let out = ''
      const decoder = new StringDecoder('utf8')
      stream.on('data', (chunk: Buffer) => {
        out += decoder.write(chunk)
      })
      stream.on('close', () => {
        clearTimeout(watchdog)
        if (!monitor.polling) return // watchdog đã nổ — bỏ kết quả trễ
        monitor.polling = false
        if (!monitor.stopped) this.emit('sample', parseMetrics(monitor.hostId, out + decoder.end()))
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
    uptimeSec: null,
    cpuCount: null,
    error
  }
}

function parseMetrics(hostId: string, raw: string): MetricSample {
  const sample = errorSample(hostId, '')
  sample.ok = true
  delete sample.error
  try {
    const [loadPart, memPart, diskPart, upPart, cpuPart] = splitSections(raw)
    // loadavg: "0.00 0.01 0.05 1/123 456"
    const nums = loadPart.trim().split(/\s+/)
    if (nums.length >= 3 && nums[0] !== '') {
      sample.load1 = Number(nums[0]) || 0
      sample.loadText = `${nums[0]} ${nums[1]} ${nums[2]}`
    }
    // meminfo: MemTotal / MemFree / MemAvailable (kB)
    if (memPart) {
      const total = matchKb(memPart, 'MemTotal')
      const avail = matchKb(memPart, 'MemAvailable') ?? matchKb(memPart, 'MemFree')
      if (total && avail !== null) sample.memUsedPct = Math.round(((total - avail) / total) * 100)
    }
    // df: "/dev/sda1 100G 40G 60G 40% /"
    if (diskPart) {
      const pct = /(\d+)%/.exec(diskPart)
      if (pct) sample.diskUsedPct = Number(pct[1])
    }
    // uptime: "12345.67 9876.54"
    if (upPart) {
      const up = Number(upPart.trim().split(/\s+/)[0])
      if (!Number.isNaN(up)) sample.uptimeSec = Math.floor(up)
    }
    if (cpuPart) {
      const n = Number(cpuPart.trim())
      if (!Number.isNaN(n) && n > 0) sample.cpuCount = n
    }
  } catch {
    return errorSample(hostId, 'Không parse được metrics (không phải Linux?)')
  }
  // Không metric nào parse được (host BSD, shell lỗi…) → báo lỗi thay vì card "OK" rỗng
  if (sample.load1 === null && sample.memUsedPct === null && sample.uptimeSec === null) {
    return errorSample(hostId, 'Không parse được metrics (không phải Linux?)')
  }
  return sample
}

function splitSections(raw: string): [string, string, string, string, string] {
  const mem = raw.split('==MEM==')
  const disk = (mem[1] ?? '').split('==DISK==')
  const up = (disk[1] ?? '').split('==UP==')
  const cpu = (up[1] ?? '').split('==CPU==')
  return [mem[0] ?? '', disk[0] ?? '', up[0] ?? '', cpu[0] ?? '', cpu[1] ?? '']
}

function matchKb(text: string, key: string): number | null {
  const m = new RegExp(`${key}:\\s*(\\d+)`).exec(text)
  return m ? Number(m[1]) : null
}
