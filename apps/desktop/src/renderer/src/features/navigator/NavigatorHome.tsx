import type { ReactNode } from 'react'
import { FeaturesTabView } from '../../components/FeaturesTabView'
import { KeysModal } from '../../components/KeysModal'
import { SnippetsModal } from '../../components/SnippetsModal'
import { TunnelsModal } from '../../components/TunnelsModal'
import { WorkspacesModal } from '../../components/WorkspacesModal'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import { DashboardView } from '../dashboard/DashboardView'
import { HistoryView } from './HistoryView'
import { HostsView } from './HostsView'
import { useT } from '../../i18n'

/**
 * Vùng "home" của app — thứ hiện khi KHÔNG tab nào active (`activeId === null`).
 *
 *  · theme **Infra** → Dashboard, y như trước;
 *  · theme **Navigator** → mục đang chọn trên NavRail (Dashboard chỉ là một trong các mục).
 *
 * Đặt quyết định này ở một chỗ để App.tsx không phải biết theme nào đang bật.
 */
export function HomeView({ active }: { active: boolean }) {
  const layout = useSettingsStore((s) => s.layout)
  if (layout === 'navigator') return <NavigatorHome active={active} />
  return <DashboardView active={active} />
}

/**
 * Vùng chính của theme Navigator: vẽ mục đang chọn.
 *
 * Dashboard và Hosts luôn mounted (ẩn bằng `hidden`) — Dashboard có effect nạp lịch sử
 * monitoring theo cờ `active`, Hosts giữ nhóm đang xem. Các mục còn lại mount theo mục đang
 * chọn và chỉ ẩn khi một tab terminal đang active: chuyển sang tab rồi quay lại vẫn thấy form
 * đang điền dở, đổi mục thì bắt đầu lại — đúng kỳ vọng của một menu.
 *
 * Tunnels / Snippets / Keys / Workspaces dùng lại ĐÚNG component của popup ở chế độ `embedded`
 * (cùng cách ToolTabView làm) nên không có bản UI thứ hai phải bảo trì.
 */
function NavigatorHome({ active }: { active: boolean }) {
  const t = useT()
  const section = useUiStore((s) => s.navSection)
  return (
    <>
      <DashboardView active={active && section === 'dashboard'} />
      <HostsView active={active && section === 'hosts'} />
      {section === 'tunnels' && (
        <Section hidden={!active} icon="🔀" title={t('tunnel.title')}>
          <TunnelsModal embedded />
        </Section>
      )}
      {section === 'snippets' && (
        <Section hidden={!active} icon="📝" title={t('nav.snippets')}>
          <SnippetsModal embedded />
        </Section>
      )}
      {section === 'keys' && (
        <Section hidden={!active} icon="🔑" title={t('nav.keys')}>
          <KeysModal embedded />
        </Section>
      )}
      {section === 'workspaces' && (
        <Section hidden={!active} icon="🪟" title={t('ws.title')}>
          <WorkspacesModal embedded />
        </Section>
      )}
      {section === 'history' && (
        <Section hidden={!active} icon="🕒" title={t('history.title')}>
          <HistoryView />
        </Section>
      )}
      {section === 'tools' && <FeaturesTabView active={active} />}
    </>
  )
}

/** Khung một mục: header (icon + tên) + thân chiếm hết chỗ còn lại — cùng khuôn với ToolTabView. */
function Section({
  icon,
  title,
  hidden,
  children
}: {
  readonly icon: string
  readonly title: string
  readonly hidden: boolean
  readonly children: ReactNode
}) {
  return (
    <div className={`absolute inset-0 flex flex-col ${hidden ? 'hidden' : ''}`}>
      <div className="border-edge bg-panel flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className="text-content text-sm font-medium">
          {icon} {title}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
