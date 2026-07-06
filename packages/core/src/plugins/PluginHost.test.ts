import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'
import { PluginHost, type PluginHostAdapters, type PluginWorkerLike } from './PluginHost'
import type { HostToWorker, WorkerToHost } from './protocol'

const roots: string[] = []
function newPluginsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'infra-phost-'))
  roots.push(dir)
  return dir
}
function writePlugin(pluginsDir: string, id: string, commands: { id: string; title: string }[] = []): void {
  const dir = join(pluginsDir, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ id, name: id.toUpperCase(), version: '1.0.0', contributes: { commands } })
  )
  writeFileSync(join(dir, 'index.js'), 'module.exports.activate = () => {}')
}

class FakeWorker implements PluginWorkerLike {
  posted: HostToWorker[] = []
  terminated = false
  private msgCb: ((m: WorkerToHost) => void) | null = null
  private exitCb: ((code: number) => void) | null = null
  private errCb: ((e: Error) => void) | null = null
  postMessage(msg: HostToWorker): void {
    this.posted.push(msg)
  }
  onMessage(cb: (m: WorkerToHost) => void): void {
    this.msgCb = cb
  }
  onExit(cb: (code: number) => void): void {
    this.exitCb = cb
  }
  onError(cb: (e: Error) => void): void {
    this.errCb = cb
  }
  terminate(): void {
    this.terminated = true
  }
  // test helpers
  emit(m: WorkerToHost): void {
    this.msgCb?.(m)
  }
  exit(code = 1): void {
    this.exitCb?.(code)
  }
  err(e: Error): void {
    this.errCb?.(e)
  }
}

interface Harness {
  host: PluginHost
  workers: FakeWorker[]
  last: () => FakeWorker
  state: Record<string, { enabled: boolean }>
  writes: { sessionId: string; data: string }[]
  storage: Record<string, Record<string, unknown>>
  activeSessionId: string | null
  prompts: { pluginId: string; opts: unknown }[]
  promptAnswer: string | null
}

function makeHost(pluginsDir: string, overrides: Partial<PluginHostAdapters> = {}): Harness {
  const workers: FakeWorker[] = []
  const h: Harness = {
    host: null as unknown as PluginHost,
    workers,
    last: () => workers[workers.length - 1]!,
    state: {},
    writes: [],
    storage: {},
    activeSessionId: 'sess-active',
    prompts: [],
    promptAnswer: null
  }
  const adapters: PluginHostAdapters = {
    pluginsDir,
    createWorker: () => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    },
    readState: () => h.state,
    writeState: (s) => {
      h.state = s
    },
    terminalWrite: (sessionId, data) => {
      h.writes.push({ sessionId, data })
    },
    getActiveSessionId: () => h.activeSessionId,
    storageGet: (pluginId, key) => h.storage[pluginId]?.[key],
    storageSet: (pluginId, key, value) => {
      ;(h.storage[pluginId] ??= {})[key] = value
    },
    promptUser: (pluginId, opts) => {
      h.prompts.push({ pluginId, opts })
      return Promise.resolve(h.promptAnswer)
    },
    ...overrides
  }
  h.host = new PluginHost(adapters)
  return h
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

