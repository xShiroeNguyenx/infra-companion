/**
 * Tách dòng từ stdout/stderr của process con + ring buffer + toán rotate log.
 * Thuần → test trực tiếp (đây là chỗ dễ sai với chunk cắt giữa dòng / giữa ký tự UTF-8).
 */

/**
 * Gộp `rest` (phần dư lần trước) với `chunk` mới rồi tách thành các dòng HOÀN CHỈNH.
 * Dòng chưa kết thúc được trả lại ở `rest` để lần sau nối tiếp — nếu không, mọi dòng bị
 * chunk cắt ngang sẽ hiện thành 2 dòng rác.
 *
 * Chuẩn hoá CRLF → LF (nginx/mariadb trên Windows ghi \r\n).
 */
export function splitLines(rest: string, chunk: string): { lines: string[]; rest: string } {
  const buf = rest + chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const parts = buf.split('\n')
  // Phần tử cuối là đoạn CHƯA có '\n' → giữ lại làm rest
  const tail = parts.pop() ?? ''
  return { lines: parts, rest: tail }
}

/** Có nên rotate chưa: kích thước hiện tại + sắp ghi thêm vượt trần. */
export function shouldRotate(currentBytes: number, incomingBytes: number, maxBytes: number): boolean {
  return currentBytes > 0 && currentBytes + incomingBytes > maxBytes
}

/**
 * Danh sách phép đổi tên khi rotate, theo thứ tự PHẢI thực hiện (từ file cũ nhất trước —
 * nếu làm ngược sẽ ghi đè mất dữ liệu).
 * keep=2 → [{from:'a.log.1', to:'a.log.2'}, {from:'a.log', to:'a.log.1'}] và xoá 'a.log.2' cũ.
 */
export function rotatePlan(file: string, keep: number): { deleteFile: string | null; renames: Array<{ from: string; to: string }> } {
  const k = Math.max(0, Math.floor(keep))
  if (k === 0) return { deleteFile: file, renames: [] }
  const renames: Array<{ from: string; to: string }> = []
  for (let i = k - 1; i >= 1; i--) renames.push({ from: `${file}.${i}`, to: `${file}.${i + 1}` })
  renames.push({ from: file, to: `${file}.1` })
  return { deleteFile: `${file}.${k}`, renames }
}

/** Ring buffer dòng log để UI xem `tail` mà không phải đọc đĩa. */
export class LogRing {
  private readonly buf: string[] = []

  constructor(private readonly cap = 500) {}

  push(lines: readonly string[]): void {
    for (const l of lines) this.buf.push(l)
    if (this.buf.length > this.cap) this.buf.splice(0, this.buf.length - this.cap)
  }

  tail(n: number): string[] {
    if (n <= 0) return []
    return this.buf.slice(Math.max(0, this.buf.length - n))
  }

  get size(): number {
    return this.buf.length
  }

  clear(): void {
    this.buf.length = 0
  }
}
