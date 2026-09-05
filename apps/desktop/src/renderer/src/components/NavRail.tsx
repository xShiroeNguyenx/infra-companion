import { useDataStore } from '../stores/data'
import { useTabsStore } from '../stores/tabs'
import { useUiStore, type NavSection } from '../stores/ui'
import { useWorkspacesStore } from '../stores/workspaces'
import { NAV_ITEMS, goToSection } from '../features/navigator/nav'
import { useT } from '../i18n'

/**
 * Cột trái của theme **Navigator** — thay cho `Sidebar` khi user chọn theme này.
 *
 * Nó KHÔNG liệt kê host. Nó là một dãy mục (Dashboard · Hosts · Tunnels · Snippets · Keys ·
 * Workspaces · History · Tools) và bấm mục nào thì nội dung hiện ở vùng chính — đúng cách
 * Termius làm, và là điều user yêu cầu: "menu bên trái không sổ ra nữa, phần tử con hiện ở
 * giao diện chính".
 *
 * Nút `«` (hoặc Ctrl+Shift+H) thu cột về dạng chỉ-icon 48px thay vì biến mất hẳn như Sidebar:
 * ở đây mỗi mục là một icon rõ nghĩa nên thu gọn vẫn dùng được, không cần mở lại để bấm.
 */
export function NavRail() {
  const t = useT()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const section = useUiStore((s) => s.navSection)
  const setModal = useUiStore((s) => s.setModal)
  const activeId = useTabsStore((s) => s.activeId)
  const hosts = useDataStore((s) => s.hosts)
  const tunnels = useDataStore((s) => s.tunnels)
  const tunnelStates = useDataStore((s) => s.tunnelStates)
  const snippets = useDataStore((s) => s.snippets)
  const keys = useDataStore((s) => s.keys)
  const workspaces = useWorkspacesStore((s) => s.workspaces)

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
      {/* Hàng đầu: tên app + nút thu/mở. Thu gọn thì chỉ còn nút `»` để mở lại. */}
      <div className={`flex items-center py-2 ${collapsed ? 'justify-center' : 'gap-2 pr-1.5 pl-3'}`}>
        {!collapsed && (
          <span className="text-content min-w-0 flex-1 truncate text-xs font-semibold tracking-wide">
            Infra Companion
          </span>
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

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-1.5 py-1">
        {NAV_ITEMS.map((item) => (
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
