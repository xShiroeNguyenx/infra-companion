import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execOnce, type ExecOnceResult } from '@infra/core'
import {
  IPC,
  type HostExecResultDto,
  type ProcListResultDto,
  type ProcessInfoDto,
  type ServiceActionDto,
  type ServiceInfoDto,
  type ServiceListResultDto
} from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { touchActivity } from './vault'

/** Tên unit systemd hợp lệ — chặn injection vào lệnh shell (không shq vì tên unit đơn giản). */
const UNIT_PATTERN = /^[A-Za-z0-9@._:\\-]+$/

/** Bọc chuỗi trong nháy đơn cho shell — đường dẫn file người dùng nhập có thể chứa ký tự đặc biệt. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/** Trần đọc file: 1MB — đủ cho config, tránh nuốt cả file log khổng lồ. */
const READ_FILE_MAX_BYTES = 1_048_576

/** Chạy 1 lệnh trên host qua kênh exec riêng (login-script aware) — dùng chung F33/F34. */
async function runOnHost(
  event: IpcMainInvokeEvent,
  hostId: string,
  command: string,
  timeoutMs = 30_000
): Promise<ExecOnceResult> {
  touchActivity()
  const prepared = await prepareConnection(event.sender, hostId)
  return execOnce(prepared.chain, command, makeHostKeyVerifier(event.sender), {
    loginSteps: prepared.loginSteps,
    timeoutMs
  })
}

function toExecDto(res: ExecOnceResult): HostExecResultDto {
  return { ok: res.status === 'done' && (res.code ?? 0) === 0, stdout: res.stdout, stderr: res.stderr, error: res.error }
}

/** Parse output `ps -eo pid=,user=,pcpu=,pmem=,rss=,etime=,comm=` — comm là cột cuối (có thể chứa space). */
export function parseProcesses(stdout: string): ProcessInfoDto[] {
  const out: ProcessInfoDto[] = []
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!m) continue
    out.push({
      pid: Number(m[1]),
      user: m[2]!,
      cpuPct: Number(m[3]),
      memPct: Number(m[4]),
      rssKb: Number(m[5]),
      elapsed: m[6]!,
      command: m[7]!.trim()
    })
  }
  return out
}

/** Parse output `systemctl list-units --type=service --all --plain --no-legend`. */
export function parseServices(stdout: string): ServiceInfoDto[] {
  const out: ServiceInfoDto[] = []
  for (const line of stdout.split('\n')) {
    // Cột: UNIT LOAD ACTIVE SUB DESCRIPTION… (● đầu dòng ở unit failed — --plain vẫn giữ)
    const m = line.replace(/^[●○*]\s*/, '').trim().match(/^(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/)
    if (!m) continue
    out.push({ unit: m[1]!, active: m[3]!, sub: m[4]!, description: m[5] ?? '' })
  }
  return out
}

/**
 * F33 (process viewer) + F34 (systemd manager): mọi lệnh chạy qua kênh exec riêng như Bulk/AI
 * chẩn đoán — KHÔNG đụng phiên terminal đang mở; xuyên được login-script gate (deriveExec).
 * Lệnh ghi (kill/systemctl start-stop-restart) LUÔN đi sau confirm ở renderer; main validate
 * tham số (pid số, unit theo pattern, action whitelist) để không thành generic-exec.
 */
export function registerHostToolsIpc(): void {
  ipcMain.handle(IPC.HTOOLS_PROCS, async (event, hostId: string, sortBy: 'cpu' | 'mem'): Promise<ProcListResultDto> => {
    const sort = sortBy === 'mem' ? '-pmem' : '-pcpu'
    const res = await runOnHost(event, hostId, `ps -eo pid=,user=,pcpu=,pmem=,rss=,etime=,comm= --sort=${sort} | head -60`)
    if (res.status === 'error') return { ok: false, processes: [], error: res.error }
    const processes = parseProcesses(res.stdout)
    if (processes.length === 0 && res.stderr.trim()) return { ok: false, processes: [], error: res.stderr.trim() }
    return { ok: true, processes }
  })

  ipcMain.handle(
    IPC.HTOOLS_KILL,
    async (event, hostId: string, pid: number, signal: 'TERM' | 'KILL'): Promise<HostExecResultDto> => {
      if (!Number.isInteger(pid) || pid <= 1) return { ok: false, stdout: '', stderr: '', error: 'PID không hợp lệ' }
      const sig = signal === 'KILL' ? 'KILL' : 'TERM'
      return toExecDto(await runOnHost(event, hostId, `kill -${sig} ${pid}`))
    }
  )

  ipcMain.handle(IPC.HTOOLS_SERVICES, async (event, hostId: string): Promise<ServiceListResultDto> => {
    const res = await runOnHost(event, hostId, 'systemctl list-units --type=service --all --plain --no-legend --no-pager')
    if (res.status === 'error') return { ok: false, services: [], error: res.error }
    const services = parseServices(res.stdout)
    if (services.length === 0) {
      const detail = res.stderr.trim() || res.stdout.trim().slice(0, 300)
      return { ok: false, services: [], error: detail || 'Không có output — server không dùng systemd?' }
    }
    return { ok: true, services }
  })

  ipcMain.handle(
    IPC.HTOOLS_SERVICE_ACTION,
    async (event, hostId: string, unit: string, action: ServiceActionDto): Promise<HostExecResultDto> => {
      if (!UNIT_PATTERN.test(unit)) return { ok: false, stdout: '', stderr: '', error: 'Tên service không hợp lệ' }
      if (!['start', 'stop', 'restart'].includes(action))
        return { ok: false, stdout: '', stderr: '', error: 'Hành động không hợp lệ' }
      return toExecDto(await runOnHost(event, hostId, `systemctl ${action} ${unit}`, 60_000))
    }
  )

  ipcMain.handle(IPC.HTOOLS_SERVICE_LOGS, async (event, hostId: string, unit: string): Promise<HostExecResultDto> => {
    if (!UNIT_PATTERN.test(unit)) return { ok: false, stdout: '', stderr: '', error: 'Tên service không hợp lệ' }
    return toExecDto(await runOnHost(event, hostId, `journalctl -u ${unit} -n 120 --no-pager 2>&1 | tail -n 120`))
  })

  // F49 — đọc nội dung file để so sánh config. `test -f` chặn thư mục/thiết bị; `head -c` cắt trần
  // để không nuốt cả file log lớn. Đường dẫn shq nên an toàn với ký tự đặc biệt/khoảng trắng.
  ipcMain.handle(IPC.HTOOLS_READ_FILE, async (event, hostId: string, path: string): Promise<HostExecResultDto> => {
    const p = (path ?? '').trim()
    if (!p) return { ok: false, stdout: '', stderr: '', error: 'Chưa nhập đường dẫn file' }
    const q = shq(p)
    const cmd = `if [ -f ${q} ]; then head -c ${READ_FILE_MAX_BYTES} -- ${q}; else echo "__NOFILE__" 1>&2; fi`
    const res = await runOnHost(event, hostId, cmd)
    if (res.status === 'error') return { ok: false, stdout: '', stderr: '', error: res.error }
    if (res.stderr.includes('__NOFILE__'))
      return { ok: false, stdout: '', stderr: '', error: `Không tìm thấy file (hoặc không phải file thường): ${p}` }
    if ((res.code ?? 0) !== 0 && !res.stdout)
      return { ok: false, stdout: '', stderr: res.stderr, error: res.stderr.trim() || 'Không đọc được file' }
    return { ok: true, stdout: res.stdout, stderr: res.stderr }
  })
}
