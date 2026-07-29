import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { ProcessSupervisor, type SpawnFn, type SpawnedProcess } from './ProcessSupervisor'
import { localDevPaths } from './paths'
import type { PlatformAdapter } from './platform/PlatformAdapter'
import type { LocalDevPaths, ServiceSpec, ServiceStatus, StrayProcess } from './types'

const roots: string[] = []
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

function newPaths(): LocalDevPaths {
  const dir = mkdtempSync(join(tmpdir(), 'infra-sup-'))
  roots.push(dir)
  return localDevPaths(dir)
}

/** Process giả: điều khiển được exit/stdout/stderr từ test. */
class FakeProc implements SpawnedProcess {
  pid: number | undefined
  private exitCbs: Array<(code: number | null, signal: string | null) => void> = []
  private errCbs: Array<(e: Error) => void> = []
  private outCbs: Array<(c: unknown) => void> = []
  private errOutCbs: Array<(c: unknown) => void> = []

  constructor(pid: number) {
    this.pid = pid
  }
  readonly stdout = { on: (_e: 'data', cb: (c: unknown) => void) => this.outCbs.push(cb) }
  readonly stderr = { on: (_e: 'data', cb: (c: unknown) => void) => this.errOutCbs.push(cb) }
  on(event: 'exit' | 'error', cb: never): this {
    if (event === 'exit') this.exitCbs.push(cb as unknown as (code: number | null, s: string | null) => void)
    else this.errCbs.push(cb as unknown as (e: Error) => void)
    return this
  }
  emitExit(code: number | null, signal: string | null = null): void {
    for (const cb of this.exitCbs) cb(code, signal)
  }
  emitError(e: Error): void {
    for (const cb of this.errCbs) cb(e)
  }
  writeOut(s: string): void {
    for (const cb of this.outCbs) cb(s)
  }
  writeErr(s: string): void {
    for (const cb of this.errOutCbs) cb(s)
  }
}

interface Harness {
  sup: ProcessSupervisor
  procs: FakeProc[]
  killed: number[]
  strays: StrayProcess[]
  statuses: ServiceStatus[]
  runPending: () => void
  paths: LocalDevPaths
  spawnCount: () => number
}

function harness(over?: {
  spawnThrows?: NodeJS.ErrnoException
  strays?: StrayProcess[]
  checkPort?: (port: number) => Promise<boolean>
}): Harness {
  const paths = newPaths()
  const procs: FakeProc[] = []
  const killed: number[] = []
  const statuses: ServiceStatus[] = []
  let pidSeq = 1000
  const pending: Array<{ fn: () => void }> = []

  const spawn: SpawnFn = () => {
    if (over?.spawnThrows) throw over.spawnThrows
    const p = new FakeProc(pidSeq++)
    procs.push(p)
    return p
  }

  const adapter: PlatformAdapter = {
    platform: 'win32',
    extractArchive: () => Promise.resolve(),
    killTree: (pid) => {
      killed.push(pid)
      return Promise.resolve()
    },
    findStrayProcesses: () => Promise.resolve(over?.strays ?? []),
    reservedPortRanges: () => Promise.resolve([]),
    runShort: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
    runWithStdinFile: () => Promise.resolve({ code: 0, stdout: '', stderr: '' })
  }

  const sup = new ProcessSupervisor({
    paths,
    adapter,
    spawn,
    // schedule giả: chạy ngay khi test gọi runPending() → không phải chờ backoff thật
    schedule: (fn) => {
      const item = { fn }
      pending.push(item)
      return () => {
        const i = pending.indexOf(item)
        if (i >= 0) pending.splice(i, 1)
      }
    },
    ...(over?.checkPort ? { checkPort: over.checkPort } : {}),
    healthFailThreshold: 3
  })
  sup.on('status', (s) => statuses.push(s))

  return {
    sup,
    procs,
    killed,
    strays: over?.strays ?? [],
    statuses,
    paths,
    spawnCount: () => procs.length,
    runPending: () => {
      const list = pending.splice(0, pending.length)
      for (const p of list) p.fn()
    }
  }
}

