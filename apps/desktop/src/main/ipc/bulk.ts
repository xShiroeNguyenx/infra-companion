import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { BulkService, type BulkTarget } from '@infra/core'
import { IPC, type BulkRunEvent } from '@infra/shared'
import { getVault, touchActivity } from './vault'
import { makeHostKeyVerifier, prepareConnection } from './connection'

/**
 * Bulk exec: chạy 1 lệnh trên nhiều host song song.
 * Dùng credential đã lưu / key / agent; host vào bằng login-script (ssh/su/sudo…) sẽ
 * chạy lệnh trên máy đích bên trong qua lệnh exec lồng nhau trên gate.
 */
export function registerBulkIpc(): void {
  const service = new BulkService()
  const controllers = new Map<string, AbortController>()

  // runId do RENDERER sinh và truyền xuống: event lỗi prepare được emit TRƯỚC khi invoke
  // resolve — nếu main tự sinh runId thì renderer chưa biết id, các event đó bị drop → UI kẹt.
  ipcMain.handle(IPC.BULK_RUN, async (event, runId: string, hostIds: string[], command: string): Promise<string> => {
    touchActivity()
    const id = typeof runId === 'string' && runId ? runId : randomUUID()
    const controller = new AbortController()
    controllers.set(id, controller)
    const sender = event.sender
    const finished = new Set<string>()
    const emit = (e: Omit<BulkRunEvent, 'runId'>): void => {
      if (e.phase === 'done' || e.phase === 'error') finished.add(e.hostId)
      if (!sender.isDestroyed()) sender.send(IPC.BULK_EVENT, { runId: id, ...e })
    }

    // Phân giải kết nối cho từng host (prepareConnection hỏi mật khẩu nếu thiếu)
    const targets: BulkTarget[] = []
    for (const hostId of hostIds) {
      const host = getVault().getHost(hostId)
      if (!host) {
        emit({ hostId, phase: 'error', error: 'Host không tồn tại' })
        continue
      }
      if (host.protocol !== 'ssh') {
        emit({ hostId, phase: 'error', error: 'Bulk chỉ hỗ trợ host SSH' })
        continue
      }
      try {
        const prepared = await prepareConnection(sender, hostId)
        // Host vào bằng login-script → chạy lệnh xuyên qua tới máy đích bên trong
        targets.push({ hostId, label: prepared.title, chain: prepared.chain, loginSteps: prepared.loginSteps })
      } catch (error) {
        emit({ hostId, phase: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    }

    // Chạy nền — trả runId ngay, kết quả stream qua event
    void service
      .run(
        targets,
        command,
        makeHostKeyVerifier(sender),
        (hostId) => emit({ hostId, phase: 'running' }),
        (result) =>
          emit({
            hostId: result.hostId,
            phase: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
            code: result.code,
            error: result.error,
            durationMs: result.durationMs
          }),
        { concurrency: 8, timeoutMs: 120_000, signal: controller.signal }
      )
      .then(() => {
        // Bị hủy: host còn xếp hàng chưa chạy sẽ không có event nào → chốt sổ cho UI
        if (controller.signal.aborted) {
          for (const hostId of hostIds) {
            if (!finished.has(hostId)) emit({ hostId, phase: 'error', error: 'Đã hủy' })
          }
        }
      })
      .catch(() => {
        // lỗi tổng thể hiếm — từng host đã có event riêng
      })
      .finally(() => {
        controllers.delete(id)
      })

    return id
  })

  ipcMain.handle(IPC.BULK_CANCEL, (_event, runId: string): void => {
    controllers.get(runId)?.abort()
  })
}
