import * as net from 'node:net'
import { Duplex, PassThrough } from 'node:stream'
import type { Client } from 'ssh2'
import type { TunnelRuleDto } from '@infra/shared'
import { describe, expect, it } from 'vitest'
import { TunnelService } from './TunnelService'

/**
 * Đường `nc` qua login-script chết mà chưa nhận byte nào của đích thì phải TỰ ĐỔI sang
 * direct-tcpip, phát lại nguyên vẹn byte client đã gửi — client không được thấy gì bất thường.
 */

/** Kênh ssh2 giả: Duplex + stderr, ghi lại mọi byte nhận được. */
class FakeChannel extends Duplex {
  readonly stderr = new PassThrough()
  private readonly chunks: Buffer[] = []

  override _read(): void {
    // dữ liệu được đẩy vào bằng push() từ test
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error) => void): void {
    this.chunks.push(Buffer.from(chunk))
    cb()
  }

  received(): string {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

const RULE: TunnelRuleDto = {
  id: 'r1',
  hostId: 'h1',
  type: 'L',
  label: 'test',
  bindHost: '127.0.0.1',
  bindPort: 0, // 0 = xin cổng trống bất kỳ
  destHost: '10.20.30.40',
  destPort: 3306,
  autoStart: false
}

const LOGIN_STEPS = [{ send: 'ssh app-06' }, { send: 'secret', secret: true }]

interface Harness {
  service: TunnelService
  tunnel: { rule: TunnelRuleDto; server: net.Server | null; status: string; detail?: string }
  nc: FakeChannel
  native: FakeChannel
  execCommands: string[]
  forwardTargets: string[]
  client: Client
}

function makeHarness(): Harness {
  const nc = new FakeChannel()
  const native = new FakeChannel()
  const execCommands: string[] = []
  const forwardTargets: string[] = []
  const client = {
    exec(cmd: string, cb: (e: Error | undefined, ch: FakeChannel) => void) {
      execCommands.push(cmd)
      setImmediate(() => cb(undefined, nc))
    },
    forwardOut(
      _sh: string,
      _sp: number,
      host: string,
      port: number,
      cb: (e: Error | undefined, ch: FakeChannel) => void
    ) {
      forwardTargets.push(`${host}:${port}`)
      setImmediate(() => cb(undefined, native))
    }
  } as unknown as Client
  const service = new TunnelService()
  const tunnel = {
    rule: RULE,
    client: null,
    server: null as net.Server | null,
    closeChain: null,
    status: 'active',
    stopping: false,
    loginSteps: LOGIN_STEPS
  }
  return { service, tunnel, nc, native, execCommands, forwardTargets, client }
}

/** Mở listener của tunnel rồi nối một client TCP thật vào. */
async function connectClient(h: Harness): Promise<net.Socket> {
  // startLocal là chi tiết nội bộ — test đi thẳng vào nó để khỏi phải dựng SSH chain thật.
  await (h.service as unknown as { startLocal(t: unknown, c: Client): Promise<void> }).startLocal(h.tunnel, h.client)
  const port = (h.tunnel.server!.address() as net.AddressInfo).port
  const socket = net.connect(port, '127.0.0.1')
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
  return socket
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`Quá hạn chờ: ${label}`)
}

const MARKER = /ICTUN[0-9a-f]{18}/

describe('tunnel L qua login-script có hop ssh', () => {
  it('đi nc trên máy sâu TRƯỚC (không dùng direct-tcpip khi nc chạy được)', async () => {
    const h = makeHarness()
    const socket = await connectClient(h)
    await waitFor(() => h.execCommands.length === 1, 'exec nc')

    expect(h.execCommands[0]).toContain('sshpass') // hop ssh của login script, có password
    expect(h.execCommands[0]).toContain(' app-06 ')
    expect(h.execCommands[0]).toContain('exec nc 10.20.30.40 3306')
    expect(h.forwardTargets).toEqual([])

    // MOTD + marker + lời chào của MySQL
    const marker = MARKER.exec(h.execCommands[0])![0]
    h.nc.push(Buffer.from(`Last login: hôm qua\n${marker}`))
    h.nc.push(Buffer.from('\x0a\x00\x00\x00mysql-greeting'))
    const received = await new Promise<Buffer>((resolve) => socket.once('data', (d: Buffer) => resolve(d)))

    expect(received.toString('utf8')).toBe('\x0a\x00\x00\x00mysql-greeting')
    expect(h.forwardTargets).toEqual([]) // vẫn không đụng tới đường native
    socket.destroy()
    h.tunnel.server?.close()
  })

  it('nc chết trước khi đích nói → tự đổi sang direct-tcpip, client không hay biết', async () => {
    const h = makeHarness()
    const socket = await connectClient(h)
    await waitFor(() => h.execCommands.length === 1, 'exec nc')

    // Kịch bản thật: hop ssh vào được, marker in ra, nhưng `nc` không nối được tới DB
    // → luồng rỗng rồi đóng (trước đây client treo tới timeout "reading initial packet").
    const marker = MARKER.exec(h.execCommands[0])![0]
    h.nc.push(Buffer.from(marker))
    h.nc.push(null)
    await waitFor(() => h.forwardTargets.length === 1, 'fallback direct-tcpip')
    expect(h.forwardTargets).toEqual(['10.20.30.40:3306'])

    h.native.push(Buffer.from('mysql-greeting'))
    const received = await new Promise<Buffer>((resolve) => socket.once('data', (d: Buffer) => resolve(d)))
    expect(received.toString('utf8')).toBe('mysql-greeting')
    socket.destroy()
    h.tunnel.server?.close()
  })

  it('byte client gửi trước lúc đổi đường được phát lại đầy đủ, đúng thứ tự', async () => {
    const h = makeHarness()
    const socket = await connectClient(h)
    await waitFor(() => h.execCommands.length === 1, 'exec nc')

    // Protocol client-nói-trước: client đã bắn dữ liệu vào đường nc rồi nó mới chết
    socket.write('PING\r\n')
    await waitFor(() => h.nc.received() === 'PING\r\n', 'nc nhận byte client')
    socket.write('MORE\r\n')
    await waitFor(() => h.nc.received() === 'PING\r\nMORE\r\n', 'nc nhận tiếp')
    h.nc.push(null)

    await waitFor(() => h.forwardTargets.length === 1, 'fallback direct-tcpip')
    await waitFor(() => h.native.received() === 'PING\r\nMORE\r\n', 'phát lại vào kênh native')

    // Luồng tiếp tục chảy sang kênh mới sau khi đã đổi
    socket.write('LAST\r\n')
    await waitFor(() => h.native.received() === 'PING\r\nMORE\r\nLAST\r\n', 'byte sau khi đổi đường')
    socket.destroy()
    h.tunnel.server?.close()
  })

  it('đích loopback: chỉ dùng nc, KHÔNG đổi sang direct-tcpip (localhost là của máy sâu)', async () => {
    const h = makeHarness()
    h.tunnel.rule = { ...RULE, destHost: '127.0.0.1' }
    const socket = await connectClient(h)
    await waitFor(() => h.execCommands.length === 1, 'exec nc')

    h.nc.push(null)
    await new Promise((r) => setTimeout(r, 50))
    expect(h.forwardTargets).toEqual([])
    expect(h.tunnel.detail).toContain('Tunnel login-script lỗi')
    socket.destroy()
    h.tunnel.server?.close()
  })
})
