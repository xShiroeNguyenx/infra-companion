/**
 * Bootstrap chạy TRONG worker_thread (1 worker chung cho mọi plugin).
 * Nạp plugin CJS từ userData, dựng `api` proxy, định tuyến message với PluginHost ở main.
 * Mỗi plugin lỗi đều được bọc try/catch để không kéo cả worker.
 */
import { parentPort } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import type { ApiMethod, CommandCtx, HostToWorker, WorkerToHost } from '@infra/core'

const nodeRequire = createRequire(import.meta.url)
const port = parentPort

interface LoadedPlugin {
  id: string
  dir: string
  commandHandlers: Map<string, (ctx: CommandCtx) => void | Promise<void>>
  commands: { id: string; title: string }[]
  dataCallbacks: Set<(e: { sessionId: string; data: string }) => void>
  deactivate?: () => void
}

const plugins = new Map<string, LoadedPlugin>()
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const API_TIMEOUT_MS = 8_000
/** ui.prompt chờ user gõ — phải dài hơn timeout 120s của askRenderer phía main. */
const PROMPT_TIMEOUT_MS = 130_000

function post(msg: WorkerToHost): void {
  port?.postMessage(msg)
}

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

function callApi(pluginId: string, method: ApiMethod, args: unknown[], timeoutMs = API_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callId = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(callId)
      reject(new Error(`API "${method}" quá hạn`))
    }, timeoutMs)
    pending.set(callId, { resolve, reject, timer })
    post({ t: 'api-call', callId, pluginId, method, args })
  })
}

/** Dựng object api truyền vào activate(api) của 1 plugin (pluginId đóng cứng). */
function buildApi(p: LoadedPlugin): unknown {
  return {
    id: p.id,
    commands: {
      register(id: string, title: string, handler: (ctx: CommandCtx) => void | Promise<void>): void {
        p.commandHandlers.set(id, handler)
        const existing = p.commands.findIndex((c) => c.id === id)
        if (existing >= 0) p.commands[existing] = { id, title }
        else p.commands.push({ id, title })
        post({ t: 'register', pluginId: p.id, contributions: { commands: p.commands } })
      }
    },
    terminal: {
      onData(cb: (e: { sessionId: string; data: string }) => void): () => void {
        const wasEmpty = p.dataCallbacks.size === 0
        p.dataCallbacks.add(cb)
        if (wasEmpty) post({ t: 'subscribe-terminal', pluginId: p.id, on: true })
        return () => {
          p.dataCallbacks.delete(cb)
          if (p.dataCallbacks.size === 0) post({ t: 'subscribe-terminal', pluginId: p.id, on: false })
        }
      },
      write(sessionId: string, data: string): Promise<void> {
        return callApi(p.id, 'terminal.write', [sessionId, data]) as Promise<void>
      },
      getActiveSessionId(): Promise<string | null> {
        return callApi(p.id, 'terminal.getActiveSessionId', []) as Promise<string | null>
      }
    },
    ui: {
      showPanel(opts: { title: string; markdown?: string; text?: string }): Promise<void> {
        return callApi(p.id, 'ui.showPanel', [opts]) as Promise<void>
      },
      notify(message: string): Promise<void> {
        return callApi(p.id, 'ui.notify', [message]) as Promise<void>
      },
      prompt(opts: { title?: string; label?: string; placeholder?: string; value?: string }): Promise<string | null> {
        return callApi(p.id, 'ui.prompt', [opts], PROMPT_TIMEOUT_MS) as Promise<string | null>
      }
    },
    storage: {
      get(key: string): Promise<unknown> {
        return callApi(p.id, 'storage.get', [key])
      },
      set(key: string, value: unknown): Promise<void> {
        return callApi(p.id, 'storage.set', [key, value]) as Promise<void>
      }
    },
    log(...args: unknown[]): void {
      post({ t: 'log', pluginId: p.id, level: 'log', line: fmt(args) })
    }
  }
}

function bustCache(dir: string): void {
  for (const key of Object.keys(nodeRequire.cache)) {
    if (key.startsWith(dir)) delete nodeRequire.cache[key]
  }
}

function teardown(p: LoadedPlugin): void {
  try {
    p.deactivate?.()
  } catch (e) {
    post({ t: 'log', pluginId: p.id, level: 'error', line: `deactivate lỗi: ${(e as Error).message}` })
  }
  if (p.dataCallbacks.size > 0) post({ t: 'subscribe-terminal', pluginId: p.id, on: false })
  p.dataCallbacks.clear()
  p.commandHandlers.clear()
}

async function activate(pluginId: string, dir: string, entry: string): Promise<void> {
  // Gỡ plugin cũ (reload) + bust cache để nạp code mới
  const old = plugins.get(pluginId)
  if (old) teardown(old)
  bustCache(dir)

  const p: LoadedPlugin = {
    id: pluginId,
    dir,
    commandHandlers: new Map(),
    commands: [],
    dataCallbacks: new Set()
  }
  plugins.set(pluginId, p)

  try {
    const mod = nodeRequire(entry) as { activate?: (api: unknown) => void | Promise<void>; deactivate?: () => void }
    if (typeof mod.activate !== 'function') {
      throw new Error('plugin thiếu export "activate(api)"')
    }
    if (typeof mod.deactivate === 'function') p.deactivate = mod.deactivate
    await mod.activate(buildApi(p))
    post({ t: 'activated', pluginId })
  } catch (e) {
    plugins.delete(pluginId)
    const err = e as Error
    post({ t: 'activate-error', pluginId, message: err.message, stack: err.stack })
  }
}

function handle(msg: HostToWorker): void {
  switch (msg.t) {
    case 'activate':
      void activate(msg.pluginId, msg.dir, msg.entry)
      break
    case 'deactivate': {
      const p = plugins.get(msg.pluginId)
      if (p) {
        teardown(p)
        plugins.delete(msg.pluginId)
        bustCache(p.dir)
      }
      break
    }
    case 'invokeCommand': {
      const p = plugins.get(msg.pluginId)
      const handler = p?.commandHandlers.get(msg.commandId)
      if (handler) {
        try {
          void Promise.resolve(handler(msg.ctx)).catch((e: Error) =>
            post({ t: 'log', pluginId: msg.pluginId, level: 'error', line: `lệnh "${msg.commandId}" lỗi: ${e.message}` })
          )
        } catch (e) {
          post({ t: 'log', pluginId: msg.pluginId, level: 'error', line: `lệnh "${msg.commandId}" lỗi: ${(e as Error).message}` })
        }
      }
      break
    }
    case 'terminalData': {
      for (const p of plugins.values()) {
        for (const cb of p.dataCallbacks) {
          try {
            cb({ sessionId: msg.sessionId, data: msg.data })
          } catch (e) {
            post({ t: 'log', pluginId: p.id, level: 'error', line: `onData lỗi: ${(e as Error).message}` })
          }
        }
      }
      break
    }
    case 'api-result': {
      const entry = pending.get(msg.callId)
      if (!entry) break
      clearTimeout(entry.timer)
      pending.delete(msg.callId)
      if (msg.ok) entry.resolve(msg.value)
      else entry.reject(new Error(msg.error))
      break
    }
  }
}

port?.on('message', handle)
post({ t: 'ready' })
