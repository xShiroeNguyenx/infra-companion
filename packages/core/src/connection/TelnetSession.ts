import * as net from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import type { SessionSink, TerminalSession } from './types'

// Telnet IAC (RFC 854/855)
const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240
const OPT_ECHO = 1
const OPT_SGA = 3 // suppress go-ahead
const OPT_NAWS = 31 // negotiate window size
const OPT_TTYPE = 24
const TTYPE_IS = 0
const TTYPE_SEND = 1
const TERMINAL_NAME = 'xterm-256color'

/**
 * Phiên Telnet thuần (raw TCP) + thương lượng option tối thiểu:
 * chấp nhận SGA, gửi NAWS (kích thước cửa sổ) & terminal type, từ chối option khác.
 * Đủ để dùng với thiết bị mạng/switch cũ và BBS.
 */
export class TelnetSession implements TerminalSession {
  readonly kind = 'telnet' as const
  private socket: net.Socket | null = null
  private killed = false
  private buffer = Buffer.alloc(0)
  private readonly decoder = new StringDecoder('utf8')
  /** Trạng thái option đã thương lượng — RFC 854 cấm trả lời khi trạng thái không đổi (chống loop). */
  private readonly myOptions = new Map<number, boolean>()
  private readonly peerOptions = new Map<number, boolean>()
  private cols: number
  private rows: number

  constructor(
    readonly id: string,
    host: string,
    port: number,
    cols: number,
    rows: number,
    private readonly sink: SessionSink
  ) {
    this.cols = cols
    this.rows = rows
    this.sink.status(this.id, 'connecting')
    const socket = net.connect({ host, port })
    this.socket = socket
    socket.setNoDelay(true)
    socket.on('connect', () => {
      this.sink.status(this.id, 'connected')
    })
    socket.on('data', (chunk: Buffer) => this.onData(chunk))
    socket.on('error', (error) => {
      if (this.killed) return
      this.killed = true
      this.sink.exit(this.id, null, friendlyError(error, host, port))
    })
    socket.on('close', () => {
      if (this.killed) return
      this.killed = true
      this.sink.exit(this.id, 0, 'Kết nối Telnet đã đóng')
    })
  }

  /** Tách lệnh IAC khỏi dữ liệu thường; phần dữ liệu hiển thị lên terminal. */
  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const out: number[] = []
    let i = 0
    while (i < this.buffer.length) {
      const byte = this.buffer[i]!
      if (byte !== IAC) {
        out.push(byte)
        i += 1
        continue
      }
      // cần ít nhất 2 byte cho lệnh
      if (i + 1 >= this.buffer.length) break
      const cmd = this.buffer[i + 1]!
      if (cmd === IAC) {
        out.push(IAC) // 255 255 = literal 255
        i += 2
        continue
      }
      if (cmd === SB) {
        const seIndex = this.findSe(i + 2)
        if (seIndex === -1) break // chưa đủ dữ liệu
        this.handleSubnegotiation(this.buffer.subarray(i + 2, seIndex))
        i = seIndex + 2
        continue
      }
      if (cmd === DO || cmd === DONT || cmd === WILL || cmd === WONT) {
        if (i + 2 >= this.buffer.length) break
        this.respondOption(cmd, this.buffer[i + 2]!)
        i += 3
        continue
      }
      i += 2 // lệnh 2 byte khác (NOP, GA…) — bỏ qua
    }
    this.buffer = this.buffer.subarray(i)
    if (out.length > 0) {
      const text = this.decoder.write(Buffer.from(out))
      if (text) this.sink.data(this.id, text)
    }
  }

  private findSe(from: number): number {
    for (let j = from; j < this.buffer.length - 1; j++) {
      if (this.buffer[j] === IAC) {
        if (this.buffer[j + 1] === SE) return j
        j += 1 // IAC <byte khác> (kể cả escape IAC IAC) — không phải SE thật
      }
    }
    return -1
  }

  /** Trả lời TTYPE SEND bằng terminal type (RFC 1091) — đã WILL TTYPE thì server sẽ hỏi. */
  private handleSubnegotiation(payload: Buffer): void {
    if (payload[0] === OPT_TTYPE && payload[1] === TTYPE_SEND) {
      this.socket?.write(
        Buffer.concat([
          Buffer.from([IAC, SB, OPT_TTYPE, TTYPE_IS]),
          Buffer.from(TERMINAL_NAME, 'ascii'),
          Buffer.from([IAC, SE])
        ])
      )
    }
  }

  private respondOption(cmd: number, opt: number): void {
    const socket = this.socket
    if (!socket) return
    if (cmd === DO) {
      // server muốn ta BẬT option
      const enable = opt === OPT_SGA || opt === OPT_TTYPE || opt === OPT_NAWS
      if (this.myOptions.get(opt) === enable) return
      this.myOptions.set(opt, enable)
      socket.write(Buffer.from([IAC, enable ? WILL : WONT, opt]))
      if (enable && opt === OPT_NAWS) this.sendWindowSize()
    } else if (cmd === WILL) {
      // server muốn BẬT option của nó
      const accept = opt === OPT_ECHO || opt === OPT_SGA
      if (this.peerOptions.get(opt) === accept) return
      this.peerOptions.set(opt, accept)
      socket.write(Buffer.from([IAC, accept ? DO : DONT, opt]))
    } else if (cmd === DONT) {
      if (this.myOptions.get(opt) === false) return
      this.myOptions.set(opt, false)
      socket.write(Buffer.from([IAC, WONT, opt]))
    } else if (cmd === WONT) {
      if (this.peerOptions.get(opt) === false) return
      this.peerOptions.set(opt, false)
      socket.write(Buffer.from([IAC, DONT, opt]))
    }
  }

  private sendWindowSize(): void {
    const socket = this.socket
    if (!socket) return
    // IAC SB NAWS <cols-hi> <cols-lo> <rows-hi> <rows-lo> IAC SE (escape 255)
    const payload = [IAC, SB, OPT_NAWS]
    for (const value of [this.cols >> 8, this.cols & 0xff, this.rows >> 8, this.rows & 0xff]) {
      payload.push(value)
      if (value === IAC) payload.push(IAC)
    }
    payload.push(IAC, SE)
    socket.write(Buffer.from(payload))
  }

  write(data: string): void {
    // escape byte 255 trong dữ liệu người dùng
    const bytes = Buffer.from(data, 'utf8')
    if (bytes.includes(IAC)) {
      const escaped: number[] = []
      for (const b of bytes) {
        escaped.push(b)
        if (b === IAC) escaped.push(IAC)
      }
      this.socket?.write(Buffer.from(escaped))
    } else {
      this.socket?.write(bytes)
    }
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.sendWindowSize()
  }

  kill(): void {
    this.killed = true
    this.socket?.destroy()
    this.socket = null
  }
}

function friendlyError(error: Error & { code?: string }, host: string, port: number): string {
  if (error.code === 'ECONNREFUSED') return `Bị từ chối kết nối tới ${host}:${port}`
  if (error.code === 'ETIMEDOUT') return `Timeout khi kết nối ${host}:${port}`
  if (error.code === 'ENOTFOUND') return `Không phân giải được ${host}`
  return error.message
}
