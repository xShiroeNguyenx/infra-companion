import { mergeKnownOrder } from './sidebarTree'

/**
 * Menu cột trái của theme **Navigator** — phần "quyết định hiện mục nào, theo thứ tự nào".
 *
 * Từ v0.2.21 menu này sửa được như khối sidebar của theme Infra: tick mục nào hiện, kéo sắp thứ
 * tự. Dashboard vẫn là một mục nhưng **mặc định TẮT** — theme Navigator bắt đầu thẳng từ Hosts,
 * ai muốn Dashboard thì bật lại trong hộp ⚙. Theme Workbench vẫn giữ 🏠 riêng của nó.
 *
 * Hàm thuần ở `packages/shared` (không phải core) vì renderer không được import `@infra/core`.
 */
export type NavMenuId =
  | 'dashboard'
  | 'hosts'
  | 'sftp'
  | 'tunnels'
  | 'snippets'
  | 'keys'
  | 'workspaces'
  | 'history'
  | 'tools'

/** Thứ tự MẶC ĐỊNH — đúng thứ tự menu của v0.2.18–v0.2.20 (Dashboard đứng đầu, nhưng xem `DEFAULT_NAV_ENABLED`). */
export const DEFAULT_NAV_MENU: readonly NavMenuId[] = [
  'dashboard',
  'hosts',
  'sftp',
  'tunnels',
  'snippets',
  'keys',
  'workspaces',
  'history',
  'tools'
]

/** Mục bật sẵn khi chưa cấu hình gì: tất cả TRỪ Dashboard — user yêu cầu theme này mở thẳng vào Hosts. */
export const DEFAULT_NAV_ENABLED: readonly NavMenuId[] = DEFAULT_NAV_MENU.filter((id) => id !== 'dashboard')

/**
 * Mục KHÔNG tắt được: Hosts là trang chính của theme (nơi mở app rơi vào khi mục đã nhớ không
 * còn trên menu). Tắt nó thì menu có thể rỗng hoàn toàn — hộp cấu hình vẫn cho kéo đổi chỗ, chỉ
 * khoá ô tick.
 */
export const NAV_MENU_LOCKED: readonly NavMenuId[] = ['hosts']

/** Mục nhà của theme Navigator — giá trị lưu lạ hay mục đã tắt lúc khởi động đều về đây. */
export const NAV_HOME: NavMenuId = 'hosts'

export function isNavMenuId(id: string): id is NavMenuId {
  return (DEFAULT_NAV_MENU as readonly string[]).includes(id)
}

/**
 * Toàn bộ mục theo thứ tự đang dùng — KỂ CẢ mục đang tắt — cho hộp cấu hình (chỗ duy nhất bật
 * lại được). Thứ tự lưu có thể cũ/thiếu: id lạ bị bỏ, mục mới của bản sau nối vào cuối.
 */
export function orderedNavMenu(order: readonly string[]): NavMenuId[] {
  return mergeKnownOrder(order, DEFAULT_NAV_MENU)
}

/**
 * Danh sách mục để RENDER lên cột trái: theo thứ tự user đặt, chỉ giữ mục đang bật — và mục
 * bị khoá ({@link NAV_MENU_LOCKED}) luôn có mặt dù `enabled` có ghi nó hay không (localStorage
 * bị sửa tay, hoặc bản cũ). Vì thế kết quả không bao giờ rỗng.
 */
export function visibleNavMenu(order: readonly string[], enabled: readonly string[]): NavMenuId[] {
  const on = new Set<string>([...enabled, ...NAV_MENU_LOCKED])
  return orderedNavMenu(order).filter((id) => on.has(id))
}

/**
 * Mục thật sự hiện ở vùng chính khi `navSection` là `section` — TRONG PHIÊN. Mọi id hợp lệ giữ
 * nguyên, kể cả mục user đã TẮT trên menu: palette và "mở SFTP" từ danh mục công cụ vẫn phải tới
 * được nó — tắt chỉ là bỏ khỏi cột trái, không phải cấm dùng. Chỉ giá trị lạ mới về {@link NAV_HOME}.
 */
export function resolveNavigatorSection(section: string): NavMenuId {
  return isNavMenuId(section) ? section : NAV_HOME
}

/**
 * Mục để MỞ APP vào, từ giá trị đã nhớ ở localStorage: chỉ nhận mục đang có trên menu, còn lại
 * về {@link NAV_HOME}. Khác `resolveNavigatorSection` (trong phiên) ở đúng chỗ này — mục đã tắt
 * không phải đích khởi động: ca thật là người lên từ v0.2.20 còn nhớ `dashboard` (khi đó Dashboard
 * mặc định bật), nay Dashboard mặc định tắt mà mở app lại rơi vào Dashboard với menu không sáng
 * mục nào thì trái với "bắt đầu từ Hosts".
 */
export function startupNavSection(stored: string | null, order: readonly string[], enabled: readonly string[]): NavMenuId {
  if (stored !== null && isNavMenuId(stored) && visibleNavMenu(order, enabled).includes(stored)) return stored
  return NAV_HOME
}
