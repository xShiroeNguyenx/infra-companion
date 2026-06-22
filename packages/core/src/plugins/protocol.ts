import type { PluginManifest } from './manifest'

/**
 * Giao thức message giữa main (PluginHost) và worker_thread chạy plugin.
 * Single-source: cả host lẫn worker bootstrap đều import từ đây.
 */

/** Context truyền cho command handler lúc chạy (renderer cấp activeSessionId khi gọi). */
export interface CommandCtx {
  activeSessionId?: string
}

/** Method API mà plugin gọi — round-trip qua main, trả về api-result. */
export type ApiMethod =
  | 'terminal.write'
  | 'terminal.getActiveSessionId'
  | 'ui.showPanel'
  | 'ui.notify'
  | 'storage.get'
  | 'storage.set'

/** Đóng góp plugin đăng ký khi activate. */
export interface WorkerContributions {
  commands: { id: string; title: string }[]
}

/** main → worker. */
export type HostToWorker =
  | { t: 'activate'; pluginId: string; dir: string; entry: string; manifest: PluginManifest }
  | { t: 'deactivate'; pluginId: string }
  | { t: 'invokeCommand'; pluginId: string; commandId: string; ctx: CommandCtx }
  | { t: 'terminalData'; sessionId: string; data: string }
  | { t: 'api-result'; callId: string; ok: true; value: unknown }
  | { t: 'api-result'; callId: string; ok: false; error: string }

/** worker → main. */
export type WorkerToHost =
  | { t: 'ready' }
  | { t: 'activated'; pluginId: string }
  | { t: 'activate-error'; pluginId: string; message: string; stack?: string }
  | { t: 'register'; pluginId: string; contributions: WorkerContributions }
  | { t: 'subscribe-terminal'; pluginId: string; on: boolean }
  | { t: 'api-call'; callId: string; pluginId: string; method: ApiMethod; args: unknown[] }
  | { t: 'log'; pluginId: string; level: 'log' | 'warn' | 'error'; line: string }
