import { isIP } from 'node:net'
import { isSafeDomain } from '../localdev/templates/escape'

/**
 * "Đổi IP của domain" mà KHÔNG sửa file hosts và KHÔNG cần quyền admin.
 *
 * Cách làm: mọi browser Chromium (Chrome/Edge/Brave/Vivaldi) nhận cờ
 *   --host-resolver-rules="MAP www.example.com 203.0.113.10,MAP *.example.net 203.0.113.11"
 * ghi đè phân giải DNS **chỉ trong tiến trình browser đó**. Ba hệ quả quan trọng:
 *  1. Không đụng `C:\Windows\System32\drivers\etc\hosts` ⇒ không cần admin, không có gì phải
 *     dọn nếu app chết giữa đường, và các app khác trên máy không bị ảnh hưởng.
 *  2. Hostname trong URL KHÔNG đổi ⇒ SNI + Host header vẫn là domain thật ⇒ certificate vẫn
 *     khớp, không có cảnh báo HTTPS (khác hẳn kiểu gõ thẳng https://<ip>/).
 *  3. Vì phạm vi là 1 tiến trình browser, MỞ ĐƯỢC NHIỀU CỬA SỔ CÙNG LÚC trỏ vào các server
 *     khác nhau — việc file hosts không làm được (hosts là toàn máy, mỗi lúc 1 IP).
 *
 * Đánh đổi phải nói rõ với user: chỉ browser Chromium hiểu cờ này. Firefox/Postman/client MySQL
 * thì không (những thứ đó cần proxy hoặc tunnel — app đã có tunnel cho DB).
 *
 * File này THUẦN (chỉ dựng chuỗi + validate) → test trực tiếp bằng vitest.
 *
 * ⚠️ ĐÂY LÀ HÀNG RÀO AN NINH của tính năng: chuỗi rules phân tách bằng dấu phẩy và khoảng
 * trắng, nên một pattern chứa `,` hay ` ` sẽ CHÈN ĐƯỢC RULE MỚI (vd map cả `*` về IP của kẻ
 * tấn công, hoặc thêm `--` để đẩy thêm cờ dòng lệnh cho browser). Vì vậy mọi pattern/IP phải
 * qua validate TRƯỚC khi ghép, và hàm ghép sẽ throw chứ không "cố gắng làm sạch".
 */

export interface HostMapTarget {
  id: string
  /** Nhãn user thấy, vd 'LB1 — web-01'. */
  label: string
  /** IP đích (v4 hoặc v6, KHÔNG kèm ngoặc vuông). */
  ip: string
}

export interface HostMapGroup {
  id: string
  name: string
  /** Domain hoặc pattern kiểu `*.example.net`. */
  patterns: string[]
  /** Các server có thể trỏ tới (5 con LB…). */
  targets: HostMapTarget[]
  /** Target đang chọn; null = chưa chọn (không mở được). */
  activeTargetId: string | null
  /** URL mở khi bấm Mở. Trống ⇒ suy ra từ pattern đầu tiên. */
  url: string | null
}

/**
 * Pattern hợp lệ: domain thường, hoặc `*.domain` (Chromium hỗ trợ wildcard 1 cấp đầu).
 * Cố ý KHÔNG cho `*` trơ trọi: map toàn bộ Internet về 1 IP gần như luôn là lỗi gõ nhầm, và
 * hậu quả (mọi request trong cửa sổ đó đi tới 1 máy) rất khó hiểu với người dùng.
 */
export function isSafeHostPattern(p: string): boolean {
  if (p !== p.trim() || p.length === 0 || p.length > 253) return false
  const bare = p.startsWith('*.') ? p.slice(2) : p
  return bare.length > 0 && isSafeDomain(bare)
}

/** IP literal hợp lệ (v4/v6). Ngoặc vuông của v6 do hàm render tự thêm, không nhận sẵn. */
export function isSafeIpLiteral(ip: string): boolean {
  return ip === ip.trim() && isIP(ip) !== 0
}

/** IP đem nhúng vào rules: v6 phải bọc `[...]` để Chromium không hiểu `:` là dấu tách cổng. */
function ipForRule(ip: string): string {
  return isIP(ip) === 6 ? `[${ip}]` : ip
}

