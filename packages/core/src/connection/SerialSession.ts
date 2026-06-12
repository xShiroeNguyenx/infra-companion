import { StringDecoder } from 'node:string_decoder'
import { SerialPort } from 'serialport'
import type { SerialPortInfo } from '@infra/shared'
import type { SessionSink, TerminalSession } from './types'

/** Liệt kê cổng serial (COM) trên máy. */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list()
  return ports.map((p) => ({
    path: p.path,
    label: p.friendlyName ?? p.manufacturer ?? p.path
  }))
}

/**
 * Phiên serial qua node-serialport (N-API, chạy thẳng trong Electron không cần rebuild).
 * Dùng cho console switch/router qua cáp USB-to-serial.
 */
export class SerialSession implements TerminalSession {
  readonly kind = 'serial' as const
  private port: SerialPort | null = null
  private killed = false

  constructor(
    readonly id: string,
    path: string,
    baudRate: number,
    private readonly sink: SessionSink
  ) {
    this.sink.status(this.id, 'connecting')
    const port = new SerialPort({ path, baudRate: sanitizeBaud(baudRate), autoOpen: false })
    this.port = port
    port.open((error) => {
      if (this.killed) {
        // kill() chạy trước khi open xong: phải đóng lại, không thì COM port (exclusive) bị giữ tới khi thoát app
        if (!error) port.close(() => {})
        return
      }
      if (error) {
        this.killed = true
        this.sink.exit(this.id, null, `Không mở được ${path}: ${error.message}`)
        return
      }
      this.sink.status(this.id, 'connected')
      this.sink.data(this.id, `\x1b[32m[Đã mở ${path} @ ${sanitizeBaud(baudRate)} baud — Enter để xem prompt]\x1b[0m\r\n`)
    })
    const decoder = new StringDecoder('utf8')
    port.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk)
      if (text) this.sink.data(this.id, text)
    })
    port.on('error', (error) => {
      if (this.killed) return
      this.killed = true
      this.sink.exit(this.id, null, `Lỗi cổng serial: ${error.message}`)
    })
    port.on('close', () => {
      if (this.killed) return
      this.killed = true
      this.sink.exit(this.id, 0, 'Cổng serial đã đóng (rút cáp?)')
    })
  }

  write(data: string): void {
    this.port?.write(data)
  }

  resize(): void {
    // serial không có khái niệm kích thước cửa sổ
  }

  kill(): void {
    this.killed = true
    try {
      this.port?.close()
    } catch {
      // đã đóng
    }
    this.port = null
  }
}

function sanitizeBaud(value: number): number {
  const common = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400]
  return common.includes(value) ? value : 9600
}
