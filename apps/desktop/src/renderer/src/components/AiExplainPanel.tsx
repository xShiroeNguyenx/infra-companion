import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { useAiExplainStore } from '../stores/aiExplain'
import { usePluginStore } from '../stores/plugins'
import { Button } from './ui'

/** F46 — Panel kết quả "AI giải thích output" (dock góc phải như panel plugin,
 *  KHÔNG backdrop, không bắt Esc — Esc thuộc terminal). Có panel plugin (cùng z-40
 *  top-14) thì tụt xuống top-24 để không đè nhau. Riêng biệt với usePluginStore.panel
 *  (cái đó coupling pluginId + nút cmd:).
 *  KÉO THẢ được (nắm header) + PHÓNG TO/THU NHỎ (grip góc dưới-phải — CSS resize gốc
 *  của Chromium, browser tự ghi width/height inline nên React không đè lại).
 *  Vị trí nhớ trong phiên (component luôn mount, chỉ return null khi không có yêu cầu);
 *  chưa kéo lần nào thì vẫn neo góc phải như cũ. */
export function AiExplainPanel() {
  const t = useT()
  const request = useAiExplainStore((s) => s.request)
  const close = useAiExplainStore((s) => s.close)
  const retry = useAiExplainStore((s) => s.retry)
  const hasPluginPanel = usePluginStore((s) => s.panel !== null)
  const [minimized, setMinimized] = useState(false)
  /** null = chưa kéo → neo top-right mặc định; có giá trị = toạ độ user đã thả. */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; offX: number; offY: number } | null>(null)

  // Yêu cầu mới → tự bung để user thấy trạng thái/kết quả
  useEffect(() => {
    setMinimized(false)
  }, [request])

  if (!request) return null
  const top = hasPluginPanel ? 'top-24' : 'top-14'

  if (minimized) {
    return (
      <div
        className={`bg-elevated/95 border-edge-strong absolute ${top} right-3 z-40 flex max-w-[280px] cursor-pointer items-center gap-2 rounded-full border py-1.5 pr-2 pl-3 opacity-75 shadow-2xl transition-opacity duration-150 hover:opacity-100`}
        title={t('panel.restore')}
        onClick={() => setMinimized(false)}
      >
        <span className="text-xs leading-none">✨</span>
        <span className="text-content min-w-0 truncate text-xs">{t('ai.explainTitle')}</span>
        <button
          className="text-subtle hover:text-content shrink-0 px-1 text-sm leading-none"
          aria-label={t('panel.close')}
          title={t('panel.close')}
          onClick={(e) => {
            e.stopPropagation()
            close()
          }}
        >
          ✕
        </button>
      </div>
    )
  }

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    // Bấm vào nút –/✕ thì là bấm nút, không phải bắt đầu kéo
    if ((e.target as HTMLElement).closest('button')) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    drag.current = { pointerId: e.pointerId, offX: e.clientX - rect.left, offY: e.clientY - rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    const panel = panelRef.current
    if (!d || d.pointerId !== e.pointerId || !panel) return
    const parent = panel.offsetParent as HTMLElement | null
    if (!parent) return
    const pr = parent.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    // Kẹp trong khung app: không cho văng mất — header luôn còn với tới được
    const x = Math.min(Math.max(e.clientX - pr.left - d.offX, 0), Math.max(0, pr.width - rect.width))
    const y = Math.min(Math.max(e.clientY - pr.top - d.offY, 0), Math.max(0, pr.height - 40))
    setPos({ x, y })
  }

  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }

  return (
    <div
      ref={panelRef}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`bg-elevated/95 border-edge-strong absolute z-40 flex max-h-[calc(100%-3rem)] w-[460px] max-w-[85vw] min-h-40 min-w-72 flex-col overflow-hidden rounded-lg border opacity-75 shadow-2xl transition-opacity duration-150 hover:opacity-100 resize ${
        pos ? '' : `${top} right-3`
      }`}
    >
      <div
        className="border-edge flex shrink-0 cursor-move items-center justify-between gap-2 border-b px-4 py-2.5 select-none"
        title={t('panel.dragHint')}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <span className="text-content truncate text-sm font-semibold">✨ {t('ai.explainTitle')}</span>
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
            onClick={close}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {request.status === 'loading' && (
          <div className="text-muted flex items-center gap-2 py-2 text-xs">
            <span className="bg-warning size-2 animate-pulse rounded-full" />
            {t('ai.explaining')}
          </div>
        )}
        {request.status === 'error' && (
          <div className="space-y-2">
            <p className="text-danger text-xs break-words">{request.error}</p>
            <Button className="!px-2 !py-1 !text-xs" onClick={retry}>
              {t('ai.retry')}
            </Button>
          </div>
        )}
        {request.status === 'done' && <MiniMarkdown source={request.answer ?? ''} />}
      </div>
    </div>
  )
}
