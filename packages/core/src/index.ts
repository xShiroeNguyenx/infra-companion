export { detectShells, defaultCwd } from './pty/shellDetector'
export { SessionManager } from './connection/SessionManager'
export type { SshSessionOptions } from './connection/SshSession'
export type { HostKeyInfo, HostKeyVerifier, TerminalSession } from './connection/types'
export { establishChain, agentPath, friendlySshError } from './connection/establish'
export type { ChainEndpoint, EstablishedChain } from './connection/establish'
export { TunnelService } from './connection/TunnelService'
export type { TunnelConnectionConfig } from './connection/TunnelService'
export { startForward } from './connection/forward'
export type { ForwardHandle } from './connection/forward'
export { SftpService } from './sftp/SftpService'
export { deriveSftpExecFromLoginSteps, deriveExecFromLoginSteps } from './connection/loginScript'
export type { LoginStepLike } from './connection/loginScript'
export { listSerialPorts } from './connection/SerialSession'
export { BulkService } from './bulk/BulkService'
export type { BulkTarget, BulkResult } from './bulk/BulkService'
export { execOnce } from './connection/execOnce'
export type { ExecOnceOptions, ExecOnceResult } from './connection/execOnce'
export { ping, dnsLookup, checkPort, scanCommonPorts, fetchImageAsDataUrl, normalizeImageUrl } from './nettools/netTools'
export type { PingResult, DnsResult, PortScanEntry } from './nettools/netTools'
export { MonitorService } from './monitor/MonitorService'
export type { MetricSample, MonitorTarget } from './monitor/MonitorService'
export { AlertEngine } from './monitor/AlertEngine'
export type { AlertRules, AlertThresholds, AlertEvent, AlertMetric } from './monitor/AlertEngine'
export { buildWebhookRequest, formatAlertText } from './monitor/webhook'
export { MetricsStore } from './monitor/MetricsStore'
export type { MetricHistoryPoint, MetricHistoryHost } from './monitor/MetricsStore'
export { AiService } from './ai/AiService'
export type { AiProvider, AiRuntimeConfig, AiAskRequest, AiAskResult, AiMode } from './ai/AiService'
export { isReadOnlyCommand } from './ai/readonlyGuard'
export type { ReadOnlyVerdict } from './ai/readonlyGuard'
export { resolveSecret, detectSecretProvider } from './secrets/SecretsService'
export type { SecretProvider } from './secrets/SecretsService'
export { importSshConfig, parseSshConfig } from './importers/sshConfig'
export { VaultService } from './vault/VaultService'
export type { KnownHostRecord, ResolvedConnection, ResolvedEndpoint, SyncSnapshot } from './vault/VaultService'
export { deriveSyncKey, newSyncSalt } from './vault/crypto'
export { SyncService, createBackend } from './sync/SyncService'
export type { SyncBackend, SyncResult } from './sync/SyncService'
export { validateManifest, parseManifest } from './plugins/manifest'
export type { PluginManifest, PluginCommandManifest, ManifestResult } from './plugins/manifest'
export { discoverPlugins } from './plugins/discover'
export type { DiscoveredPlugin, InvalidPlugin, DiscoverResult } from './plugins/discover'
export { pluginScopedPath } from './plugins/paths'
export { validateRegistry, parseRegistry, semverGt } from './plugins/registry'
export type { RegistryFile, RegistryPluginEntry, RegistryResult } from './plugins/registry'
export {
  pluginSigningPayload,
  signPluginEntry,
  verifyPluginEntry,
  OFFICIAL_REGISTRY_PUBLIC_KEY_PEM
} from './plugins/signing'
export { PluginHost } from './plugins/PluginHost'
export type {
  PluginHostAdapters,
  PluginWorkerLike,
  PluginInfo,
  PluginStatus,
  ContributedCommand,
  PluginPanelPayload,
  PluginNotifyPayload
} from './plugins/PluginHost'
export type {
  HostToWorker,
  WorkerToHost,
  ApiMethod,
  CommandCtx,
  WorkerContributions,
  PluginPromptOptions
} from './plugins/protocol'
