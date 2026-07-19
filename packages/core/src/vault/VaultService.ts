import { existsSync } from 'node:fs'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { utils as sshUtils } from 'ssh2'
import type {
  AiDiagnoseDetailDto,
  AiDiagnoseRecordDto,
  AiDiagnoseSaveInput,
  AiDiagnoseStepDto,
  AuthType,
  GroupDto,
  GroupInput,
  HistoryEntry,
  HostDto,
  HostInput,
  HostProtocol,
  KeyImportInput,
  LoginStep,
  SnippetDto,
  SnippetInput,
  SshKeyDto,
  TunnelRuleDto,
  TunnelRuleInput,
  VaultState
} from '@infra/shared'
import {
  checkVerifier,
  decryptField,
  deriveKek,
  encryptField,
  generateDek,
  makeVerifier,
  newKdfParams,
  unwrapDek,
  wrapDek,
  type KdfParams
} from './crypto'
import { openDatabase } from './db'
import { ed25519ToOpenSshPrivate } from './sshKeyFormat'

export interface KnownHostRecord {
  id: string
  hostPattern: string
  keyType: string
  fingerprintSha256: string
}

/** Ảnh chụp vault để sync — secret đã giải mã (chỉ tồn tại trong main, sẽ mã hoá bằng sync key). */
export interface SyncSnapshot {
  version: number
  groups: Record<string, unknown>[]
  keys: Record<string, unknown>[]
  hosts: Record<string, unknown>[]
  snippets: Record<string, unknown>[]
  tunnels: Record<string, unknown>[]
  knownHosts: Record<string, unknown>[]
  tombstones: Array<{ recordId: string; table: string; deletedAt: number }>
}

const SYNC_TABLES = ['groups', 'keys', 'hosts', 'snippets', 'tunnels', 'known_hosts']

/** Chống SQL injection qua tên bảng từ tombstone. */
function safeTable(table: string): string {
  if (!SYNC_TABLES.includes(table)) throw new Error(`Bảng sync không hợp lệ: ${table}`)
  return table
}

/** Ép giá trị từ snapshot (unknown) về kiểu SQLite chấp nhận. */
function coerceSql(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  return String(value)
}

/** Một đầu kết nối SSH đã phân giải đầy đủ (target hoặc 1 hop trong jump chain). */
export interface ResolvedEndpoint {
  hostId: string | null
  label: string
  host: string
  port: number
  username: string
  authType: AuthType
  password?: string
  privateKey?: string
  passphrase?: string
  /** authType=password nhưng chưa lưu password → phải hỏi user. */
  needsPassword: boolean
  /** authType=secret: tham chiếu secret manager — main sẽ resolve thành password trước khi nối. */
  secretRef?: string
}

/** Cấu hình kết nối hoàn chỉnh sau khi áp group inheritance + jump chain. */
export interface ResolvedConnection {
  target: ResolvedEndpoint
  hops: ResolvedEndpoint[]
  env: Record<string, string>
  startupScript?: string
  agentForward: boolean
  /** Bật tmux auto-attach-or-create sau login (resume khi rớt mạng). */
  tmux: boolean
  /** Login script với giá trị secret THẬT — chỉ dùng trong main process. */
  loginSteps: LoginStep[]
  /** F41: TOTP seed (base32) đã giải mã — SshSession thay token {{totp}} bằng mã tươi lúc gửi. */
  totpSecret?: string
}

export class VaultService {
  private db: DatabaseSync | null = null
  private dek: Buffer | null = null

  constructor(private readonly dbPath: string) {}

  // -------------------------------------------------------------------------
  // Lifecycle: setup / unlock / lock
  // -------------------------------------------------------------------------

  state(): VaultState {
    if (!existsSync(this.dbPath)) return 'uninitialized'
    if (this.dek) return 'unlocked'
    // File tồn tại nhưng chưa có meta (setup dở dang) → coi như chưa khởi tạo
    return this.readMeta('kdf') ? 'locked' : 'uninitialized'
  }

  setup(masterPassword: string): void {
    if (this.state() !== 'uninitialized') throw new Error('Vault đã được khởi tạo')
    if (masterPassword.length < 8) throw new Error('Master password phải có ít nhất 8 ký tự')
    const kdf = newKdfParams()
    const kek = deriveKek(masterPassword, kdf)
    const dek = generateDek()
    this.writeMeta('kdf', JSON.stringify(kdf))
    this.writeMeta('wrapped_dek', wrapDek(dek, kek))
    this.writeMeta('verifier', makeVerifier(dek))
    this.dek = dek
  }

  /** Trả về false nếu sai master password. */
  unlock(masterPassword: string): boolean {
    if (this.state() === 'uninitialized') throw new Error('Vault chưa được khởi tạo')
    const kdfRaw = this.readMeta('kdf')
    const wrapped = this.readMeta('wrapped_dek')
    if (!kdfRaw || !wrapped) throw new Error('Vault hỏng: thiếu thông tin KDF')
    const kek = deriveKek(masterPassword, JSON.parse(kdfRaw) as KdfParams)
    const dek = unwrapDek(wrapped, kek)
    if (!dek) return false
    this.dek = dek
    return true
  }

  /** Mở bằng DEK đã lưu qua OS keychain (tính năng "ghi nhớ"). */
  unlockWithDek(dek: Buffer): boolean {
    const verifier = this.readMeta('verifier')
    if (!verifier || !checkVerifier(dek, verifier)) return false
    this.dek = dek
    return true
  }

  /** DEK hiện tại — chỉ dùng để wrap vào safeStorage, không log/ghi ra ngoài. */
  currentDek(): Buffer {
    return this.requireDek()
  }

  lock(): void {
    this.dek?.fill(0)
    this.dek = null
  }

