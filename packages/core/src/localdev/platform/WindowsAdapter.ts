import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PortRange } from '../ports'
import type { StrayProcess } from '../types'
import type { PlatformAdapter } from './PlatformAdapter'

const execFileAsync = promisify(execFile)

/** Đường dẫn TUYỆT ĐỐI tới binary hệ thống — không bao giờ dựa vào PATH. */
function system32(exe: string): string {
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  return join(root, 'System32', exe)
}

/**
 * ⚠️ BẮT BUỘC gọi tar bằng đường dẫn tuyệt đối `System32\tar.exe` (bsdtar/libarchive — đọc
 * được .zip). `tar` trên PATH của máy dev thường là GNU tar của Git Bash và **KHÔNG** đọc
 * được zip → nếu dựa vào PATH thì giải nén sẽ fail một cách khó hiểu.
 * Nhờ dùng bsdtar có sẵn (Windows 10 1803+): 0 dependency mới cho việc giải nén.
 */
export class WindowsAdapter implements PlatformAdapter {
  readonly platform: NodeJS.Platform = 'win32'

  async extractArchive(
    archivePath: string,
    destDir: string,
    opts: { archive: 'zip' | 'tar.gz' | 'raw'; stripComponents: number; rawFileName?: string }
  ): Promise<void> {
    await mkdir(destDir, { recursive: true })

    if (opts.archive === 'raw') {
      // Binary đơn lẻ (vd mkcert.exe) — chỉ copy vào đúng tên
      const name = opts.rawFileName ?? 'downloaded.bin'
      await copyFile(archivePath, join(destDir, name))
      return
    }

    const args = ['-xf', archivePath, '-C', destDir]
    if (opts.stripComponents > 0) args.push('--strip-components', String(opts.stripComponents))
    try {
      await execFileAsync(system32('tar.exe'), args, { windowsHide: true, timeout: 300_000 })
      return
    } catch (e) {
      // Windows quá cũ / thiếu bsdtar → fallback Expand-Archive (chậm hơn, không có
      // --strip-components nên phải tự nâng cấp thư mục sau).
      if (opts.archive !== 'zip') throw e
      await this.expandArchiveFallback(archivePath, destDir, opts.stripComponents)
    }
  }

  private async expandArchiveFallback(archivePath: string, destDir: string, strip: number): Promise<void> {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath ${quotePs(archivePath)} -DestinationPath ${quotePs(destDir)} -Force`
      ],
      { windowsHide: true, timeout: 600_000 }
    )
    if (strip <= 0) return
    // Tự làm việc của --strip-components: nâng nội dung thư mục con duy nhất lên 1 cấp
    for (let i = 0; i < strip; i++) {
      const entries = await readdir(destDir, { withFileTypes: true })
      if (entries.length !== 1 || !entries[0]!.isDirectory()) break
      const inner = join(destDir, entries[0]!.name)
      const moved = join(destDir, `.__strip_${String(i)}`)
      await rename(inner, moved)
      for (const e of await readdir(moved, { withFileTypes: true })) {
        await rename(join(moved, e.name), join(destDir, e.name))
      }
      await rm(moved, { recursive: true, force: true })
    }
  }

  /** taskkill /T = cả cây con, /F = cưỡng chế. Process đã chết thì bỏ qua lỗi. */
  async killTree(pid: number): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) return
    try {
      await execFileAsync(system32('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 15_000
      })
    } catch {
      // "process not found" là kết quả CHẤP NHẬN ĐƯỢC — đích đến là process không còn sống
    }
  }

  /**
   * Liệt kê process có ExecutablePath nằm trong `underDir`. Không app nào khác chạy exe từ
   * thư mục runtime của ta ⇒ an toàn để diệt, miễn nhiễm PID reuse, và bắt được cả cháu/chắt.
   */
  async findStrayProcesses(underDir: string): Promise<StrayProcess[]> {
    // -LiteralPath không dùng được cho -like nên escape thủ công cho pattern
    const pattern = `${underDir.replace(/'/g, "''")}\\*`
    const script = [
      '$ErrorActionPreference = "Stop";',
      `Get-CimInstance Win32_Process |`,
      `  Where-Object { $_.ExecutablePath -like '${pattern}' } |`,
      '  Select-Object ProcessId, ParentProcessId, ExecutablePath, CreationDate |',
      '  ConvertTo-Json -Compress -Depth 3'
    ].join(' ')
    let stdout = ''
    try {
      const res = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }
      )
      stdout = res.stdout
    } catch {
      return [] // không liệt kê được thì coi như không có — reap là best-effort
    }
    return parseStrayJson(stdout)
  }