function spec(over: Partial<ServiceSpec> = {}): ServiceSpec {
  return {
    id: 'nginx',
    groupId: 'nginx',
    label: 'Nginx',
    exe: 'D:\\rt\\nginx-1.28\\nginx.exe',
    args: [],
    cwd: 'D:\\rt',
    env: { PATH: 'D:\\rt' },
    logFile: 'D:\\logs\\nginx.log',
    healthPort: 8080,
    restartOnCleanExit: false,
    maxRestarts: 3,
    restartWindowMs: 60_000,
    ...over
  }
}

describe('ProcessSupervisor — start/stop cơ bản', () => {
  test('start → running, có pid', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    const st = h.sup.status('nginx')[0]!
    expect(st.state).toBe('running')
    expect(st.pid).toBe(1000)
    expect(st.since).toBeTypeOf('number')
  })

  test('start 2 lần không spawn thêm process', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    await h.sup.start('nginx')
    expect(h.spawnCount()).toBe(1)
  })

  test('stop: gọi gracefulStop TRƯỚC killTree', async () => {
    const h = harness()
    const order: string[] = []
    h.sup.register(
      spec({
        gracefulStop: () => {
          order.push('graceful')
          return Promise.resolve(true)
        }
      })
    )
    await h.sup.start('nginx')
    await h.sup.stop('nginx')
    order.push(...h.killed.map(() => 'kill'))
    expect(order[0]).toBe('graceful')
    expect(h.sup.status('nginx')[0]?.state).toBe('stopped')
  })

  test('gracefulStop thất bại → hạ cấp sang killTree (không để worker con giữ cổng)', async () => {
    const h = harness()
    h.sup.register(spec({ gracefulStop: () => Promise.resolve(false) }))
    await h.sup.start('nginx')
    await h.sup.stop('nginx')
    expect(h.killed).toContain(1000)
  })

  test('gracefulStop throw vẫn không làm stop() vỡ', async () => {
    const h = harness()
    h.sup.register(spec({ gracefulStop: () => Promise.reject(new Error('nginx -s quit lỗi')) }))
    await h.sup.start('nginx')
    await expect(h.sup.stop('nginx')).resolves.toBeUndefined()
    expect(h.killed).toContain(1000)
  })

  test('service không có gracefulStop (php-cgi stateless) → kill thẳng', async () => {
    const h = harness()
    h.sup.register(spec({ id: 'php#0', groupId: 'php-8.3', gracefulStop: undefined }))
    await h.sup.start('php#0')
    await h.sup.stop('php#0')
    expect(h.killed).toEqual([1000])
  })

  test('stop khi chưa chạy → stopped, không kill gì', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.stop('nginx')
    expect(h.killed).toEqual([])
    expect(h.sup.status('nginx')[0]?.state).toBe('stopped')
  })

  test('start service chưa đăng ký → throw', async () => {
    const h = harness()
    await expect(h.sup.start('khong-co')).rejects.toThrow(/chưa đăng ký/)
  })
})

