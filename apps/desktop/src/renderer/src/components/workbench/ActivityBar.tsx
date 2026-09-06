import { useDataStore } from '../../stores/data'
import { useTabsStore } from '../../stores/tabs'
import { useUiStore } from '../../stores/ui'
import { NAV_ITEMS, goToSection } from '../../features/navigator/nav'
import { isWorkbenchPanel } from '../../features/workbench/workbench'
import { useT } from '../../i18n'

/**
 * Activity bar của theme **Workbench** — cột icon 48px sát mép trái, kiểu VS Code.
 *
 *  · mục PANEL (Hosts, Tunnels, Snippets, Keys, Workspaces, History, Tools): bấm → panel phụ
 *    hiện mục đó; bấm lại mục đang sáng → **đóng panel** (bar vẫn còn), y như VS Code;
 *  · 🏠 → về Dashboard (home); 📁 → mở trang SFTP dạng tab — hai thứ này là vùng làm việc nên
 *    đi vào vùng chính, không vào panel;
 *  · ⚙ / ❓ ghim đáy.
 *
 * "Đóng panel" dùng chung cờ `sidebarCollapsed` với theme Infra (Ctrl+Shift+H, lệnh palette
 * "Thu gọn danh sách host" đều áp được) — cùng một ý "giấu cột trái đi", chỉ khác là ở đây bar
 * icon vẫn ở lại.
 */
export function ActivityBar() {
  const t = useT()
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const panel = useUiStore((s) => s.workbenchPanel)
  const setPanel = useUiStore((s) => s.setWorkbenchPanel)
  const setModal = useUiStore((s) => s.setModal)
  const bottomOpen = useUiStore((s) => s.workbenchBottomOpen)
  const toggleBottom = useUiStore((s) => s.toggleWorkbenchBottom)
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  const openToolTab = useTabsStore((s) => s.openToolTab)
  const tunnels = useDataStore((s) => s.tunnels)
  const tunnelStates = useDataStore((s) => s.tunnelStates)

  const activeTab = tabs.find((tab) => tab.id === activeId)
  const runningTunnels = tunnels.some((r) => tunnelStates[r.id]?.status === 'active')

  return (
    <div className="border-edge bg-panel flex w-12 shrink-0 flex-col items-center border-r py-1.5 select-none">
      {NAV_ITEMS.map((item) => {
        const label = t(item.titleKey)
        if (item.id === 'dashboard') {
          return (
            <RailButton
              key={item.id}
              icon={item.icon}
              label={label}
              active={activeId === null}
              flat
              onClick={() => goToSection('dashboard')}
            />
          )
        }
        if (item.id === 'sftp') {
          return (
            <RailButton
              key={item.id}
              icon={item.icon}
              label={label}
              active={activeTab?.kind === 'files'}
              flat
              onClick={() => openToolTab('files')}
            />
          )
        }
        if (!isWorkbenchPanel(item.id)) return null
        const id = item.id
        const open = !collapsed && panel === id
        return (
          <RailButton
            key={id}
            icon={item.icon}
            label={label}
            active={open}
            dot={id === 'tunnels' && runningTunnels ? 'bg-success' : undefined}
            onClick={() => {
              if (open) {
                toggleSidebar() // bấm lại mục đang mở = đóng panel
                return
              }
              setPanel(id)
              if (collapsed) toggleSidebar()
            }}
          />
        )
      })}
      <div className="flex-1" />
      {/* Panel đáy (Monitoring / Log / Tunnels dưới terminal) — sáng khi đang mở, Ctrl+J cũng bật/tắt */}
      <RailButton icon="⬒" label={t('workbench.bottomToggle')} active={bottomOpen} flat onClick={toggleBottom} />
      <RailButton icon="⚙" label={t('settings.title')} onClick={() => setModal('settings')} />
      <RailButton icon="❓" label={t('help.title')} onClick={() => setModal('help')} />
    </div>
  )
}

function RailButton({
  icon,
  label,
  active = false,
  flat = false,
  dot,
  onClick
}: {
  readonly icon: string
  readonly label: string
  readonly active?: boolean
  /** Mục "đi tới" (home / tab) — sáng nhẹ, KHÔNG có vạch accent, để không lẫn với panel đang mở. */
  readonly flat?: boolean
  readonly dot?: string
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`relative my-0.5 flex size-9 items-center justify-center rounded text-base leading-none ${
        active
          ? flat
            ? 'bg-hover text-content'
            : 'bg-accent-soft/40 text-content'
          : 'text-subtle hover:bg-hover hover:text-content'
      }`}
      style={active && !flat ? { boxShadow: 'inset 2px 0 0 var(--c-accent)' } : undefined}
    >
      {icon}
      {dot && <span className={`absolute top-1 right-1 size-1.5 rounded-full ${dot}`} />}
    </button>
  )
}
