import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTabsStore, type AppTab } from '../../stores/tabs'
import { useToastsStore } from '../../stores/toasts'
import { useSettingsStore } from '../../stores/settings'
import { useT } from '../../i18n'
import { TerminalPane } from './TerminalPane'

function statusDot(status: string): string {
  if (status === 'connected') return 'bg-success'
  if (status === 'exited') return 'bg-danger'
  return 'bg-warning animate-pulse'
}

/** Render các pane của 1 tab terminal dạng lưới + thanh công cụ pane (split, broadcast, log). */
export function TerminalTabView({ tab, active }: { tab: AppTab; active: boolean }) {
  const t = useT()
  const { tabs, setActivePane, closePane, toggleBroadcast, mergeTabs, unmergeTab } = useTabsStore()
  // Có ảnh nền: nền pane/grid trong suốt để lộ ảnh phía sau terminal
  const hasBackground = useSettingsStore((s) => s.backgroundImage !== null)
  const [logging, setLogging] = useState<Set<string>>(new Set())
  const [recording, setRecording] = useState<Set<string>>(new Set())
  const count = tab.panes.length
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const multi = count > 1
  // Còn tab terminal khác để gộp vào tab này không (Split = gộp tab thành pane)
  const canMerge = tabs.filter((t) => t.kind === 'terminal').length > 1
  const activePane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
  const activeLogging = activePane ? logging.has(activePane.sessionId) : false
  const activeRecording = activePane ? recording.has(activePane.sessionId) : false

  const toggleLog = async (): Promise<void> => {
    if (!activePane) return
    const state = await window.infra.terminal.toggleLog(activePane.sessionId, activePane.title)
    setLogging((prev) => {
      const next = new Set(prev)
      if (state.active) next.add(activePane.sessionId)
      else next.delete(activePane.sessionId)
      return next
    })
    useToastsStore.getState().push(state.active ? `Đang ghi log: ${state.filePath}` : 'Đã dừng ghi log', 'info')
  }

  const toggleRecord = async (): Promise<void> => {
    if (!activePane) return
    const state = await window.infra.terminal.toggleRecord(activePane.sessionId, activePane.title)
    setRecording((prev) => {
      const next = new Set(prev)
      if (state.active) next.add(activePane.sessionId)
      else next.delete(activePane.sessionId)
      return next
    })
    useToastsStore.getState().push(
      state.active ? `Đang ghi hình (replay): ${state.filePath}` : 'Đã dừng ghi hình',
      'info'
    )
  }

  // ── Kéo chỉnh kích thước pane: tỷ lệ fr per cột/hàng, gutter đè lên ranh giới grid.
  // Kéo = đổi cặp track hai bên ranh giới; double-click = chia đều lại; xterm tự fit
  // nhờ ResizeObserver sẵn có. Reset khi số cột/hàng đổi (thêm/đóng pane).
  const gridRef = useRef<HTMLDivElement>(null)
  const [colFr, setColFr] = useState<number[]>(() => Array(cols).fill(1))
  const [rowFr, setRowFr] = useState<number[]>(() => Array(rows).fill(1))
  const [dragAxis, setDragAxis] = useState<'col' | 'row' | null>(null)
  useEffect(() => {
    setColFr(Array(cols).fill(1))
    setRowFr(Array(rows).fill(1))
  }, [cols, rows])

  const startDrag = (e: ReactMouseEvent, index: number, axis: 'col' | 'row'): void => {
    e.preventDefault()
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return
    const startPos = axis === 'col' ? e.clientX : e.clientY
    const sizePx = axis === 'col' ? rect.width : rect.height
    const startFr = axis === 'col' ? [...colFr] : [...rowFr]
    const total = startFr.reduce((a, b) => a + b, 0)
    const min = total * 0.12 // không cho pane bé hơn ~12% — vẫn đọc được nội dung
    const setFr = axis === 'col' ? setColFr : setRowFr
    setDragAxis(axis)
    const onMove = (ev: MouseEvent): void => {
      const raw = (((axis === 'col' ? ev.clientX : ev.clientY) - startPos) / sizePx) * total
      const delta = Math.max(-(startFr[index - 1]! - min), Math.min(startFr[index]! - min, raw))
      const next = [...startFr]
      next[index - 1] = startFr[index - 1]! + delta
      next[index] = startFr[index]! - delta
      setFr(next)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDragAxis(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const frTemplate = (fr: number[]): string => fr.map((f) => `minmax(0, ${f}fr)`).join(' ')
  /** Vị trí ranh giới thứ i (0-100%) theo tổng fr phía trước. */
  const cutPct = (fr: number[], i: number): number =>
    (fr.slice(0, i).reduce((a, b) => a + b, 0) / fr.reduce((a, b) => a + b, 0)) * 100

  return (
    <div className={`absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      {/* Thanh công cụ chỉ hiện khi có nhiều pane hoặc để bật split/broadcast */}
      <div className="border-edge bg-panel flex h-7 shrink-0 items-center gap-2 border-b px-2 text-[11px]">
        <button
          className={`rounded border px-1.5 py-0.5 disabled:opacity-40 ${
            multi
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-edge-strong text-muted hover:bg-hover hover:text-content'
          }`}
          title={t('tabs.splitTip')}
          disabled={!multi && !canMerge}
          onClick={() => (multi ? unmergeTab(tab.id) : mergeTabs(tab.id))}
        >
          {multi ? t('tabs.splitOn') : t('tabs.split')}
        </button>
        <button
          className={`rounded border px-1.5 py-0.5 ${
            tab.broadcast
              ? 'border-warning bg-warning/15 text-warning'
              : 'border-edge-strong text-muted hover:bg-hover hover:text-content'
          }`}
          title={t('tabs.broadcastTip')}
          onClick={() => toggleBroadcast(tab.id)}
        >
          {tab.broadcast ? t('tabs.broadcastOn') : t('tabs.broadcastOff')}
        </button>
        <button
          className={`rounded border px-1.5 py-0.5 ${
            activeLogging
              ? 'border-danger bg-danger/15 text-danger'
              : 'border-edge-strong text-muted hover:bg-hover hover:text-content'
          }`}
          title={t('tabs.logTip')}
          onClick={() => void toggleLog()}
        >
          {activeLogging ? t('tabs.logging') : t('tabs.log')}
        </button>
        <button
          className={`rounded border px-1.5 py-0.5 ${
            activeRecording
              ? 'border-danger bg-danger/15 text-danger'
              : 'border-edge-strong text-muted hover:bg-hover hover:text-content'
          }`}
          title={t('tabs.recordTip')}
          onClick={() => void toggleRecord()}
        >
          {activeRecording ? t('tabs.recording') : t('tabs.record')}
        </button>
        {multi && <span className="text-subtle">{t('tabs.panes', { n: count })}</span>}
        {tab.broadcast && multi && (
          <span className="text-warning">{t('tabs.broadcastHint', { n: count })}</span>
        )}
      </div>

      <div
        ref={gridRef}
        className={`relative grid min-h-0 flex-1 gap-px ${hasBackground ? '' : 'bg-edge'}`}
        style={{
          gridTemplateColumns: frTemplate(colFr),
          gridTemplateRows: frTemplate(rowFr)
        }}
      >
        {tab.panes.map((pane) => {
          const isActive = pane.id === tab.activePaneId
          return (
            <div
              key={pane.id}
              className={`relative flex min-h-0 min-w-0 flex-col ${hasBackground ? '' : 'bg-app'} ${
                multi && isActive ? 'ring-accent/70 ring-1 ring-inset' : ''
              }`}
              onMouseDownCapture={() => setActivePane(tab.id, pane.id)}
            >
              {multi && (
                <div
                  className={`flex h-6 shrink-0 items-center gap-1.5 px-2 text-[10px] ${
                    isActive ? 'bg-hover text-content' : 'bg-panel text-subtle'
                  }`}
                >
                  <span className={`size-1.5 shrink-0 rounded-full ${statusDot(pane.status)}`} />
                  <span className="min-w-0 flex-1 truncate" title={pane.subtitle ?? pane.title}>
                    {pane.title}
                  </span>
                  <button
                    className="text-subtle hover:bg-edge-strong hover:text-content rounded px-1"
                    title={t('tabs.closePane')}
                    onClick={(e) => {
                      e.stopPropagation()
                      closePane(tab.id, pane.id)
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <TerminalPane tabId={tab.id} pane={pane} paneActive={isActive} tabVisible={active} />
              </div>
            </div>
          )
        })}

        {/* Gutter kéo chỉnh kích thước — con absolute của grid nên KHÔNG chiếm ô grid */}
        {colFr.slice(1).map((_, idx) => (
          <div
            key={`gutter-col-${idx + 1}`}
            className="hover:bg-accent/50 absolute top-0 bottom-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize"
            style={{ left: `${cutPct(colFr, idx + 1)}%` }}
            title={t('tabs.dragResize')}
            onMouseDown={(e) => startDrag(e, idx + 1, 'col')}
            onDoubleClick={() => setColFr(Array(cols).fill(1))}
          />
        ))}
        {rowFr.slice(1).map((_, idx) => (
          <div
            key={`gutter-row-${idx + 1}`}
            className="hover:bg-accent/50 absolute right-0 left-0 z-10 h-1.5 -translate-y-1/2 cursor-row-resize"
            style={{ top: `${cutPct(rowFr, idx + 1)}%` }}
            title={t('tabs.dragResize')}
            onMouseDown={(e) => startDrag(e, idx + 1, 'row')}
            onDoubleClick={() => setRowFr(Array(rows).fill(1))}
          />
        ))}
        {/* Đang kéo: phủ toàn grid để xterm không nuốt mousemove/không bôi đen text */}
        {dragAxis && (
          <div
            className={`absolute inset-0 z-20 ${dragAxis === 'col' ? 'cursor-col-resize' : 'cursor-row-resize'}`}
          />
        )}
      </div>
    </div>
  )
}
