import type { I18nKey } from '../../i18n'
import { useTabsStore } from '../../stores/tabs'
import { useUiStore, type NavSection } from '../../stores/ui'

/**
 * Theme **Navigator** (kiểu Termius) — phần "dữ liệu" của thanh điều hướng.
 *
 * Ở theme Infra, cột trái LÀ danh sách host và sổ ra tại chỗ. Ở theme này cột trái chỉ là một
 * dãy mục; bấm mục nào thì **vùng chính** (nơi Dashboard vẫn đứng) đổi sang nội dung của mục đó.
 * Danh sách mục khai ở đây để NavRail, Command Palette và vùng chính dùng cùng một nguồn — thêm
 * một mục là thêm đúng một dòng.
 */
export interface NavItemMeta {
  id: NavSection
  icon: string
  titleKey: I18nKey
}

export const NAV_ITEMS: readonly NavItemMeta[] = [
  { id: 'dashboard', icon: '🏠', titleKey: 'nav.dashboard' },
  { id: 'hosts', icon: '🖥', titleKey: 'nav.hosts' },
  { id: 'sftp', icon: '📁', titleKey: 'nav.sftp' },
  { id: 'tunnels', icon: '🔀', titleKey: 'nav.tunnels' },
  { id: 'snippets', icon: '📝', titleKey: 'nav.snippets' },
  { id: 'keys', icon: '🔑', titleKey: 'nav.keys' },
  { id: 'workspaces', icon: '🪟', titleKey: 'nav.workspaces' },
  { id: 'history', icon: '🕒', titleKey: 'nav.history' },
  { id: 'tools', icon: '⊞', titleKey: 'nav.tools' }
]

/**
 * Chuyển sang một mục: đặt mục đang chọn VÀ về "home" (không tab nào active) để vùng chính hiện
 * nó. Hai việc phải đi cùng nhau — chỉ đổi mục mà một tab terminal vẫn đang active thì người
 * dùng bấm rồi không thấy gì đổi.
 *
 * Ở theme Infra hàm này vẫn dùng được (nút 🏠, palette): vùng chính khi đó luôn là Dashboard,
 * mục đang chọn không ảnh hưởng gì.
 */
export function goToSection(section: NavSection): void {
  useUiStore.getState().setNavSection(section)
  useTabsStore.getState().showDashboard()
}
