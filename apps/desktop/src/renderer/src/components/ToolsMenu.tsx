import { useEffect, useMemo, useRef, useState } from 'react'
import { TOOLS, TOOL_CATEGORIES, openTool, splitMenuLabel } from '../lib/toolCatalog'
import { useTabsStore } from '../stores/tabs'
import { useUiStore, type AppModal } from '../stores/ui'
import { useWatcherStore } from '../stores/watcher'
import { useT, type I18nKey } from '../i18n'

/**
 * Menu `⋯` ở đáy sidebar — đường vào công cụ khi đang ở tab terminal (không thấy Dashboard).
 *
 * Bản cũ là một dropdown PHẲNG mười mấy dòng bật lên che gần hết danh sách host, và trộn hai
 * loại việc khác nhau vào cùng một khối: công cụ (Workspaces, Tunnels, Monitoring…) lẫn hành
 * động quản lý danh bạ (Tạo group, Import ssh_config). Ở đây tách ra:
 *
 *  · **ô tìm** ngay trong menu — gõ 2-3 chữ là tới thẳng, không cần biết công cụ nằm nhóm nào;
 *  · **chia nhóm** theo `TOOL_CATEGORIES` — CÙNG danh mục với tab "Tất cả tính năng", nên hai
 *    nơi không bao giờ lệch nhau;
 *  · **hành động quản lý** xuống khối riêng dưới cùng, cạnh Cài đặt / Trợ giúp.
 *
 * Khi tìm kiếm, menu tìm trong **toàn bộ** danh mục chứ không chỉ nhóm `common`: gõ tên một
 * công cụ mà menu báo không có, trong khi app có nó, là hành vi sai.
 */

/** Một mục hành động không phải công cụ (tạo group, import…) — nơi gọi truyền vào. */
export interface ToolsMenuAction {
  id: string
  labelKey: I18nKey
  run: () => void
}

