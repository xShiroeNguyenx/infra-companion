import type { Client, ClientChannel, SFTPWrapper } from 'ssh2'
// Deep import: lớp SFTP nội bộ của ssh2 (không export ở entry chính, nhưng package không khoá subpath).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — không có type cho đường dẫn sâu
import sftpProtocol from 'ssh2/lib/protocol/SFTP.js'

const SFTP = (sftpProtocol as { SFTP: SftpCtor }).SFTP

interface SftpCtor {
  new (client: Client, chanInfo: unknown, cfg: unknown): SftpInstance
}

interface SftpInstance {
  _protocol: unknown
  outgoing: { id: number; window: number; packetSize: number; state: string }
  push(data: Buffer | null): void
  _init(): void
  end(): void
  on(event: string, cb: (...args: unknown[]) => void): unknown
  once(event: string, cb: (...args: unknown[]) => void): unknown
  emit(event: string, ...args: unknown[]): boolean
}

/** Quá hạn này mà chưa 'ready' → coi như treo (mạng blackhole), không để UI đứng im vô hạn. */
const OPEN_TIMEOUT_MS = 30_000

/**
 * Mở phiên SFTP tới một máy nội bộ CHỈ vào được khi đứng trên máy trung gian
 * (vd jpapst04 chỉ ssh được từ gate bằng key của gate).
 *
 * Cách làm: trên `client` (đã kết nối tới gate), exec `ssh <target> -s sftp` — tức là
 * mượn ssh client + key của gate để mở subsystem sftp của máy đích, rồi nói chuyện
 * giao thức SFTP xuyên qua kênh exec đó. Đây là cách `sshfs`/`sftp -J` hoạt động.
 *
 * @param sshArgs phần sau chữ "ssh", vd "vn_dev@jpapst04" hoặc "-p 2222 vn_dev@jpapst04"
 */
export function openSftpOverExec(client: Client, sshArgs: string): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    // StrictHostKeyChecking=no: không hỏi yes/no host key (exec không có tty); dùng "no" thay vì
    // "accept-new" vì OpenSSH đời cũ trên gate không hỗ trợ accept-new.
    // BatchMode=yes: nếu máy đích đòi mật khẩu (không dùng key) thì fail nhanh thay vì treo.
    const command = `ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 ${sshArgs} -s sftp`

    client.exec(command, (error, stream: ClientChannel) => {
      if (error) return reject(new Error(`Không chạy được ssh trên máy trung gian: ${error.message}`))

      let stderr = ''
      let settled = false
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      // không có listener 'error' thì write-after-end emit error → uncaught exception sập main process
      stream.on('error', () => {})

      const openTimeout = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          stream.close()
        } catch {
          // đã đóng
        }
        reject(new Error(`SFTP qua máy trung gian không phản hồi sau ${OPEN_TIMEOUT_MS / 1000}s`))
      }, OPEN_TIMEOUT_MS)

      // SFTP instance dùng chung client (để đọc _remoteIdentRaw) nhưng định tuyến I/O qua exec stream
      const chanInfo = {
        type: 'sftp',
        incoming: { id: 0, window: Number.MAX_SAFE_INTEGER, packetSize: 32_768, state: 'open' },
        outgoing: { id: 0, window: Number.MAX_SAFE_INTEGER, packetSize: 32_768, state: 'open' }
      }
      const sftp = new SFTP(client, chanInfo, {})

      // Shim _protocol: chuyển mọi gói SFTP outgoing thẳng vào stdin của exec stream
      sftp._protocol = {
        _remoteIdentRaw: (client as unknown as { _protocol?: { _remoteIdentRaw?: Buffer } })._protocol
          ?._remoteIdentRaw,
        channelData: (_id: number, payload: Buffer) => {
          if (stream.writable) stream.write(payload)
        },
        channelClose: () => {
          try {
            stream.end()
          } catch {
            // đã đóng
          }
        },
        channelWindowAdjust: () => {},
        channelEOF: () => {},
        channelOpenConfirm: () => {},
        channelOpenFail: () => {}
      }

      // stdout của exec = luồng giao thức SFTP từ máy đích → đẩy vào parser
      stream.on('data', (chunk: Buffer) => sftp.push(chunk))
      stream.on('close', () => {
        sftp.push(null)
        if (!settled) {
          settled = true
          clearTimeout(openTimeout)
          reject(new Error(stderr.trim() || 'Kết nối SFTP qua máy trung gian bị đóng'))
          return
        }
        // phiên đã mở mà kênh exec chết (máy đích reboot, gate vẫn sống) →
        // phát 'close' để SftpService dọn session + báo UI, không thành phiên zombie
        sftp.emit('close')
      })

      sftp.once('ready', () => {
        if (settled) return
        settled = true
        clearTimeout(openTimeout)
        resolve(sftp as unknown as SFTPWrapper)
      })
      sftp.once('error', (err: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(openTimeout)
        reject(err instanceof Error ? err : new Error(String(err)))
      })

      sftp._init()
    })
  })
}

/** Lấy đối số ssh từ login script: bước cuối có dạng "ssh …" (không hỗ trợ nếu trước đó có su). */
export function deriveSshArgsFromLoginSteps(
  steps: Array<{ send: string; secret?: boolean }>
): string | null {
  if (steps.length === 0) return null
  // Nếu có bước su/sudo thì sftp-over-exec (1 lệnh, không tty) không tái hiện được → bỏ qua
  if (steps.some((s) => /^\s*(su|sudo)\b/.test(s.send))) return null
  let args: string | null = null
  for (const step of steps) {
    const match = /^\s*ssh\s+(.+)$/.exec(step.send)
    if (match) args = match[1]!.trim()
  }
  return args
}