describe('ProcessSupervisor — phân biệt USER DỪNG vs CRASH', () => {
  test('exit khi đang stopping ⇒ stopped, KHÔNG restart (nếu lẫn thì mỗi lần bấm Dừng lại tự bật lên)', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    const p = h.procs[0]!
    const stopping = h.sup.stop('nginx')
    p.emitExit(0)
    await stopping
    h.runPending()
    expect(h.spawnCount()).toBe(1)
    expect(h.sup.status('nginx')[0]?.state).toBe('stopped')
  })

  test('crash (code != 0) ⇒ restart theo backoff', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    h.procs[0]!.emitExit(1)
    expect(h.sup.status('nginx')[0]?.state).toBe('restarting')
    h.runPending()
    expect(h.spawnCount()).toBe(2)
    expect(h.sup.status('nginx')[0]?.state).toBe('running')
    expect(h.sup.status('nginx')[0]?.restarts).toBe(1)
  })

  test('nginx thoát code 0 (restartOnCleanExit=false) ⇒ coi là dừng, không restart', async () => {
    const h = harness()
    h.sup.register(spec({ restartOnCleanExit: false }))
    await h.sup.start('nginx')
    h.procs[0]!.emitExit(0)
    h.runPending()
    expect(h.spawnCount()).toBe(1)
    expect(h.sup.status('nginx')[0]?.state).toBe('stopped')
  })

  test('php-cgi thoát code 0 (hết PHP_FCGI_MAX_REQUESTS) ⇒ restart im lặng', async () => {
    const h = harness()
    h.sup.register(spec({ id: 'php#0', restartOnCleanExit: true }))
    await h.sup.start('php#0')
    h.procs[0]!.emitExit(0)
    h.runPending()
    expect(h.spawnCount()).toBe(2)
  })

  test('vượt maxRestarts trong cửa sổ ⇒ đứng ở crashed, KHÔNG thử nữa', async () => {
    const h = harness()
    h.sup.register(spec({ maxRestarts: 3 }))
    await h.sup.start('nginx')
    for (let i = 0; i < 3; i++) {
      h.procs.at(-1)!.emitExit(1)
      h.runPending()
    }
    expect(h.sup.status('nginx')[0]?.state).toBe('crashed')
    expect(h.sup.status('nginx')[0]?.lastError).toMatch(/tạm dừng/)
    // Không còn lần spawn nào nữa
    const before = h.spawnCount()
    h.runPending()
    expect(h.spawnCount()).toBe(before)
  })

  test('resetRestarts cho phép user bấm "Thử lại" sau khi đã bỏ cuộc', async () => {
    const h = harness()
    h.sup.register(spec({ maxRestarts: 1 }))
    await h.sup.start('nginx')
    h.procs[0]!.emitExit(1)
    expect(h.sup.status('nginx')[0]?.state).toBe('crashed')
    h.sup.resetRestarts('nginx')
    await h.sup.start('nginx')
    expect(h.sup.status('nginx')[0]?.state).toBe('running')
  })

  test('lastError chứa stderr THẬT để nói được lý do, không chỉ "đã dừng"', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    const p = h.procs[0]!
    p.writeErr('nginx: [emerg] bind() to 0.0.0.0:80 failed (10013: permission denied)\n')
    p.emitExit(1)
    expect(h.sup.status('nginx')[0]?.lastError).toMatch(/bind\(\) to 0\.0\.0\.0:80 failed/)
  })

  test('ENOENT (runtime bị gỡ tay) ⇒ missing-runtime, KHÔNG backoff vô nghĩa', async () => {
    const err: NodeJS.ErrnoException = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    const h = harness({ spawnThrows: err })
    h.sup.register(spec())
    await h.sup.start('nginx')
    expect(h.sup.status('nginx')[0]?.state).toBe('missing-runtime')
    h.runPending()
    expect(h.spawnCount()).toBe(0)
  })

  test("lỗi spawn khác ENOENT ⇒ crashed", async () => {
    const err: NodeJS.ErrnoException = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    const h = harness({ spawnThrows: err })
    h.sup.register(spec())
    await h.sup.start('nginx')
    expect(h.sup.status('nginx')[0]?.state).toBe('crashed')
  })

  test('stop() trong lúc đang chờ backoff ⇒ huỷ restart đã hẹn', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    h.procs[0]!.emitExit(1)
    expect(h.sup.status('nginx')[0]?.state).toBe('restarting')
    await h.sup.stop('nginx')
    h.runPending()
    expect(h.spawnCount()).toBe(1)
    expect(h.sup.status('nginx')[0]?.state).toBe('stopped')
  })
})

