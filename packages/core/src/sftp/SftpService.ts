import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import type { Client, SFTPWrapper } from 'ssh2'
import type { FileEntryDto, TransferEvent } from '@infra/shared'
import { establishChain, type ChainEndpoint } from '../connection/establish'
import type { HostKeyVerifier } from '../connection/types'
import { openSftpOverExec } from './sftpOverExec'

export interface SftpServiceEvents {
  transfer: [TransferEvent]
  closed: [sessionId: string]
}

interface SftpSession {
  id: string
  client: Client
  sftp: SFTPWrapper
  closeChain: () => void
}

/** Quản lý các phiên SFTP (mỗi phiên 1 kết nối SSH riêng, đi qua jump chain nếu có). */
export class SftpService extends EventEmitter<SftpServiceEvents> {
  private readonly sessions = new Map<string, SftpSession>()

  /**
   * @param viaExecCommand nếu có: mở SFTP của máy nội bộ bằng cách exec lệnh này (build bởi
   *   deriveSftpExecFromLoginSteps, vd `ssh <opts> <đích> -s sftp`) trên máy cuối của chain
   *   (gate) — dùng cho host chỉ vào được khi đứng trên gate.
   */
  async open(
    chain: ChainEndpoint[],
    verifyHostKey: HostKeyVerifier,
    viaExecCommand?: string
  ): Promise<{ sessionId: string; home: string }> {
    const { client, closeAll } = await establishChain(chain, verifyHostKey)
    const id = randomUUID()
    try {
      const sftp = viaExecCommand
        ? await openSftpOverExec(client, viaExecCommand)
        : await new Promise<SFTPWrapper>((resolve, reject) => {
            client.sftp((error, wrapper) => (error ? reject(error) : resolve(wrapper)))
          })
      const session: SftpSession = { id, client, sftp, closeChain: closeAll }
      this.sessions.set(id, session)
      const cleanup = (): void => {
        if (this.sessions.delete(id)) this.emit('closed', id)
      }
      client.on('close', cleanup)
      // kênh SFTP chết riêng (viaExecCommand: ssh nội bộ đứt nhưng gate còn sống) → vẫn phải dọn session
      sftp.on('close', cleanup)
      const home = await this.realpath(id, '.')
      return { sessionId: id, home }
    } catch (error) {
      // mở SFTP/realpath fail sau khi chain đã nối — phải đóng chain, không thì leak kết nối
      this.sessions.delete(id)
      closeAll()
      throw error
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    session.closeChain()
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }

  realpath(sessionId: string, remotePath: string): Promise<string> {
    const { sftp } = this.require(sessionId)
    return new Promise((resolve, reject) => {
      sftp.realpath(remotePath, (error, resolved) => (error ? reject(error) : resolve(resolved)))
    })
  }

  list(sessionId: string, remotePath: string): Promise<FileEntryDto[]> {
    const { sftp } = this.require(sessionId)
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (error, entries) => {
        if (error) return reject(error)
        resolve(
          entries
            // OpenSSH trả cả "." và ".." — phải loại, không thì delete/download đệ quy leo lên thư mục cha
            .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
            .map((entry) => {
              const mode = entry.attrs.mode ?? 0
              return {
                name: entry.filename,
                kind: kindFromMode(mode),
                size: entry.attrs.size ?? 0,
                mtimeMs: (entry.attrs.mtime ?? 0) * 1000,
                mode: (mode & 0o7777).toString(8).padStart(3, '0')
              }
            })
        )
      })
    })
  }

  mkdir(sessionId: string, remotePath: string): Promise<void> {
    const { sftp } = this.require(sessionId)
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (error) => (error ? reject(error) : resolve()))
    })
  }

  rename(sessionId: string, from: string, to: string): Promise<void> {
    const { sftp } = this.require(sessionId)
    return new Promise((resolve, reject) => {
      sftp.rename(from, to, (error) => (error ? reject(error) : resolve()))
    })
  }

  chmod(sessionId: string, remotePath: string, mode: string): Promise<void> {
    const { sftp } = this.require(sessionId)
    // parseInt('79', 8) trả 7 chứ không NaN — phải validate cả chuỗi
    if (!/^[0-7]{3,4}$/.test(mode.trim())) return Promise.reject(new Error('Mode phải là số octal, vd 755'))
    const parsed = Number.parseInt(mode.trim(), 8)
    return new Promise((resolve, reject) => {
      sftp.chmod(remotePath, parsed, (error) => (error ? reject(error) : resolve()))
    })
  }

  async delete(sessionId: string, remotePath: string, isDir: boolean): Promise<void> {
    const { sftp } = this.require(sessionId)
    if (!isDir) {
      return new Promise((resolve, reject) => {
        sftp.unlink(remotePath, (error) => (error ? reject(error) : resolve()))
      })
    }
    // Xoá đệ quy thư mục
    const entries = await this.list(sessionId, remotePath)
    for (const entry of entries) {
      await this.delete(sessionId, joinRemote(remotePath, entry.name), entry.kind === 'dir')
    }
    return new Promise((resolve, reject) => {
      sftp.rmdir(remotePath, (error) => (error ? reject(error) : resolve()))
    })
  }

  /** Tải file/thư mục remote → thư mục local. Phát TransferEvent theo tiến độ. */
  async download(sessionId: string, remotePath: string, localDir: string): Promise<void> {
    // Tên file Linux hợp lệ có thể chứa "\" — trên Windows path.join coi đó là separator
    // → server độc có thể ghi file RA NGOÀI thư mục download. Phải chặn trước khi ghi.
    const entryName = safeLocalName(baseName(remotePath))
    const stat = await this.stat(sessionId, remotePath)
    if (stat.kind === 'dir') {
      const localTarget = path.join(localDir, entryName)
      await fsp.mkdir(localTarget, { recursive: true })
      const entries = await this.list(sessionId, remotePath)
      for (const entry of entries) {
        await this.download(sessionId, joinRemote(remotePath, entry.name), localTarget)
      }
      return
    }
    const { sftp } = this.require(sessionId)
    const transferId = randomUUID()
    const label = `${entryName} ← ${remotePath}`
    await this.trackTransfer(transferId, 'download', label, stat.size, (progress) => {
      return new Promise<void>((resolve, reject) => {
        sftp.fastGet(
          remotePath,
          path.join(localDir, entryName),
          { step: (transferred) => progress(transferred) },
          (error) => (error ? reject(error) : resolve())
        )
      })
    })
  }

  /** Đẩy file/thư mục local → thư mục remote. */
  async upload(sessionId: string, localPath: string, remoteDir: string): Promise<void> {
    const entryName = path.basename(localPath)
    const stat = await fsp.stat(localPath)
    const remoteTarget = joinRemote(remoteDir, entryName)
    if (stat.isDirectory()) {
      await this.mkdirIgnoreExists(sessionId, remoteTarget)
      for (const child of await fsp.readdir(localPath)) {
        await this.upload(sessionId, path.join(localPath, child), remoteTarget)
      }
      return
    }
    const { sftp } = this.require(sessionId)
    const transferId = randomUUID()
    const label = `${entryName} → ${remoteDir}`
    await this.trackTransfer(transferId, 'upload', label, stat.size, (progress) => {
      return new Promise<void>((resolve, reject) => {
        sftp.fastPut(localPath, remoteTarget, { step: (transferred) => progress(transferred) }, (error) =>
          error ? reject(error) : resolve()
        )
      })
    })
  }

  /** Upload đè 1 file (dùng cho edit-with-local-editor). */
  async uploadFileTo(sessionId: string, localFile: string, remoteFile: string, kind: TransferEvent['kind'] = 'edit-upload'): Promise<void> {
    const { sftp } = this.require(sessionId)
    const stat = await fsp.stat(localFile)
    const transferId = randomUUID()
    await this.trackTransfer(transferId, kind, `${baseName(remoteFile)} → ${remoteFile}`, stat.size, (progress) => {
      return new Promise<void>((resolve, reject) => {
        sftp.fastPut(localFile, remoteFile, { step: (transferred) => progress(transferred) }, (error) =>
          error ? reject(error) : resolve()
        )
      })
    })
  }

  /** Tải 1 file remote về đúng đường dẫn local chỉ định (dùng cho edit). */
  async downloadFileTo(sessionId: string, remoteFile: string, localFile: string): Promise<void> {
    const { sftp } = this.require(sessionId)
    await fsp.mkdir(path.dirname(localFile), { recursive: true })
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remoteFile, localFile, (error) => (error ? reject(error) : resolve()))
    })
  }

  async stat(sessionId: string, remotePath: string): Promise<{ kind: FileEntryDto['kind']; size: number }> {
    const { sftp } = this.require(sessionId)
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (error, stats) => {
        if (error) return reject(error)
        // sftp.stat đi theo symlink nên isSymbolicLink() không bao giờ true ở đây —
        // giữ stat (không lstat) để download symlink-tới-thư-mục vẫn xử lý như thư mục
        resolve({
          kind: stats.isDirectory() ? 'dir' : 'file',
          size: stats.size ?? 0
        })
      })
    })
  }

  private async mkdirIgnoreExists(sessionId: string, remotePath: string): Promise<void> {
    try {
      await this.mkdir(sessionId, remotePath)
    } catch (error) {
      // chỉ nuốt lỗi khi thư mục đã tồn tại thật — permission denied phải nổi lên rõ ràng
      const existing = await this.stat(sessionId, remotePath).catch(() => null)
      if (!existing || existing.kind !== 'dir') throw error
    }
  }

  private async trackTransfer(
    id: string,
    kind: TransferEvent['kind'],
    label: string,
    total: number,
    run: (progress: (transferred: number) => void) => Promise<void>
  ): Promise<void> {
    let lastEmit = 0
    const emitProgress = (transferred: number, status: TransferEvent['status'], error?: string): void => {
      this.emit('transfer', { id, kind, label, transferred, total, status, error })
    }
    emitProgress(0, 'running')
    try {
      await run((transferred) => {
        const now = Date.now()
        if (now - lastEmit > 100) {
          lastEmit = now
          emitProgress(transferred, 'running')
        }
      })
      emitProgress(total, 'done')
    } catch (error) {
      emitProgress(0, 'error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  private require(sessionId: string): SftpSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Phiên SFTP đã đóng')
    return session
  }
}

function kindFromMode(mode: number): FileEntryDto['kind'] {
  const type = mode & fs.constants.S_IFMT
  if (type === fs.constants.S_IFDIR) return 'dir'
  if (type === fs.constants.S_IFLNK) return 'symlink'
  if (type === fs.constants.S_IFREG) return 'file'
  return 'other'
}

function joinRemote(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

function baseName(remotePath: string): string {
  const idx = remotePath.lastIndexOf('/')
  return idx >= 0 ? remotePath.slice(idx + 1) : remotePath
}

/** Chặn tên remote có thể thoát khỏi thư mục đích khi ghi xuống máy local (Windows coi "\" là separator). */
function safeLocalName(name: string): string {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`Tên file remote không an toàn để ghi xuống máy: "${name}"`)
  }
  return name
}
