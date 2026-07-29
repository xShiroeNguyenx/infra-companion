/**
 * Khoá định danh cho từng mục đích cấp cổng. THUẦN, cố ý nằm RIÊNG khỏi `LocalDevStore.ts`:
 * store import `node:sqlite` (chỉ có từ Node 22.5) nên mọi thứ dùng chung phải tách ra, nếu
 * không các module như ManagedStackProvider sẽ kéo theo sqlite và không test được trên Node 20.
 */

/** Cổng web dùng chung cho mọi site (1 nginx phục vụ nhiều server_name). */
export const WEB_PORT_PURPOSE = 'web'

/** Cổng riêng của 1 site (khi cần listen tách biệt). */
export function sitePortPurpose(siteId: string): string {
  return `site:${siteId}`
}

/** Cổng của 1 worker php-cgi trong pool. */
export function phpPortPurpose(runtimeId: string, index: number): string {
  return `php:${runtimeId}#${String(index)}`
}

/** Cổng của MariaDB (M2). */
export const MARIADB_PORT_PURPOSE = 'mariadb'
