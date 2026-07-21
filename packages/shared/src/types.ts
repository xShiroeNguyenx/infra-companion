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

/** 'none' = server cho vào không cần xác thực. 'secret' = lấy password từ secret manager (op/bw/vault).
 *  'key+password' = MFA: server bắt buộc CẢ publickey LẪN password (AuthenticationMethods publickey,password). */
export type AuthType = 'password' | 'key' | 'agent' | 'none' | 'secret' | 'key+password'

/** Giao thức của host. serial: hostname = COM port, port = baud rate.
 *  vnc/rdp (F13): remote desktop — hostname:port của máy đích, có thể xuyên jump host. */
export type HostProtocol = 'ssh' | 'telnet' | 'serial' | 'vnc' | 'rdp'

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
  /** Màu nhận diện (hex) — tô tab/pane/sidebar của host trong group (vd production đỏ). null = không màu. */
  color: string | null
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
  color?: string | null
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
  /** F41: đã lưu TOTP seed (seed thật không rời main — login script dùng token {{totp}}). */
  hasTotp: boolean
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
  /** F41 TOTP seed (base32): undefined = giữ nguyên, null/'' = xoá, string = đặt mới. */
  totpSecret?: string | null
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
export type AiModeDto = 'generate' | 'explain' | 'explain-error' | 'diagnose'

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

/** F48 — kết quả chạy MỘT lệnh chẩn đoán read-only qua kênh exec riêng. */
export interface AiDiagnoseExecResultDto {
  /** false = lệnh bị guard read-only chặn (blocked), không hề chạy trên remote. */
  ok: boolean
  /** Lý do chặn khi ok=false. */
  blockedReason?: string
  stdout: string
  stderr: string
  code: number | null
  /** Lỗi kết nối/timeout khi chạy (khác blockedReason). */
  error?: string
}

/** F48 — trạng thái kết thúc của một phiên chẩn đoán được lưu lại. */
export type AiDiagnoseStatusDto = 'done' | 'stopped' | 'error'

/** F48 — một bước trong phiên chẩn đoán (mirror của DiagnoseStep ở renderer để lưu/khôi phục). */
export interface AiDiagnoseStepDto {
  reasoning: string
  command: string
  status: 'proposed' | 'running' | 'done' | 'skipped' | 'blocked' | 'error'
  blockedReason?: string
  output?: string
  code?: number | null
  error?: string
}

/** F48 — payload lưu một phiên chẩn đoán vào lịch sử (steps + conclusion mã hoá bằng DEK ở vault). */
export interface AiDiagnoseSaveInput {
  hostId: string
  hostLabel: string
  symptom: string
  status: AiDiagnoseStatusDto
  steps: AiDiagnoseStepDto[]
  conclusion?: string
  error?: string
}

/** F48 — mục danh sách lịch sử chẩn đoán (nhẹ: chỉ metadata + trích kết luận để xem nhanh). */
export interface AiDiagnoseRecordDto {
  id: string
  hostLabel: string
  symptom: string
  status: AiDiagnoseStatusDto
  /** Vài trăm ký tự đầu của kết luận (đã giải mã) để hiển thị preview. */
  conclusionSnippet: string
  stepCount: number
  createdAt: number
}

/** F48 — chi tiết đầy đủ một phiên chẩn đoán đã lưu (để xem lại read-only). */
export interface AiDiagnoseDetailDto extends AiDiagnoseSaveInput {
  id: string
  createdAt: number
}

// ---------------------------------------------------------------------------
// Remote desktop — VNC + RDP (F13)
// ---------------------------------------------------------------------------

/** VNC nhúng: main mở cầu WebSocket↔TCP (qua jump host), noVNC ở renderer nối vào. */
export interface VncOpenResultDto {
  sessionId: string
  /** Cổng WebSocket local (127.0.0.1) để noVNC nối: ws://127.0.0.1:<wsPort>/?token=… */
  wsPort: number
  /** Token 1 phiên — ws server chỉ nhận kết nối có token đúng. */
  token: string
  title: string
}

/** RDP qua tunnel: main forward cổng 3389 rồi mở client RDP hệ điều hành trỏ vào cổng local. */
export interface RdpOpenResultDto {
  sessionId: string
  /** Cổng local (127.0.0.1) đã forward tới 3389 của đích. */
  localPort: number
  label: string
  /** true = đã tự mở client RDP (mstsc…); false = không mở được, user tự nối vào localPort. */
  launched: boolean
  /** Hướng dẫn khi launched=false (vd macOS/Linux không có client). */
  hint?: string
}

