import type { PortRange } from '../ports'
import type { StrayProcess } from '../types'
import type { PlatformAdapter } from './PlatformAdapter'
import { WindowsAdapter } from './WindowsAdapter'

const NOT_SUPPORTED = 'Local dev hiện chỉ hỗ trợ Windows. macOS/Linux sẽ được thêm sau.'

/**
 * Stub cho macOS/Linux — throw có thông báo rõ ràng thay vì fail nửa vời.
 * Giữ file này để seam `PlatformAdapter` có ít nhất 2 impl ngay từ đầu: nhờ vậy mọi chỗ
 * OS-specific bị buộc phải đi qua interface, không lẫn vào logic chung.
 *
 * TODO khi port sang POSIX (mỗi hàm 1 dòng, xem bảng trong PlatformAdapter.ts):
 *  - extractArchive:      tar -xzf / unzip -q
 *  - killTree:            spawn({detached:true}) + process.kill(-pgid)
 *  - findStrayProcesses:  pgrep -af <dir>
 *  - reservedPortRanges:  sysctl net.ipv4.ip_local_port_range (Linux) / net.inet.ip.portrange (mac)
 *  - php:                 dùng php-fpm THẬT (PhpFpmPool) thay cho pool php-cgi
 */
export class PosixAdapter implements PlatformAdapter {
  readonly platform: NodeJS.Platform = process.platform

  extractArchive(): Promise<void> {
    return Promise.reject(new Error(NOT_SUPPORTED))
  }

  killTree(): Promise<void> {
    return Promise.reject(new Error(NOT_SUPPORTED))
  }

  findStrayProcesses(): Promise<StrayProcess[]> {
    // Trả rỗng thay vì throw: reap là best-effort và được gọi lúc khởi động app —
    // không được để nó làm app không boot được trên nền tảng chưa hỗ trợ.
    return Promise.resolve([])
  }

  reservedPortRanges(): Promise<PortRange[]> {
    return Promise.resolve([])
  }

  runShort(): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return Promise.resolve({ code: null, stdout: '', stderr: NOT_SUPPORTED })
  }

  runWithStdinFile(): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return Promise.resolve({ code: null, stdout: '', stderr: NOT_SUPPORTED })
  }
}

/** Chọn adapter theo nền tảng đang chạy. */
export function createPlatformAdapter(): PlatformAdapter {
  return process.platform === 'win32' ? new WindowsAdapter() : new PosixAdapter()
}
