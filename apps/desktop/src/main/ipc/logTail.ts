import { randomUUID } from 'node:crypto'
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { execStream, type StreamHandle } from '@infra/core'
import { IPC, tailCommand, type LogTailEvent, type LogTailStartResult } from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { touchActivity } from './vault'

/**
 * Gộp dòng trước khi bắn qua IPC. Một log ồn có thể ra hàng nghìn dòng/giây; mỗi dòng một
 * message là renderer chết chìm trong IPC chứ không phải trong việc vẽ.
 */
const FLUSH_MS = 100

interface Session {
  handle: StreamHandle
  sender: WebContents
  pending: Array<{ text: string; source: 'stdout' | 'stderr' }>
  timer: NodeJS.Timeout | null
}

const sessions = new Map<string, Session>()

function send(id: string, event: LogTailEvent): void {
  const session = sessions.get(id)
  if (!session || session.sender.isDestroyed()) return
  session.sender.send(IPC.LOG_TAIL_EVENT, event)
}

function flush(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  session.timer = null
  if (session.pending.length === 0) return
  const lines = session.pending
  session.pending = []
  send(id, { id, kind: 'lines', lines })
}

/** Đóng phiên: dừng lệnh remote, xả nốt phần còn chờ, quên session. */
function dispose(id: string, reason?: { code: number | null; error?: string }): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.timer) clearTimeout(session.timer)
  flush(id)
  session.handle.stop()
  sessions.delete(id)
  if (reason) send(id, { id, kind: 'closed', code: reason.code, error: reason.error })
}

/**
 * F30 — theo dõi một file log mà không chiếm terminal.
 *
 * ⚠️ Đây là kênh exec CHẠY DÀI đầu tiên của app ngoài phiên terminal và tunnel, nên kỷ luật
 * dọn dẹp là phần quan trọng nhất: mỗi phiên bỏ quên giữ một kết nối SSH mở và để `tail -F`
 * chạy tiếp trên remote. Vì thế dọn ở CẢ BA đường — user bấm dừng, lệnh tự thoát, và cửa sổ
 * renderer bị đóng (`destroyed`, không có sự kiện nào từ phía UI cả).
 */
export function registerLogTailIpc(): void {
  ipcMain.handle(
    IPC.LOG_TAIL_START,
    async (event: IpcMainInvokeEvent, hostId: string, path: string): Promise<LogTailStartResult> => {
      touchActivity()
      try {
        const prepared = await prepareConnection(event.sender, hostId)
        const id = randomUUID()
        const sender = event.sender

        const handle = execStream(prepared.chain, tailCommand(path), makeHostKeyVerifier(sender), {
          loginSteps: prepared.loginSteps,
          onLines: (lines, source) => {
            const session = sessions.get(id)
            if (!session) return
            for (const text of lines) session.pending.push({ text, source })
            session.timer ??= setTimeout(() => flush(id), FLUSH_MS)
          },
          onClose: (info) => dispose(id, info)
        })

        sessions.set(id, { handle, sender, pending: [], timer: null })

        // Cửa sổ đóng thì KHÔNG có sự kiện nào từ UI báo dừng — phải tự dọn ở đây
        sender.once('destroyed', () => dispose(id))

        return { ok: true, id }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(IPC.LOG_TAIL_STOP, (_e, id: string): void => {
    dispose(id, { code: null })
  })
}

/** Dừng mọi phiên tail — gọi lúc thoát app. */
export function disposeLogTails(): void {
  for (const id of [...sessions.keys()]) dispose(id)
}