export function ToolsMenu({
  open,
  onClose,
  actions
}: {
  readonly open: boolean
  readonly onClose: () => void
  /** Hành động quản lý danh bạ — sống ở Sidebar vì cần state của nó (editor group, refresh). */
  readonly actions: readonly ToolsMenuAction[]
}) {
  const t = useT()
  const setModal = useUiStore((s) => s.setModal)
  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const setWatcherEnabled = useWatcherStore((s) => s.setEnabled)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Mở menu là con trỏ vào ngay ô tìm: mở rồi phải bấm thêm vào ô mới gõ được thì ô tìm
  // chỉ làm chậm người dùng bàn phím.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Đóng rồi mở lại thì bắt đầu sạch — không thì lần sau mở ra thấy menu đã bị lọc sẵn
  // bởi chữ gõ từ lần trước và trông như menu bị thiếu mục.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const needle = query.trim().toLowerCase()
  const searching = needle !== ''

  const watcherName = splitMenuLabel(t('menu.watcher'))

  const sections = useMemo(() => {
    const hit = (label: string): boolean => !searching || label.toLowerCase().includes(needle)
    // Không tìm kiếm → CHỈ nhóm `common` (menu là đường vào nhanh, không phải danh mục đầy đủ).
    // Đang tìm kiếm → tìm trong TOÀN BỘ danh mục.
    const pool = searching ? TOOLS : TOOLS.filter((tool) => tool.common)
    return TOOL_CATEGORIES.map((category) => ({
      category,
      tools: pool
        .filter((tool) => tool.category === category.id)
        .map((tool) => ({ tool, ...splitMenuLabel(t(tool.menuKey)) }))
        .filter((entry) => hit(entry.name))
    })).filter((section) => section.tools.length > 0)
  }, [needle, searching, t])

  const showWatcher = !searching || watcherName.name.toLowerCase().includes(needle)
  const shownActions = actions.filter((a) => !searching || t(a.labelKey).toLowerCase().includes(needle))
  const nothing = sections.length === 0 && !showWatcher && shownActions.length === 0

  if (!open) return null

  const pick = (run: () => void): void => {
    onClose()
    run()
  }

  return (
    /* ⚠️ Menu KHÔNG neo `right-0 w-60` theo nút `⋯` được: nút đó nằm sát mép phải một cột chỉ
       rộng 240px, nên một menu rộng 240px sẽ thò hẳn ra ngoài mép TRÁI cửa sổ (đã dính thật).
       Neo CẢ HAI mép vào hàng nút đáy (`relative` đặt ở hàng đó) → menu tự rộng bằng sidebar
       và không bao giờ tràn, ở cả hai phía, không phụ thuộc bề rộng cột hay số nút trong hàng.
       `left-2 right-2` để lề bằng `p-2` của hàng nút, cho menu thẳng cột với các nút bên dưới. */
    <div className="border-edge-strong bg-elevated absolute bottom-9 left-2 right-2 z-50 flex max-h-[55vh] flex-col rounded-md border shadow-xl">
      <div className="border-edge shrink-0 border-b p-1.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            // Enter khi chỉ còn ĐÚNG một kết quả → mở luôn. Nhiều kết quả thì không đoán:
            // mở nhầm một công cụ chạy thật (bulk, xoay key) tệ hơn hẳn việc bấm thêm một cái.
            if (e.key === 'Enter') {
              const only = sections.flatMap((s) => s.tools)
              if (only.length === 1 && shownActions.length === 0) pick(() => openTool(only[0]!.tool))
              else if (only.length === 0 && shownActions.length === 1) pick(shownActions[0]!.run)
            }
          }}
          placeholder={t('menu.searchTools')}
          aria-label={t('menu.searchTools')}
          className="border-edge bg-input text-content placeholder-subtle focus:border-accent w-full rounded border px-2 py-1 text-[11px] outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {nothing && <p className="text-subtle px-3 py-3 text-center text-[11px]">{t('features.noMatch')}</p>}

        {sections.map(({ category, tools }) => (
          <div key={category.id}>
            <div className="text-subtle px-3 pt-1.5 pb-0.5 text-[9px] font-semibold tracking-wider uppercase">
              {t(category.titleKey)}
            </div>
            {tools.map(({ tool, icon, name }) => (
              <MenuItem key={tool.id} icon={icon} label={name} onClick={() => pick(() => openTool(tool))} />
            ))}
            {/* Watcher là TOGGLE chứ không mở gì — thuộc nhóm "cả fleet" cùng Monitoring */}
            {category.id === 'fleet' && showWatcher && (
              <MenuItem
                icon={watcherName.icon}
                label={`${watcherEnabled ? '✓ ' : ''}${watcherName.name}`}
                active={watcherEnabled}
                onClick={() => pick(() => setWatcherEnabled(!watcherEnabled))}
              />
            )}
          </div>
        ))}

        {/* Watcher vẫn phải tìm thấy được khi nhóm 'fleet' bị lọc mất hoàn toàn */}
        {showWatcher && !sections.some((s) => s.category.id === 'fleet') && (
          <MenuItem
            icon={watcherName.icon}
            label={`${watcherEnabled ? '✓ ' : ''}${watcherName.name}`}
            active={watcherEnabled}
            onClick={() => pick(() => setWatcherEnabled(!watcherEnabled))}
          />
        )}

        {/* Hành động QUẢN LÝ danh bạ — khối riêng: chúng sửa dữ liệu, không phải mở công cụ.
            Trộn lẫn vào danh sách công cụ như bản cũ thì "Tạo group" nằm cạnh "Monitoring"
            mà không có gì cho biết hai thứ đó khác loại nhau. */}
        {shownActions.length > 0 && (
          <>
            <div className="border-edge my-1 border-t" />
            <div className="text-subtle px-3 pt-0.5 pb-0.5 text-[9px] font-semibold tracking-wider uppercase">
              {t('menu.catManage')}
            </div>
            {shownActions.map((action) => (
              <MenuItem key={action.id} label={t(action.labelKey)} onClick={() => pick(action.run)} />
            ))}
          </>
        )}
      </div>

      {/* Ba mục cuối GHIM ở đáy menu, không cuộn theo: chúng là lối ra quen tay của mọi app
          (danh mục đầy đủ / cài đặt / trợ giúp) nên phải luôn ở đúng chỗ. */}
      <div className="border-edge shrink-0 border-t py-1">
        <MenuItem
          icon="⊞"
          label={splitMenuLabel(t('menu.features')).name}
          onClick={() => pick(() => useTabsStore.getState().openToolTab('features'))}
        />
        <div className="flex">
          <MenuItem
            className="flex-1"
            icon={splitMenuLabel(t('menu.settings')).icon}
            label={splitMenuLabel(t('menu.settings')).name}
            onClick={() => pick(() => setModal('settings'))}
          />
          <MenuItem
            className="flex-1"
            icon={splitMenuLabel(t('menu.help')).icon}
            label={splitMenuLabel(t('menu.help')).name}
            onClick={() => pick(() => setModal('help'))}
          />
        </div>
      </div>
    </div>
  )
}

function MenuItem({
  icon,
  label,
  active,
  className = '',
  onClick
}: {
  readonly icon?: string
  readonly label: string
  readonly active?: boolean
  readonly className?: string
  readonly onClick: () => void
}) {
  return (
    <button
      className={`hover:bg-hover hover:text-content flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs whitespace-nowrap ${
        active ? 'text-accent-fg' : 'text-muted'
      } ${className}`}
      onClick={onClick}
    >
      {icon && <span className="shrink-0 text-sm leading-none">{icon}</span>}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/** Modal toàn cục — App là nơi mount duy nhất. */
export type { AppModal }
