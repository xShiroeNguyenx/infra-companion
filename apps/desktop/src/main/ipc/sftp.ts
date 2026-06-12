import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { SftpService, deriveSshArgsFromLoginSteps } from '@infra/core'
import { IPC, type FileEntryDto, type SftpOpenResponse } from '@infra/shared'
import { getVault, touchActivity } from './vault'
import { makeHostKeyVerifier, prepareConnection } from './connection'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** SFTP + thao tác file system local cho pane trái. Trả về hàm dispose. */
export function registerSftpIpc(): () => void {
  const service = new SftpService()
  /** sessionId → các file local đang được watch cho edit-with-editor */
  const editWatchers = new Map<string, string[]>()

  service.on('transfer', (event) => broadcast(IPC.TRANSFER_EVENT, event))
  service.on('closed', (sessionId) => {
    stopWatchers(sessionId)
    broadcast(IPC.TERM_EXIT, { sessionId, exitCode: null, reason: 'Phiên SFTP đã đóng' })
  })

  function stopWatchers(sessionId: string): void {
    for (const file of editWatchers.get(sessionId) ?? []) {
      fs.unwatchFile(file)
    }
    editWatchers.delete(sessionId)
  }

  ipcMain.handle(IPC.SFTP_OPEN, async (event, hostId: string): Promise<SftpOpenResponse> => {
    touchActivity()
    const host = getVault().getHost(hostId)
    if (!host) throw new Error('Host không tồn tại')
    const prepared = await prepareConnection(event.sender, hostId)
    // Host dùng login script kiểu "ssh <đích>" → SFTP đi qua exec `ssh -s sftp` trên gate
    const viaSshArgs = deriveSshArgsFromLoginSteps(prepared.loginSteps) ?? undefined
    const { sessionId, home } = await service.open(
      prepared.chain,
      makeHostKeyVerifier(event.sender),
      viaSshArgs
    )
    return { sessionId, title: `SFTP — ${prepared.title}`, home }
  })

  ipcMain.on(IPC.SFTP_CLOSE, (_event, sessionId: string) => {
    stopWatchers(sessionId)
    service.close(sessionId)
  })

  ipcMain.handle(IPC.SFTP_LIST, (_event, sessionId: string, remotePath: string) => {
    touchActivity()
    return service.list(sessionId, remotePath)
  })

  ipcMain.handle(IPC.SFTP_HOME, (_event, sessionId: string) => service.realpath(sessionId, '.'))

  ipcMain.handle(IPC.SFTP_MKDIR, (_event, sessionId: string, remotePath: string) =>
    service.mkdir(sessionId, remotePath)
  )

  ipcMain.handle(IPC.SFTP_RENAME, (_event, sessionId: string, from: string, to: string) =>
    service.rename(sessionId, from, to)
  )

  ipcMain.handle(IPC.SFTP_DELETE, (_event, sessionId: string, remotePath: string, isDir: boolean) =>
    service.delete(sessionId, remotePath, isDir)
  )

  ipcMain.handle(IPC.SFTP_CHMOD, (_event, sessionId: string, remotePath: string, mode: string) =>
    service.chmod(sessionId, remotePath, mode)
  )

  ipcMain.handle(IPC.SFTP_DOWNLOAD, (_event, sessionId: string, remotePath: string, localDir: string) => {
    touchActivity()
    return service.download(sessionId, remotePath, localDir)
  })

  ipcMain.handle(IPC.SFTP_UPLOAD, (_event, sessionId: string, localPath: string, remoteDir: string) => {
    touchActivity()
    return service.upload(sessionId, localPath, remoteDir)
  })

  // Edit-with-local-editor: tải về temp, mở bằng app mặc định, tự upload khi file đổi
  ipcMain.handle(IPC.SFTP_EDIT, async (_event, sessionId: string, remotePath: string) => {
    touchActivity()
    const rawName = remotePath.split('/').pop() ?? 'file'
    // ".." hoặc "\" trong tên có thể trỏ localFile ra ngoài thư mục temp
    const fileName = rawName === '.' || rawName === '..' || rawName.includes('\\') || rawName === '' ? 'file' : rawName
    const localFile = path.join(app.getPath('temp'), 'infra-companion-edit', sessionId, fileName)
    const watched = editWatchers.get(sessionId) ?? []
    const alreadyWatched = watched.includes(localFile)
    await service.downloadFileTo(sessionId, remotePath, localFile)
    const openError = await shell.openPath(localFile)
    if (openError) throw new Error(`Không mở được editor: ${openError}`)
    if (alreadyWatched) return // edit lần 2 cùng file — watcher đã có, không đăng ký trùng
    fs.watchFile(localFile, { interval: 1_000 }, (current, previous) => {
      if (current.mtimeMs === previous.mtimeMs) return
      void service.uploadFileTo(sessionId, localFile, remotePath).catch(() => {
        // lỗi upload đã được báo qua transfer event (status=error)
      })
    })
    watched.push(localFile)
    editWatchers.set(sessionId, watched)
  })

  // ---- File system local (pane trái) ----

  ipcMain.handle(IPC.FS_ROOTS, async (): Promise<string[]> => {
    if (process.platform !== 'win32') return ['/']
    const roots: string[] = []
    for (let code = 65; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:\\`
      if (fs.existsSync(drive)) roots.push(drive)
    }
    return roots
  })

  ipcMain.handle(IPC.FS_HOME, () => os.homedir())

  ipcMain.handle(IPC.FS_LIST, async (_event, dirPath: string): Promise<FileEntryDto[]> => {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    const result: FileEntryDto[] = []
    for (const entry of entries) {
      let size = 0
      let mtimeMs = 0
      try {
        const stat = await fsp.stat(path.join(dirPath, entry.name))
        size = stat.size
        mtimeMs = stat.mtimeMs
      } catch {
        // file hệ thống không stat được — vẫn hiển thị
      }
      result.push({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'symlink' : entry.isFile() ? 'file' : 'other',
        size,
        mtimeMs
      })
    }
    return result
  })

  ipcMain.handle(IPC.FS_MKDIR, (_event, dirPath: string) => fsp.mkdir(dirPath))

  ipcMain.handle(IPC.FS_RENAME, (_event, from: string, to: string) => fsp.rename(from, to))

  ipcMain.handle(IPC.FS_DELETE, (_event, target: string) => fsp.rm(target, { recursive: true, force: true }))

  return () => {
    for (const sessionId of [...editWatchers.keys()]) stopWatchers(sessionId)
    service.closeAll()
  }
}