describe('ProcessSupervisor — log', () => {
  test('gom dòng hoàn chỉnh, nối chunk bị cắt giữa dòng', async () => {
    const h = harness()
    const chunks: string[][] = []
    h.sup.on('log', (e) => chunks.push(e.lines))
    h.sup.register(spec())
    await h.sup.start('nginx')
    const p = h.procs[0]!
    p.writeOut('dòng một\ndòng h')
    p.writeOut('ai\n')
    expect(chunks).toEqual([['dòng một'], ['dòng hai']])
    expect(h.sup.tail('nginx', 10)).toEqual(['dòng một', 'dòng hai'])
  })

  test('tail giới hạn số dòng', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    h.procs[0]!.writeOut(Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n') + '\n')
    expect(h.sup.tail('nginx', 3)).toEqual(['l17', 'l18', 'l19'])
  })

  test('stderr cũng vào log chung', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    h.procs[0]!.writeErr('lỗi X\n')
    expect(h.sup.tail('nginx', 5)).toContain('lỗi X')
  })
})

describe('ProcessSupervisor — journal pids.json + reconcile (chống orphan)', () => {
  test('ghi journal NGAY lúc spawn (crash 1ms sau vẫn có dấu vết)', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    const file = join(h.paths.run, 'pids.json')
    expect(existsSync(file)).toBe(true)
    const rec = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, unknown>>
    expect(rec).toHaveLength(1)
    expect(rec[0]?.pid).toBe(1000)
    expect(rec[0]?.serviceId).toBe('nginx')
  })

  test('stop xoá bản ghi khỏi journal', async () => {
    const h = harness()
    h.sup.register(spec())
    await h.sup.start('nginx')
    await h.sup.stop('nginx')
    const rec = JSON.parse(readFileSync(join(h.paths.run, 'pids.json'), 'utf8')) as unknown[]
    expect(rec).toEqual([])
  })

  test('reconcile diệt MỌI process chạy từ trong runtimes (theo exePath, KHÔNG theo PID)', async () => {
    const strays: StrayProcess[] = [
      { pid: 4242, parentPid: 1, exePath: 'D:\\rt\\runtimes\\nginx-1.28\\nginx.exe', startedAt: 1 },
      { pid: 4243, parentPid: 4242, exePath: 'D:\\rt\\runtimes\\php-8.3\\php-cgi.exe', startedAt: 2 }
    ]
    const h = harness({ strays })
    const res = await h.sup.reconcile()
    expect(res.killed).toHaveLength(2)
    expect(h.killed).toEqual([4242, 4243])
  })

  test('reconcile báo số bản ghi journal còn sót (để nói với user, không im lặng)', async () => {
    const h = harness({ strays: [{ pid: 7, parentPid: null, exePath: 'D:\\rt\\runtimes\\x.exe', startedAt: 1 }] })
    h.sup.register(spec())
    await h.sup.start('nginx') // tạo 1 bản ghi journal
    const res = await h.sup.reconcile()
    expect(res.fromJournal).toBe(1)
    // reconcile dọn journal
    expect(JSON.parse(readFileSync(join(h.paths.run, 'pids.json'), 'utf8'))).toEqual([])
  })

  test('không có orphan ⇒ killed rỗng, không lỗi', async () => {
    const h = harness()
    const res = await h.sup.reconcile()
    expect(res.killed).toEqual([])
    expect(h.killed).toEqual([])
  })

  test('adapter liệt kê lỗi ⇒ reconcile KHÔNG throw (không được làm app không boot được)', async () => {
    const paths = newPaths()
    const sup = new ProcessSupervisor({
      paths,
      adapter: {
        platform: 'win32',
        extractArchive: () => Promise.resolve(),
        killTree: () => Promise.resolve(),
        findStrayProcesses: () => Promise.reject(new Error('powershell lỗi')),
        reservedPortRanges: () => Promise.resolve([]),
        runShort: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
        runWithStdinFile: () => Promise.resolve({ code: 0, stdout: '', stderr: '' })
      },
      spawn: () => new FakeProc(1)
    })
    await expect(sup.reconcile()).resolves.toEqual({ killed: [], fromJournal: 0 })
  })
})

