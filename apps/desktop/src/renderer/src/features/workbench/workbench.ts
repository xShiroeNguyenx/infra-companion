import { NAV_ITEMS, type NavItemMeta } from '../navigator/nav'
import { useUiStore, type WorkbenchPanel } from '../../stores/ui'

/**
 * Theme **Workbench** (kiểu VS Code) — phần "dữ liệu" của activity bar + panel phụ.
 *
 * Khác Navigator ở chỗ mục bấm KHÔNG chiếm vùng chính: activity bar chọn *panel phụ* hiện gì
 * (danh sách host, tunnel, snippet…), panel nằm cạnh, còn vùng chính luôn là terminal/Dashboard.
 * Hai mục không phải panel: 🏠 = về Dashboard (home), 📁 = mở trang SFTP dạng TAB — chúng là vùng
 * làm việc, không phải danh sách, nên thuộc vùng chính.
 *
 * Icon + nhãn lấy từ {@link NAV_ITEMS} để hai theme luôn cùng bộ.
 */
export const WORKBENCH_PANEL_IDS: readonly WorkbenchPanel[] = [
  'hosts',
  'tunnels',
  'snippets',
  'keys',
  'workspaces',
  'history',
  'tools'
]

export function isWorkbenchPanel(id: string): id is WorkbenchPanel {
  return (WORKBENCH_PANEL_IDS as readonly string[]).includes(id)
}

export type WorkbenchPanelMeta = NavItemMeta & { id: WorkbenchPanel }

export const WORKBENCH_PANELS: readonly WorkbenchPanelMeta[] = NAV_ITEMS.filter(
  (item): item is WorkbenchPanelMeta => isWorkbenchPanel(item.id)
)

/** Mở panel `panel` (và mở lại panel phụ nếu đang đóng) — dùng cho palette và activity bar. */
export function openWorkbenchPanel(panel: WorkbenchPanel): void {
  const ui = useUiStore.getState()
  ui.setWorkbenchPanel(panel)
  if (ui.sidebarCollapsed) ui.toggleSidebar()
}