export function assertSafeHostPattern(p: string): void {
  if (!isSafeHostPattern(p)) throw new Error(`Domain/pattern không hợp lệ: ${JSON.stringify(p)}`)
}

export function assertSafeIpLiteral(ip: string): void {
  if (!isSafeIpLiteral(ip)) throw new Error(`IP không hợp lệ: ${JSON.stringify(ip)}`)
}

/**
 * Giá trị cho `--host-resolver-rules`. Ném lỗi nếu pattern/IP không sạch (xem ghi chú an ninh
 * đầu file) hoặc danh sách pattern rỗng.
 */
export function buildHostResolverRules(patterns: readonly string[], ip: string): string {
  assertSafeIpLiteral(ip)
  if (patterns.length === 0) throw new Error('Chưa có domain nào để map')
  const target = ipForRule(ip)
  const seen = new Set<string>()
  const rules: string[] = []
  for (const p of patterns) {
    assertSafeHostPattern(p)
    // Trùng pattern ⇒ rule thứ hai vô nghĩa (Chromium lấy rule khớp đầu tiên)
    if (seen.has(p)) continue
    seen.add(p)
    rules.push(`MAP ${p} ${target}`)
  }
  return rules.join(',')
}

/** URL mở mặc định khi group không đặt riêng: https trên domain đầu tiên (bỏ `*.`). */
export function defaultUrlFor(patterns: readonly string[]): string | null {
  const first = patterns[0]
  if (first === undefined) return null
  const host = first.startsWith('*.') ? first.slice(2) : first
  return `https://${host}/`
}

/** URL đem truyền cho browser: chỉ cho http/https — `file://`, `javascript:`… thì không. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export interface ChromiumArgsInput {
  rules: string
  /** Thư mục profile RIÊNG — xem ghi chú trong hàm. */
  profileDir: string
  url: string
}

/**
 * Cờ dòng lệnh cho browser Chromium.
 *
 * `--user-data-dir` là BẮT BUỘC, không phải tuỳ chọn: nếu browser đã chạy sẵn với profile mặc
 * định thì lần chạy mới chỉ gửi "mở tab" cho tiến trình cũ rồi thoát — cờ
 * `--host-resolver-rules` bị BỎ QUA hoàn toàn (bug im lặng: cửa sổ mở ra nhưng vẫn vào IP cũ).
 * Profile riêng còn cho phép mở song song nhiều cửa sổ tới nhiều server, mỗi cửa sổ một cookie
 * jar (đăng nhập ở LB1 không đè phiên ở LB2).
 */
export function buildChromiumArgs(input: ChromiumArgsInput): string[] {
  if (!isSafeHttpUrl(input.url)) throw new Error(`URL không hợp lệ: ${JSON.stringify(input.url)}`)
  return [
    `--host-resolver-rules=${input.rules}`,
    `--user-data-dir=${input.profileDir}`,
    // Không hỏi "đặt làm browser mặc định" / wizard lần đầu trên profile mới
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    input.url
  ]
}

/**
 * Lệnh curl tương đương để dán vào terminal — `--resolve` là bản curl của cùng ý tưởng
 * (giữ hostname, đổi IP đích) nên certificate cũng vẫn khớp.
 */
export function buildCurlResolveCommand(
  patterns: readonly string[],
  ip: string,
  url: string,
  ports: readonly number[] = [80, 443]
): string {
  assertSafeIpLiteral(ip)
  if (!isSafeHttpUrl(url)) throw new Error(`URL không hợp lệ: ${JSON.stringify(url)}`)
  const target = ipForRule(ip)
  const parts = ['curl']
  for (const p of patterns) {
    assertSafeHostPattern(p)
    // curl --resolve không nhận wildcard → bỏ '*.' để ra domain cụ thể
    const host = p.startsWith('*.') ? p.slice(2) : p
    for (const port of ports) {
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Cổng không hợp lệ: ${String(port)}`)
      parts.push('--resolve', `${host}:${String(port)}:${target}`)
    }
  }
  parts.push('-I', url)
  return parts.join(' ')
}
