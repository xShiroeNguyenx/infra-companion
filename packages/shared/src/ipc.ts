/** Tên các kênh IPC giữa main ↔ renderer. Mọi nơi phải dùng hằng số này, không hardcode chuỗi. */
export const IPC = {
  SHELLS_LIST: 'shells:list',

  VAULT_STATUS: 'vault:status',
  VAULT_SETUP: 'vault:setup',
  VAULT_UNLOCK: 'vault:unlock',
  VAULT_LOCK: 'vault:lock',
  VAULT_LOCKED_EVENT: 'vault:locked',

  GROUPS_LIST: 'groups:list',
  GROUPS_SAVE: 'groups:save',
  GROUPS_DELETE: 'groups:delete',

  HOSTS_LIST: 'hosts:list',
  HOSTS_SAVE: 'hosts:save',
  HOSTS_DELETE: 'hosts:delete',

  KEYS_LIST: 'keys:list',
  KEYS_GENERATE: 'keys:generate',
  KEYS_IMPORT: 'keys:import',
  KEYS_DELETE: 'keys:delete',

  HISTORY_LIST: 'history:list',

  SNIPPETS_LIST: 'snippets:list',
  SNIPPETS_SAVE: 'snippets:save',
  SNIPPETS_DELETE: 'snippets:delete',

  TUNNELS_LIST: 'tunnels:list',
  TUNNELS_SAVE: 'tunnels:save',
  TUNNELS_DELETE: 'tunnels:delete',
  TUNNELS_START: 'tunnels:start',
  TUNNELS_STOP: 'tunnels:stop',
  TUNNELS_STATES: 'tunnels:states',
  TUNNELS_EVENT: 'tunnels:event',

  TERM_CREATE: 'terminal:create',
  TERM_WRITE: 'terminal:write',
  TERM_RESIZE: 'terminal:resize',
  TERM_KILL: 'terminal:kill',
  TERM_DATA: 'terminal:data',
  TERM_EXIT: 'terminal:exit',
  TERM_STATUS: 'terminal:status',
  TERM_LOG_TOGGLE: 'terminal:log-toggle',
  TERM_LOG_OPEN_FOLDER: 'terminal:log-open-folder',
  TERM_RECORD_TOGGLE: 'terminal:record-toggle',
  TERM_SET_ACTIVE: 'terminal:set-active',

  REC_LIST: 'rec:list',
  REC_READ: 'rec:read',
  REC_OPEN_FOLDER: 'rec:open-folder',
  REC_DELETE: 'rec:delete',

  SERIAL_LIST: 'serial:list',

  SFTP_OPEN: 'sftp:open',
  SFTP_CLOSE: 'sftp:close',
  SFTP_LIST: 'sftp:list',
  SFTP_HOME: 'sftp:home',
  SFTP_MKDIR: 'sftp:mkdir',
  SFTP_RENAME: 'sftp:rename',
  SFTP_DELETE: 'sftp:delete',
  SFTP_CHMOD: 'sftp:chmod',
  SFTP_DOWNLOAD: 'sftp:download',
  SFTP_UPLOAD: 'sftp:upload',
  SFTP_EDIT: 'sftp:edit',
  TRANSFER_EVENT: 'transfer:event',

  FS_ROOTS: 'fs:roots',
  FS_HOME: 'fs:home',
  FS_LIST: 'fs:list',
  FS_MKDIR: 'fs:mkdir',
  FS_RENAME: 'fs:rename',
  FS_DELETE: 'fs:delete',

  IMPORT_SSH_CONFIG: 'import:ssh-config',

  BULK_RUN: 'bulk:run',
  BULK_CANCEL: 'bulk:cancel',
  BULK_EVENT: 'bulk:event',

  NET_PING: 'net:ping',
  NET_DNS: 'net:dns',
  NET_PORT: 'net:port',
  NET_SCAN: 'net:scan',
  NET_FETCH_IMAGE: 'net:fetchImage',

  MONITOR_START: 'monitor:start',
  MONITOR_STOP: 'monitor:stop',
  MONITOR_STOP_ALL: 'monitor:stop-all',
  MONITOR_SAMPLE: 'monitor:sample',

  AI_GET_CONFIG: 'ai:get-config',
  AI_SET_CONFIG: 'ai:set-config',
  AI_ASK: 'ai:ask',

  SYNC_STATUS: 'sync:status',
  SYNC_PICK_FOLDER: 'sync:pick-folder',
  SYNC_CONFIGURE: 'sync:configure',
  SYNC_NOW: 'sync:now',
  SYNC_DISABLE: 'sync:disable',

  PROMPT_HOSTKEY: 'prompt:hostkey',
  PROMPT_PASSWORD: 'prompt:password',
  PROMPT_ANSWER: 'prompt:answer',

  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_PROGRESS: 'update:progress',
  UPDATE_DOWNLOADED: 'update:downloaded',

  PLUGINS_LIST: 'plugins:list',
  PLUGINS_SET_ENABLED: 'plugins:set-enabled',
  PLUGINS_RELOAD: 'plugins:reload',
  PLUGINS_RESCAN: 'plugins:rescan',
  PLUGINS_OPEN_FOLDER: 'plugins:open-folder',
  PLUGINS_INVOKE_COMMAND: 'plugins:invoke-command',
  PLUGINS_CONTRIBUTIONS: 'plugins:contributions',
  PLUGINS_CONTRIBUTIONS_CHANGED: 'plugins:contributions-changed',
  PLUGINS_PANEL_SHOW: 'plugins:panel-show',
  PLUGINS_NOTIFY: 'plugins:notify'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
