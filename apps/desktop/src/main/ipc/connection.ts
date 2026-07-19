import type { WebContents } from 'electron'
import { resolveSecret, type ChainEndpoint, type HostKeyInfo } from '@infra/core'
import type { ResolvedEndpoint } from '@infra/core'
import { IPC, type LoginStep } from '@infra/shared'
import { askRenderer } from './prompts'
import { getVault } from './vault'

/** Phân giải 1 endpoint (đã resolve từ vault) thành ChainEndpoint — hỏi password nếu thiếu. */
async function toChainEndpoint(sender: WebContents, endpoint: ResolvedEndpoint): Promise<ChainEndpoint> {
  let password = endpoint.password
  if (endpoint.secretRef) {
    // F11: lấy password từ secret manager (op/bw/vault) đúng lúc kết nối
    password = await resolveSecret(endpoint.secretRef)
  } else if (endpoint.needsPassword) {
    const answer = await askRenderer<string | null>(sender, IPC.PROMPT_PASSWORD, {
      target: `${endpoint.username}@${endpoint.host}`
    })
    if (!answer) throw new Error('Đã huỷ kết nối')
    password = answer
  }
  return {
    host: endpoint.host,
    port: endpoint.port,
    username: endpoint.username,
    password,
    privateKey: endpoint.privateKey,
    passphrase: endpoint.passphrase,
    useAgent: endpoint.authType === 'agent',
    label: endpoint.label
  }
}

/** Xác minh host key theo TOFU với bảng known_hosts; hỏi user khi lạ/mismatch. */
export function makeHostKeyVerifier(sender: WebContents) {
  return async (info: HostKeyInfo): Promise<boolean> => {
    const vault = getVault()
    const known = vault.findKnownHost(info.host, info.port, info.keyType)
    if (known && known.fingerprintSha256 === info.fingerprint) {
      vault.touchKnownHost(info.host, info.port, info.keyType)
      return true
    }
    const accepted = await askRenderer<boolean>(sender, IPC.PROMPT_HOSTKEY, {
      host: info.host,
      port: info.port,
      keyType: info.keyType,
      fingerprint: info.fingerprint,
      kind: known ? 'mismatch' : 'unknown',
      knownFingerprint: known?.fingerprintSha256
    })
    if (accepted === true) {
      vault.storeKnownHost(info.host, info.port, info.keyType, info.fingerprint)
      return true
    }
    return false
  }
}

export interface PreparedConnection {
  /** [hop1, …, target] — password thiếu đã được hỏi user. */
  chain: ChainEndpoint[]
  env: Record<string, string>
  startupScript?: string
  agentForward: boolean
  /** Bật tmux auto-attach-or-create sau login (resume khi rớt mạng). */
  tmux: boolean
  /** Login script với secret đầy đủ (đã hỏi user nếu chưa lưu). */
  loginSteps: LoginStep[]
  /** F41: TOTP seed — SshSession thay token {{totp}} trong login script bằng mã tươi lúc gửi. */
  totpSecret?: string
  title: string
  subtitle: string
  historyTarget: string
}

/**
 * Phân giải host (inheritance + jump chain + secrets); endpoint nào thiếu password
 * thì hỏi user qua modal — theo đúng thứ tự hop trước, target sau.
 */
export async function prepareConnection(sender: WebContents, hostId: string): Promise<PreparedConnection> {
  const vault = getVault()
  const resolved = vault.resolveConnection(hostId)
  const endpoints = [...resolved.hops, resolved.target]
  const chain: ChainEndpoint[] = []
  for (const endpoint of endpoints) {
    chain.push(await toChainEndpoint(sender, endpoint))
  }
  // Bước secret chưa lưu giá trị → hỏi user trước khi kết nối
  const loginSteps: LoginStep[] = []
  for (const [index, step] of resolved.loginSteps.entries()) {
    if (step.secret && !step.send) {
      const answer = await askRenderer<string | null>(sender, IPC.PROMPT_PASSWORD, {
        target: `login script — bước ${index + 1} (${step.expect || 'mật khẩu'})`
      })
      if (!answer) throw new Error('Đã huỷ kết nối')
      loginSteps.push({ ...step, send: answer })
    } else {
      loginSteps.push(step)
    }
  }

  const target = resolved.target
  return {
    chain,
    env: resolved.env,
    startupScript: resolved.startupScript,
    agentForward: resolved.agentForward,
    tmux: resolved.tmux,
    loginSteps,
    totpSecret: resolved.totpSecret,
    title: target.label,
    subtitle: `${target.username}@${target.host}:${target.port}`,
    historyTarget: `${target.username}@${target.host}:${target.port}`
  }
}

export interface PreparedForward {
  /** Chuỗi SSH jump host để xuyên tới đích (rỗng = nối thẳng, đích cùng mạng). */
  jumps: ChainEndpoint[]
  /** Máy đích (VNC/RDP) — KHÔNG phải endpoint SSH, chỉ là host:port để forwardOut/net.connect. */
  destHost: string
  destPort: number
  label: string
  /** Username (nếu có) — RDP điền sẵn vào file .rdp. */
  user: string
}

/**
 * Chuẩn bị tunnel tới cổng VNC/RDP của host (F13). Khác prepareConnection: máy ĐÍCH không
 * phải SSH — chỉ resolve jump chain (các hop SSH) rồi trả host:port đích để forwardOut.
 */
export async function prepareForward(sender: WebContents, hostId: string): Promise<PreparedForward> {
  const vault = getVault()
  const resolved = vault.resolveConnection(hostId)
  const jumps: ChainEndpoint[] = []
  for (const hop of resolved.hops) {
    jumps.push(await toChainEndpoint(sender, hop))
  }
  return {
    jumps,
    destHost: resolved.target.host,
    destPort: resolved.target.port,
    label: resolved.target.label,
    user: resolved.target.username
  }
}