describe('ProcessSupervisor — stopAll (before-quit) + group', () => {
  test('stopAll dừng mọi service', async () => {
    const h = harness()
    h.sup.register(spec({ id: 'nginx', groupId: 'nginx' }))
    h.sup.register(spec({ id: 'php#0', groupId: 'php-8.3', healthPort: 9000 }))
    h.sup.register(spec({ id: 'php#1', groupId: 'php-8.3', healthPort: 9001 }))
    await h.sup.start('nginx')
    await h.sup.startGroup('php-8.3')
    expect(h.sup.status().filter((s) => s.state === 'running')).toHaveLength(3)

    await h.sup.stopAll(100)
    expect(h.sup.status().every((s) => s.state === 'stopped')).toBe(true)
    expect(h.killed.sort()).toEqual([1000, 1001, 1002])
  })

  test('startGroup/stopGroup chỉ ảnh hưởng đúng group', async () => {
    const h = harness()
    h.sup.register(spec({ id: 'nginx', groupId: 'nginx' }))
    h.sup.register(spec({ id: 'php#0', groupId: 'php-8.3' }))
    await h.sup.startGroup('php-8.3')
    expect(h.sup.status('nginx')[0]?.state).toBe('stopped')
    expect(h.sup.status('php#0')[0]?.state).toBe('running')
    await h.sup.stopGroup('php-8.3')
    expect(h.sup.status('php#0')[0]?.state).toBe('stopped')
  })
})

describe('ProcessSupervisor — health probe', () => {
  test('probe fail đủ ngưỡng ⇒ unhealthy, KHÔNG tự restart (tránh restart-bão khi máy tải nặng)', async () => {
    const h = harness({ checkPort: () => Promise.resolve(false) })
    h.sup.register(spec())
    await h.sup.start('nginx')
    for (let i = 0; i < 3; i++) await h.sup.probeAll()
    expect(h.sup.status('nginx')[0]?.state).toBe('unhealthy')
    expect(h.spawnCount()).toBe(1) // không restart
    expect(h.sup.status('nginx')[0]?.lastError).toMatch(/8080/)
  })

  test('chưa đủ ngưỡng thì vẫn running', async () => {
    const h = harness({ checkPort: () => Promise.resolve(false) })
    h.sup.register(spec())
    await h.sup.start('nginx')
    await h.sup.probeAll()
    await h.sup.probeAll()
    expect(h.sup.status('nginx')[0]?.state).toBe('running')
  })

  test('probe OK lại ⇒ tự về running', async () => {
    let ok = false
    const h = harness({ checkPort: () => Promise.resolve(ok) })
    h.sup.register(spec())
    await h.sup.start('nginx')
    for (let i = 0; i < 3; i++) await h.sup.probeAll()
    expect(h.sup.status('nginx')[0]?.state).toBe('unhealthy')
    ok = true
    await h.sup.probeAll()
    expect(h.sup.status('nginx')[0]?.state).toBe('running')
  })

  test('service healthPort=null thì không probe', async () => {
    const h = harness({ checkPort: () => Promise.resolve(false) })
    h.sup.register(spec({ healthPort: null }))
    await h.sup.start('nginx')
    for (let i = 0; i < 5; i++) await h.sup.probeAll()
    expect(h.sup.status('nginx')[0]?.state).toBe('running')
  })
})

describe('ProcessSupervisor — bootstrap', () => {
  test('bootstrap chạy 1 lần trước start đầu tiên', async () => {
    const h = harness()
    let calls = 0
    h.sup.register(
      spec({
        bootstrap: () => {
          calls++
          return Promise.resolve()
        }
      })
    )
    await h.sup.start('nginx')
    await h.sup.stop('nginx')
    await h.sup.start('nginx')
    expect(calls).toBe(1)
  })

  test('bootstrap lỗi ⇒ crashed + không spawn', async () => {
    const h = harness()
    h.sup.register(spec({ bootstrap: () => Promise.reject(new Error('mariadb-install-db fail')) }))
    await expect(h.sup.start('nginx')).rejects.toThrow(/install-db/)
    expect(h.spawnCount()).toBe(0)
    expect(h.sup.status('nginx')[0]?.state).toBe('crashed')
    expect(h.sup.status('nginx')[0]?.lastError).toMatch(/Bootstrap/)
  })
})
