export type ShellIcon = 'powershell' | 'cmd' | 'bash' | 'wsl' | 'zsh' | 'fish' | 'shell'

/** Một loại shell local phát hiện được trên máy (PowerShell, cmd, Git Bash, WSL…). */
export interface ShellProfile {
  id: string
  label: string
  shellPath: string
  args?: string[]
  cwd?: string
  icon: ShellIcon
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export type VaultState = 'uninitialized' | 'locked' | 'unlocked'

export interface VaultStatus {
  state: VaultState
  /** DEK đang được ghi nhớ qua OS keychain (Electron safeStorage). */
  remembered: boolean
}

// ---------------------------------------------------------------------------
// Hosts / Groups / Keys / Snippets / History
// ---------------------------------------------------------------------------

/** 'none' = server cho vào không cần xác thực. 'secret' = lấy password từ secret manager (op/bw/vault). */
export type AuthType = 'password' | 'key' | 'agent' | 'none' | 'secret'

/** Giao thức của host. serial: hostname = COM port, port = baud rate. */
export type HostProtocol = 'ssh' | 'telnet' | 'serial'

/** Group với các field cấu hình kế thừa — null nghĩa là "kế thừa tiếp từ group cha". */
export interface GroupDto {
  id: string
  parentId: string | null
  name: string
  username: string | null
  authType: AuthType | null
  keyId: string | null
  env: Record<string, string> | null
  startupSnippetId: string | null
  jumpChain: string[] | null
}

export interface GroupInput {
  id?: string
  parentId?: string | null
  name: string
  username?: string | null
  authType?: AuthType | null
  keyId?: string | null
  env?: Record<string, string> | null
  startupSnippetId?: string | null
  jumpChain?: string[] | null
}

/**
 * Host trả về renderer — KHÔNG bao giờ chứa secret (password/private key).
 * username/authType/keyId/jumpChain/startupSnippetId = null → kế thừa từ group.
 */
export interface HostDto {
  id: string
  groupId: string | null
  label: string
  protocol: HostProtocol
  hostname: string
  port: number
  username: string | null
  authType: AuthType | null
  keyId: string | null
  hasPassword: boolean
  /** authType=secret: tham chiếu (op://… / bw://… / vault://…). */
  secretRef: string | null
  favorite: boolean
  lastConnectedAt: number | null
  jumpChain: string[] | null
  env: Record<string, string> | null
  startupSnippetId: string | null
  agentForward: boolean
  /** Bật: sau login tự chạy `tmux new-session -A` để phiên sống sót/khôi phục khi rớt mạng. */
  tmux: boolean
  /** Ghi chú Markdown (đã giải mã khi vault mở) — null nếu trống. */
  notes: string | null
  /** Bước secret có send='' (giá trị thật không rời main process). */
  loginSteps: LoginStep[] | null
}

/** Payload lưu host. password: undefined = giữ nguyên, null = xoá, string = đặt mới. */
export interface HostInput {
  id?: string
  groupId?: string | null
  label: string
  protocol?: HostProtocol
  hostname: string
  port: number
  username?: string | null
  authType?: AuthType | null
  password?: string | null
  keyId?: string | null
  secretRef?: string | null
  favorite?: boolean
  jumpChain?: string[] | null
  env?: Record<string, string> | null
  startupSnippetId?: string | null
  agentForward?: boolean
  tmux?: boolean
  /** Ghi chú: undefined = giữ nguyên, null/'' = xoá, string = đặt mới. */
  notes?: string | null
  /** Bước secret với send='' = giữ nguyên giá trị cũ (merge theo vị trí). */
  loginSteps?: LoginStep[] | null
}

/**
 * Một bước trong login script chạy sau khi shell mở (vd: su sang user khác rồi ssh tiếp).
 * Engine chờ `expect` xuất hiện trong output rồi gửi `send` + Enter.
 */
export interface LoginStep {
  /** Chuỗi chờ trong output trước khi gửi. Bỏ trống = gửi sau ~800ms. */
  expect?: string
  /** Nội dung gửi (kèm Enter). Với secret: renderer luôn nhận '' — giá trị thật chỉ ở main. */
  send: string
  /** Là mật khẩu: lưu mã hoá trong vault, không trả về renderer. */
  secret?: boolean
}

export interface SshKeyDto {
  id: string
  label: string
  keyType: string
  /** Dòng public key dạng OpenSSH ("ssh-ed25519 AAAA… label") — dán thẳng vào authorized_keys. */
  publicKey: string
  hasPassphrase: boolean
  source: 'generated' | 'imported'
  createdAt: number
}

export interface KeyImportInput {
  label: string
  privateKey: string
  passphrase?: string
}

export interface SnippetDto {
  id: string
  label: string
  /** Script có thể chứa biến dạng {{ten_bien}} — được hỏi giá trị lúc chạy. */
  script: string
}

export interface SnippetInput {
  id?: string
  label: string
  script: string
}

export interface HistoryEntry {
  id: string
  /** Chuỗi hiển thị, vd "root@1.2.3.4:22". */
  target: string
  hostId: string | null
  connectedAt: number
}

// ---------------------------------------------------------------------------
// Tunnels (port forwarding)
// ---------------------------------------------------------------------------

export type TunnelType = 'L' | 'R' | 'D'

export interface TunnelRuleDto {
  id: string
  hostId: string
  type: TunnelType
  label: string
  bindHost: string
  bindPort: number
  /** Không dùng với type=D. */
  destHost: string | null
  destPort: number | null
  autoStart: boolean
}

export interface TunnelRuleInput {
  id?: string
  hostId: string
  type: TunnelType
  label?: string
  bindHost?: string
  bindPort: number
  destHost?: string | null
  destPort?: number | null
  autoStart?: boolean
}

export type TunnelStatus = 'stopped' | 'starting' | 'active' | 'error'

export interface TunnelStateDto {
  ruleId: string
  status: TunnelStatus
  detail?: string
}

// ---------------------------------------------------------------------------
// SFTP & file system local
// ---------------------------------------------------------------------------

export interface FileEntryDto {
  name: string
  kind: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  mtimeMs: number
  /** Mode dạng octal "755" (chỉ có với SFTP). */
  mode?: string
}

export interface SftpOpenResponse {
  sessionId: string
  title: string
  /** Thư mục home trên server. */
  home: string
}

export interface TransferEvent {
  id: string
  kind: 'upload' | 'download' | 'edit-upload'
  /** Tên hiển thị, vd "nginx.conf → /etc/nginx". */
  label: string
  transferred: number
  total: number
  status: 'running' | 'done' | 'error'
  error?: string
}

// ---------------------------------------------------------------------------
// Bulk execution (chạy 1 lệnh trên nhiều host)
// ---------------------------------------------------------------------------

export type BulkPhase = 'pending' | 'running' | 'done' | 'error'

export interface BulkHostResult {
  hostId: string
  label: string
  phase: BulkPhase
  stdout: string
  stderr: string
  code: number | null
  error?: string
  durationMs?: number
}

export interface BulkRunEvent {
  runId: string
  hostId: string
  phase: BulkPhase
  stdout?: string
  stderr?: string
  code?: number | null
  error?: string
  durationMs?: number
}

// ---------------------------------------------------------------------------
// AI assistant
// ---------------------------------------------------------------------------

export type AiProviderDto = 'claude' | 'openai' | 'gemini' | 'ollama'
export type AiModeDto = 'generate' | 'explain' | 'explain-error'

export interface AiConfigDto {
  provider: AiProviderDto
  model: string
  baseUrl: string
  hasApiKey: boolean
}

export interface AiConfigInput {
  provider: AiProviderDto
  model: string
  baseUrl: string
  /** undefined = giữ nguyên, '' = xoá, string = đặt mới. */
  apiKey?: string
}

export interface AiAskResultDto {
  text: string
  command?: string
}

// ---------------------------------------------------------------------------
// Sync E2EE
// ---------------------------------------------------------------------------

export interface SyncStatusDto {
  configured: boolean
  backend?: string
  folder?: string
  lastSyncAt?: number
  lastMessage?: string
}

export interface SyncRunResult {
  ok: boolean
  pulled: number
  message: string
}

// ---------------------------------------------------------------------------
// Network toolbox
// ---------------------------------------------------------------------------

export interface PingResultDto {
  alive: boolean
  output: string
  avgMs: number | null
}

export interface DnsResultDto {
  a: string[]
  aaaa: string[]
  reverse: string[]
  error?: string
}

export interface PortScanEntryDto {
  port: number
  service: string
  open: boolean
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export interface MetricSampleDto {
  hostId: string
  ts: number
  ok: boolean
  load1: number | null
  loadText: string | null
  memUsedPct: number | null
  diskUsedPct: number | null
  uptimeSec: number | null
  cpuCount: number | null
  error?: string
}

export interface SshConfigImportResult {
  hostsImported: number
  keysImported: number
  groupName: string
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Terminal sessions (local PTY + SSH)
// ---------------------------------------------------------------------------

export type SessionKind = 'local' | 'ssh' | 'telnet' | 'serial'

export type SessionStatus = 'connecting' | 'connected' | 'reconnecting'

export interface SerialPortInfo {
  path: string
  label: string
}

export interface SessionLogState {
  sessionId: string
  active: boolean
  filePath?: string
}

export interface SessionRecordState {
  sessionId: string
  active: boolean
  filePath?: string
}

export interface RecordingInfoDto {
  name: string
  path: string
  sizeBytes: number
  mtimeMs: number
}

export interface TerminalCreateRequest {
  kind: SessionKind
  cols: number
  rows: number
  /** kind=local: id shell profile (bỏ trống → mặc định). */
  profileId?: string
  /** kind=ssh: id host đã lưu trong vault. */
  hostId?: string
  /** kind=ssh: Quick Connect "user@host[:port]" — không cần host lưu sẵn. */
  quickTarget?: string
  cwd?: string
}

export interface TerminalCreateResponse {
  sessionId: string
  kind: SessionKind
  title: string
  subtitle?: string
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number | null
  reason?: string
}

export interface TerminalStatusEvent {
  sessionId: string
  status: SessionStatus
  detail?: string
}

// ---------------------------------------------------------------------------
// Prompts (main hỏi → renderer trả lời)
// ---------------------------------------------------------------------------

/** Câu hỏi xác minh host key (TOFU hoặc fingerprint thay đổi). */
export interface HostKeyQuestion {
  requestId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  kind: 'unknown' | 'mismatch'
  /** kind=mismatch: fingerprint đã lưu trước đó. */
  knownFingerprint?: string
}

export interface PasswordQuestion {
  requestId: string
  /** vd "root@1.2.3.4" */
  target: string
}

// ---------------------------------------------------------------------------
// API preload expose cho renderer qua `window.infra`
// ---------------------------------------------------------------------------

// ── Plugins (F16) ────────────────────────────────────────────────────────────
export type PluginStatusDto = 'active' | 'disabled' | 'failed' | 'crashed' | 'loading'

export interface PluginCommandDto {
  id: string
  title: string
}

export interface PluginInfoDto {
  id: string
  name: string
  version: string
  description: string | null
  enabled: boolean
  status: PluginStatusDto
  error: string | null
  commands: PluginCommandDto[]
  permissions: string[]
  logTail: string[]
}

/** Lệnh plugin đóng góp vào Command Palette. */
export interface ContributedCommandDto {
  pluginId: string
  commandId: string
  title: string
}

export interface PluginPanelDto {
  pluginId: string
  title: string
  markdown?: string
  text?: string
}

export interface PluginNotifyDto {
  pluginId: string
  message: string
}

export interface InfraApi {
  vault: {
    status(): Promise<VaultStatus>
    setup(masterPassword: string, remember: boolean): Promise<VaultStatus>
    unlock(masterPassword: string, remember: boolean): Promise<VaultStatus>
    lock(): Promise<VaultStatus>
    /** Sự kiện vault bị khoá từ main (auto-lock). Trả về hàm unsubscribe. */
    onLocked(cb: () => void): () => void
  }
  data: {
    listShells(): Promise<ShellProfile[]>
    listGroups(): Promise<GroupDto[]>
    saveGroup(group: GroupInput): Promise<GroupDto>
    deleteGroup(id: string): Promise<void>
    listHosts(): Promise<HostDto[]>
    saveHost(input: HostInput): Promise<HostDto>
    deleteHost(id: string): Promise<void>
    listKeys(): Promise<SshKeyDto[]>
    generateKey(label: string): Promise<SshKeyDto>
    importKey(input: KeyImportInput): Promise<SshKeyDto>
    deleteKey(id: string): Promise<void>
    listHistory(limit?: number): Promise<HistoryEntry[]>
    listSnippets(): Promise<SnippetDto[]>
    saveSnippet(input: SnippetInput): Promise<SnippetDto>
    deleteSnippet(id: string): Promise<void>
  }
  tunnels: {
    list(): Promise<TunnelRuleDto[]>
    save(input: TunnelRuleInput): Promise<TunnelRuleDto>
    delete(id: string): Promise<void>
    start(id: string): Promise<void>
    stop(id: string): Promise<void>
    states(): Promise<TunnelStateDto[]>
    onState(cb: (e: TunnelStateDto) => void): () => void
  }
  terminal: {
    create(req: TerminalCreateRequest): Promise<TerminalCreateResponse>
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    kill(sessionId: string): void
    onData(cb: (e: TerminalDataEvent) => void): () => void
    onExit(cb: (e: TerminalExitEvent) => void): () => void
    onStatus(cb: (e: TerminalStatusEvent) => void): () => void
    /** Bật/tắt ghi log phiên ra file. Trả về trạng thái + đường dẫn file. */
    toggleLog(sessionId: string, title: string): Promise<SessionLogState>
    /** Mở thư mục chứa log bằng file explorer. */
    openLogFolder(): void
    /** Bật/tắt ghi hình phiên (asciicast v2 — replay được). */
    toggleRecord(sessionId: string, title: string): Promise<SessionRecordState>
    /** Báo main phiên terminal đang active (cho plugin api.terminal.getActiveSessionId). */
    setActive(sessionId: string | null): void
  }
  recordings: {
    list(): Promise<RecordingInfoDto[]>
    /** Đọc nội dung file .cast để replay. */
    read(name: string): Promise<string>
    openFolder(): void
    delete(name: string): Promise<void>
  }
  serial: {
    listPorts(): Promise<SerialPortInfo[]>
  }
  sftp: {
    open(hostId: string): Promise<SftpOpenResponse>
    close(sessionId: string): void
    list(sessionId: string, path: string): Promise<FileEntryDto[]>
    mkdir(sessionId: string, path: string): Promise<void>
    rename(sessionId: string, from: string, to: string): Promise<void>
    delete(sessionId: string, path: string, isDir: boolean): Promise<void>
    chmod(sessionId: string, path: string, mode: string): Promise<void>
    /** Tải file/thư mục remote về thư mục local. */
    download(sessionId: string, remotePath: string, localDir: string): Promise<void>
    /** Đẩy file/thư mục local lên thư mục remote. */
    upload(sessionId: string, localPath: string, remoteDir: string): Promise<void>
    /** Mở file remote bằng editor local; tự upload lại khi file thay đổi. */
    edit(sessionId: string, remotePath: string): Promise<void>
    onTransfer(cb: (e: TransferEvent) => void): () => void
  }
  fs: {
    roots(): Promise<string[]>
    home(): Promise<string>
    list(path: string): Promise<FileEntryDto[]>
    mkdir(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    delete(path: string): Promise<void>
  }
  importer: {
    /** Mở dialog chọn file ssh_config rồi import. null = user huỷ. */
    sshConfig(): Promise<SshConfigImportResult | null>
  }
  bulk: {
    /**
     * Chạy lệnh trên nhiều host song song. Kết quả stream qua onEvent.
     * runId do renderer sinh (event lỗi prepare có thể về TRƯỚC khi invoke resolve).
     */
    run(runId: string, hostIds: string[], command: string): Promise<string>
    /** Hủy run đang chạy: dừng host xếp hàng + đóng kết nối đang chạy. */
    cancel(runId: string): Promise<void>
    onEvent(cb: (e: BulkRunEvent) => void): () => void
  }
  net: {
    ping(host: string): Promise<PingResultDto>
    dns(host: string): Promise<DnsResultDto>
    portCheck(host: string, port: number): Promise<{ open: boolean; ms: number }>
    scan(host: string): Promise<PortScanEntryDto[]>
  }
  monitor: {
    /** Bắt đầu theo dõi các host (mở kết nối + poll). */
    start(hostIds: string[]): Promise<void>
    stop(hostId: string): void
    stopAll(): void
    onSample(cb: (s: MetricSampleDto) => void): () => void
  }
  ai: {
    getConfig(): Promise<AiConfigDto | null>
    setConfig(input: AiConfigInput): Promise<void>
    ask(mode: AiModeDto, input: string, context?: string): Promise<AiAskResultDto>
  }
  sync: {
    status(): Promise<SyncStatusDto>
    /** Mở dialog chọn thư mục đồng bộ. null = huỷ. */
    pickFolder(): Promise<string | null>
    /** Bật sync: dẫn xuất sync key từ passphrase, verify với blob hiện có, ghi nhớ key. */
    configure(folderPath: string, passphrase: string): Promise<SyncRunResult>
    now(): Promise<SyncRunResult>
    disable(): Promise<SyncStatusDto>
  }
  prompts: {
    onHostKey(cb: (q: HostKeyQuestion) => void): () => void
    onPassword(cb: (q: PasswordQuestion) => void): () => void
    answer(requestId: string, answer: unknown): void
  }
  versions: {
    electron: string
    node: string
    chrome: string
  }
  update: {
    /** Kiểm tra update — trả về ngay, kết quả về qua onAvailable / onDownloaded. */
    check(): Promise<void>
    /** Bắt đầu tải bản cập nhật về nền. */
    download(): Promise<void>
    /** Thoát app và cài bản vừa tải (chỉ gọi sau khi onDownloaded đã bắn). */
    install(): void
    /** Bản mới có sẵn — version là string vd "1.2.3". */
    onAvailable(cb: (version: string) => void): () => void
    /** Tiến trình tải — percent từ 0 đến 100. */
    onProgress(cb: (percent: number) => void): () => void
    /** Tải xong, sẵn sàng cài. */
    onDownloaded(cb: (version: string) => void): () => void
  }
  plugins: {
    list(): Promise<PluginInfoDto[]>
    setEnabled(id: string, enabled: boolean): Promise<PluginInfoDto[]>
    reload(id: string): Promise<PluginInfoDto[]>
    /** Quét lại thư mục plugins (phát hiện plugin mới) — không cần khởi động lại. */
    rescan(): Promise<PluginInfoDto[]>
    /** Mở thư mục plugins (hoặc thư mục 1 plugin) bằng file explorer. */
    openFolder(id?: string): void
    /** Chạy 1 lệnh do plugin đóng góp; activeSessionId lấy từ tab đang mở. */
    invokeCommand(pluginId: string, commandId: string, activeSessionId: string | null): Promise<void>
    contributions(): Promise<ContributedCommandDto[]>
    onContributionsChanged(cb: (list: ContributedCommandDto[]) => void): () => void
    onPanel(cb: (p: PluginPanelDto) => void): () => void
    onNotify(cb: (n: PluginNotifyDto) => void): () => void
  }
}
