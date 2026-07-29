import * as net from 'node:net'

/**
 * Cấp phát cổng cho web server / php pool / mariadb.
 * Phần THUẦN (pickPort, isReserved) test trực tiếp; phần I/O (probe bind) inject được.
 *
 * Vì sao không dùng `listen(0)` như forward.ts: ta cần cổng ỔN ĐỊNH (user bookmark URL,
 * cấu hình DB client), không phải cổng ngẫu nhiên mỗi lần chạy.
 */

export type PortRange = readonly [number, number]

/** Cổng nằm trong một dải bị hệ điều hành giữ (Hyper-V/WinNAT) → bind sẽ EACCES, không phải EADDRINUSE. */
export function isReserved(port: number, reserved: readonly PortRange[]): boolean {
  return reserved.some(([from, to]) => port >= from && port <= to)
}

/**
 * Chọn cổng đầu tiên khả dụng: ưu tiên `preferred`, sau đó quét `range` tăng dần.
 * Bỏ qua cổng đã cấp (`taken`) và cổng trong dải OS giữ (`reserved`).
 * Trả null nếu hết cổng → caller phải báo lỗi rõ chứ không được im lặng.
 */
export function pickPort(
  preferred: number | null,
  range: PortRange,
  taken: ReadonlySet<number>,
  reserved: readonly PortRange[] = []
): number | null {
  const usable = (p: number): boolean =>
    Number.isInteger(p) && p >= 1 && p <= 65_535 && !taken.has(p) && !isReserved(p, reserved)
  if (preferred !== null && usable(preferred)) return preferred
  const [from, to] = range
  for (let p = from; p <= to; p++) if (usable(p)) return p
  return null
}

/** Lý do một cổng không dùng được — để UI nói đúng thay vì "bind failed". */
export type PortBlockedReason = 'in-use' | 'os-reserved' | 'permission' | 'unknown'

export interface PortProbeResult {
  free: boolean
  reason?: PortBlockedReason
  /** Mã lỗi gốc của Node (EADDRINUSE/EACCES…) — đưa vào log, không hiện cho user. */
  code?: string
}

/**
 * Thử bind THẬT để biết cổng có rảnh không (chính xác hơn parse `netstat`).
 *
 * Bind trên `0.0.0.0` khi kiểm cho nginx: bind được `127.0.0.1` KHÔNG bảo đảm bind được
 * `0.0.0.0` (một tiến trình khác có thể đang giữ toàn bộ interface).
 */
export function probePort(port: number, host = '0.0.0.0', reserved: readonly PortRange[] = []): Promise<PortProbeResult> {
  if (isReserved(port, reserved)) {
    return Promise.resolve({ free: false, reason: 'os-reserved' })
  }
  return new Promise((resolve) => {
    const server = net.createServer()
    const done = (result: PortProbeResult): void => {
      server.removeAllListeners()
      try {
        server.close()
      } catch {
        /* chưa listen */
      }
      resolve(result)
    }
    server.once('error', (e: NodeJS.ErrnoException) => {
      const code = e.code ?? 'UNKNOWN'
      // EACCES ngoài dải reserved đã biết = cổng bị OS/driver (http.sys) giữ, hoặc thiếu quyền
      const reason: PortBlockedReason =
        code === 'EADDRINUSE' ? 'in-use' : code === 'EACCES' ? 'permission' : 'unknown'
      done({ free: false, reason, code })
    })
    server.once('listening', () => done({ free: true }))
    try {
      server.listen(port, host)
    } catch (e) {
      done({ free: false, reason: 'unknown', code: (e as NodeJS.ErrnoException).code })
    }
  })
}

/**
 * Cấp cổng có kiểm tra bind thật: quét từ `preferred`/đầu dải, bỏ cổng bị chiếm.
 * `probe` inject được để test không cần mở socket.
 */
export async function allocatePort(
  preferred: number | null,
  range: PortRange,
  taken: ReadonlySet<number>,
  reserved: readonly PortRange[] = [],
  probe: (port: number) => Promise<PortProbeResult> = (p) => probePort(p, '0.0.0.0', reserved)
): Promise<{ port: number } | { port: null; lastReason?: PortBlockedReason }> {
  const tried = new Set<number>(taken)
  let lastReason: PortBlockedReason | undefined
  for (;;) {
    const candidate = pickPort(preferred !== null && !tried.has(preferred) ? preferred : null, range, tried, reserved)
    if (candidate === null) return lastReason ? { port: null, lastReason } : { port: null }
    const res = await probe(candidate)
    if (res.free) return { port: candidate }
    lastReason = res.reason
    tried.add(candidate)
  }
}
