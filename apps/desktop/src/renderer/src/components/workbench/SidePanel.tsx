import { useState, type ReactNode } from 'react'
import { TOOLS, TOOL_CATEGORIES, openTool, splitMenuLabel } from '../../lib/toolCatalog'
import { useDataStore } from '../../stores/data'
import { useTabsStore } from '../../stores/tabs'
import { useToastsStore } from '../../stores/toasts'
import { useUiStore, type WorkbenchPanel } from '../../stores/ui'
import { WORKBENCH_PANELS } from '../../features/workbench/workbench'
import { HistoryView } from '../../features/navigator/HistoryView'
import { Sidebar } from '../Sidebar'
import { SnippetsBlock, TunnelsBlock, WorkspacesBlock } from '../SidebarBlocks'
import { Button } from '../ui'
import { useT } from '../../i18n'

/**
 * Panel phụ của theme **Workbench** — cột cạnh activity bar, nội dung theo mục đang chọn.
 *
 *  · **Hosts** = chính `<Sidebar fluid />` của theme Infra (ô tìm, quick-connect, ★, nhóm gập, các
 *    khối, hàng nút đáy) — đây là phần đắt nhất và đã có sẵn, không viết lại;
 *  · **Tunnels / Snippets / Workspaces** = ba khối gọn của SidebarBlocks (không giới hạn 8 dòng)
 *    + nút *Quản lý…* mở modal đầy đủ để sửa/xoá — panel 260px không phải chỗ đặt form;
 *  · **Keys / Tools** = danh sách gọn viết ở đây; **History** = trang lịch sử có sẵn.
 *
 * **Kéo mép phải để đổi bề rộng** (200–520px, nhớ qua localStorage). Trong lúc kéo phủ một lớp
 * `fixed` lên toàn cửa sổ: không có nó thì xterm bên cạnh nuốt mousemove và thao tác kéo đứt
 * giữa chừng (cùng bẫy với kéo resize pane split).
 */
export function SidePanel() {
  const t = useT()
  const panel = useUiStore((s) => s.workbenchPanel)
  const width = useUiStore((s) => s.workbenchPanelWidth)
  const setWidth = useUiStore((s) => s.setWorkbenchPanelWidth)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const [dragging, setDragging] = useState(false)
  const meta = WORKBENCH_PANELS.find((p) => p.id === panel)

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    setDragging(true)
    const onMove = (ev: MouseEvent): void => setWidth(startW + ev.clientX - startX) // store tự kẹp min/max
    const onUp = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="border-edge bg-panel relative flex shrink-0 flex-col border-r select-none" style={{ width }}>
      {panel === 'hosts' ? (
        <Sidebar fluid />
      ) : (
        <>
          <div className="border-edge flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
            <span className="text-subtle min-w-0 flex-1 truncate text-[10px] font-semibold tracking-wider uppercase">
              {meta?.icon} {meta ? t(meta.titleKey) : ''}
            </span>
            <button
              className="text-subtle hover:bg-hover hover:text-content shrink-0 rounded px-1 py-0.5 text-sm leading-none"
              title={`${t('sidebar.collapse')} (Ctrl+Shift+H)`}
              aria-label={t('sidebar.collapse')}
              onClick={toggleSidebar}
            >
              «
            </button>
          </div>
          <PanelBody panel={panel} />
        </>
      )}

      {/* Tay kéo đổi bề rộng — đè lên mép phải 6px, sáng lên khi hover/kéo */}
      <div
        role="separator"
        aria-orientation="vertical"
        title={t('workbench.resize')}
        onMouseDown={startDrag}
        className={`hover:bg-accent/40 absolute inset-y-0 -right-[3px] z-10 w-1.5 cursor-col-resize ${
          dragging ? 'bg-accent/60' : ''
        }`}
      />
      {dragging && <div className="fixed inset-0 z-[60] cursor-col-resize" />}
    </div>
  )
}

function PanelBody({ panel }: { readonly panel: WorkbenchPanel }) {
  const setModal = useUiStore((s) => s.setModal)
  switch (panel) {
    case 'tunnels':
      return (
        <ListPanel onManage={() => setModal('tunnels')}>
          <TunnelsBlock limit={Infinity} />
        </ListPanel>
      )
    case 'snippets':
      return (
        <ListPanel onManage={() => setModal('snippets')}>
          <SnippetsBlock limit={Infinity} />
        </ListPanel>
      )
    case 'workspaces':
      return (
        <ListPanel onManage={() => setModal('workspaces')}>
          <WorkspacesBlock limit={Infinity} />
        </ListPanel>
      )
    case 'keys':
      return <KeysPanel />
    case 'history':
      return <HistoryView />
    case 'tools':
      return <ToolsPanel />
    default:
      return null
  }
}

