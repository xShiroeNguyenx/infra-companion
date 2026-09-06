import { useMemo, useState } from 'react'
import { orderedNavMenu, resolveNavigatorSection, NAV_MENU_LOCKED, type NavMenuId } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useNavMenuStore } from '../stores/navMenu'
import { useTabsStore } from '../stores/tabs'
import { useUiStore, type NavSection } from '../stores/ui'
import { useWorkspacesStore } from '../stores/workspaces'
import { NAV_ITEM_BY_ID, goToSection, useNavMenu } from '../features/navigator/nav'
import { BlockLayoutPanel } from './BlockLayoutPanel'
import { GearIcon } from './icons'
import { useT } from '../i18n'

/**
 * Cột trái của theme **Navigator** — thay cho `Sidebar` khi user chọn theme này.
 *
 * Nó KHÔNG liệt kê host. Nó là một dãy mục (Hosts · SFTP · Tunnels · Snippets · Keys ·
 * Workspaces · History · Tools, và Dashboard nếu user bật) và bấm mục nào thì nội dung hiện ở
 * vùng chính — đúng cách Termius làm, và là điều user yêu cầu: "menu bên trái không sổ ra nữa,
 * phần tử con hiện ở giao diện chính". Theme này bắt đầu thẳng từ Hosts; thanh tab không có 🏠
 * vì chính các mục ở đây đã là đường về vùng chính.
 *
 * Menu **sửa được** như khối sidebar của theme Infra: nút ⚙ ở hàng đầu mở hộp tick mục nào hiện
 * và kéo sắp thứ tự (Hosts khoá tick vì nó là trang chính; Dashboard mặc định tắt). Mục đã tắt
 * vẫn gọi được từ palette.
 *
 * Nút `«` (hoặc Ctrl+Shift+H) thu cột về dạng chỉ-icon 48px thay vì biến mất hẳn như Sidebar:
 * ở đây mỗi mục là một icon rõ nghĩa nên thu gọn vẫn dùng được, không cần mở lại để bấm.
 */
export function NavRail() {
  const t = useT()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const section = resolveNavigatorSection(useUiStore((s) => s.navSection))
  const setModal = useUiStore((s) => s.setModal)
  const activeId = useTabsStore((s) => s.activeId)
  const hosts = useDataStore((s) => s.hosts)
  const tunnels = useDataStore((s) => s.tunnels)
  const tunnelStates = useDataStore((s) => s.tunnelStates)
  const snippets = useDataStore((s) => s.snippets)
  const keys = useDataStore((s) => s.keys)
  const workspaces = useWorkspacesStore((s) => s.workspaces)
  const items = useNavMenu()
  const [layoutOpen, setLayoutOpen] = useState(false)

  // Mục chỉ SÁNG khi vùng chính đang hiện nó (không tab nào active). Đang ở tab terminal thì
  // không mục nào sáng — sáng một mục mà màn hình đang là terminal thì nó nói sai.
  const home = activeId === null
  const runningTunnels = tunnels.filter((r) => tunnelStates[r.id]?.status === 'active').length

  const counts: Partial<Record<NavSection, number>> = {
    hosts: hosts.length,
    tunnels: tunnels.length,
    snippets: snippets.length,
    keys: keys.length,
    workspaces: workspaces.length
  }

  return (
    <div
      className={`border-edge bg-panel flex shrink-0 flex-col border-r select-none ${collapsed ? 'w-12' : 'w-52'}`}
    >
      {/* Hàng đầu: tên app + ⚙ bố cục + nút thu/mở. Thu gọn thì chỉ còn nút `»` để mở lại —
          hộp cấu hình không có chỗ đứng trong 48px nên ⚙ cũng ẩn theo. */}
      <div className={`flex items-center py-2 ${collapsed ? 'justify-center' : 'gap-1 pr-1.5 pl-3'}`}>
        {!collapsed && (
          <>
            <span className="text-content min-w-0 flex-1 truncate text-xs font-semibold tracking-wide">
              Infra Companion
            </span>
            <button
              className={`hover:bg-hover shrink-0 rounded px-1 py-1 leading-none ${
                layoutOpen ? 'text-accent' : 'text-subtle hover:text-content'
              }`}
              title={t('nav.layoutTitle')}
              aria-label={t('nav.layoutTitle')}
              aria-expanded={layoutOpen}
              onClick={() => setLayoutOpen((v) => !v)}
            >
              <GearIcon />
            </button>
          </>
        )}
        <button
          className="text-subtle hover:bg-hover hover:text-content shrink-0 rounded px-1.5 py-1 text-sm leading-none"
          title={`${collapsed ? t('sidebar.expand') : t('sidebar.collapse')} (Ctrl+Shift+H)`}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          onClick={toggleSidebar}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {layoutOpen && !collapsed && (
        <div className="px-1.5">
          <NavLayoutPanel onClose={() => setLayoutOpen(false)} />
        </div>
      )}

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-1.5 py-1">
        {items.map((item) => (
          <NavButton
            key={item.id}
            icon={item.icon}
            label={t(item.titleKey)}
            collapsed={collapsed}
            active={home && section === item.id}
            count={counts[item.id]}
            // Tunnels: chấm xanh khi có tunnel đang chạy — thứ đáng biết dù đang ở mục khác
            dot={item.id === 'tunnels' && runningTunnels > 0 ? 'bg-success' : undefined}
            onClick={() => goToSection(item.id)}
          />
        ))}
      </nav>

      {/* Hai lối ra quen tay của mọi app ghim ở đáy — không cuộn theo danh sách mục. */}
      <div className="border-edge space-y-0.5 border-t px-1.5 py-1">
        <NavButton icon="⚙" label={t('settings.title')} collapsed={collapsed} onClick={() => setModal('settings')} />
        <NavButton icon="❓" label={t('help.title')} collapsed={collapsed} onClick={() => setModal('help')} />
      </div>
    </div>
  )
}

