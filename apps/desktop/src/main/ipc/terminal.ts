import { shell, ipcMain, type WebContents } from 'electron'
import { SessionManager, listSerialPorts } from '@infra/core'
import {
  IPC,
  type RecordingInfoDto,
  type SessionLogState,
  type SessionRecordState,
  type TerminalCreateRequest,
  type TerminalCreateResponse
} from '@infra/shared'
import { askRenderer } from './prompts'
import { getVault, touchActivity } from './vault'
import { loadShells } from './data'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { sessionLogger } from './sessionLog'
import { recorder } from './recording'

/**
 * Nối SessionManager với IPC. Output stream về đúng WebContents đã tạo phiên.
 * Trả về hàm dispose gọi khi app quit.
 */
export function registerTerminalIpc(): () => void {
  const manager = new SessionManager()
  const owners = new Map<string, WebContents>()
  /** sessionId → thông tin để ghi history khi kết nối thành công lần đầu */
  const pendingHistory = new Map<string, { target: string; hostId: string | null }>()
  /** sessionId → kích thước terminal hiện tại (cho header asciicast khi ghi hình) */
  const dims = new Map<string, { cols: number; rows: number }>()

  const killSessionsOf = (sender: WebContents): void => {
    for (const [sessionId, owner] of [...owners]) {
      if (owner !== sender) continue
      sessionLogger.stop(sessionId)
      recorder.stop(sessionId)
      dims.delete(sessionId)
      manager.kill(sessionId)
      owners.delete(sessionId)
      pendingHistory.delete(sessionId)
    }
  }

  // Renderer reload (mất hết sessionId) hoặc đóng cửa sổ không quit app:
  // không dọn thì PTY/SSH + write stream log/.cast chạy mồ côi tới khi thoát app
  const watchedSenders = new WeakSet<WebContents>()
  const watchSender = (sender: WebContents): void => {
    if (watchedSenders.has(sender)) return
    watchedSenders.add(sender)
    sender.once('destroyed', () => killSessionsOf(sender))
    sender.on('did-navigate', () => killSessionsOf(sender))
  }

  manager.on('data', (sessionId, data) => {
    sessionLogger.append(sessionId, data) // tee ra file log (text thuần) nếu đang bật
    recorder.append(sessionId, data) // tee ra .cast (raw + thời gian) nếu đang ghi hình
    const owner = owners.get(sessionId)
    if (owner && !owner.isDestroyed()) owner.send(IPC.TERM_DATA, { sessionId, data })
  })

  manager.on('exit', (sessionId, exitCode, reason) => {
    sessionLogger.stop(sessionId)
    recorder.stop(sessionId)
    dims.delete(sessionId)
    const owner = owners.get(sessionId)
    owners.delete(sessionId)
    pendingHistory.delete(sessionId)
    if (owner && !owner.isDestroyed()) owner.send(IPC.TERM_EXIT, { sessionId, exitCode, reason })
  })

  manager.on('status', (sessionId, status, detail) => {
    const owner = owners.get(sessionId)
    if (owner && !owner.isDestroyed()) owner.send(IPC.TERM_STATUS, { sessionId, status, detail })
    if (status === 'connected') {
      const entry = pendingHistory.get(sessionId)
      if (entry) {
        pendingHistory.delete(sessionId)
        try {
          getVault().addHistory(entry.target, entry.hostId)
          if (entry.hostId) getVault().touchHostConnected(entry.hostId)
        } catch {
          // vault vừa bị khoá — bỏ qua, không chặn phiên
        }
      }
    }
  })

  ipcMain.handle(
    IPC.TERM_CREATE,
    async (event, req: TerminalCreateRequest): Promise<TerminalCreateResponse> => {
      touchActivity()

      if (req.kind === 'local') {
        const shells = await loadShells()
        const profile = shells.find((s) => s.id === req.profileId) ?? shells[0]
        if (!profile) throw new Error('Không tìm thấy shell nào trên máy')
        const sessionId = manager.createLocal(profile, req.cols, req.rows, req.cwd)
        owners.set(sessionId, event.sender)
        watchSender(event.sender)
        return { sessionId, kind: 'local', title: profile.label }
      }

      // ---- Saved host: protocol quyết định ssh/telnet/serial ----
      const verifyHostKey = makeHostKeyVerifier(event.sender)

      if (req.hostId) {
        const host = getVault().getHost(req.hostId)
        if (!host) throw new Error('Host không tồn tại')

        if (host.protocol === 'telnet') {
          const sessionId = manager.createTelnet(host.hostname, host.port || 23, req.cols, req.rows)
          owners.set(sessionId, event.sender)
          watchSender(event.sender)
          pendingHistory.set(sessionId, { target: `telnet://${host.hostname}:${host.port || 23}`, hostId: host.id })
          return { sessionId, kind: 'telnet', title: host.label, subtitle: `telnet ${host.hostname}:${host.port || 23}` }
        }

        if (host.protocol === 'serial') {
          const sessionId = manager.createSerial(host.hostname, host.port || 9600, req.cols, req.rows)
          owners.set(sessionId, event.sender)
          watchSender(event.sender)
          pendingHistory.set(sessionId, { target: `serial:${host.hostname}@${host.port || 9600}`, hostId: host.id })
          return { sessionId, kind: 'serial', title: host.label, subtitle: `${host.hostname} @ ${host.port || 9600} baud` }
        }

        const prepared = await prepareConnection(event.sender, req.hostId)
        const sessionId = manager.createSsh(
          {
            chain: prepared.chain,
            env: prepared.env,
            startupScript: prepared.startupScript,
            agentForward: prepared.agentForward,
            loginSteps: prepared.loginSteps,
            verifyHostKey
          },
          req.cols,
          req.rows
        )
        owners.set(sessionId, event.sender)
        watchSender(event.sender)
        pendingHistory.set(sessionId, { target: prepared.historyTarget, hostId: req.hostId })
        return { sessionId, kind: 'ssh', title: prepared.title, subtitle: prepared.subtitle }
      }

      if (req.quickTarget) {
        const parsed = parseQuickTarget(req.quickTarget)
        if (!parsed) throw new Error('Định dạng không hợp lệ — dùng user@host hoặc user@host:port')
        const password = await askRenderer<string | null>(event.sender, IPC.PROMPT_PASSWORD, {
          target: `${parsed.username}@${parsed.host}`
        })
        if (!password) throw new Error('Đã huỷ kết nối')
        const sessionId = manager.createSsh(
          { chain: [{ ...parsed, password }], verifyHostKey },
          req.cols,
          req.rows
        )
        owners.set(sessionId, event.sender)
        watchSender(event.sender)
        pendingHistory.set(sessionId, { target: `${parsed.username}@${parsed.host}:${parsed.port}`, hostId: null })
        return {
          sessionId,
          kind: 'ssh',
          title: `${parsed.username}@${parsed.host}`,
          subtitle: `${parsed.username}@${parsed.host}:${parsed.port}`
        }
      }

      throw new Error('Thiếu hostId hoặc quickTarget')
    }
  )

  ipcMain.on(IPC.TERM_WRITE, (_event, sessionId: string, data: string) => {
    manager.write(sessionId, data)
  })

  ipcMain.on(IPC.TERM_RESIZE, (_event, sessionId: string, cols: number, rows: number) => {
    dims.set(sessionId, { cols, rows })
    manager.resize(sessionId, cols, rows)
  })

  ipcMain.on(IPC.TERM_KILL, (_event, sessionId: string) => {
    sessionLogger.stop(sessionId)
    recorder.stop(sessionId)
    dims.delete(sessionId)
    manager.kill(sessionId)
    owners.delete(sessionId)
  })

  ipcMain.handle(IPC.TERM_LOG_TOGGLE, (_event, sessionId: string, title: string): SessionLogState => {
    return sessionLogger.toggle(sessionId, title)
  })

  ipcMain.on(IPC.TERM_LOG_OPEN_FOLDER, () => {
    void shell.openPath(sessionLogger.logDir())
  })

  ipcMain.handle(IPC.TERM_RECORD_TOGGLE, (_event, sessionId: string, title: string): SessionRecordState => {
    const d = dims.get(sessionId) ?? { cols: 80, rows: 24 }
    return recorder.toggle(sessionId, title, d.cols, d.rows)
  })

  ipcMain.handle(IPC.REC_LIST, (): RecordingInfoDto[] => recorder.list())
  ipcMain.handle(IPC.REC_READ, (_e, name: string) => recorder.read(name))
  ipcMain.handle(IPC.REC_DELETE, (_e, name: string) => recorder.delete(name))
  ipcMain.on(IPC.REC_OPEN_FOLDER, () => {
    void shell.openPath(recorder.dir())
  })

  ipcMain.handle(IPC.SERIAL_LIST, () => listSerialPorts())

  return () => {
    sessionLogger.stopAll()
    recorder.stopAll()
    manager.disposeAll()
    owners.clear()
  }
}

export function parseQuickTarget(
  input: string
): { username: string; host: string; port: number } | null {
  const match = /^([^@\s]+)@(\[[0-9a-fA-F:]+\]|[^:\s]+)(?::(\d{1,5}))?$/.exec(input.trim())
  if (!match) return null
  const port = match[3] ? Number(match[3]) : 22
  if (port < 1 || port > 65_535) return null
  return { username: match[1]!, host: match[2]!.replace(/^\[|\]$/g, ''), port }
}
