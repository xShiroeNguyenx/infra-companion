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
export { deriveSftpExecFromLoginSteps, deriveExecFromLoginSteps, deriveStreamExecFromLoginSteps } from './connection/loginScript'
export type { LoginStepLike } from './connection/loginScript'
export { listSerialPorts } from './connection/SerialSession'
export { BulkService } from './bulk/BulkService'
export type { BulkTarget, BulkResult } from './bulk/BulkService'
export { execOnce } from './connection/execOnce'
export type { ExecOnceOptions, ExecOnceResult } from './connection/execOnce'
export { ping, dnsLookup, checkPort, scanCommonPorts, fetchImageAsDataUrl, normalizeImageUrl } from './nettools/netTools'
export type { PingResult, DnsResult, PortScanEntry } from './nettools/netTools'
export {
  assertSafeHostPattern,
  assertSafeIpLiteral,
  buildChromiumArgs,
  buildCurlResolveCommand,
  buildHostResolverRules,
  defaultUrlFor,
  isSafeHostPattern,
  isSafeHttpUrl,
  isSafeIpLiteral
} from './hostmap/hostMap'
export type { ChromiumArgsInput, HostMapGroup, HostMapTarget } from './hostmap/hostMap'
export { CHROMIUM_BROWSERS, detectChromiumBrowsers } from './hostmap/browsers'
export type { BrowserCandidate, BrowserEnv, DetectedBrowser } from './hostmap/browsers'
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
export { generateTotp, isValidTotpSecret, normalizeTotpSecret, applyTotpToken, TOTP_TOKEN } from './secrets/totp'
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
// Local dev stack (Laragon/LocalWP-style) — chạy trên máy local, không SSH.
export {
  localDevPaths,
  scopedPath,
  runtimeScopedPath,
  runtimeDir,
  siteDir,
  isSafeToDeleteRecursive
} from './localdev/paths'
export type {
  LocalDevPaths,
  RuntimeKind,
  ServiceSpec,
  ServiceState,
  ServiceStatus,
  StrayProcess
} from './localdev/types'
export {
  RUNTIME_SOURCES,
  cliShimSources,
  newestPhpRuntime,
  pickPhpForWebApp,
  resolveCatalog,
  runtimeSigningPayload,
  signRuntimeEntry,
  validateRuntimeManifest,
  verifyRuntimeEntry,
  webAppSources
} from './localdev/runtimeCatalog'
export type {
  RuntimeArchive,
  RuntimeCliShim,
  RuntimeManifest,
  RuntimeManifestEntry,
  RuntimeManifestResult,
  RuntimeSource,
  RuntimeWebApp
} from './localdev/runtimeCatalog'
export { nextDelayMs, pruneHistory, shouldGiveUp } from './localdev/backoff'
export { allocatePort, isReserved, pickPort, probePort } from './localdev/ports'
export type { PortBlockedReason, PortProbeResult, PortRange } from './localdev/ports'
export { LogRing, rotatePlan, shouldRotate, splitLines } from './localdev/logLines'
export { assertSafeDomain, assertSafePort, iniPath, isSafeDomain, isSafePort, nginxPath, toFwd } from './localdev/templates/escape'
export { renderNginxConf, renderSiteConf, upstreamName } from './localdev/templates/nginxConf'
export type { NginxConfModel, NginxSiteModel, NginxUpstream } from './localdev/templates/nginxConf'
export { DEFAULT_PHP_EXTENSIONS, renderPhpIni } from './localdev/templates/phpIni'
export type { PhpIniModel } from './localdev/templates/phpIni'
export { MARIADB_BIN_CANDIDATES, renderClientCnf, renderMyIni } from './localdev/templates/myIni'
export type { MyIniModel } from './localdev/templates/myIni'
export { renderPmaConfig } from './localdev/templates/pmaConfig'
export type { PmaConfigModel } from './localdev/templates/pmaConfig'
export { renderCmdShim } from './localdev/templates/cmdShim'
export type { CmdShimModel } from './localdev/templates/cmdShim'
export { LocalDevStore } from './localdev/LocalDevStore'
export {
  MARIADB_PORT_PURPOSE,
  WEB_PORT_PURPOSE,
  phpPortPurpose,
  sitePortPurpose
} from './localdev/portPurpose'
export type { SiteInsert, SiteRow, SiteUpdate } from './localdev/types'
export {
  ADMINER_DOMAIN,
  MARIADB_SERVICE_ID,
  PMA_DOMAIN,
  ManagedStackProvider,
  buildInstallDbArgs,
  parseCnfPassword
} from './localdev/ManagedStackProvider'
export {
  WP_DB_CONSTANTS,
  applyWpDbConfig,
  detectEol,
  looksLikeWpConfig,
  phpSingleQuoted,
  readDefine,
  readWpDbConfig,
  replaceDefine,
  wpDbHost
} from './localdev/wpConfig'
export type { ApplyWpDbResult, WpDbConfig, WpDbConstant } from './localdev/wpConfig'
export type { ManagedStackDeps, MariadbTarget, StackPortStore, StackSettings } from './localdev/ManagedStackProvider'
export type { StackCapabilities, StackProvider } from './localdev/StackProvider'
export { DbService } from './localdev/DbService'
export type { DbCredentials, DbReadyResult, DbServiceDeps } from './localdev/DbService'
export {
  IDENT_RE,
  assertIdent,
  buildCreateDbSql,
  buildDropDbSql,
  deriveDbNames,
  genDbPassword,
  pingDb,
  runSql,
  sqlQuote
} from './localdev/mysqlCli'
export type { MysqlCliDeps, SqlResult } from './localdev/mysqlCli'
export {
  deriveDomain,
  detectSiteKind,
  slugify,
  uniqueDomain,
  uniqueSlug
} from './localdev/siteScaffold'
export type { SiteTld } from './localdev/siteScaffold'
export { PhpCgiPool } from './localdev/php/PhpCgiPool'
export type { PhpBackend, PhpPoolInput } from './localdev/php/PhpBackend'
export { PROVENANCE_FILE, RuntimeManager } from './localdev/RuntimeManager'
export type {
  DownloadStream,
  InstalledRuntime,
  RuntimeManagerDeps,
  RuntimeProgress,
  RuntimeProvenance
} from './localdev/RuntimeManager'
export { ProcessSupervisor } from './localdev/ProcessSupervisor'
export type { SpawnFn, SpawnOptions, SpawnedProcess, SupervisorDeps } from './localdev/ProcessSupervisor'
export type { PlatformAdapter } from './localdev/platform/PlatformAdapter'
export { WindowsAdapter, parseExcludedPortRanges, parseStrayJson } from './localdev/platform/WindowsAdapter'
export { PosixAdapter, createPlatformAdapter } from './localdev/platform/PosixAdapter'
