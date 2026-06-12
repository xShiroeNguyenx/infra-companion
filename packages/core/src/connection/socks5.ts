import type { Socket } from 'node:net'

export interface Socks5Request {
  host: string
  port: number
  /** Byte client gửi sớm sau request (pipeline) — caller phải đẩy lại vào stream đích. */
  leftover: Buffer
}

/**
 * Bắt tay SOCKS5 tối thiểu cho dynamic forwarding (RFC 1928):
 * chỉ hỗ trợ no-auth + CONNECT, đủ cho trình duyệt/curl dùng làm SOCKS proxy.
 * Trả về đích cần kết nối; caller chịu trách nhiệm reply success/failure.
 * Socket được pause() trước khi resolve — caller pipe() sẽ tự resume.
 */
export function readSocks5Request(socket: Socket): Promise<Socks5Request> {
  return new Promise((resolve, reject) => {
    let stage: 'greeting' | 'request' = 'greeting'
    let buffer = Buffer.alloc(0)

    const fail = (message: string, reply?: Buffer): void => {
      socket.off('data', onData)
      if (reply && !socket.destroyed) socket.end(reply)
      reject(new Error(message))
    }

    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])

      if (stage === 'greeting') {
        // check version ngay byte đầu — garbage (vd HTTP request) fail sớm thay vì treo chờ đủ length
        if (buffer[0] !== 0x05) return fail('Không phải SOCKS5')
        if (buffer.length < 2) return
        const methodCount = buffer[1]!
        if (buffer.length < 2 + methodCount) return
        const methods = buffer.subarray(2, 2 + methodCount)
        if (!methods.includes(0x00)) {
          // 0xFF = không method nào chấp nhận được (RFC 1928 §3)
          return fail('Client không hỗ trợ no-auth', Buffer.from([0x05, 0xff]))
        }
        buffer = buffer.subarray(2 + methodCount)
        stage = 'request'
        socket.write(Buffer.from([0x05, 0x00])) // no-auth
        // rơi xuống parse request nếu client gửi gộp
      }

      if (stage === 'request') {
        if (buffer.length === 0) return
        if (buffer[0] !== 0x05) return fail('Request không phải SOCKS5')
        if (buffer.length < 4) return
        if (buffer[1] !== 0x01) {
          // 0x07 = command not supported
          return fail('Chỉ hỗ trợ lệnh CONNECT', Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        }
        const addressType = buffer[3]!
        let host: string
        let portOffset: number
        if (addressType === 0x01) {
          if (buffer.length < 10) return
          host = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`
          portOffset = 8
        } else if (addressType === 0x03) {
          const length = buffer[4]
          if (length === undefined || buffer.length < 5 + length + 2) return
          host = buffer.subarray(5, 5 + length).toString('utf8')
          portOffset = 5 + length
        } else if (addressType === 0x04) {
          if (buffer.length < 22) return
          const parts: string[] = []
          for (let i = 0; i < 16; i += 2) parts.push(buffer.readUInt16BE(4 + i).toString(16))
          host = parts.join(':')
          portOffset = 20
        } else {
          return fail('Address type không hỗ trợ', Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        }
        const port = buffer.readUInt16BE(portOffset)
        socket.off('data', onData)
        // pause + giữ leftover: byte pipeline sau request không bị drop trong lúc forwardOut chạy
        socket.pause()
        resolve({ host, port, leftover: buffer.subarray(portOffset + 2) })
      }
    }

    socket.on('data', onData)
    socket.once('error', () => fail('Socket lỗi khi bắt tay SOCKS5'))
    socket.once('close', () => fail('Socket đóng khi bắt tay SOCKS5'))
  })
}

/** Reply thành công cho CONNECT (bind addr 0.0.0.0:0 — client không dùng). */
export function socks5Success(socket: Socket): void {
  socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
}

export function socks5Failure(socket: Socket): void {
  if (!socket.destroyed) {
    socket.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
  }
}
