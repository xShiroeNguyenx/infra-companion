import type { PortRange } from '../ports'
import type { StrayProcess } from '../types'

/**
 * SEAM cho hệ điều hành: MỌI chỗ OS-specific của module local dev đều bị nhốt sau interface
 * này. Nhờ vậy thêm macOS/Linux về sau chỉ là viết 1 impl mới, không sửa RuntimeManager /
 * ProcessSupervisor / tầng IPC.
 *
 * Bản đồ tương ứng khi port sang POSIX:
 *   extractArchive  Windows: System32\tar.exe   | POSIX: tar -xzf / unzip
 *   killTree        Windows: taskkill /T /F     | POSIX: process.kill(-pgid) + detached:true
 *   findStray       Windows: Get-CimInstance    | POSIX: pgrep -af <dir>
 *   reservedPorts   Windows: netsh              | POSIX: sysctl ip_local_port_range
 */
export interface PlatformAdapter {
  readonly platform: NodeJS.Platform

  /** Giải nén archive vào `destDir`. `stripComponents` bỏ N cấp thư mục đầu. */
  extractArchive(
    archivePath: string,
    destDir: string,
    opts: { archive: 'zip' | 'tar.gz' | 'raw'; stripComponents: number; rawFileName?: string }
  ): Promise<void>

  /**
   * Giết CẢ CÂY process (nginx master sinh worker; mariadbd cũng có con).
   * Chỉ kill 1 PID là để lại worker orphan VẪN GIỮ CỔNG → lần start sau bind fail.
   */
  killTree(pid: number): Promise<void>

  /**
   * Tìm process đang chạy từ BÊN TRONG `underDir` — dùng để dọn orphan lúc app khởi động.
   * Tiêu chí là ĐƯỜNG DẪN EXECUTABLE, tuyệt đối KHÔNG phải PID: Windows tái dùng PID rất
   * nhanh nên so PID sẽ có ngày giết oan process vô can của user.
   */
  findStrayProcesses(underDir: string): Promise<StrayProcess[]>

  /**
   * Các dải cổng hệ điều hành đang giữ (Hyper-V/WinNAT/WSL2). Bind vào đó fail bằng
   * EACCES chứ không phải EADDRINUSE → thông báo lỗi sẽ gây hiểu sai nếu không biết trước.
   */
  reservedPortRanges(): Promise<PortRange[]>

  /** Chạy 1 lệnh ngắn để smoke-test binary vừa cài (php -v / nginx -v). */
  runShort(
    exe: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }
  ): Promise<{ code: number | null; stdout: string; stderr: string }>

  /**
   * Chạy 1 lệnh với STDIN nối vào 1 file — dành cho `mariadb.exe < dump.sql`.
   *
   * Vì sao không dùng `runShort` + `-e "source <file>"`: `source` là builtin của client, nó
   * dừng giữa đường khi gặp lỗi và đường dẫn phải nhúng vào chuỗi SQL (dấu nháy/backslash
   * trong path Windows là mìn). Nối stdin là cách nhập dump chuẩn và không phải escape gì.
   *
   * KHÔNG bao giờ đẩy dữ liệu nhị phân/dump qua shell pipe (bài học v0.1.31: pipeline shell
   * làm hỏng stream) — ở đây là spawn trực tiếp, không qua shell.
   */
  runWithStdinFile(
    exe: string,
    args: string[],
    stdinFile: string,
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }
  ): Promise<{ code: number | null; stdout: string; stderr: string }>
}
