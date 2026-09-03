import type { PackageUpdateDto } from './types'

/**
 * F37 — tóm tắt một đợt cập nhật thành thứ đọc được.
 *
 * Ở `packages/shared` vì **renderer vẽ phần tóm tắt** mà renderer KHÔNG import được
 * `@infra/core` (CLAUDE.md §5). Test nằm ở `packages/core` vì vitest chỉ quét ở đó.
 *
 * Vì sao cần: một danh sách 435 cái tên gói không trả lời được câu hỏi người ta thật sự có —
 * *có gấp không* (mấy bản vá bảo mật), *có phải khởi động lại không*, *đợt này đụng vào cái gì*.
 */

/** Nhóm gói theo "thứ đang đổi là gì". */
export type UpdateGroup = 'kernel' | 'core' | 'web' | 'db' | 'runtime' | 'other'

/**
 * Xếp gói vào nhóm theo TÊN. Cố ý thô: mục tiêu là trả lời "đợt này đụng vào cái gì", không
 * phải phân loại chính xác từng gói. Nhận cả tên Debian lẫn RHEL cho cùng phần mềm.
 */
export function groupOf(name: string): UpdateGroup {
  const n = name.toLowerCase()
  if (/^(kernel|linux-image|linux-headers|linux-modules)/.test(n)) return 'kernel'
  if (/^(glibc|libc6|systemd|dbus|openssl|libssl|openssh|sudo|pam_|libpam|ca-certificates)/.test(n)) return 'core'
  if (/^(nginx|httpd|apache2|php|tomcat|haproxy|varnish)/.test(n)) return 'web'
  if (/^(mysql|mariadb|postgresql|postgres|redis|memcached|mongodb)/.test(n)) return 'db'
  if (/^(python|nodejs|openjdk|java-|perl|ruby|golang|dotnet)/.test(n)) return 'runtime'
  return 'other'
}

/**
 * Gói nào mà cập nhật xong phải KHỞI ĐỘNG LẠI mới thật sự chạy bản mới.
 *
 * Đây là câu hỏi vận hành quan trọng nhất sau "có bản vá bảo mật không": vá kernel/glibc mà
 * không reboot thì máy vẫn đang chạy bản cũ — tức đã "vá" nhưng chưa hết lỗ hổng.
 */
export function needsReboot(updates: readonly PackageUpdateDto[]): boolean {
  return updates.some(
    (u) => groupOf(u.name) === 'kernel' || /^(glibc|libc6|systemd|dbus)/.test(u.name.toLowerCase())
  )
}

export interface UpdateSummary {
  total: number
  security: number
  needsReboot: boolean
  /** Chỉ các nhóm CÓ gói, xếp theo mức đáng chú ý (kernel → core → web → db → runtime → other). */
  groups: Array<{ group: UpdateGroup; names: string[] }>
}

const GROUP_ORDER: readonly UpdateGroup[] = ['kernel', 'core', 'web', 'db', 'runtime', 'other']

export function summarizeUpdates(updates: readonly PackageUpdateDto[]): UpdateSummary {
  const byGroup = new Map<UpdateGroup, string[]>()
  for (const u of updates) {
    const g = groupOf(u.name)
    byGroup.set(g, [...(byGroup.get(g) ?? []), u.name])
  }
  return {
    total: updates.length,
    security: updates.filter((u) => u.security).length,
    needsReboot: needsReboot(updates),
    groups: GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({
      group,
      names: (byGroup.get(group) ?? []).sort((a, b) => a.localeCompare(b))
    }))
  }
}

export interface FleetSummary {
  /** Số máy có kết quả (kể cả máy lỗi) — tức số máy đã thử quét. */
  scanned: number
  /** Có ít nhất một gói cần cập nhật. */
  needPatch: number
  /** Quét được và không còn gì để cập nhật. */
  clean: number
  /** Không quét được (không dò ra package manager, lệnh lỗi, mất kết nối…). */
  failed: number
  securityHosts: number
  securityPackages: number
  rebootHosts: number
}

/**
 * Gộp kết quả cả fleet thành mấy con số đứng đầu màn hình.
 *
 * Không có bước này thì kết quả quét là một danh sách máy, mỗi máy một danh sách gói — người
 * đọc phải tự cộng để biết "có phải vá gấp không". Đó chính là chỗ khiến kết quả quét khó hiểu.
 */
export function summarizeFleet(
  rows: readonly { updates: readonly PackageUpdateDto[]; error?: string }[]
): FleetSummary {
  const ok = rows.filter((r) => !r.error)
  return {
    scanned: rows.length,
    failed: rows.length - ok.length,
    needPatch: ok.filter((r) => r.updates.length > 0).length,
    clean: ok.filter((r) => r.updates.length === 0).length,
    securityHosts: ok.filter((r) => r.updates.some((u) => u.security)).length,
    securityPackages: ok.reduce((n, r) => n + r.updates.filter((u) => u.security).length, 0),
    rebootHosts: ok.filter((r) => needsReboot(r.updates)).length
  }
}