  /** Khoá + đóng hẳn kết nối DB (dùng khi thoát app / teardown test). */
  close(): void {
    this.lock()
    this.db?.close()
    this.db = null
  }

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------

  listGroups(): GroupDto[] {
    const rows = this.ensureDb()
      .prepare('SELECT * FROM groups ORDER BY sort_order, name')
      .all() as unknown as GroupRow[]
    return rows.map((r) => this.toGroupDto(r))
  }

  saveGroup(input: GroupInput): GroupDto {
    const db = this.ensureDb()
    const now = Date.now()
    const id = input.id ?? randomUUID()
    const envEnc = input.env && Object.keys(input.env).length > 0
      ? encryptField(this.requireDek(), JSON.stringify(input.env))
      : null
    const jumpChain = input.jumpChain ? JSON.stringify(input.jumpChain) : null
    if (input.id) {
      db.prepare(
        `UPDATE groups SET name=?, parent_id=?, username=?, auth_type=?, key_id=?, env_enc=?,
         startup_snippet_id=?, jump_chain=?, color=?, updated_at=? WHERE id=?`
      ).run(
        input.name,
        input.parentId ?? null,
        input.username ?? null,
        input.authType ?? null,
        input.keyId ?? null,
        envEnc,
        input.startupSnippetId ?? null,
        jumpChain,
        input.color ?? null,
        now,
        id
      )
    } else {
      db.prepare(
        `INSERT INTO groups (id, parent_id, name, username, auth_type, key_id, env_enc,
         startup_snippet_id, jump_chain, color, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        id,
        input.parentId ?? null,
        input.name,
        input.username ?? null,
        input.authType ?? null,
        input.keyId ?? null,
        envEnc,
        input.startupSnippetId ?? null,
        jumpChain,
        input.color ?? null,
        now,
        now
      )
    }
    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as unknown as GroupRow
    return this.toGroupDto(row)
  }

  deleteGroup(id: string): void {
    this.ensureDb().prepare('DELETE FROM groups WHERE id = ?').run(id)
    this.tombstone(id, 'groups')
  }

  /** Chuỗi group từ gần nhất → gốc (dùng cho inheritance). */
  private groupChain(groupId: string | null): GroupRow[] {
    const chain: GroupRow[] = []
    const seen = new Set<string>()
    let current = groupId
    while (current && !seen.has(current)) {
      seen.add(current)
      const row = this.ensureDb().prepare('SELECT * FROM groups WHERE id = ?').get(current) as
        | unknown
        | undefined
      if (!row) break
      const group = row as GroupRow
      chain.push(group)
      current = group.parent_id
    }
    return chain
  }

  // -------------------------------------------------------------------------
  // Hosts
  // -------------------------------------------------------------------------

  listHosts(): HostDto[] {
    const rows = this.ensureDb().prepare('SELECT * FROM hosts ORDER BY label').all() as unknown as HostRow[]
    return rows.map((r) => this.toHostDto(r))
  }

  getHost(id: string): HostDto | null {
    const row = this.ensureDb().prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostRow | undefined
    return row ? this.toHostDto(row) : null
  }

  saveHost(input: HostInput): HostDto {
    const db = this.ensureDb()
    const dek = this.requireDek()
    const now = Date.now()
    const envEnc =
      input.env && Object.keys(input.env).length > 0 ? encryptField(dek, JSON.stringify(input.env)) : null
    const jumpChain = input.jumpChain && input.jumpChain.length > 0 ? JSON.stringify(input.jumpChain) : null

    if (input.id) {
      const existing = db
        .prepare('SELECT password_enc, login_script_enc, notes_enc, totp_enc FROM hosts WHERE id = ?')
        .get(input.id) as
        | { password_enc: string | null; login_script_enc: string | null; notes_enc: string | null; totp_enc: string | null }
        | undefined
      if (!existing) throw new Error('Host không tồn tại')
      let passwordEnc = existing.password_enc
      if (input.password === null) passwordEnc = null
      else if (typeof input.password === 'string')
        passwordEnc = input.password ? encryptField(dek, input.password) : null
      const loginScriptEnc =
        input.loginSteps === undefined
          ? existing.login_script_enc
          : this.encodeLoginSteps(dek, input.loginSteps, existing.login_script_enc)
      // notes: undefined = giữ nguyên; null/'' = xoá; string = đặt mới
      const notesEnc =
        input.notes === undefined ? existing.notes_enc : input.notes ? encryptField(dek, input.notes) : null
      // totpSecret (F41): cùng semantics notes — seed là secret 2FA nên mã hoá DEK
      const totpEnc =
        input.totpSecret === undefined
          ? existing.totp_enc
          : input.totpSecret
            ? encryptField(dek, input.totpSecret)
            : null
      db.prepare(
        `UPDATE hosts SET group_id=?, label=?, protocol=?, hostname=?, port=?, username=?, auth_type=?,
         password_enc=?, key_id=?, secret_ref=?, favorite=?, jump_chain=?, env_enc=?, startup_snippet_id=?,
         agent_forward=?, tmux=?, login_script_enc=?, notes_enc=?, totp_enc=?, updated_at=? WHERE id=?`
      ).run(
        input.groupId ?? null,
        input.label,
        input.protocol ?? 'ssh',
        input.hostname,
        input.port,
        input.username ?? '',
        input.authType ?? '',
        passwordEnc,
        input.keyId ?? null,
        input.secretRef ?? null,
        input.favorite ? 1 : 0,
        jumpChain,
        envEnc,
        input.startupSnippetId ?? null,
        input.agentForward ? 1 : 0,
        input.tmux ? 1 : 0,
        loginScriptEnc,
        notesEnc,
        totpEnc,
        now,
        input.id
      )
      return this.getHost(input.id)!
    }

    const id = randomUUID()
    db.prepare(
      `INSERT INTO hosts (id, group_id, label, protocol, hostname, port, username, auth_type, password_enc,
       key_id, secret_ref, favorite, jump_chain, env_enc, startup_snippet_id, agent_forward, tmux,
       login_script_enc, notes_enc, totp_enc, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      input.groupId ?? null,
      input.label,
      input.protocol ?? 'ssh',
      input.hostname,
      input.port,
      input.username ?? '',
      input.authType ?? '',
      input.password ? encryptField(dek, input.password) : null,
      input.keyId ?? null,
      input.secretRef ?? null,
      input.favorite ? 1 : 0,
      jumpChain,
      envEnc,
      input.startupSnippetId ?? null,
      input.agentForward ? 1 : 0,
      input.tmux ? 1 : 0,
      this.encodeLoginSteps(dek, input.loginSteps ?? null, null),
      input.notes ? encryptField(dek, input.notes) : null,
      input.totpSecret ? encryptField(dek, input.totpSecret) : null,
      now,
      now
    )
    return this.getHost(id)!
  }

  /**
   * Mã hoá login script. Bước secret có send='' → giữ giá trị cũ cùng vị trí
   * (renderer không bao giờ thấy secret nên gửi '' khi không đổi).
   */
  private encodeLoginSteps(dek: Buffer, steps: LoginStep[] | null, previousEnc: string | null): string | null {
    if (!steps || steps.length === 0) return null
    const previous = this.decodeLoginSteps(dek, previousEnc)
    const merged = steps.map((step, index) => {
      if (step.secret && step.send === '' && previous[index]?.secret) {
        return { ...step, send: previous[index]!.send }
      }
      return step
    })
    return encryptField(dek, JSON.stringify(merged))
  }

  private decodeLoginSteps(dek: Buffer, enc: string | null): LoginStep[] {
    if (!enc) return []
    const raw = decryptField(dek, enc)
    if (!raw) return []
    try {
      return JSON.parse(raw) as LoginStep[]
    } catch {
      return []
    }
  }

  deleteHost(id: string): void {
    this.ensureDb().prepare('DELETE FROM hosts WHERE id = ?').run(id)
    this.tombstone(id, 'hosts')
  }

  touchHostConnected(id: string): void {
    this.ensureDb().prepare('UPDATE hosts SET last_connected_at = ? WHERE id = ?').run(Date.now(), id)
  }

  // -------------------------------------------------------------------------
  // Resolve connection (inheritance + jump chain + secrets) — CHỈ gọi từ main
  // -------------------------------------------------------------------------

  resolveConnection(hostId: string): ResolvedConnection {
    const dek = this.requireDek()
    const row = this.hostRow(hostId)
    const chain = this.groupChain(row.group_id)

    // env: gốc → group gần nhất → host (host thắng)
    const env: Record<string, string> = {}
    for (const group of [...chain].reverse()) {
      Object.assign(env, this.decryptEnv(dek, group.env_enc))
    }
    Object.assign(env, this.decryptEnv(dek, row.env_enc))

    const startupSnippetId =
      row.startup_snippet_id ?? chain.find((g) => g.startup_snippet_id)?.startup_snippet_id ?? null
    const startupScript = startupSnippetId ? (this.getSnippet(startupSnippetId)?.script ?? undefined) : undefined

    const jumpChainRaw = row.jump_chain ?? chain.find((g) => g.jump_chain)?.jump_chain ?? null
    const jumpIds: string[] = jumpChainRaw ? (JSON.parse(jumpChainRaw) as string[]) : []
    const seen = new Set<string>([hostId])
    const hops: ResolvedEndpoint[] = []
    for (const jumpId of jumpIds) {
      if (seen.has(jumpId)) continue // chặn vòng lặp jump chain
      seen.add(jumpId)
      hops.push(this.resolveEndpoint(jumpId))
    }

    return {
      target: this.resolveEndpoint(hostId),
      hops,
      env,
      startupScript,
      agentForward: row.agent_forward === 1,
      tmux: row.tmux === 1,
      loginSteps: this.decodeLoginSteps(dek, row.login_script_enc),
      totpSecret: row.totp_enc ? (decryptField(dek, row.totp_enc) ?? undefined) : undefined
    }
  }

  /** Phân giải 1 endpoint (username/auth/secrets) theo group inheritance. */
  private resolveEndpoint(hostId: string): ResolvedEndpoint {
    const dek = this.requireDek()
    const row = this.hostRow(hostId)
    const chain = this.groupChain(row.group_id)

    const username = orInherit(row.username) ?? chain.map((g) => orInherit(g.username)).find(Boolean) ?? ''
    if (!username) throw new Error(`Host "${row.label}" thiếu username (kể cả từ group)`)

    const authType = (orInherit(row.auth_type) ??
      chain.map((g) => orInherit(g.auth_type)).find(Boolean) ??
      'password') as AuthType

    const endpoint: ResolvedEndpoint = {
      hostId,
      label: row.label,
      host: row.hostname,
      port: row.port,
      username,
      authType,
      needsPassword: false
    }

    if (authType === 'password') {
      if (row.password_enc) {
        endpoint.password = decryptField(dek, row.password_enc) ?? undefined
      }
      endpoint.needsPassword = endpoint.password === undefined
    } else if (authType === 'none') {
      // ssh2 thử auth "none" trước; password rỗng cover thêm server bật PermitEmptyPasswords
      endpoint.password = ''
    } else if (authType === 'secret') {
      // Resolve qua secret manager ở main (async) — chỉ truyền tham chiếu ra ngoài
      endpoint.secretRef = row.secret_ref ?? undefined
      if (!endpoint.secretRef) throw new Error(`Host "${row.label}" dùng secret manager nhưng chưa nhập tham chiếu`)
    } else if (authType === 'key') {
      const keyId = row.key_id ?? chain.map((g) => g.key_id).find(Boolean) ?? null
      if (!keyId) throw new Error(`Host "${row.label}" dùng auth key nhưng chưa chọn key`)
      const material = this.getKeyMaterial(keyId)
      endpoint.privateKey = material.privateKey
      endpoint.passphrase = material.passphrase
    }
    // authType=agent: không cần secret — dùng OS ssh-agent

    return endpoint
  }

  private hostRow(id: string): HostRow {
    const row = this.ensureDb().prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostRow | undefined
    if (!row) throw new Error('Host không tồn tại')
    return row
  }

  private decryptEnv(dek: Buffer, envEnc: string | null): Record<string, string> {
    if (!envEnc) return {}
    const raw = decryptField(dek, envEnc)
    if (!raw) return {}
    try {
      return JSON.parse(raw) as Record<string, string>
    } catch {
      return {}
    }
  }

  // -------------------------------------------------------------------------
  // SSH Keys
  // -------------------------------------------------------------------------

  listKeys(): SshKeyDto[] {
    const rows = this.ensureDb()
      .prepare('SELECT id, label, key_type, public_key, passphrase_enc, source, created_at FROM keys ORDER BY label')
      .all() as unknown as KeyRow[]
    return rows.map(toKeyDto)
  }

  /** Sinh cặp khoá ed25519 mới (định dạng OpenSSH), private key mã hoá bằng DEK trước khi ghi DB. */
  generateKey(label: string): SshKeyDto {
    const dek = this.requireDek()
    const { privateKey } = generateKeyPairSync('ed25519')
    // JWK là cách duy nhất lấy raw seed/public từ node:crypto; ssh2 không đọc PKCS8 ed25519
    const jwk = privateKey.export({ format: 'jwk' }) as { d?: string; x?: string }
    if (!jwk.d || !jwk.x) throw new Error('Sinh khoá thất bại: không lấy được raw key')
    const openssh = ed25519ToOpenSshPrivate(
      Buffer.from(jwk.d, 'base64url'),
      Buffer.from(jwk.x, 'base64url'),
      label
    )
    const parsed = sshUtils.parseKey(openssh)
    if (parsed instanceof Error) throw new Error(`Sinh khoá thất bại: ${parsed.message}`)
    const publicLine = `${parsed.type} ${parsed.getPublicSSH().toString('base64')} ${label}`
    return this.insertKey(label, parsed.type, publicLine, encryptField(dek, openssh), null, 'generated')
  }

  /** Import private key (OpenSSH/PEM/PPK). Validate + lấy public key bằng ssh2 trước khi lưu. */
  importKey(input: KeyImportInput): SshKeyDto {
    const dek = this.requireDek()
    const parsed = sshUtils.parseKey(input.privateKey, input.passphrase)
    if (parsed instanceof Error) {
      throw new Error(
        input.passphrase
          ? `Key không hợp lệ hoặc sai passphrase: ${parsed.message}`
          : `Key không hợp lệ (nếu key có passphrase, hãy nhập passphrase): ${parsed.message}`
      )
    }
    const publicLine = `${parsed.type} ${parsed.getPublicSSH().toString('base64')} ${input.label}`
    return this.insertKey(
      input.label,
      parsed.type,
      publicLine,
      encryptField(dek, input.privateKey),
      input.passphrase ? encryptField(dek, input.passphrase) : null,
      'imported'
    )
  }

  deleteKey(id: string): void {
    this.ensureDb().prepare('DELETE FROM keys WHERE id = ?').run(id)
    this.tombstone(id, 'keys')
  }

  getKeyMaterial(id: string): { privateKey: string; passphrase?: string } {
    const dek = this.requireDek()
    const row = this.ensureDb()
      .prepare('SELECT private_key_enc, passphrase_enc FROM keys WHERE id = ?')
      .get(id) as { private_key_enc: string; passphrase_enc: string | null } | undefined
    if (!row) throw new Error('Key không tồn tại')
    const privateKey = decryptField(dek, row.private_key_enc)
    if (!privateKey) throw new Error('Không giải mã được private key')
    return {
      privateKey,
      passphrase: row.passphrase_enc ? (decryptField(dek, row.passphrase_enc) ?? undefined) : undefined
    }
  }

  private insertKey(
    label: string,
    keyType: string,
    publicKey: string,
    privateKeyEnc: string,
    passphraseEnc: string | null,
    source: 'generated' | 'imported'
  ): SshKeyDto {
    const now = Date.now()
    const id = randomUUID()
    this.ensureDb()
      .prepare(
        `INSERT INTO keys (id, label, key_type, public_key, private_key_enc, passphrase_enc, source, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(id, label, keyType, publicKey, privateKeyEnc, passphraseEnc, source, now, now)
    return { id, label, keyType, publicKey, hasPassphrase: passphraseEnc !== null, source, createdAt: now }
  }

  // -------------------------------------------------------------------------
  // Snippets
  // -------------------------------------------------------------------------

  listSnippets(): SnippetDto[] {
    const rows = this.ensureDb()
      .prepare('SELECT id, label, script FROM snippets ORDER BY label')
      .all() as unknown as SnippetDto[]
    return rows
  }

  getSnippet(id: string): SnippetDto | null {
    const row = this.ensureDb().prepare('SELECT id, label, script FROM snippets WHERE id = ?').get(id) as
      | SnippetDto
      | undefined
    return row ?? null
  }

  saveSnippet(input: SnippetInput): SnippetDto {
    const db = this.ensureDb()
    const now = Date.now()
    const id = input.id ?? randomUUID()
    if (input.id) {
      db.prepare('UPDATE snippets SET label=?, script=?, updated_at=? WHERE id=?').run(
        input.label,
        input.script,
        now,
        id
      )
    } else {
      db.prepare('INSERT INTO snippets (id, label, script, created_at, updated_at) VALUES (?,?,?,?,?)').run(
        id,
        input.label,
        input.script,
        now,
        now
      )
    }
    return { id, label: input.label, script: input.script }
  }

  deleteSnippet(id: string): void {
    this.ensureDb().prepare('DELETE FROM snippets WHERE id = ?').run(id)
    this.tombstone(id, 'snippets')
  }

  // -------------------------------------------------------------------------
  // Tunnels (rules — runtime do TunnelService quản lý)
  // -------------------------------------------------------------------------

  listTunnels(): TunnelRuleDto[] {
    const rows = this.ensureDb().prepare('SELECT * FROM tunnels ORDER BY created_at').all() as unknown as TunnelRow[]
    return rows.map(toTunnelDto)
  }

  getTunnel(id: string): TunnelRuleDto | null {
    const row = this.ensureDb().prepare('SELECT * FROM tunnels WHERE id = ?').get(id) as TunnelRow | undefined
    return row ? toTunnelDto(row) : null
  }

  saveTunnel(input: TunnelRuleInput): TunnelRuleDto {
    const db = this.ensureDb()
    const now = Date.now()
    const id = input.id ?? randomUUID()
    const values = [
      input.hostId,
      input.type,
      input.label ?? '',
      input.bindHost ?? '127.0.0.1',
      input.bindPort,
      input.type === 'D' ? null : (input.destHost ?? null),
      input.type === 'D' ? null : (input.destPort ?? null),
      input.autoStart ? 1 : 0
    ]
    if (input.id) {
      db.prepare(
        `UPDATE tunnels SET host_id=?, type=?, label=?, bind_host=?, bind_port=?, dest_host=?, dest_port=?,
         auto_start=?, updated_at=? WHERE id=?`
      ).run(...values, now, id)
    } else {
      db.prepare(
        `INSERT INTO tunnels (host_id, type, label, bind_host, bind_port, dest_host, dest_port, auto_start,
         created_at, updated_at, id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).run(...values, now, now, id)
    }
    return this.getTunnel(id)!
  }

  deleteTunnel(id: string): void {
    this.ensureDb().prepare('DELETE FROM tunnels WHERE id = ?').run(id)
    this.tombstone(id, 'tunnels')
  }

  // -------------------------------------------------------------------------
  // Known hosts (TOFU)
  // -------------------------------------------------------------------------

  findKnownHost(host: string, port: number, keyType: string): KnownHostRecord | null {
    const row = this.ensureDb()
      .prepare('SELECT id, host_pattern, key_type, fingerprint_sha256 FROM known_hosts WHERE host_pattern = ? AND key_type = ?')
      .get(hostPattern(host, port), keyType) as
      | { id: string; host_pattern: string; key_type: string; fingerprint_sha256: string }
      | undefined
    if (!row) return null
    return { id: row.id, hostPattern: row.host_pattern, keyType: row.key_type, fingerprintSha256: row.fingerprint_sha256 }
  }

  storeKnownHost(host: string, port: number, keyType: string, fingerprint: string): void {
    const now = Date.now()
    this.ensureDb()
      .prepare(
        `INSERT INTO known_hosts (id, host_pattern, key_type, fingerprint_sha256, first_seen, last_seen)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT (host_pattern, key_type)
         DO UPDATE SET fingerprint_sha256 = excluded.fingerprint_sha256, last_seen = excluded.last_seen`
      )
      .run(randomUUID(), hostPattern(host, port), keyType, fingerprint, now, now)
  }

  touchKnownHost(host: string, port: number, keyType: string): void {
    this.ensureDb()
      .prepare('UPDATE known_hosts SET last_seen = ? WHERE host_pattern = ? AND key_type = ?')
      .run(Date.now(), hostPattern(host, port), keyType)
  }

  // -------------------------------------------------------------------------
  // History (Quick Connect)
  // -------------------------------------------------------------------------

  addHistory(target: string, hostId: string | null): void {
    const db = this.ensureDb()
    // 1 target chỉ giữ 1 dòng mới nhất
    db.prepare('DELETE FROM history WHERE target = ?').run(target)
    db.prepare('INSERT INTO history (id, target, host_id, connected_at) VALUES (?,?,?,?)').run(
      randomUUID(),
      target,
      hostId,
      Date.now()
    )
    db.prepare(
      'DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY connected_at DESC LIMIT 50)'
    ).run()
  }

  listHistory(limit = 10): HistoryEntry[] {
    const rows = this.ensureDb()
      .prepare('SELECT id, target, host_id, connected_at FROM history ORDER BY connected_at DESC LIMIT ?')
      .all(limit) as Array<{ id: string; target: string; host_id: string | null; connected_at: number }>
    return rows.map((r) => ({ id: r.id, target: r.target, hostId: r.host_id, connectedAt: r.connected_at }))
  }

  // -------------------------------------------------------------------------
  // AI diagnose history (F48) — steps + conclusion MÃ HOÁ bằng DEK trong data_enc.
  // Giữ tối đa 50 phiên mới nhất. KHÔNG nằm trong sync (log cục bộ).
  // -------------------------------------------------------------------------

  private static readonly DIAGNOSE_CAP = 50
  private static readonly DIAGNOSE_SNIPPET_LEN = 200

  saveDiagnosis(input: AiDiagnoseSaveInput): string {
    const db = this.ensureDb()
    const dek = this.requireDek()
    const id = randomUUID()
    const now = Date.now()
    const dataEnc = encryptField(
      dek,
      JSON.stringify({ steps: input.steps, conclusion: input.conclusion ?? null, error: input.error ?? null })
    )
    db.prepare(
      `INSERT INTO diagnoses (id, host_id, host_label, symptom, status, data_enc, created_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(id, input.hostId || null, input.hostLabel, input.symptom, input.status, dataEnc, now)
    // Giữ tối đa DIAGNOSE_CAP dòng mới nhất
    db.prepare(
      `DELETE FROM diagnoses WHERE id NOT IN (SELECT id FROM diagnoses ORDER BY created_at DESC LIMIT ${VaultService.DIAGNOSE_CAP})`
    ).run()
    return id
  }

  listDiagnoses(limit = VaultService.DIAGNOSE_CAP): AiDiagnoseRecordDto[] {
    const rows = this.ensureDb()
      .prepare(
        'SELECT id, host_label, symptom, status, data_enc, created_at FROM diagnoses ORDER BY created_at DESC LIMIT ?'
      )
      .all(limit) as Array<{
      id: string
      host_label: string
      symptom: string
      status: string
      data_enc: string
      created_at: number
    }>
    return rows.map((r) => {
      // Vault khoá → không giải mã được, vẫn trả metadata (snippet rỗng, stepCount 0)
      const parsed = this.dek ? this.parseDiagnoseData(r.data_enc) : null
      const conclusion = parsed?.conclusion ?? ''
      const snippet = conclusion.replace(/\s+/g, ' ').trim().slice(0, VaultService.DIAGNOSE_SNIPPET_LEN)
      return {
        id: r.id,
        hostLabel: r.host_label,
        symptom: r.symptom,
        status: r.status as AiDiagnoseRecordDto['status'],
        conclusionSnippet: snippet,
        stepCount: parsed?.steps.length ?? 0,
        createdAt: r.created_at
      }
    })
  }

  getDiagnosis(id: string): AiDiagnoseDetailDto | null {
    const row = this.ensureDb()
      .prepare('SELECT id, host_id, host_label, symptom, status, data_enc, created_at FROM diagnoses WHERE id = ?')
      .get(id) as
      | {
          id: string
          host_id: string | null
          host_label: string
          symptom: string
          status: string
          data_enc: string
          created_at: number
        }
      | undefined
    if (!row) return null
    const parsed = this.parseDiagnoseData(row.data_enc)
    return {
      id: row.id,
      hostId: row.host_id ?? '',
      hostLabel: row.host_label,
      symptom: row.symptom,
      status: row.status as AiDiagnoseDetailDto['status'],
      steps: parsed?.steps ?? [],
      conclusion: parsed?.conclusion ?? undefined,
      error: parsed?.error ?? undefined,
      createdAt: row.created_at
    }
  }

  deleteDiagnosis(id: string): void {
    this.ensureDb().prepare('DELETE FROM diagnoses WHERE id = ?').run(id)
  }

  private parseDiagnoseData(
    enc: string
  ): { steps: AiDiagnoseStepDto[]; conclusion: string | null; error: string | null } | null {
    const raw = decryptField(this.requireDek(), enc)
    if (!raw) return null
    try {
      const data = JSON.parse(raw) as {
        steps?: AiDiagnoseStepDto[]
        conclusion?: string | null
        error?: string | null
      }
      return { steps: data.steps ?? [], conclusion: data.conclusion ?? null, error: data.error ?? null }
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Sync config (lưu trong meta — không bí mật)
  // -------------------------------------------------------------------------

  getSyncConfig(): { backend: string; folderPath: string; saltB64: string } | null {
    const raw = this.readMeta('sync_config')
    return raw ? (JSON.parse(raw) as { backend: string; folderPath: string; saltB64: string }) : null
  }

  setSyncConfig(config: { backend: string; folderPath: string; saltB64: string }): void {
    this.writeMeta('sync_config', JSON.stringify(config))
  }

  clearSyncConfig(): void {
    this.ensureDb().prepare('DELETE FROM meta WHERE key = ?').run('sync_config')
  }

  // -------------------------------------------------------------------------
  // AI config (provider/model/baseUrl trong meta; api key MÃ HOÁ bằng DEK)
  // -------------------------------------------------------------------------

  getAiConfig(): { provider: string; model: string; baseUrl: string; hasApiKey: boolean } | null {
    const raw = this.readMeta('ai_config')
    if (!raw) return null
    const cfg = JSON.parse(raw) as { provider: string; model: string; baseUrl: string }
    return { ...cfg, hasApiKey: this.readMeta('ai_api_key') !== null }
  }

  /** API key thật để gọi AI — chỉ dùng trong main process. */
  getAiApiKey(): string | undefined {
    const enc = this.readMeta('ai_api_key')
    if (!enc) return undefined
    return decryptField(this.requireDek(), enc) ?? undefined
  }

  /** apiKey: undefined = giữ nguyên, '' = xoá, string = đặt mới. */
  setAiConfig(input: { provider: string; model: string; baseUrl: string; apiKey?: string }): void {
    this.writeMeta('ai_config', JSON.stringify({ provider: input.provider, model: input.model, baseUrl: input.baseUrl }))
    if (input.apiKey === '') {
      this.ensureDb().prepare('DELETE FROM meta WHERE key = ?').run('ai_api_key')
    } else if (typeof input.apiKey === 'string') {
      this.writeMeta('ai_api_key', encryptField(this.requireDek(), input.apiKey))
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot cho sync E2EE (chứa secret ĐÃ GIẢI MÃ — chỉ dùng trong main process)
  // -------------------------------------------------------------------------

  /** Xuất toàn bộ bản ghi đồng bộ được + secret đã giải mã + tombstones. */
  exportSnapshot(): SyncSnapshot {
    const dek = this.requireDek()
    const db = this.ensureDb()
    const all = (sql: string): Record<string, unknown>[] => db.prepare(sql).all() as Record<string, unknown>[]
    const dec = (v: unknown): string | null => (v ? (decryptField(dek, v as string) ?? null) : null)

    return {
      version: 1,
      groups: all('SELECT * FROM groups').map((r) => ({ ...r, env_plain: dec(r.env_enc), env_enc: undefined })),
      keys: all('SELECT * FROM keys').map((r) => ({
        ...r,
        private_key_plain: dec(r.private_key_enc),
        passphrase_plain: dec(r.passphrase_enc),
        private_key_enc: undefined,
        passphrase_enc: undefined
      })),
      hosts: all('SELECT * FROM hosts').map((r) => ({
        ...r,
        password_plain: dec(r.password_enc),
        env_plain: dec(r.env_enc),
        login_script_plain: dec(r.login_script_enc),
        notes_plain: dec(r.notes_enc),
        totp_plain: dec(r.totp_enc),
        password_enc: undefined,
        env_enc: undefined,
        login_script_enc: undefined,
        notes_enc: undefined,
        totp_enc: undefined
      })),
      snippets: all('SELECT * FROM snippets'),
      tunnels: all('SELECT * FROM tunnels'),
      knownHosts: all('SELECT * FROM known_hosts'),
      tombstones: (all('SELECT * FROM tombstones') as Array<{ record_id: string; table_name: string; deleted_at: number }>).map(
        (t) => ({ recordId: t.record_id, table: t.table_name, deletedAt: t.deleted_at })
      )
    }
  }

  /**
   * Merge snapshot remote vào local theo Last-Write-Wins (so updated_at) + tombstones.
   * Secret được mã hoá lại bằng DEK local. Trả về số bản ghi đã thay đổi.
   */
  importSnapshot(remote: SyncSnapshot): number {
    const dek = this.requireDek()
    const db = this.ensureDb()
    let changed = 0
    const enc = (v: string | null | undefined): string | null => (v ? encryptField(dek, v) : null)

    // Tombstones: gom cả 2 phía, áp dụng cái mới nhất
    const localTomb = new Map<string, number>()
    for (const t of db.prepare('SELECT record_id, deleted_at FROM tombstones').all() as Array<{
      record_id: string
      deleted_at: number
    }>) {
      localTomb.set(t.record_id, t.deleted_at)
    }
    const remoteTomb = new Map(remote.tombstones.map((t) => [t.recordId, t.deletedAt]))
    const tombAt = (id: string): number => Math.max(localTomb.get(id) ?? 0, remoteTomb.get(id) ?? 0)

    db.exec('BEGIN')
    try {
      // Upsert từng bảng nếu remote mới hơn local VÀ mới hơn tombstone
      const upsertRow = (
        table: string,
        idCol: string,
        tsCol: string,
        row: Record<string, unknown>,
        cols: string[]
      ): void => {
        const id = row[idCol] as string
        const remoteTs = Number(row[tsCol] ?? 0)
        if (remoteTs <= tombAt(id)) return // đã bị xoá ở đâu đó muộn hơn → bỏ
        const localRow = db.prepare(`SELECT ${tsCol} FROM ${table} WHERE ${idCol} = ?`).get(id) as
          | Record<string, number>
          | undefined
        if (localRow && Number(localRow[tsCol] ?? 0) >= remoteTs) return // local mới hơn → giữ
        const placeholders = cols.map(() => '?').join(',')
        const updates = cols.filter((c) => c !== idCol).map((c) => `${c}=excluded.${c}`).join(',')
        db.prepare(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})
           ON CONFLICT(${idCol}) DO UPDATE SET ${updates}`
        ).run(...cols.map((c) => coerceSql(row[c])))
        changed += 1
      }

      for (const g of remote.groups) {
        // Snapshot từ máy cũ (trước v11) không có 'color' → null
        upsertRow('groups', 'id', 'updated_at', { ...g, env_enc: enc(g.env_plain as string), color: g.color ?? null }, [
          'id', 'parent_id', 'name', 'sort_order', 'username', 'auth_type', 'key_id', 'env_enc',
          'startup_snippet_id', 'jump_chain', 'color', 'created_at', 'updated_at'
        ])
      }
      for (const k of remote.keys) {
        upsertRow(
          'keys', 'id', 'updated_at',
          { ...k, private_key_enc: enc(k.private_key_plain as string), passphrase_enc: enc(k.passphrase_plain as string) },
          ['id', 'label', 'key_type', 'public_key', 'private_key_enc', 'passphrase_enc', 'source', 'created_at', 'updated_at']
        )
      }
      for (const h of remote.hosts) {
        upsertRow(
          'hosts', 'id', 'updated_at',
          {
            ...h,
            password_enc: enc(h.password_plain as string),
            env_enc: enc(h.env_plain as string),
            login_script_enc: enc(h.login_script_plain as string),
            notes_enc: enc(h.notes_plain as string),
            totp_enc: enc(h.totp_plain as string),
            // Snapshot từ máy cũ (trước v9) không có 'tmux' → mặc định 0 (cột NOT NULL)
            tmux: h.tmux ?? 0
          },
          ['id', 'group_id', 'label', 'protocol', 'hostname', 'port', 'username', 'auth_type', 'password_enc',
           'key_id', 'secret_ref', 'favorite', 'jump_chain', 'env_enc', 'startup_snippet_id', 'agent_forward',
           'tmux', 'login_script_enc', 'notes_enc', 'totp_enc', 'last_connected_at', 'created_at', 'updated_at']
        )
      }
      for (const s of remote.snippets) {
        upsertRow('snippets', 'id', 'updated_at', s, ['id', 'label', 'script', 'created_at', 'updated_at'])
      }
      for (const t of remote.tunnels) {
        upsertRow('tunnels', 'id', 'updated_at', t, [
          'id', 'host_id', 'type', 'label', 'bind_host', 'bind_port', 'dest_host', 'dest_port', 'auto_start',
          'created_at', 'updated_at'
        ])
      }
      for (const kh of remote.knownHosts) {
        upsertRow('known_hosts', 'id', 'last_seen', kh, [
          'id', 'host_pattern', 'key_type', 'fingerprint_sha256', 'first_seen', 'last_seen'
        ])
      }

      // Áp tombstone remote: xoá bản ghi local cũ hơn + lưu tombstone
      for (const t of remote.tombstones) {
        if (!localTomb.has(t.recordId) || (localTomb.get(t.recordId) ?? 0) < t.deletedAt) {
          db.prepare(
            `INSERT INTO tombstones (record_id, table_name, deleted_at) VALUES (?,?,?)
             ON CONFLICT(record_id) DO UPDATE SET deleted_at=excluded.deleted_at, table_name=excluded.table_name`
          ).run(t.recordId, t.table, t.deletedAt)
          const deleted = db.prepare(`DELETE FROM ${safeTable(t.table)} WHERE id = ? AND updated_at < ?`).run(
            t.recordId,
            t.deletedAt
          )
          if (deleted.changes > 0) changed += 1
        }
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return changed
  }

  private tombstone(recordId: string, table: string): void {
    this.ensureDb()
      .prepare(
        `INSERT INTO tombstones (record_id, table_name, deleted_at) VALUES (?,?,?)
         ON CONFLICT(record_id) DO UPDATE SET deleted_at=excluded.deleted_at`
      )
      .run(recordId, table, Date.now())
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ensureDb(): DatabaseSync {
    this.db ??= openDatabase(this.dbPath)
    return this.db
  }

  private requireDek(): Buffer {
    if (!this.dek) throw new Error('Vault đang khoá')
    return this.dek
  }

  private readMeta(key: string): string | null {
    const row = this.ensureDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private writeMeta(key: string, value: string): void {
    this.ensureDb()
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  private toGroupDto(row: GroupRow): GroupDto {
    return {
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      username: orInherit(row.username),
      authType: (orInherit(row.auth_type) as AuthType | null) ?? null,
      keyId: row.key_id,
      env: this.dek ? nullIfEmpty(this.decryptEnv(this.dek, row.env_enc)) : null,
      startupSnippetId: row.startup_snippet_id,
      jumpChain: row.jump_chain ? (JSON.parse(row.jump_chain) as string[]) : null,
      color: row.color ?? null
    }
  }

  private toHostDto(row: HostRow): HostDto {
    return {
      id: row.id,
      groupId: row.group_id,
      label: row.label,
      protocol: (row.protocol as HostProtocol) ?? 'ssh',
      hostname: row.hostname,
      port: row.port,
      username: orInherit(row.username),
      authType: (orInherit(row.auth_type) as AuthType | null) ?? null,
      keyId: row.key_id,
      hasPassword: row.password_enc !== null,
      secretRef: row.secret_ref,
      favorite: row.favorite === 1,
      lastConnectedAt: row.last_connected_at,
      jumpChain: row.jump_chain ? (JSON.parse(row.jump_chain) as string[]) : null,
      env: this.dek ? nullIfEmpty(this.decryptEnv(this.dek, row.env_enc)) : null,
      startupSnippetId: row.startup_snippet_id,
      agentForward: row.agent_forward === 1,
      tmux: row.tmux === 1,
      notes: this.dek && row.notes_enc ? (decryptField(this.dek, row.notes_enc) ?? null) : null,
      hasTotp: row.totp_enc !== null,
      loginSteps: this.dek ? maskLoginSteps(this.decodeLoginSteps(this.dek, row.login_script_enc)) : null
    }
  }
}

/** Che giá trị secret trước khi gửi về renderer. */
function maskLoginSteps(steps: LoginStep[]): LoginStep[] | null {
  if (steps.length === 0) return null
  return steps.map((step) => (step.secret ? { ...step, send: '' } : step))
}

function hostPattern(host: string, port: number): string {
  return port === 22 ? host.toLowerCase() : `[${host.toLowerCase()}]:${port}`
}

/** '' hoặc null → null (= kế thừa). v1 lưu auth_type='password' mặc định → giữ nguyên giá trị cũ. */
function orInherit(value: string | null): string | null {
  return value ? value : null
}

function nullIfEmpty(env: Record<string, string>): Record<string, string> | null {
  return Object.keys(env).length > 0 ? env : null
}

interface GroupRow {
  id: string
  parent_id: string | null
  name: string
  username: string | null
  auth_type: string | null
  key_id: string | null
  env_enc: string | null
  startup_snippet_id: string | null
  jump_chain: string | null
  color: string | null
}

interface HostRow {
  id: string
  group_id: string | null
  label: string
  protocol: string
  hostname: string
  port: number
  username: string | null
  auth_type: string | null
  password_enc: string | null
  key_id: string | null
  secret_ref: string | null
  favorite: number
  last_connected_at: number | null
  jump_chain: string | null
  env_enc: string | null
  startup_snippet_id: string | null
  agent_forward: number
  tmux: number
  login_script_enc: string | null
  notes_enc: string | null
  totp_enc: string | null
}

interface KeyRow {
  id: string
  label: string
  key_type: string
  public_key: string
  passphrase_enc: string | null
  source: string
  created_at: number
}

function toKeyDto(row: KeyRow): SshKeyDto {
  return {
    id: row.id,
    label: row.label,
    keyType: row.key_type,
    publicKey: row.public_key,
    hasPassphrase: row.passphrase_enc !== null,
    source: row.source === 'generated' ? 'generated' : 'imported',
    createdAt: row.created_at
  }
}

interface TunnelRow {
  id: string
  host_id: string
  type: string
  label: string
  bind_host: string
  bind_port: number
  dest_host: string | null
  dest_port: number | null
  auto_start: number
}

function toTunnelDto(row: TunnelRow): TunnelRuleDto {
  return {
    id: row.id,
    hostId: row.host_id,
    type: row.type as TunnelRuleDto['type'],
    label: row.label,
    bindHost: row.bind_host,
    bindPort: row.bind_port,
    destHost: row.dest_host,
    destPort: row.dest_port,
    autoStart: row.auto_start === 1
  }
}
