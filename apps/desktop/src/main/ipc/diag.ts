import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  detectManagerCommand,
  dfCommand,
  duCommand,
  execOnce,
  parseDf,
  parseDu,
  parseManager,
  parseUpdates,
  readCrontabCommand,
  updatesCommand,
  writeCrontabCommand,
  writeSucceeded
} from '@infra/core'
import { IPC, type CronReadResult, type CronWriteResult, type DiskUsageResultDto, type HostUpdatesDto } from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { touchActivity } from './vault'

/** `du` trên cây lớn có thể lâu — nới hơn 30s mặc định của các lệnh chẩn đoán khác. */
const DU_TIMEOUT_MS = 120_000
const PKG_TIMEOUT_MS = 60_000

/**
 * F36/F37 — chẩn đoán CHỈ ĐỌC trên host: đĩa đầy ở đâu, máy nào cần vá gì.
 *
 * Không có đường nào ở đây sửa gì trên máy remote: `du`/`df` chỉ đọc, và lệnh liệt kê gói cố ý
 * KHÔNG chạy `apt update` (cần root, ghi vào máy) — xem `packageUpdates.ts`.
 */
export function registerDiagIpc(): void {
  const run = async (
    event: IpcMainInvokeEvent,
    hostId: string,
    command: string,
    timeoutMs: number
  ): Promise<{ ok: boolean; stdout: string; error?: string }> => {
    const prepared = await prepareConnection(event.sender, hostId)
    const res = await execOnce(prepared.chain, command, makeHostKeyVerifier(event.sender), {
      loginSteps: prepared.loginSteps,
      timeoutMs
    })
    return {
      // `du`/`df` trả code khác 0 khi có thư mục không đọc được, nhưng phần đọc được vẫn dùng
      // được — nên chỉ coi là hỏng khi KHÔNG có stdout nào.
      ok: res.status === 'done' && res.stdout.trim() !== '',
      stdout: res.stdout,
      error: res.stderr.trim() || res.error
    }
  }

  ipcMain.handle(IPC.DIAG_DISK, async (event, hostId: string, path: string): Promise<DiskUsageResultDto> => {
    touchActivity()
    try {
      const [du, df] = await Promise.all([
        run(event, hostId, duCommand(path), DU_TIMEOUT_MS),
        run(event, hostId, dfCommand(), DU_TIMEOUT_MS)
      ])
      if (!du.ok) {
        return { ok: false, usage: null, filesystems: [], error: du.error ?? `Không đọc được ${path}` }
      }
      return {
        ok: true,
        usage: parseDu(du.stdout, path),
        filesystems: df.ok ? parseDf(df.stdout) : []
      }
    } catch (error) {
      return { ok: false, usage: null, filesystems: [], error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.CRON_READ, async (event, hostId: string): Promise<CronReadResult> => {
    touchActivity()
    try {
      const res = await run(event, hostId, readCrontabCommand(), PKG_TIMEOUT_MS)
      // stdout rỗng là HỢP LỆ ở đây: máy chưa có crontab nào. `; true` đã nuốt mã lỗi của
      // `crontab -l`, nên chỉ coi là hỏng khi execOnce báo lỗi tầng dưới.
      return { ok: true, content: res.stdout }
    } catch (error) {
      return { ok: false, content: '', error: error instanceof Error ? error.message : String(error) }
    }
  })

  /**
   * ⚠️ Đây là đường GHI VÀO PRODUCTION duy nhất trong file này. Renderer phải xác nhận trước
   * khi gọi; ở đây chỉ lo chạy đúng và **kiểm chứng bằng marker** chứ không tin exit code —
   * `rm -f` ở cuối chuỗi lệnh che mất mã lỗi của `crontab`.
   */
  ipcMain.handle(IPC.CRON_WRITE, async (event, hostId: string, content: string): Promise<CronWriteResult> => {
    touchActivity()
    try {
      const res = await run(event, hostId, writeCrontabCommand(content), PKG_TIMEOUT_MS)
      if (writeSucceeded(res.stdout)) return { ok: true }
      return { ok: false, error: res.error ?? 'crontab từ chối nội dung (kiểm lại cú pháp dòng lịch)' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.DIAG_UPDATES, async (event, hostId: string): Promise<HostUpdatesDto> => {
    touchActivity()
    try {
      const detected = await run(event, hostId, detectManagerCommand(), PKG_TIMEOUT_MS)
      const manager = detected.ok ? parseManager(detected.stdout) : 'unknown'
      const command = updatesCommand(manager)
      if (!command) {
        return { hostId, manager: 'unknown', updates: [], error: 'Không nhận ra package manager của máy này' }
      }
      const listed = await run(event, hostId, command, PKG_TIMEOUT_MS)
      // stdout rỗng ở đây là HỢP LỆ: máy đã vá đủ. Chỉ báo lỗi khi lệnh thật sự hỏng.
      if (!listed.ok && listed.error) return { hostId, manager, updates: [], error: listed.error }
      return { hostId, manager, updates: parseUpdates(manager, listed.stdout) }
    } catch (error) {
      return {
        hostId,
        manager: 'unknown',
        updates: [],
        error: error instanceof Error ? error.message : String(error)
      }
    }
  })
}