/** Một phiên RDP đang mở (tunnel còn sống) — cho danh sách quản lý/Dừng. */
export interface RdpSessionDto {
  sessionId: string
  label: string
  localPort: number
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
  /** % dùng cao nhất trong các mount thật (bỏ tmpfs…) — mount tương ứng ở diskMount. */
  diskUsedPct: number | null
  diskMount: string | null
  inodeUsedPct: number | null
  uptimeSec: number | null
  cpuCount: number | null
  /** CPU thật từ delta /proc/stat (null ở lần poll đầu). cpuPct = 100 − idle − iowait. */
  cpuPct: number | null
  cpuUserPct: number | null
  cpuSystemPct: number | null
  cpuIowaitPct: number | null
  /** % CPU bị hypervisor lấy (VPS) — ≥10% kéo dài là bất thường. */
  cpuStealPct: number | null
  /** Số tiến trình chờ CPU (cột r của vmstat). */
  runQueue: number | null
  swapUsedMb: number | null
  swapTotalMb: number | null
  netRxKbps: number | null
  netTxKbps: number | null
  tcpConns: number | null
  tcpTimeWait: number | null
  topProc: string | null
  /** Uptime service quen thuộc (httpd/nginx/java…) — tiến trình lâu đời nhất mỗi tên,
   *  sort giảm dần. Khác uptimeSec: service restart không đụng uptime server. */
  services: { name: string; uptimeSec: number }[] | null
  error?: string
}

export type MonitorAlertMetric = 'load' | 'mem' | 'disk' | 'steal' | 'conn' | 'offline'

/** Ngưỡng cảnh báo — null = tắt metric đó. loadPct chuẩn hoá theo core: load1/cpuCount*100
 *  (KHÔNG chặn 100 — server bận thường trực 300-400%+). connCount là số tuyệt đối. */
export interface MonitorThresholdsDto {
  loadPct: number | null
  memPct: number | null
  diskPct: number | null
  /** % CPU steal (VPS bị oversubscribe). */
  stealPct: number | null
  /** Số kết nối TCP ESTABLISHED. */
  connCount: number | null
  offline: boolean
}

/** Cài đặt cảnh báo monitoring — lưu file JSON userData (KHÔNG vault: alert phải chạy cả khi vault khoá). */
export interface MonitorSettingsDto {
  defaults: MonitorThresholdsDto
  /** Override từng host — thiếu field nào dùng defaults. Key của host đã xoá là vô hại (bị bỏ qua). */
  perHost: Record<string, Partial<MonitorThresholdsDto>>
  /** '' = tắt webhook. Tự nhận diện Google Chat/Slack/Discord/Telegram/generic theo URL. */
  webhookUrl: string
  /** Thông báo hệ điều hành (Windows toast) khi breach. */
  osNotify: boolean
}

export interface MonitorAlertDto {
  hostId: string
  label: string
  metric: MonitorAlertMetric
  kind: 'breach' | 'recover'
  /** Giá trị đo được lúc chốt cảnh báo (%; null với offline). */
  value: number | null
  /** Ngưỡng hiệu lực (null với offline). */
  threshold: number | null
  ts: number
}

/** 1 host có dữ liệu lịch sử metrics (từng được monitor, còn trong hạn giữ 30 ngày). */
export interface MetricHistoryHostDto {
  hostId: string
  firstTs: number
  lastTs: number
}

