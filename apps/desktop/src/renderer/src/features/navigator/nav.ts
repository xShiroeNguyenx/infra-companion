import { useMemo } from 'react'
import { visibleNavMenu } from '@infra/shared'
import type { I18nKey } from '../../i18n'
import { useNavMenuStore } from '../../stores/navMenu'
import { useTabsStore } from '../../stores/tabs'
import { useUiStore, type NavSection } from '../../stores/ui'

/**
 * Theme **Navigator** (kiểu Termius) — phần "dữ liệu" của thanh điều hướng.
 *
 * Ở theme Infra, cột trái LÀ danh sách host và sổ ra tại chỗ. Ở theme này cột trái chỉ là một
 * dãy mục; bấm mục nào thì **vùng chính** đổi sang nội dung của mục đó. Danh sách mục khai ở đây
 * để NavRail, Command Palette, ActivityBar (Workbench) và vùng chính dùng cùng một nguồn — thêm
 * một mục là thêm đúng một dòng (và một id trong `DEFAULT_NAV_MENU` ở shared).
 */
export interface NavItemMeta {
  id: NavSection
  icon: string
  titleKey: I18nKey
}

/**
 * Bộ mục ĐẦY ĐỦ theo thứ tự mặc định. Cột trái Navigator KHÔNG vẽ thẳng từ đây mà qua
 * {@link useNavMenu} (tôn trọng mục user bật/tắt + thứ tự kéo; Dashboard mặc định tắt). Palette
 * liệt kê đủ bộ này — mục đã tắt vẫn gọi được, tắt là bỏ khỏi cột chứ không phải cấm dùng.
 * Theme Workbench lấy 🏠 và các panel từ đây.
 */
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

export const NAV_ITEM_BY_ID: ReadonlyMap<NavSection, NavItemMeta> = new Map(NAV_ITEMS.map((item) => [item.id, item]))

/** Mục đang hiện trên cột trái Navigator: thứ tự và bật/tắt theo `useNavMenuStore`. */
export function useNavMenu(): readonly NavItemMeta[] {
  const order = useNavMenuStore((s) => s.order)
  const enabled = useNavMenuStore((s) => s.enabled)
  return useMemo(
    () =>
      visibleNavMenu(order, enabled)
        .map((id) => NAV_ITEM_BY_ID.get(id))
        .filter((item): item is NavItemMeta => item !== undefined),
    [order, enabled]
  )
}

/**
 * Chuyển sang một mục: đặt mục đang chọn VÀ về "home" (không tab nào active) để vùng chính hiện
 * nó. Hai việc phải đi cùng nhau — chỉ đổi mục mà một tab terminal vẫn đang active thì người
 * dùng bấm rồi không thấy gì đổi.
 *
 * Ở theme Infra/Workbench hàm này vẫn dùng được (nút 🏠, palette): vùng chính khi đó luôn là
 * Dashboard, mục đang chọn không ảnh hưởng gì.
 */
export function goToSection(section: NavSection): void {
  useUiStore.getState().setNavSection(section)
  useTabsStore.getState().showDashboard()
}