afterEach(() => {
  vi.useRealTimers()
})
afterAll(() => {
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('PluginHost', () => {
  test('activate: queue tới khi ready → activated → status active', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    h.host.init()
    // chưa ready → activate nằm trong outbox, worker chưa nhận
    expect(h.last().posted).toHaveLength(0)
    h.last().emit({ t: 'ready' })
    expect(h.last().posted.some((m) => m.t === 'activate' && m.pluginId === 'demo')).toBe(true)
    h.last().emit({ t: 'activated', pluginId: 'demo' })
    expect(h.host.list()[0]!.status).toBe('active')
  })

  test('activate-error → failed + error, không ảnh hưởng plugin khác', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'aaa')
    writePlugin(dir, 'bbb')
    const h = makeHost(dir)
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.last().emit({ t: 'activate-error', pluginId: 'aaa', message: 'bùm', stack: 'stack...' })
    h.last().emit({ t: 'activated', pluginId: 'bbb' })
    const list = h.host.list()
    expect(list.find((p) => p.id === 'aaa')!.status).toBe('failed')
    expect(list.find((p) => p.id === 'aaa')!.error).toBe('bùm')
    expect(list.find((p) => p.id === 'bbb')!.status).toBe('active')
  })

  test('activate timeout → failed', () => {
    vi.useFakeTimers()
    const dir = newPluginsDir()
    writePlugin(dir, 'slow')
    const h = makeHost(dir)
    h.host.init()
    h.last().emit({ t: 'ready' })
    vi.advanceTimersByTime(10_001)
    expect(h.host.list()[0]!.status).toBe('failed')
  })

  test('register → contributions cập nhật + phát sự kiện (chỉ khi active)', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    const seen: number[] = []
    h.host.on('contributions-changed', (list) => seen.push(list.length))
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.last().emit({ t: 'register', pluginId: 'demo', contributions: { commands: [{ id: 'demo.x', title: 'X' }] } })
    // chưa activated → contributions() lọc theo status active = rỗng
    expect(h.host.contributions()).toHaveLength(0)
    h.last().emit({ t: 'activated', pluginId: 'demo' })
    expect(h.host.contributions()).toEqual([{ pluginId: 'demo', commandId: 'demo.x', title: 'X' }])
    expect(seen.length).toBeGreaterThan(0)
  })

  test('api-call: getActiveSessionId round-trip → api-result ok', async () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.last().emit({ t: 'api-call', callId: 'c1', pluginId: 'demo', method: 'terminal.getActiveSessionId', args: [] })
    await tick()
    const res = h.last().posted.find((m) => m.t === 'api-result' && m.callId === 'c1')
    expect(res).toMatchObject({ t: 'api-result', ok: true, value: 'sess-active' })
  })

  test('api-call: terminal.write gọi adapter; lỗi adapter → ok:false', async () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir, {
      terminalWrite: () => {
        throw new Error('no session')
      }
    })
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.last().emit({ t: 'api-call', callId: 'c2', pluginId: 'demo', method: 'terminal.write', args: ['s', 'echo\n'] })
    await tick()
    const res = h.last().posted.find((m) => m.t === 'api-result' && m.callId === 'c2')
    expect(res).toMatchObject({ ok: false, error: 'no session' })
  })

  test('ui.showPanel / ui.notify phát sự kiện', async () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    const panels: unknown[] = []
    const notifs: unknown[] = []
    h.host.on('panel', (p) => panels.push(p))
    h.host.on('notify', (n) => notifs.push(n))
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.last().emit({
      t: 'api-call',
      callId: 'p1',
      pluginId: 'demo',
      method: 'ui.showPanel',
      args: [{ title: 'T', markdown: '# hi' }]
    })
    h.last().emit({ t: 'api-call', callId: 'n1', pluginId: 'demo', method: 'ui.notify', args: ['xin chào'] })
    await tick()
    expect(panels).toEqual([{ pluginId: 'demo', title: 'T', markdown: '# hi', text: undefined }])
    expect(notifs).toEqual([{ pluginId: 'demo', message: 'xin chào' }])
  })

  test('ui.prompt round-trip qua adapter promptUser → api-result trả câu trả lời (null = Huỷ)', async () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    h.promptAnswer = '/var/log/nginx/access.log'
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.last().emit({
      t: 'api-call',
      callId: 'q1',
      pluginId: 'demo',
      method: 'ui.prompt',
      args: [{ title: 'Chọn log', placeholder: '/etc/httpd/logs/ssl_access_log' }]
    })
    await tick()
    expect(h.prompts).toEqual([
      { pluginId: 'demo', opts: { title: 'Chọn log', placeholder: '/etc/httpd/logs/ssl_access_log' } }
    ])
    const res = h.last().posted.find((m) => m.t === 'api-result' && m.callId === 'q1')
    expect(res).toMatchObject({ ok: true, value: '/var/log/nginx/access.log' })

    h.promptAnswer = null // user Huỷ / timeout
    h.last().emit({ t: 'api-call', callId: 'q2', pluginId: 'demo', method: 'ui.prompt', args: [{}] })
    await tick()
    const res2 = h.last().posted.find((m) => m.t === 'api-result' && m.callId === 'q2')
    expect(res2).toMatchObject({ ok: true, value: null })
  })

  test('subscribe-terminal ref-count + onTerminalData chỉ forward khi có subscriber active', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.last().emit({ t: 'activated', pluginId: 'demo' })
    expect(h.host.hasTerminalSubscribers()).toBe(false)
    h.host.onTerminalData('s1', 'data')
    expect(h.last().posted.some((m) => m.t === 'terminalData')).toBe(false)

    h.last().emit({ t: 'subscribe-terminal', pluginId: 'demo', on: true })
    expect(h.host.hasTerminalSubscribers()).toBe(true)
    h.host.onTerminalData('s1', 'data')
    expect(h.last().posted.some((m) => m.t === 'terminalData')).toBe(true)

    h.last().emit({ t: 'subscribe-terminal', pluginId: 'demo', on: false })
    expect(h.host.hasTerminalSubscribers()).toBe(false)
  })

  test('disable gỡ contributions + post deactivate; enable activate lại', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.last().emit({ t: 'register', pluginId: 'demo', contributions: { commands: [{ id: 'demo.x', title: 'X' }] } })
    h.last().emit({ t: 'activated', pluginId: 'demo' })
    expect(h.host.contributions()).toHaveLength(1)

    h.host.setEnabled('demo', false)
    expect(h.host.list()[0]!.status).toBe('disabled')
    expect(h.host.contributions()).toHaveLength(0)
    expect(h.last().posted.some((m) => m.t === 'deactivate' && m.pluginId === 'demo')).toBe(true)
    expect(h.state.demo!.enabled).toBe(false)

    h.host.setEnabled('demo', true)
    expect(h.last().posted.some((m) => m.t === 'activate' && m.pluginId === 'demo')).toBe(true)
  })

  test('invokeCommand chỉ gửi khi plugin active, kèm activeSessionId', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    h.host.init()
    h.last().emit({ t: 'ready' })
    // chưa active → không gửi
    h.host.invokeCommand('demo', 'demo.x', 'sX')
    expect(h.last().posted.some((m) => m.t === 'invokeCommand')).toBe(false)
    h.last().emit({ t: 'activated', pluginId: 'demo' })
    h.host.invokeCommand('demo', 'demo.x', 'sX')
    const inv = h.last().posted.find((m) => m.t === 'invokeCommand')
    expect(inv).toMatchObject({ commandId: 'demo.x', ctx: { activeSessionId: 'sX' } })
  })

  test('worker crash → plugin crashed + respawn 1 lần', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.last().emit({ t: 'activated', pluginId: 'demo' })
    expect(h.workers).toHaveLength(1)

    h.last().exit(1)
    // respawn → worker thứ 2, plugin về loading (đang activate lại)
    expect(h.workers).toHaveLength(2)
    expect(h.host.list()[0]!.status).toBe('loading')
    h.last().emit({ t: 'ready' })
    h.last().emit({ t: 'activated', pluginId: 'demo' })
    expect(h.host.list()[0]!.status).toBe('active')

    // crash lần 2 → không respawn nữa (giữ crashed)
    h.last().exit(1)
    expect(h.workers).toHaveLength(2)
    expect(h.host.list()[0]!.status).toBe('crashed')
  })

  test('plugin lỗi manifest hiển thị trong list (failed)', () => {
    const dir = newPluginsDir()
    mkdirSync(join(dir, 'broken'), { recursive: true })
    writeFileSync(join(dir, 'broken', 'manifest.json'), '{ bad')
    const h = makeHost(dir)
    h.host.init()
    const broken = h.host.list().find((p) => p.id === 'broken')
    expect(broken?.status).toBe('failed')
    expect(broken?.error).toBeTruthy()
  })

  test('disposeAll: post deactivate + terminate worker', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'demo')
    const h = makeHost(dir)
    h.host.init()
    h.last().emit({ t: 'ready' })
    h.host.disposeAll()
    expect(h.last().terminated).toBe(true)
    expect(h.last().posted.some((m) => m.t === 'deactivate')).toBe(true)
  })
})
