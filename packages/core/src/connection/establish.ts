import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { Client } from 'ssh2'
import type { HostKeyVerifier } from './types'

/** Một đầu kết nối trong chuỗi (hop hoặc target). */
export interface ChainEndpoint {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  /** Xác thực qua OS ssh-agent (OpenSSH agent / Pageant). */
  useAgent?: boolean
  label?: string
}

export interface EstablishedChain {
  /** Client của endpoint cuối (target) — dùng để mở shell/sftp/forward. */
  client: Client
  /** Đóng toàn bộ chuỗi (target trước, hops sau). */
  closeAll: () => void
}

/** Đường dẫn OS ssh-agent: named pipe trên Windows, SSH_AUTH_SOCK trên unix. */
export function agentPath(): string | undefined {
  if (process.platform === 'win32') return '\\\\.\\pipe\\openssh-ssh-agent'
  return process.env['SSH_AUTH_SOCK']
}

/**
 * Dựng chuỗi SSH qua các jump host: connect hop1 → forwardOut tới hop2 → … → target
 * (tương đương `ssh -J hop1,hop2 target`). Mỗi hop được xác minh host key riêng.
 */
export async function establishChain(
  endpoints: ChainEndpoint[],
  verifyHostKey: HostKeyVerifier,
  agentForward = false
): Promise<EstablishedChain> {
  if (endpoints.length === 0) throw new Error('Chuỗi kết nối rỗng')
  const clients: Client[] = []
  const closeAll = (): void => {
    for (const client of [...clients].reverse()) {
      try {
        client.end()
      } catch {
        // đã đóng
      }
    }
  }

  try {
    let sock: Duplex | undefined
    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i]!
      const client = new Client()
      clients.push(client)
      await connectOne(client, endpoint, sock, verifyHostKey, agentForward)
      if (i < endpoints.length - 1) {
        const next = endpoints[i + 1]!
        sock = await forwardOut(client, next.host, next.port)
      }
    }
    return { client: clients[clients.length - 1]!, closeAll }
  } catch (error) {
    closeAll()
    throw error
  }
}

function connectOne(
  client: Client,
  endpoint: ChainEndpoint,
  sock: Duplex | undefined,
  verifyHostKey: HostKeyVerifier,
  agentForward: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Persistent handler + settled guard: ssh2 có thể phát NHIỀU 'error' liên tiếp khi auth
    // thất bại (vd "Failed to connect to agent" rồi "All authentication methods failed").
    // Listener once sẽ bỏ sót cái thứ 2 → Node ném uncaught → Electron văng dialog.
    let settled = false
    client.on('error', (error: Error) => {
      if (settled) return // sau khi đã settle: nuốt mọi error còn lại (kể cả lúc rớt mạng)
      settled = true
      reject(decorateError(error, endpoint))
    })
    client.once('ready', () => {
      settled = true
      resolve()
    })
    const useAgent = endpoint.useAgent || agentForward
    client.connect({
      host: endpoint.host,
      port: endpoint.port,
      sock,
      username: endpoint.username,
      password: endpoint.password,
      privateKey: endpoint.privateKey,
      passphrase: endpoint.passphrase,
      agent: useAgent ? agentPath() : undefined,
      agentForward: agentForward && Boolean(agentPath()),
      readyTimeout: 20_000,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
        const info = parseHostKey(key, endpoint.host, endpoint.port)
        verifyHostKey(info)
          .then(verify)
          .catch(() => verify(false))
      }
    })
  })
}

function forwardOut(client: Client, destHost: string, destPort: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, destHost, destPort, (error, stream) => {
      if (error) reject(new Error(`Không mở được tunnel tới ${destHost}:${destPort}: ${error.message}`))
      else resolve(stream)
    })
  })
}

/** Đọc key type từ wire format + tính fingerprint SHA256 (cùng format OpenSSH). */
export function parseHostKey(key: Buffer, host: string, port: number) {
  let keyType = 'unknown'
  if (key.length > 4) {
    const typeLen = key.readUInt32BE(0)
    if (typeLen > 0 && typeLen < 64 && key.length >= 4 + typeLen) {
      keyType = key.subarray(4, 4 + typeLen).toString('ascii')
    }
  }
  const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
  return { host, port, keyType, fingerprint }
}

/**
 * Bọc một lệnh để chạy XUYÊN qua login-script kiểu nested-ssh:
 * trên máy gate, chạy `ssh <sshArgs> '<command>'` → lệnh thực thi trên máy đích bên trong.
 * Dùng cho Bulk exec / Monitoring với host vào bằng `ssh ...` (vd web-01 qua gate).
 */
export function wrapSshCommand(sshArgs: string, command: string): string {
  const quoted = `'${command.replaceAll("'", `'\\''`)}'`
  return `ssh -o StrictHostKeyChecking=no -o BatchMode=yes ${sshArgs} ${quoted}`
}

export function friendlySshError(error: Error & { level?: string }, label?: string): string {
  const message = error.message || String(error)
  const prefix = label ? `[${label}] ` : ''
  if (/connect to agent/i.test(message)) {
    return `${prefix}Không kết nối được SSH agent của hệ điều hành. Nếu không cần agent forwarding, hãy bỏ tích "Agent forwarding" và đổi Xác thực sang Password/Key; hoặc bật dịch vụ "OpenSSH Authentication Agent" trên Windows.`
  }
  if (error.level === 'client-authentication' || /authentication methods failed|authentication/i.test(message)) {
    return `${prefix}Xác thực thất bại — server không chấp nhận username/password/key này. Nếu đây là máy nội bộ chỉ vào được TỪ máy nhảy, hãy dùng Login script (ssh tiếp trong shell) thay vì jump host.`
  }
  if (error.level === 'client-timeout' || /timeout/i.test(message)) {
    return `${prefix}Kết nối timeout — kiểm tra địa chỉ host và firewall`
  }
  if (/ECONNREFUSED/.test(message)) return `${prefix}Bị từ chối kết nối — kiểm tra port và sshd trên server`
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return `${prefix}Không phân giải được hostname`
  if (/Host key/i.test(message) || /verification/i.test(message)) return `${prefix}Host key bị từ chối`
  return prefix + message
}

function decorateError(error: Error & { level?: string }, endpoint: ChainEndpoint): Error {
  const decorated = new Error(friendlySshError(error, endpoint.label ?? `${endpoint.username}@${endpoint.host}`))
  return decorated
}