/**
 * Hộp cấu hình menu Navigator: đủ 9 mục theo thứ tự đang dùng (kể cả mục đang tắt — đây là chỗ
 * duy nhất bật lại được, vd Dashboard), Hosts khoá tick. Phần vẽ dùng chung với sidebar Infra
 * (`BlockLayoutPanel`).
 */
function NavLayoutPanel({ onClose }: { readonly onClose: () => void }) {
  const t = useT()
  const order = useNavMenuStore((s) => s.order)
  const enabled = useNavMenuStore((s) => s.enabled)
  const toggle = useNavMenuStore((s) => s.toggle)
  const move = useNavMenuStore((s) => s.move)
  const reset = useNavMenuStore((s) => s.reset)

  const rows = useMemo(() => {
    return orderedNavMenu(order).map((id: NavMenuId) => {
      const item = NAV_ITEM_BY_ID.get(id)
      const locked = NAV_MENU_LOCKED.includes(id)
      return {
        id,
        icon: item?.icon ?? '',
        label: item ? t(item.titleKey) : id,
        on: locked || enabled.includes(id),
        locked
      }
    })
  }, [order, enabled, t])

  return (
    <BlockLayoutPanel
      title={t('nav.layoutTitle')}
      rows={rows}
      lockedHint={t('nav.layoutLocked')}
      onToggle={toggle}
      onMove={move}
      onReset={reset}
      onClose={onClose}
    />
  )
}

function NavButton({
  icon,
  label,
  collapsed,
  active = false,
  count,
  dot,
  onClick
}: {
  readonly icon: string
  readonly label: string
  readonly collapsed: boolean
  readonly active?: boolean
  /** Số hiện bên phải (host, tunnel…) — bỏ qua khi không có gì để đếm. */
  readonly count?: number
  /** Class màu của chấm trạng thái nhỏ cạnh icon (vd tunnel đang chạy). */
  readonly dot?: string
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`relative flex w-full items-center rounded py-1.5 text-left text-xs ${
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'
      } ${active ? 'bg-accent-soft/40 text-content font-medium' : 'text-muted hover:bg-hover hover:text-content'}`}
      // Vạch accent bên trái thay cho viền: viền làm nút rộng thêm 2px và cả cột giật khi đổi mục
      style={active ? { boxShadow: 'inset 2px 0 0 var(--c-accent)' } : undefined}
    >
      <span className="relative w-5 shrink-0 text-center text-sm leading-none">
        {icon}
        {dot && <span className={`absolute -top-0.5 -right-0.5 size-1.5 rounded-full ${dot}`} />}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count !== undefined && count > 0 && (
            <span className={`shrink-0 text-[10px] ${active ? 'text-muted' : 'text-subtle'}`}>{count}</span>
          )}
        </>
      )}
    </button>
  )
}