/** Khối danh sách gọn + nút Quản lý… ở đáy (mở modal đầy đủ). */
function ListPanel({ children, onManage }: { readonly children: ReactNode; readonly onManage: () => void }) {
  const t = useT()
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
      <PanelFooter>
        <Button className="w-full !py-1 !text-xs" onClick={onManage}>
          {t('dashboard.manage')}…
        </Button>
      </PanelFooter>
    </>
  )
}

function PanelFooter({ children }: { readonly children: ReactNode }) {
  return <div className="border-edge shrink-0 border-t p-2">{children}</div>
}

/** Danh sách SSH key gọn: tên + loại, nút copy public key hiện khi hover; sinh/import/xoá ở modal. */
function KeysPanel() {
  const t = useT()
  const keys = useDataStore((s) => s.keys)
  const setModal = useUiStore((s) => s.setModal)
  const push = useToastsStore((s) => s.push)
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {keys.length === 0 ? (
          <p className="text-subtle px-2 py-1 text-[10px] italic">{t('keys.none')}</p>
        ) : (
          keys.map((key) => (
            <div key={key.id} className="group hover:bg-hover flex items-center gap-2 rounded px-2 py-1">
              <span className="shrink-0 text-xs">🔑</span>
              <span className="min-w-0 flex-1">
                <span className="text-content block truncate text-[11px]">{key.label}</span>
                <span className="text-subtle block truncate font-mono text-[10px]">
                  {key.keyType}
                  {key.hasPassphrase ? ' · 🔒' : ''}
                </span>
              </span>
              <button
                className="text-subtle hover:bg-edge-strong hover:text-content shrink-0 rounded px-1 text-[10px] opacity-0 group-hover:opacity-100"
                title={t('keys.copyPub')}
                onClick={() => void navigator.clipboard.writeText(key.publicKey).then(() => push(t('keys.copiedPub'), 'info'))}
              >
                {t('keys.copyPub')}
              </button>
            </div>
          ))
        )}
      </div>
      <PanelFooter>
        <Button className="w-full !py-1 !text-xs" onClick={() => setModal('keys')}>
          {t('dashboard.manage')}…
        </Button>
      </PanelFooter>
    </>
  )
}

/**
 * Danh mục công cụ MỘT cột cho panel hẹp — cùng nguồn `TOOLS`/`TOOL_CATEGORIES` và cùng `openTool`
 * với menu `⋯`, lưới và tab Tất cả tính năng. Không dùng lại FeaturesTabView vì lưới của nó chia
 * cột theo bề rộng CỬA SỔ (breakpoint Tailwind), trong panel 260px sẽ ra 3 cột bé tí.
 */
function ToolsPanel() {
  const t = useT()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const groups = TOOL_CATEGORIES.map((category) => ({
    category,
    tools: TOOLS.filter((tool) => tool.category === category.id)
      .map((tool) => ({ tool, ...splitMenuLabel(t(tool.menuKey)) }))
      .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
  })).filter((g) => g.tools.length > 0)

  return (
    <>
      <div className="border-edge shrink-0 border-b p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('features.search')}
          aria-label={t('features.search')}
          className="border-edge bg-input text-content placeholder-subtle focus:border-accent w-full rounded border px-2 py-1 text-[11px] outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.length === 0 && <p className="text-subtle px-3 py-3 text-center text-[11px]">{t('features.noMatch')}</p>}
        {groups.map(({ category, tools }) => (
          <div key={category.id}>
            <div className="text-subtle px-3 pt-1.5 pb-0.5 text-[9px] font-semibold tracking-wider uppercase">
              {t(category.titleKey)}
            </div>
            {tools.map(({ tool, icon, name }) => (
              <button
                key={tool.id}
                className="text-muted hover:bg-hover hover:text-content flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
                onClick={() => openTool(tool)}
              >
                <span className="shrink-0 text-sm leading-none">{icon}</span>
                <span className="min-w-0 truncate">{name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <PanelFooter>
        <Button className="w-full !py-1 !text-xs" onClick={() => useTabsStore.getState().openToolTab('features')}>
          ⊞ {splitMenuLabel(t('menu.features')).name}
        </Button>
      </PanelFooter>
    </>
  )
}
