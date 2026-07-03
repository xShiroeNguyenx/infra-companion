import type { PluginPanelDto } from '@infra/shared'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'

/** Panel hiển thị nội dung do plugin tạo (markdown hoặc text thuần).
 *  Neo góc phải + mờ khi không rê chuột, KHÔNG backdrop — user vừa xem kết quả
 *  vừa gõ tiếp trong terminal. Không bắt Esc: Esc là phím thật của terminal (vim…). */
export function PluginPanelModal({ panel, onClose }: { panel: PluginPanelDto; onClose: () => void }) {
  const t = useT()
  return (
    <div className="bg-elevated/95 border-edge-strong absolute top-14 right-3 z-40 flex max-h-[calc(100%-6rem)] w-[460px] max-w-[85vw] flex-col overflow-hidden rounded-lg border opacity-75 shadow-2xl transition-opacity duration-150 hover:opacity-100">
      <div className="border-edge flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="text-content truncate text-sm font-semibold">{panel.title}</span>
        <button
          className="text-subtle hover:text-content shrink-0 px-1 text-sm leading-none"
          aria-label={t('panel.close')}
          title={t('panel.close')}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="overflow-y-auto px-4 py-3">
        {panel.markdown !== undefined ? (
          <MiniMarkdown source={panel.markdown} />
        ) : (
          <pre className="text-content whitespace-pre-wrap break-words text-xs">{panel.text ?? ''}</pre>
        )}
      </div>
    </div>
  )
}