  /** Đọc dải cổng OS giữ; cache trong 1 phiên vì gọi netsh khá chậm. */
  private reservedCache: PortRange[] | null = null

  async reservedPortRanges(): Promise<PortRange[]> {
    if (this.reservedCache) return this.reservedCache
    try {
      const res = await execFileAsync(
        system32('netsh.exe'),
        ['int', 'ipv4', 'show', 'excludedportrange', 'protocol=tcp'],
        { windowsHide: true, timeout: 15_000 }
      )
      this.reservedCache = parseExcludedPortRanges(res.stdout)
    } catch {
      this.reservedCache = []
    }
    return this.reservedCache
  }

  async runShort(
    exe: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    try {
      const res = await execFileAsync(exe, args, {
        cwd: opts?.cwd,
        windowsHide: true,
        timeout: opts?.timeoutMs ?? 20_000,
        ...(opts?.env ? { env: opts.env } : {})
      })
      return { code: 0, stdout: res.stdout, stderr: res.stderr }
    } catch (e) {
      const err = e as { code?: number | string; stdout?: string; stderr?: string; message?: string }
      return {
        code: typeof err.code === 'number' ? err.code : null,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? ''
      }
    }
  }

  async runWithStdinFile(
    exe: string,
    args: string[],
    stdinFile: string,
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    // Mở file rồi đưa THẲNG fd làm stdio[0]: dump có thể hàng trăm MB, không đọc vào RAM,
    // và không đi qua shell nên không phải escape đường dẫn Windows.
    const fh = await open(stdinFile, 'r')
    try {
      return await new Promise((resolve) => {
        const child = spawn(exe, args, {
          cwd: opts?.cwd,
          windowsHide: true,
          stdio: [fh.fd, 'pipe', 'pipe'],
          ...(opts?.env ? { env: opts.env } : {})
        })
        let stdout = ''
        let stderr = ''
        // Giới hạn bộ đệm: một dump lỗi có thể sinh hàng triệu dòng warning
        const cap = (cur: string, chunk: string): string => (cur.length > 64_000 ? cur : cur + chunk)
        child.stdout?.on('data', (d: Buffer) => {
          stdout = cap(stdout, d.toString('utf8'))
        })
        child.stderr?.on('data', (d: Buffer) => {
          stderr = cap(stderr, d.toString('utf8'))
        })
        const timer = setTimeout(
          () => {
            child.kill()
            resolve({ code: null, stdout, stderr: `${stderr}\nQuá thời gian chờ` })
          },
          opts?.timeoutMs ?? 15 * 60_000
        )
        child.on('error', (e) => {
          clearTimeout(timer)
          resolve({ code: null, stdout, stderr: stderr || e.message })
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          resolve({ code, stdout, stderr })
        })
      })
    } finally {
      await fh.close()
    }
  }
}

function quotePs(p: string): string {
  return `'${p.replace(/'/g, "''")}'`
}

/**
 * Parse output `ConvertTo-Json` của Get-CimInstance. THUẦN → test được.
 * PowerShell trả OBJECT khi chỉ có 1 kết quả và ARRAY khi nhiều — phải xử lý cả hai,
 * đây là chỗ rất dễ sai.
 */
export function parseStrayJson(stdout: string): StrayProcess[] {
  const text = stdout.trim()
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const list = Array.isArray(raw) ? raw : [raw]
  const out: StrayProcess[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const pid = typeof o.ProcessId === 'number' ? o.ProcessId : Number.NaN
    const exePath = typeof o.ExecutablePath === 'string' ? o.ExecutablePath : ''
    if (!Number.isInteger(pid) || pid <= 0 || !exePath) continue
    out.push({
      pid,
      parentPid: typeof o.ParentProcessId === 'number' ? o.ParentProcessId : null,
      exePath,
      startedAt: parseCimDate(o.CreationDate)
    })
  }
  return out
}

/** CreationDate của CIM có thể là '/Date(1690000000000)/' hoặc ISO string. */
function parseCimDate(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return null
  const m = /\/Date\((\d+)\)\//.exec(v)
  if (m) return Number(m[1])
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/**
 * Parse `netsh int ipv4 show excludedportrange protocol=tcp`. THUẦN → test được.
 * Output có dạng cột "Start Port    End Port" kèm phần header đa ngôn ngữ, nên chỉ bắt
 * các dòng có ĐÚNG 2 số nguyên.
 */
export function parseExcludedPortRanges(stdout: string): PortRange[] {
  const out: PortRange[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d{1,5})\s+(\d{1,5})\s*$/.exec(line)
    if (!m) continue
    const from = Number(m[1])
    const to = Number(m[2])
    if (from < 1 || to > 65_535 || from > to) continue
    out.push([from, to])
  }
  return out
}
