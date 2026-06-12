import { execFile } from 'node:child_process'
import * as dns from 'node:dns'
import * as net from 'node:net'

export interface PingResult {
  alive: boolean
  output: string
  avgMs: number | null
}

/** Ping qua lệnh hệ thống (tham số khác nhau theo OS). */
export function ping(host: string, count = 4): Promise<PingResult> {
  // host bắt đầu bằng "-" sẽ bị ping hiểu là cờ (vd -t ping vô hạn) — chặn argument injection
  if (host.trim().startsWith('-') || host.trim() === '') {
    return Promise.resolve({ alive: false, output: 'Host không hợp lệ', avgMs: null })
  }
  const isWin = process.platform === 'win32'
  const args = isWin ? ['-n', String(count), host] : ['-c', String(count), host]
  return new Promise((resolve) => {
    execFile('ping', args, { timeout: 15_000, windowsHide: true }, (error, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '')
      const avgMs = parseAvg(output)
      // ping trả exit code != 0 khi không tới được; vẫn đưa output để user xem.
      // Reply IPv6 trên Windows không in TTL → nhận diện thêm "time=/time<"
      resolve({ alive: !error && (/ttl=/i.test(output) || /time[=<]\s*\d/i.test(output)), output: output.trim(), avgMs })
    })
  })
}

function parseAvg(output: string): number | null {
  // Windows: "Average = 12ms"; Unix: "rtt min/avg/max/... = 1.2/3.4/5.6"
  const win = /Average\s*=\s*(\d+)ms/i.exec(output)
  if (win) return Number(win[1])
  const unix = /=\s*[\d.]+\/([\d.]+)\//.exec(output)
  if (unix) return Number(unix[1])
  // Windows bản địa hoá ("Mittelwert = 12ms"…) — Average luôn là số "= Nms" cuối cùng
  const generic = [...output.matchAll(/=\s*(\d+)\s*ms/gi)]
  if (generic.length > 0) return Number(generic[generic.length - 1]![1])
  return null
}

export interface DnsResult {
  a: string[]
  aaaa: string[]
  reverse: string[]
  error?: string
}

export async function dnsLookup(host: string): Promise<DnsResult> {
  const result: DnsResult = { a: [], aaaa: [], reverse: [] }
  try {
    result.a = await dns.promises.resolve4(host).catch(() => [])
    result.aaaa = await dns.promises.resolve6(host).catch(() => [])
    // Nếu host là IP → reverse lookup
    if (net.isIP(host)) {
      result.reverse = await dns.promises.reverse(host).catch(() => [])
    } else if (result.a.length > 0) {
      result.reverse = await dns.promises.reverse(result.a[0]!).catch(() => [])
    }
    if (result.a.length === 0 && result.aaaa.length === 0 && !net.isIP(host)) {
      result.error = 'Không phân giải được'
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}

/** Kiểm tra 1 port TCP có mở không (connect timeout). */
export function checkPort(host: string, port: number, timeoutMs = 3_000): Promise<{ open: boolean; ms: number }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()
    let settled = false
    const finish = (open: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ open, ms: Date.now() - start })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

export interface PortScanEntry {
  port: number
  service: string
  open: boolean
}

const COMMON_PORTS: Array<[number, string]> = [
  [22, 'SSH'],
  [23, 'Telnet'],
  [25, 'SMTP'],
  [53, 'DNS'],
  [80, 'HTTP'],
  [110, 'POP3'],
  [143, 'IMAP'],
  [443, 'HTTPS'],
  [445, 'SMB'],
  [3306, 'MySQL'],
  [3389, 'RDP'],
  [5432, 'PostgreSQL'],
  [5900, 'VNC'],
  [6379, 'Redis'],
  [8080, 'HTTP-alt'],
  [27017, 'MongoDB']
]

/** Quét nhanh các port phổ biến (song song). */
export async function scanCommonPorts(host: string): Promise<PortScanEntry[]> {
  const results = await Promise.all(
    COMMON_PORTS.map(async ([port, service]) => {
      const { open } = await checkPort(host, port, 1_500)
      return { port, service, open }
    })
  )
  return results
}
