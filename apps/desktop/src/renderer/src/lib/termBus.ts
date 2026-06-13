/**
 * Định tuyến output terminal từ main process về đúng xterm instance.
 * Chỉ đăng ký MỘT listener IPC toàn cục; dữ liệu đến trước khi terminal mount
 * (giữa create và xterm.open) được buffer lại và flush khi subscribe.
 */
type DataHandler = (data: string) => void

const handlers = new Map<string, DataHandler>()
const pending = new Map<string, string[]>()
let busStarted = false

function ensureBus(): void {
  if (busStarted) return
  busStarted = true
  window.infra.terminal.onData((event) => {
    const handler = handlers.get(event.sessionId)
    if (handler) {
      handler(event.data)
    } else {
      const queue = pending.get(event.sessionId) ?? []
      queue.push(event.data)
      pending.set(event.sessionId, queue)
    }
  })
}

export function subscribeTermData(sessionId: string, handler: DataHandler): () => void {
  ensureBus()
  handlers.set(sessionId, handler)
  const queued = pending.get(sessionId)
  if (queued) {
    pending.delete(sessionId)
    for (const chunk of queued) handler(chunk)
  }
  return () => {
    handlers.delete(sessionId)
  }
}

export function clearTermSession(sessionId: string): void {
  handlers.delete(sessionId)
  pending.delete(sessionId)
  snapshots.delete(sessionId)
}

/**
 * Ảnh chụp buffer xterm (chuỗi serialize) — khôi phục scrollback khi pane bị
 * remount lúc gộp/tách tab (React không reparent được cây con giữa 2 tab).
 */
const snapshots = new Map<string, string>()

export function saveTermSnapshot(sessionId: string, data: string): void {
  snapshots.set(sessionId, data)
}

/** Lấy và xoá snapshot (chỉ dùng 1 lần cho lần mount kế tiếp). */
export function takeTermSnapshot(sessionId: string): string | undefined {
  const snapshot = snapshots.get(sessionId)
  snapshots.delete(sessionId)
  return snapshot
}
