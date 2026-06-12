import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { utils as sshUtils } from 'ssh2'
import type { SshConfigImportResult } from '@infra/shared'
import type { VaultService } from '../vault/VaultService'

interface ConfigEntry {
  alias: string
  hostname?: string
  port?: number
  user?: string
  identityFile?: string
  proxyJump?: string
}

/**
 * Import hosts từ file ~/.ssh/config:
 * - Mỗi Host alias (không wildcard) → 1 host trong group "ssh_config".
 * - ProxyJump giữ nguyên thành jump chain (kể cả nhiều bậc "a,b").
 * - IdentityFile được đọc và import vào vault (key có passphrase bị bỏ qua kèm cảnh báo).
 */
export function importSshConfig(vault: VaultService, configContent: string): SshConfigImportResult {
  const entries = parseSshConfig(configContent)
  const warnings: string[] = []

  if (entries.length === 0) {
    return { hostsImported: 0, keysImported: 0, groupName: 'ssh_config', warnings: ['Không tìm thấy Host nào trong file'] }
  }

  const group = vault.saveGroup({ name: `ssh_config (${new Date().toISOString().slice(0, 10)})` })

  // Import keys trước, dedupe theo đường dẫn file và public key đã có trong vault
  const existingPublics = new Map(vault.listKeys().map((k) => [publicCore(k.publicKey), k.id]))
  const keyIdByPath = new Map<string, string>()
  let keysImported = 0
  for (const entry of entries) {
    if (!entry.identityFile || keyIdByPath.has(entry.identityFile)) continue
    const expanded = expandHome(entry.identityFile)
    try {
      const content = fs.readFileSync(expanded, 'utf8')
      const parsed = sshUtils.parseKey(content)
      if (parsed instanceof Error) {
        warnings.push(`Bỏ qua key ${entry.identityFile}: ${parsed.message} (key có passphrase? import thủ công trong mục Keys)`)
        continue
      }
      const core = parsed.getPublicSSH().toString('base64')
      const existing = existingPublics.get(core)
      if (existing) {
        keyIdByPath.set(entry.identityFile, existing)
        continue
      }
      const dto = vault.importKey({ label: path.basename(expanded), privateKey: content })
      keyIdByPath.set(entry.identityFile, dto.id)
      existingPublics.set(core, dto.id)
      keysImported += 1
    } catch (error) {
      warnings.push(`Không đọc được ${entry.identityFile}: ${error instanceof Error ? error.message : error}`)
    }
  }

  // Pass 1: tạo tất cả host alias (chưa gắn jump chain)
  const hostIdByAlias = new Map<string, string>()
  for (const entry of entries) {
    const dto = vault.saveHost({
      groupId: group.id,
      label: entry.alias,
      hostname: entry.hostname ?? entry.alias,
      port: entry.port ?? 22,
      username: entry.user ?? null,
      authType: entry.identityFile && keyIdByPath.has(entry.identityFile) ? 'key' : null,
      keyId: entry.identityFile ? (keyIdByPath.get(entry.identityFile) ?? null) : null
    })
    hostIdByAlias.set(entry.alias, dto.id)
  }

  // Pass 2: gắn jump chain (alias tham chiếu alias khác, hoặc dạng user@host[:port])
  for (const entry of entries) {
    if (!entry.proxyJump) continue
    const chainIds: string[] = []
    for (const hop of entry.proxyJump.split(',').map((s) => s.trim()).filter(Boolean)) {
      const aliasId = hostIdByAlias.get(hop)
      if (aliasId) {
        chainIds.push(aliasId)
        continue
      }
      const parsed = parseJumpRef(hop)
      if (!parsed) {
        warnings.push(`Host "${entry.alias}": không hiểu ProxyJump "${hop}"`)
        continue
      }
      const jumpDto = vault.saveHost({
        groupId: group.id,
        label: hop,
        hostname: parsed.host,
        port: parsed.port,
        username: parsed.user ?? null,
        authType: null
      })
      hostIdByAlias.set(hop, jumpDto.id)
      chainIds.push(jumpDto.id)
    }
    if (chainIds.length > 0) {
      const hostId = hostIdByAlias.get(entry.alias)!
      const current = vault.getHost(hostId)!
      vault.saveHost({
        id: hostId,
        groupId: current.groupId,
        label: current.label,
        hostname: current.hostname,
        port: current.port,
        username: current.username,
        authType: current.authType,
        keyId: current.keyId,
        jumpChain: chainIds
      })
    }
  }

  return { hostsImported: hostIdByAlias.size, keysImported, groupName: group.name, warnings }
}

export function parseSshConfig(content: string): ConfigEntry[] {
  const entries: ConfigEntry[] = []
  let currentAliases: string[] = []
  let currentProps: Omit<ConfigEntry, 'alias'> = {}

  const flush = (): void => {
    for (const alias of currentAliases) {
      // bỏ alias wildcard ("Host *", "Host web-*")
      if (/[*?]/.test(alias)) continue
      entries.push({ alias, ...currentProps })
    }
    currentAliases = []
    currentProps = {}
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    const keyword = match[1]!.toLowerCase()
    const value = stripQuotes(match[2]!.trim())

    if (keyword === 'host') {
      flush()
      currentAliases = value.split(/\s+/)
      continue
    }
    if (currentAliases.length === 0) continue
    if (keyword === 'hostname') currentProps.hostname = value
    else if (keyword === 'port') currentProps.port = Number(value) || 22
    else if (keyword === 'user') currentProps.user = value
    else if (keyword === 'identityfile' && !currentProps.identityFile) currentProps.identityFile = value
    else if (keyword === 'proxyjump') currentProps.proxyJump = value
  }
  flush()
  return entries
}

function parseJumpRef(ref: string): { user?: string; host: string; port: number } | null {
  const match = /^(?:([^@\s]+)@)?(\[[0-9a-fA-F:]+\]|[^:\s]+)(?::(\d{1,5}))?$/.exec(ref)
  if (!match) return null
  return {
    user: match[1],
    host: match[2]!.replace(/^\[|\]$/g, ''),
    port: match[3] ? Number(match[3]) : 22
  }
}

function expandHome(filePath: string): string {
  if (filePath.startsWith('~')) return path.join(os.homedir(), filePath.slice(1))
  return filePath
}

function stripQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
}

/** Phần base64 của public key — dùng dedupe. */
function publicCore(publicLine: string): string {
  return publicLine.split(/\s+/)[1] ?? publicLine
}
