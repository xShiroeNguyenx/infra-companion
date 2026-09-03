import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  applySecurityNames,
  detectManagerCommand,
  dfCommand,
  duCommand,
  execOnce,
  parseSecurityNames,
  securityListCommand,
  parseDf,
  parseDu,
  parseManager,
  parseUpdates,
  readCrontabCommand,
  sudoDenied,
  updatesCommand,
  writeCrontabCommand,
  writeSucceeded,
  type CronScope
} from '@infra/core'
import { IPC, type CronReadResult, type CronWriteResult, type DiskUsageResultDto, type HostUpdatesDto } from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { touchActivity } from './vault'

/** `du` trên cây lớn có thể lâu — nới hơn 30s mặc định của các lệnh chẩn đoán khác. */
const DU_TIMEOUT_MS = 120_000
/** Dò package manager + đọc/ghi crontab: đều là lệnh nhanh, không cần nới. */
const PKG_TIMEOUT_MS = 60_000
/**
 * Liệt kê gói: nới hẳn. Ngay cả với `-C` (chỉ đọc cache), `dnf` trên máy nhiều repo vẫn phải
 * dựng lại sqlite cache trong bộ nhớ và mất hàng chục giây — 60s là quá sát, đã timeout thật.
 */
const PKG_LIST_TIMEOUT_MS = 180_000

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

  ipcMain.handle(IPC.CRON_READ, async (event, hostId: string, scope: CronScope = 'user'): Promise<CronReadResult> => {
    touchActivity()
    try {
      const res = await run(event, hostId, readCrontabCommand(scope), PKG_TIMEOUT_MS)
      // `sudo -n` bị từ chối thì output là câu giải thích của sudo, KHÔNG phải nội dung crontab.
      // Không bắt ca này thì UI hiện "máy này chưa có crontab nào" — sai hẳn.
      if (sudoDenied(res.stdout)) return { ok: false, content: '', error: res.stdout.trim() }
      // stdout rỗng là HỢP LỆ ở đây: phạm vi đó chưa có crontab nào. `; true` đã nuốt mã lỗi
      // của `crontab -l`, nên chỉ coi là hỏng khi execOnce báo lỗi tầng dưới.
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
  ipcMain.handle(
    IPC.CRON_WRITE,
    async (event, hostId: string, content: string, scope: CronScope = 'user'): Promise<CronWriteResult> => {
    touchActivity()
    try {
      const res = await run(event, hostId, writeCrontabCommand(content, scope), PKG_TIMEOUT_MS)
      if (writeSucceeded(res.stdout)) return { ok: true }
      if (sudoDenied(`${res.stdout}\n${res.error ?? ''}`)) return { ok: false, error: res.stdout.trim() || res.error }
      return { ok: false, error: res.error ?? 'crontab từ chối nội dung (kiểm lại cú pháp dòng lịch)' }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(IPC.DIAG_UPDATES, async (event, hostId: string): Promise<HostUpdatesDto> => {
    touchActivity()
    try {
      const detected = await run(event, hostId, detectManagerCommand(), PKG_TIMEOUT_MS)
      const manager = detected.ok ? parseManager(detected.stdout) : 'unknown'
      const command = updatesCommand(manager)
      if (!command) {
        return { hostId, manager: 'unknown', updates: [], error: 'Không nhận ra package manager của máy này' }
      }
      const listed = await run(event, hostId, command, PKG_LIST_TIMEOUT_MS)
      // stdout rỗng ở đây là HỢP LỆ: máy đã vá đủ. Chỉ báo lỗi khi lệnh thật sự hỏng.
      if (!listed.ok && listed.error) return { hostId, manager, updates: [], error: listed.error }
      let updates = parseUpdates(manager, listed.stdout)

      /**
       * Họ RHEL cần hỏi RIÊNG `updateinfo`: tên repo (`baseos`/`appstream`) không nói được gói
       * nào là bản vá bảo mật, nên nếu bỏ bước này thì kết quả ra "435 gói, 0 bảo mật" — sai
       * theo hướng làm người ta yên tâm, đúng loại sai tệ nhất. Thất bại thì bỏ qua, giữ kết
       * quả đã có: thiếu nhãn bảo mật vẫn tốt hơn mất cả danh sách.
       */
      const secCommand = securityListCommand(manager)
      if (secCommand && updates.length > 0) {
        const sec = await run(event, hostId, secCommand, PKG_LIST_TIMEOUT_MS)
        if (sec.stdout.trim() !== '') updates = applySecurityNames(updates, parseSecurityNames(sec.stdout))
      }
      return { hostId, manager, updates }
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