/** Một bucket lịch sử metrics (đầu bucket, giá trị trung bình trong bucket). */
export interface MetricHistoryPointDto {
  ts: number
  loadPct: number | null
  cpuPct: number | null
  stealPct: number | null
  memPct: number | null
  diskPct: number | null
  conns: number | null
  /** ok_count/total_count trong bucket (0..1). */
  okRatio: number
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

/** Câu hỏi nhập liệu do plugin phát (ui.prompt) — trả lời qua prompts.answer(requestId, ...). */
export interface PluginPromptDto {
  requestId: string
  pluginId: string
  title?: string
  label?: string
  placeholder?: string
  /** Giá trị điền sẵn trong ô nhập. */
  value?: string
}

// ── Marketplace (F52) ────────────────────────────────────────────────────────
/** 1 plugin trong registry công khai — bản rút gọn cho UI (files/URL ở lại main). */
export interface MarketplacePluginDto {
  id: string
  name: string
  version: string
  description: string | null
  author: string | null
}

export interface MarketplaceListDto {
  ok: boolean
  plugins: MarketplacePluginDto[]
  /** Thông báo lỗi (mất mạng, registry hỏng…) khi ok=false. */
  error: string | null
}

export interface MarketplaceInstallResultDto {
  ok: boolean
  error: string | null
}

// ---------------------------------------------------------------------------
// F39 — Uptime/port watcher nền
// ---------------------------------------------------------------------------

/** 1 host cần watch: TCP connect tới host:port (best-effort — host sau gate có thể không tới thẳng). */
export interface WatcherTargetDto {
  hostId: string
  host: string
  port: number
}

export interface WatcherStatusDto {
  hostId: string
  ok: boolean
  /** ms tới khi TCP mở được — null khi fail. */
  latencyMs: number | null
  ts: number
}

// ---------------------------------------------------------------------------
// F33/F34 — Process viewer + Systemd manager (qua kênh exec riêng, Linux)
// ---------------------------------------------------------------------------

export interface ProcessInfoDto {
  pid: number
  user: string
  /** %CPU / %MEM từ ps (1 chữ số thập phân). */
  cpuPct: number
  memPct: number
  rssKb: number
  /** etime của ps: [[dd-]hh:]mm:ss. */
  elapsed: string
  command: string
}

export interface ProcListResultDto {
  ok: boolean
  processes: ProcessInfoDto[]
  error?: string
}

export interface ServiceInfoDto {
  unit: string
  /** active/inactive/failed… (cột ACTIVE của systemctl). */
  active: string
  /** running/dead/exited… (cột SUB). */
  sub: string
  description: string
}

export interface ServiceListResultDto {
  ok: boolean
  services: ServiceInfoDto[]
  error?: string
}

export type ServiceActionDto = 'start' | 'stop' | 'restart'

export interface HostExecResultDto {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
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
  vnc: {
    /** Mở phiên VNC: main dựng cầu ws↔tcp (qua jump host), trả wsPort+token cho noVNC. */
    open(hostId: string): Promise<VncOpenResultDto>
    close(sessionId: string): void
  }
  rdp: {
    /** Mở RDP qua tunnel: forward cổng 3389 rồi mở client RDP hệ điều hành. */
    open(hostId: string): Promise<RdpOpenResultDto>
    close(sessionId: string): void
    list(): Promise<RdpSessionDto[]>
    onChange(cb: () => void): () => void
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
    /** Tải ảnh từ URL ở main process (tránh CORS) → trả về data URL gốc để renderer nén/lưu. */
    fetchImage(url: string): Promise<string>
  }
  monitor: {
    /** Bắt đầu theo dõi các host (mở kết nối + poll). Kèm label để main dựng thông báo/webhook kể cả khi vault khoá. */
    start(hosts: { id: string; label: string }[]): Promise<void>
    stop(hostId: string): void
    stopAll(): void
    /** Tham gia nhận sample mà KHÔNG khởi động lại SSH (cửa sổ tách rời) — main replay sample gần nhất. */
    subscribe(): void
    /** Monitoring bị dừng (từ bất kỳ cửa sổ nào) → mọi cửa sổ reset store. */
    onStopped(cb: () => void): () => void
    /** Mở cửa sổ monitor tách rời (always-on-top, sống cả khi thu nhỏ app chính). */
    openDetached(hosts: { id: string; label: string }[]): Promise<void>
    /** Đóng cửa sổ monitor tách rời (gộp lại về dock). */
    closeDetached(): void
    /** Cửa sổ tách rời gọi lúc khởi tạo để lấy danh sách host đang theo dõi. */
    detachedInit(): Promise<{ hosts: { id: string; label: string }[] }>
    /** App chính lắng nghe: true = đang có cửa sổ tách rời, false = đã đóng. */
    onDetachedState(cb: (open: boolean) => void): () => void
    onSample(cb: (s: MetricSampleDto) => void): () => void
    /** Cảnh báo ngưỡng breach/recover (F04). */
    onAlert(cb: (a: MonitorAlertDto) => void): () => void
    getSettings(): Promise<MonitorSettingsDto>
    setSettings(s: MonitorSettingsDto): Promise<void>
    /** Gửi alert giả qua webhook để kiểm tra URL. */
    testWebhook(url: string): Promise<{ ok: boolean; message: string }>
    /** Lịch sử metrics đã downsample (res 1 = bucket phút, 10 = bucket 10 phút). */
    queryHistory(hostId: string, fromTs: number, toTs: number, res: 1 | 10): Promise<MetricHistoryPointDto[]>
    /** Các host từng được monitor (còn dữ liệu lịch sử), mới nhất trước — cho mục Dashboard. */
    historyHosts(): Promise<MetricHistoryHostDto[]>
  }
  /** F39 — watcher nền: check TCP host:port định kỳ, chấm xanh/đỏ ở sidebar. */
  watcher: {
    /** Đặt danh sách host cần watch (thay tập cũ) + chạy sweep ngay. Gọi lại khi hosts đổi. */
    start(targets: WatcherTargetDto[]): void
    stop(): void
    /** Kết quả mỗi sweep (mảng đủ các target). */
    onStatus(cb: (statuses: WatcherStatusDto[]) => void): () => void
  }
  /** F33/F34 — công cụ host (process viewer + systemd manager) qua kênh exec riêng. */
  hostTools: {
    listProcesses(hostId: string, sortBy: 'cpu' | 'mem'): Promise<ProcListResultDto>
    /** Gửi signal cho PID (TERM trước, KILL khi cứng đầu). */
    killProcess(hostId: string, pid: number, signal: 'TERM' | 'KILL'): Promise<HostExecResultDto>
    listServices(hostId: string): Promise<ServiceListResultDto>
    /** systemctl start/stop/restart — có thể cần quyền root trên server. */
    serviceAction(hostId: string, unit: string, action: ServiceActionDto): Promise<HostExecResultDto>
    /** journalctl -u <unit> (120 dòng cuối). */
    serviceLogs(hostId: string, unit: string): Promise<HostExecResultDto>
    /** F49 — đọc nội dung 1 file trên host (stdout = nội dung), cắt ở ~1MB. Cho tính năng so sánh config. */
    readFile(hostId: string, path: string): Promise<HostExecResultDto>
  }
  ai: {
    getConfig(): Promise<AiConfigDto | null>
    setConfig(input: AiConfigInput): Promise<void>
    ask(mode: AiModeDto, input: string, context?: string): Promise<AiAskResultDto>
    /** F48 — chạy 1 lệnh chẩn đoán read-only trên host qua kênh exec riêng (enforce guard ở main). */
    diagnoseExec(hostId: string, command: string): Promise<AiDiagnoseExecResultDto>
    /** F48 — lưu một phiên chẩn đoán đã kết thúc vào lịch sử. Trả về id. */
    saveDiagnosis(input: AiDiagnoseSaveInput): Promise<string>
    /** F48 — danh sách lịch sử chẩn đoán (mới nhất trước). */
    listDiagnoses(limit?: number): Promise<AiDiagnoseRecordDto[]>
    /** F48 — chi tiết đầy đủ một phiên đã lưu để xem lại. */
    getDiagnosis(id: string): Promise<AiDiagnoseDetailDto | null>
    /** F48 — xoá một phiên khỏi lịch sử. */
    deleteDiagnosis(id: string): Promise<void>
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
    /** Chạy 1 lệnh do plugin đóng góp; activeSessionId lấy từ tab đang mở; arg tuỳ ý (link cmd: trong panel). */
    invokeCommand(pluginId: string, commandId: string, activeSessionId: string | null, arg?: string): Promise<void>
    contributions(): Promise<ContributedCommandDto[]>
    onContributionsChanged(cb: (list: ContributedCommandDto[]) => void): () => void
    onPanel(cb: (p: PluginPanelDto) => void): () => void
    onNotify(cb: (n: PluginNotifyDto) => void): () => void
    /** Plugin hỏi user 1 chuỗi (ui.prompt) — trả lời qua prompts.answer(requestId, chuỗi | null). */
    onPrompt(cb: (q: PluginPromptDto) => void): () => void
  }
  marketplace: {
    /** Tải + validate registry công khai (cache trong main 5 phút). */
    list(): Promise<MarketplaceListDto>
    /** Tải file plugin theo registry, verify sha256 rồi cài vào thư mục plugins. */
    install(id: string): Promise<MarketplaceInstallResultDto>
  }
}
