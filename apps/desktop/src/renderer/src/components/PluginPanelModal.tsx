import { useEffect, useState } from 'react'
import type { PluginPanelDto } from '@infra/shared'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { useDraggablePanel } from '../lib/useDraggablePanel'
import { useTabsStore } from '../stores/tabs'

/** Panel hiển thị nội dung do plugin tạo (markdown hoặc text thuần).
 *  Neo góc phải + mờ khi không rê chuột, KHÔNG backdrop — user vừa xem kết quả
 *  vừa gõ tiếp trong terminal. Không bắt Esc: Esc là phím thật của terminal (vim…).
 *  Link [nhãn](cmd:command.id?arg) trong markdown = nút gọi lại command của CHÍNH plugin đó.
 *  Nút – thu nhỏ về pill 🧩 (tự bung lại khi plugin gửi nội dung mới — vd bấm ↻ trong panel). */
export function PluginPanelModal({ panel, onClose }: { panel: PluginPanelDto; onClose: () => void }) {
  const t = useT()
  const [minimized, setMinimized] = useState(false)
  const { panelRef, pos, headerHandlers } = useDraggablePanel()

  // Nội dung mới (phân tích mới / chạy lại 1 mục) → tự bung để user thấy kết quả.
  useEffect(() => {
    setMinimized(false)
  }, [panel])

  const invoke = (commandId: string, arg?: string): void => {
    const { tabs, activeId } = useTabsStore.getState()
    const tab = tabs.find((tb) => tb.id === activeId)
    const sid =
      tab && tab.kind === 'terminal'
        ? ((tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0])?.sessionId ?? null)
        : null
    void window.infra.plugins.invokeCommand(panel.pluginId, commandId, sid, arg)
  }

  if (minimized) {
    return (
      <div
        className="bg-elevated/95 border-edge-strong absolute top-14 right-3 z-40 flex max-w-[280px] cursor-pointer items-center gap-2 rounded-full border py-1.5 pr-2 pl-3 opacity-75 shadow-2xl transition-opacity duration-150 hover:opacity-100"
        title={`${t('panel.restore')} — ${panel.title}`}
        onClick={() => setMinimized(false)}
      >
        <span className="text-xs leading-none">🧩</span>
        <span className="text-content min-w-0 truncate text-xs">{panel.title}</span>
        <button
          className="text-subtle hover:text-content shrink-0 px-1 text-sm leading-none"
          aria-label={t('panel.close')}
          title={t('panel.close')}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`bg-elevated/95 border-edge-strong absolute z-40 flex max-h-[calc(100%-6rem)] w-[460px] max-w-[85vw] min-h-40 min-w-72 resize flex-col overflow-hidden rounded-lg border opacity-75 shadow-2xl transition-opacity duration-150 hover:opacity-100 ${
        pos ? '' : 'top-14 right-3'
      }`}
    >
      <div
        className="border-edge flex shrink-0 cursor-move items-center justify-between gap-2 border-b px-4 py-2.5 select-none"
        title={t('panel.dragHint')}
        {...headerHandlers}
      >
        <span className="text-content truncate text-sm font-semibold">{panel.title}</span>
        <div className="flex shrink-0 items-center">
          <button
            className="text-subtle hover:text-content px-1 text-sm leading-none"
            aria-label={t('panel.minimize')}
            title={t('panel.minimize')}
            onClick={() => setMinimized(true)}
          >
            –
          </button>
          <button
            className="text-subtle hover:text-content px-1 text-sm leading-none"
            aria-label={t('panel.close')}
            title={t('panel.close')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {panel.markdown !== undefined ? (
          <MiniMarkdown source={panel.markdown} onCommand={invoke} />
        ) : (
          <pre className="text-content whitespace-pre-wrap break-words text-xs">{panel.text ?? ''}</pre>
        )}
      </div>
    </div>
  )
}
