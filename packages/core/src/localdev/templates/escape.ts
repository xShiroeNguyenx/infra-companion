/**
 * Escape đường dẫn/định danh khi sinh file config. Thuần → test trực tiếp.
 *
 * QUY TẮC DUY NHẤT cho cả nginx/php.ini/my.ini: luôn đổi `\` → `/` và luôn bọc `"…"`.
 * Lý do: nginx trên Windows nhận cả hai nhưng `\` LÀ KÝ TỰ ESCAPE trong config nginx
 * (`C:\app\new` → nginx thấy `\n`), còn PHP/MariaDB ini đều nhận `/`. Một quy tắc cho cả
 * ba giảm hẳn bề mặt lỗi — và đây là chỗ dễ sai nhất của cả module.
 */

/** Đổi mọi `\` thành `/` (nginx/php/mariadb đều hiểu `/` trên Windows). */
export function toFwd(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Đường dẫn dùng trong nginx.conf: forward slash + luôn quote (path có dấu cách rất phổ biến). */
export function nginxPath(p: string): string {
  return `"${toFwd(p).replace(/"/g, '\\"')}"`
}

/** Đường dẫn dùng trong file .ini (php.ini / my.ini). */
export function iniPath(p: string): string {
  return `"${toFwd(p).replace(/"/g, '')}"`
}

/**
 * Domain hợp lệ theo RFC 1123 (mỗi label ≤63, tổng ≤253, chữ thường).
 * BẮT BUỘC gọi trước khi nội suy domain vào bất cứ đâu: config nginx, block hosts file,
 * và nhất là lệnh PowerShell elevated — đây là hàng rào chống injection qua tên site.
 */
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function isSafeDomain(d: string): boolean {
  if (!d || d.length > 253) return false
  if (d.startsWith('.') || d.endsWith('.')) return false
  // Ký tự điều khiển / xuống dòng: nếu lọt vào hosts file sẽ tạo được DÒNG MỚI (chèn map IP khác)
  if (/[\s\u0000-\u001f\u007f]/.test(d)) return false
  const labels = d.split('.')
  if (labels.length < 1) return false
  return labels.every((l) => LABEL_RE.test(l))
}

export function assertSafeDomain(d: string): void {
  if (!isSafeDomain(d)) throw new Error(`Domain không hợp lệ: ${JSON.stringify(d)}`)
}

/** Cổng TCP hợp lệ (1..65535). */
export function isSafePort(p: number): boolean {
  return Number.isInteger(p) && p >= 1 && p <= 65_535
}

export function assertSafePort(p: number): void {
  if (!isSafePort(p)) throw new Error(`Cổng không hợp lệ: ${String(p)}`)
}
