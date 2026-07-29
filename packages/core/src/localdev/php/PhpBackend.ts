import type { ServiceSpec } from '../types'

/**
 * Seam cho cách chạy PHP. Windows KHÔNG CÓ php-fpm (SAPI đó chỉ build trên Unix vì dựa vào
 * `fork()`), nên bản Windows tự làm process manager cho một pool `php-cgi.exe`.
 * macOS/Linux về sau dùng `PhpFpmPool` (php-fpm thật, dynamic pm) — tốt hơn hẳn.
 */
export interface PhpBackend {
  /** Tên upstream nginx cho runtime này. */
  upstream(runtimeId: string): string
  /** Các cổng pool sẽ dùng (theo thứ tự worker). */
  ports(): number[]
  /** Dựng spec cho từng process trong pool. */
  buildSpecs(input: PhpPoolInput): ServiceSpec[]
}

export interface PhpPoolInput {
  runtimeId: string
  /** Đường dẫn php-cgi.exe (đã resolve từ RuntimeManager). */
  phpCgiExe: string
  /** php.ini đã sinh cho runtime này. */
  iniFile: string
  cwd: string
  logFile: string
  ports: number[]
  /** Thư mục tạm riêng — không dùng C:\Windows\Temp. */
  tmpDir: string
  /** PATH tối thiểu để php tìm được DLL cạnh nó (ICU cho ext intl…). */
  pathEntries: string[]
}
