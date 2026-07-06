import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type BulkRunEvent,
  type GroupInput,
  type HostInput,
  type HostKeyQuestion,
  type InfraApi,
  type KeyImportInput,
  type ContributedCommandDto,
  type MetricSampleDto,
  type PasswordQuestion,
  type PluginNotifyDto,
  type PluginPanelDto,
  type PluginPromptDto,
  type SnippetInput,
  type TerminalCreateRequest,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type TerminalStatusEvent,
  type TransferEvent,
  type TunnelRuleInput,
  type TunnelStateDto
} from '@infra/shared'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

const api: InfraApi = {
  vault: {
    status: () => ipcRenderer.invoke(IPC.VAULT_STATUS),
    setup: (masterPassword, remember) => ipcRenderer.invoke(IPC.VAULT_SETUP, masterPassword, remember),
    unlock: (masterPassword, remember) => ipcRenderer.invoke(IPC.VAULT_UNLOCK, masterPassword, remember),
    lock: () => ipcRenderer.invoke(IPC.VAULT_LOCK),
    onLocked: (cb) => subscribe<void>(IPC.VAULT_LOCKED_EVENT, cb)
  },
  data: {
    listShells: () => ipcRenderer.invoke(IPC.SHELLS_LIST),
    listGroups: () => ipcRenderer.invoke(IPC.GROUPS_LIST),
    saveGroup: (group: GroupInput) => ipcRenderer.invoke(IPC.GROUPS_SAVE, group),
    deleteGroup: (id) => ipcRenderer.invoke(IPC.GROUPS_DELETE, id),
    listHosts: () => ipcRenderer.invoke(IPC.HOSTS_LIST),
    saveHost: (input: HostInput) => ipcRenderer.invoke(IPC.HOSTS_SAVE, input),
    deleteHost: (id) => ipcRenderer.invoke(IPC.HOSTS_DELETE, id),
    listKeys: () => ipcRenderer.invoke(IPC.KEYS_LIST),
    generateKey: (label) => ipcRenderer.invoke(IPC.KEYS_GENERATE, label),
    importKey: (input: KeyImportInput) => ipcRenderer.invoke(IPC.KEYS_IMPORT, input),
    deleteKey: (id) => ipcRenderer.invoke(IPC.KEYS_DELETE, id),
    listHistory: (limit) => ipcRenderer.invoke(IPC.HISTORY_LIST, limit),
    listSnippets: () => ipcRenderer.invoke(IPC.SNIPPETS_LIST),
    saveSnippet: (input: SnippetInput) => ipcRenderer.invoke(IPC.SNIPPETS_SAVE, input),
    deleteSnippet: (id) => ipcRenderer.invoke(IPC.SNIPPETS_DELETE, id)
  },
  tunnels: {
    list: () => ipcRenderer.invoke(IPC.TUNNELS_LIST),
    save: (input: TunnelRuleInput) => ipcRenderer.invoke(IPC.TUNNELS_SAVE, input),
    delete: (id) => ipcRenderer.invoke(IPC.TUNNELS_DELETE, id),
    start: (id) => ipcRenderer.invoke(IPC.TUNNELS_START, id),
    stop: (id) => ipcRenderer.invoke(IPC.TUNNELS_STOP, id),
    states: () => ipcRenderer.invoke(IPC.TUNNELS_STATES),
    onState: (cb) => subscribe<TunnelStateDto>(IPC.TUNNELS_EVENT, cb)
  },
  terminal: {
    create: (req: TerminalCreateRequest) => ipcRenderer.invoke(IPC.TERM_CREATE, req),
    write: (sessionId, data) => ipcRenderer.send(IPC.TERM_WRITE, sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.TERM_RESIZE, sessionId, cols, rows),
    kill: (sessionId) => ipcRenderer.send(IPC.TERM_KILL, sessionId),
    onData: (cb) => subscribe<TerminalDataEvent>(IPC.TERM_DATA, cb),
    onExit: (cb) => subscribe<TerminalExitEvent>(IPC.TERM_EXIT, cb),
    onStatus: (cb) => subscribe<TerminalStatusEvent>(IPC.TERM_STATUS, cb),
    toggleLog: (sessionId, title) => ipcRenderer.invoke(IPC.TERM_LOG_TOGGLE, sessionId, title),
    openLogFolder: () => ipcRenderer.send(IPC.TERM_LOG_OPEN_FOLDER),
    toggleRecord: (sessionId, title) => ipcRenderer.invoke(IPC.TERM_RECORD_TOGGLE, sessionId, title),
    setActive: (sessionId) => ipcRenderer.send(IPC.TERM_SET_ACTIVE, sessionId)
  },
  recordings: {
    list: () => ipcRenderer.invoke(IPC.REC_LIST),
    read: (name) => ipcRenderer.invoke(IPC.REC_READ, name),
    openFolder: () => ipcRenderer.send(IPC.REC_OPEN_FOLDER),
    delete: (name) => ipcRenderer.invoke(IPC.REC_DELETE, name)
  },
  serial: {
    listPorts: () => ipcRenderer.invoke(IPC.SERIAL_LIST)
  },
  sftp: {
    open: (hostId) => ipcRenderer.invoke(IPC.SFTP_OPEN, hostId),
    close: (sessionId) => ipcRenderer.send(IPC.SFTP_CLOSE, sessionId),
    list: (sessionId, path) => ipcRenderer.invoke(IPC.SFTP_LIST, sessionId, path),
    mkdir: (sessionId, path) => ipcRenderer.invoke(IPC.SFTP_MKDIR, sessionId, path),
    rename: (sessionId, from, to) => ipcRenderer.invoke(IPC.SFTP_RENAME, sessionId, from, to),
    delete: (sessionId, path, isDir) => ipcRenderer.invoke(IPC.SFTP_DELETE, sessionId, path, isDir),
    chmod: (sessionId, path, mode) => ipcRenderer.invoke(IPC.SFTP_CHMOD, sessionId, path, mode),
    download: (sessionId, remotePath, localDir) =>
      ipcRenderer.invoke(IPC.SFTP_DOWNLOAD, sessionId, remotePath, localDir),
    upload: (sessionId, localPath, remoteDir) =>
      ipcRenderer.invoke(IPC.SFTP_UPLOAD, sessionId, localPath, remoteDir),
    edit: (sessionId, remotePath) => ipcRenderer.invoke(IPC.SFTP_EDIT, sessionId, remotePath),
    onTransfer: (cb) => subscribe<TransferEvent>(IPC.TRANSFER_EVENT, cb)
  },
  fs: {
    roots: () => ipcRenderer.invoke(IPC.FS_ROOTS),
    home: () => ipcRenderer.invoke(IPC.FS_HOME),
    list: (path) => ipcRenderer.invoke(IPC.FS_LIST, path),
    mkdir: (path) => ipcRenderer.invoke(IPC.FS_MKDIR, path),
    rename: (from, to) => ipcRenderer.invoke(IPC.FS_RENAME, from, to),
    delete: (path) => ipcRenderer.invoke(IPC.FS_DELETE, path)
  },
  importer: {
    sshConfig: () => ipcRenderer.invoke(IPC.IMPORT_SSH_CONFIG)
  },
  bulk: {
    run: (runId, hostIds, command) => ipcRenderer.invoke(IPC.BULK_RUN, runId, hostIds, command),
    cancel: (runId) => ipcRenderer.invoke(IPC.BULK_CANCEL, runId),
    onEvent: (cb) => subscribe<BulkRunEvent>(IPC.BULK_EVENT, cb)
  },
  net: {
    ping: (host) => ipcRenderer.invoke(IPC.NET_PING, host),
    dns: (host) => ipcRenderer.invoke(IPC.NET_DNS, host),
    portCheck: (host, port) => ipcRenderer.invoke(IPC.NET_PORT, host, port),
    scan: (host) => ipcRenderer.invoke(IPC.NET_SCAN, host),
    fetchImage: (url) => ipcRenderer.invoke(IPC.NET_FETCH_IMAGE, url)
  },
  monitor: {
    start: (hostIds) => ipcRenderer.invoke(IPC.MONITOR_START, hostIds),
    stop: (hostId) => ipcRenderer.send(IPC.MONITOR_STOP, hostId),
    stopAll: () => ipcRenderer.send(IPC.MONITOR_STOP_ALL),
    onSample: (cb) => subscribe<MetricSampleDto>(IPC.MONITOR_SAMPLE, cb)
  },
  ai: {
    getConfig: () => ipcRenderer.invoke(IPC.AI_GET_CONFIG),
    setConfig: (input) => ipcRenderer.invoke(IPC.AI_SET_CONFIG, input),
    ask: (mode, input, context) => ipcRenderer.invoke(IPC.AI_ASK, mode, input, context)
  },
  sync: {
    status: () => ipcRenderer.invoke(IPC.SYNC_STATUS),
    pickFolder: () => ipcRenderer.invoke(IPC.SYNC_PICK_FOLDER),
    configure: (folderPath, passphrase) => ipcRenderer.invoke(IPC.SYNC_CONFIGURE, folderPath, passphrase),
    now: () => ipcRenderer.invoke(IPC.SYNC_NOW),
    disable: () => ipcRenderer.invoke(IPC.SYNC_DISABLE)
  },
  prompts: {
    onHostKey: (cb) => subscribe<HostKeyQuestion>(IPC.PROMPT_HOSTKEY, cb),
    onPassword: (cb) => subscribe<PasswordQuestion>(IPC.PROMPT_PASSWORD, cb),
    answer: (requestId, answer) => ipcRenderer.send(IPC.PROMPT_ANSWER, requestId, answer)
  },
  versions: {
    electron: process.versions.electron ?? '',
    node: process.versions.node ?? '',
    chrome: process.versions.chrome ?? ''
  },
  update: {
    check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    download: () => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
    install: () => ipcRenderer.send(IPC.UPDATE_INSTALL),
    onAvailable: (cb: (version: string) => void) => subscribe<string>(IPC.UPDATE_AVAILABLE, cb),
    onProgress: (cb: (percent: number) => void) => subscribe<number>(IPC.UPDATE_PROGRESS, cb),
    onDownloaded: (cb: (version: string) => void) => subscribe<string>(IPC.UPDATE_DOWNLOADED, cb)
  },
  plugins: {
    list: () => ipcRenderer.invoke(IPC.PLUGINS_LIST),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.PLUGINS_SET_ENABLED, id, enabled),
    reload: (id) => ipcRenderer.invoke(IPC.PLUGINS_RELOAD, id),
    rescan: () => ipcRenderer.invoke(IPC.PLUGINS_RESCAN),
    openFolder: (id) => ipcRenderer.send(IPC.PLUGINS_OPEN_FOLDER, id),
    invokeCommand: (pluginId, commandId, activeSessionId, arg) =>
      ipcRenderer.invoke(IPC.PLUGINS_INVOKE_COMMAND, pluginId, commandId, activeSessionId, arg),
    contributions: () => ipcRenderer.invoke(IPC.PLUGINS_CONTRIBUTIONS),
    onContributionsChanged: (cb) => subscribe<ContributedCommandDto[]>(IPC.PLUGINS_CONTRIBUTIONS_CHANGED, cb),
    onPanel: (cb) => subscribe<PluginPanelDto>(IPC.PLUGINS_PANEL_SHOW, cb),
    onNotify: (cb) => subscribe<PluginNotifyDto>(IPC.PLUGINS_NOTIFY, cb),
    onPrompt: (cb) => subscribe<PluginPromptDto>(IPC.PLUGINS_PROMPT, cb)
  }
}

contextBridge.exposeInMainWorld('infra', api)
