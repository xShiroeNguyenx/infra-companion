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

/** Tải về tối đa 25MB — renderer còn nén lại nên không cần ảnh gốc khổng lồ. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const IMAGE_FETCH_TIMEOUT_MS = 20_000

/**
 * Chuyển link chia sẻ của các dịch vụ phổ biến → link tải trực tiếp.
 * Hiện hỗ trợ Google Drive (file/d/<id> và ?id=<id>) và Dropbox (?dl=1).
 */
export function normalizeImageUrl(raw: string): string {
  const url = raw.trim()
  // https://drive.google.com/file/d/<ID>/view?... → uc?export=download&id=<ID>
  const driveFile = /drive\.google\.com\/file\/d\/([^/?#]+)/.exec(url)
  if (driveFile) return `https://drive.google.com/uc?export=download&id=${driveFile[1]}`
  // https://drive.google.com/open?id=<ID> | .../uc?id=<ID> | bất kỳ ?id=<ID>
  const driveId = /drive\.google\.com\/[^?#]*[?&]id=([^&#]+)/.exec(url)
  if (driveId) return `https://drive.google.com/uc?export=download&id=${driveId[1]}`
  // Dropbox: ép tải file thật thay vì trang xem.
  if (/dropbox\.com\//.test(url)) {
    if (/[?&]dl=1\b/.test(url)) return url
    if (/[?&]dl=0\b/.test(url)) return url.replace(/([?&])dl=0\b/, '$1dl=1')
    return url + (url.includes('?') ? '&dl=1' : '?dl=1')
  }
  return url
}

/** Nhận diện định dạng ảnh từ magic bytes (không tin content-type của server). */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  return null
}

/**
 * Tải ảnh từ URL ở MAIN process (không vướng CORS như renderer), trả về data URL.
 * Renderer sẽ tự nén + lưu, nên ở đây chỉ cần lấy bytes gốc một cách an toàn.
 */
export async function fetchImageAsDataUrl(rawUrl: string): Promise<string> {
  const url = normalizeImageUrl(rawUrl)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('URL không hợp lệ')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Chỉ hỗ trợ http/https')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 InfraCompanion' }
    })
    if (!res.ok) throw new Error(`Tải ảnh thất bại (HTTP ${res.status})`)

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    // Drive trả text/html khi file chưa công khai hoặc cần xác nhận quét virus.
    if (contentType.startsWith('text/html')) {
      throw new Error('Link không trỏ thẳng tới ảnh (có thể file chưa được chia sẻ công khai)')
    }
    const declaredLen = Number(res.headers.get('content-length') ?? '0')
    if (declaredLen > MAX_IMAGE_BYTES) throw new Error('Ảnh quá lớn (>25MB)')

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('Ảnh quá lớn (>25MB)')

    // Ưu tiên magic bytes; nếu không nhận ra thì thử content-type image/*; còn lại là lỗi.
    const sniffed = sniffImageMime(buf)
    const mime = sniffed ?? (contentType.startsWith('image/') ? contentType.split(';')[0] : null)
    if (!mime) throw new Error('Nội dung tải về không phải là ảnh')

    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Tải ảnh quá lâu (timeout)')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
