import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTabsStore, type AppTab } from '../../stores/tabs'
import { useToastsStore } from '../../stores/toasts'
import { useUiStore } from '../../stores/ui'
import { useSettingsStore, PANE_LAYOUTS, type PaneLayout } from '../../stores/settings'
import { useT } from '../../i18n'
import { LayoutGlyph } from '../../components/LayoutGlyph'
import { TerminalPane } from './TerminalPane'

function statusDot(status: string): string {
  if (status === 'connected') return 'bg-success'
  if (status === 'exited') return 'bg-danger'
  return 'bg-warning animate-pulse'
}

/** Vị trí (grid-column/grid-row) của 1 pane, undefined = để grid tự xếp. */
type PanePlace = { gridColumn?: string; gridRow?: string } | undefined

interface GridSpec {
  cols: number
  rows: number
  /** Đặt pane thứ i vào ô cụ thể (dùng cho layout main-*); undefined = auto-flow. */
  place: (i: number) => PanePlace
  /** Có kéo chỉnh được theo trục ngang/dọc không (main-* chỉ cho chỉnh tỷ lệ chính/phụ). */
  resizeCols: boolean
  resizeRows: boolean
  /** Tỷ lệ fr mặc định cho mỗi cột/hàng (reset khi đổi layout/số pane, double-click). */
  defCol: number[]
  defRow: number[]
}

/** Ô chính (main-*) rộng gấp ~1.8 lần phần phụ. */
const MAIN_FR = 1.8

/**
 * Tính bố cục lưới cho `count` pane theo `layout`.
 * `auto` giữ nguyên hành vi cũ (lưới vuông); các layout khác đặt ô tường minh.
 */
function gridSpec(layout: PaneLayout, count: number): GridSpec {
  const single: GridSpec = {
    cols: 1,
    rows: 1,
    place: () => undefined,
    resizeCols: false,
    resizeRows: false,
    defCol: [1],
    defRow: [1]
  }
  if (count <= 1) return single

  if (layout === 'columns') {
    return {
      cols: count,
      rows: 1,
      place: () => undefined,
      resizeCols: true,
      resizeRows: false,
      defCol: Array(count).fill(1),
      defRow: [1]
    }
  }
  if (layout === 'rows') {
    return {
      cols: 1,
      rows: count,
      place: () => undefined,
      resizeCols: false,
      resizeRows: true,
      defCol: [1],
      defRow: Array(count).fill(1)
    }
  }
  if (layout === 'main-left') {
    const side = count - 1
    return {
      cols: 2,
      rows: side,
      place: (i) =>
        i === 0 ? { gridColumn: '1', gridRow: '1 / -1' } : { gridColumn: '2', gridRow: String(i) },
      resizeCols: true, // kéo ranh giới chính/phụ
      resizeRows: false, // các pane phụ chia đều
      defCol: [MAIN_FR, 1],
      defRow: Array(side).fill(1)
    }
  }
  if (layout === 'main-top') {
    const side = count - 1
    return {
      cols: side,
      rows: 2,
      place: (i) =>
        i === 0 ? { gridColumn: '1 / -1', gridRow: '1' } : { gridColumn: String(i), gridRow: '2' },
      resizeCols: false,
      resizeRows: true,
      defCol: Array(side).fill(1),
      defRow: [MAIN_FR, 1]
    }
  }
  // 'auto' — lưới vuông tự động như cũ
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  return {
    cols,
    rows,
    place: () => undefined,
    resizeCols: true,
    resizeRows: true,
    defCol: Array(cols).fill(1),
    defRow: Array(rows).fill(1)
  }
}

/** Render các pane của 1 tab terminal dạng lưới + thanh công cụ pane (split, broadcast, log). */
export function TerminalTabView({ tab, active }: { tab: AppTab; active: boolean }) {
  const t = useT()
  const { tabs, setActivePane, closePane, toggleBroadcast, mergeTabs, unmergeTab } = useTabsStore()
  // Có ảnh nền: nền pane/grid trong suốt để lộ ảnh phía sau terminal
  const hasBackground = useSettingsStore((s) => s.backgroundImage !== null)
  const paneLayout = useSettingsStore((s) => s.paneLayout)
  const setPaneLayout = useSettingsStore((s) => s.setPaneLayout)
  const paneFrame = useSettingsStore((s) => s.paneFrame)
  const togglePalette = useUiStore((s) => s.togglePalette)
  const [logging, setLogging] = useState<Set<string>>(new Set())
  const [recording, setRecording] = useState<Set<string>>(new Set())
  // Dropdown chọn bố cục (chỉ mở được khi Split ON) — gắn cạnh nút Split, không chiếm chỗ toolbar
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)
  const count = tab.panes.length
  const spec = gridSpec(paneLayout, count)
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
  const [colFr, setColFr] = useState<number[]>(spec.defCol)
  const [rowFr, setRowFr] = useState<number[]>(spec.defRow)
  const [dragAxis, setDragAxis] = useState<'col' | 'row' | null>(null)
  // Reset tỷ lệ khi đổi layout hoặc số pane (thêm/đóng pane) — về mặc định của layout đó
  useEffect(() => {
    const s = gridSpec(paneLayout, count)
    setColFr(s.defCol)
    setRowFr(s.defRow)
  }, [paneLayout, count])

  // Đóng dropdown layout khi bấm ra ngoài hoặc nhấn Esc
  useEffect(() => {
    if (!layoutMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (splitRef.current && !splitRef.current.contains(e.target as Node)) setLayoutMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLayoutMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [layoutMenuOpen])

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
        {multi ? (
          // Split ON: nút gộp/tách + phần ▼ chọn bố cục, gộp thành 1 segmented control liền mạch
          <div ref={splitRef} className="relative flex items-center">
            <div className="border-accent bg-accent/15 text-accent flex items-stretch overflow-hidden rounded border">
              <button
                className="hover:bg-accent/25 px-1.5 py-0.5"
                title={t('tabs.splitTip')}
                onClick={() => unmergeTab(tab.id)}
              >
                {t('tabs.splitOn')}
              </button>
              <span className="bg-accent/40 w-px self-stretch" aria-hidden="true" />
              <button
                className="hover:bg-accent/25 flex items-center gap-0.5 px-1.5"
                title={t('settings.termLayout')}
                aria-expanded={layoutMenuOpen}
                onClick={() => setLayoutMenuOpen((v) => !v)}
              >
                <LayoutGlyph kind={paneLayout} className="size-3" />
                <span className="text-[7px] leading-none">▼</span>
              </button>
            </div>
            {layoutMenuOpen && (
              <div className="border-edge-strong bg-elevated absolute top-full left-0 z-30 mt-1 w-44 rounded border py-1 shadow-lg">
                {PANE_LAYOUTS.map((l) => (
                  <button
                    key={l}
                    onClick={() => {
                      setPaneLayout(l)
                      setLayoutMenuOpen(false)
                    }}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-left ${
                      paneLayout === l ? 'text-accent bg-accent/10' : 'text-content hover:bg-hover'
                    }`}
                  >
                    <LayoutGlyph kind={l} className="size-4 shrink-0" />
                    <span className="flex-1">{t(`tabs.layout.${l}`)}</span>
                    {paneLayout === l && <span className="text-accent">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            className="border-edge-strong text-muted hover:bg-hover hover:text-content rounded border px-1.5 py-0.5 disabled:opacity-40"
            title={t('tabs.splitTip')}
            disabled={!canMerge}
            onClick={() => mergeTabs(tab.id)}
          >
            {t('tabs.split')}
          </button>
        )}
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
        {/* Nút mở Command Palette — nhiều người không biết tổ hợp Ctrl+Shift+P */}
        <button
          className="border-edge-strong text-muted hover:bg-hover hover:text-content ml-auto flex items-center gap-1 rounded border px-1.5 py-0.5"
          title={t('tabs.commandPalette')}
          onClick={() => togglePalette()}
        >
          <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
            <path
              d="M2.5 4l3 3-3 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line x1="8" y1="10.5" x2="13" y2="10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {t('tabs.commandPaletteLabel')}
        </button>
      </div>

      <div
        ref={gridRef}
        className={`relative grid min-h-0 flex-1 ${paneFrame === 'mac' ? 'gap-1' : 'gap-px'} ${hasBackground ? '' : 'bg-edge'}`}
        style={{
          gridTemplateColumns: frTemplate(colFr),
          gridTemplateRows: frTemplate(rowFr)
        }}
      >
        {tab.panes.map((pane, i) => {
          const isActive = pane.id === tab.activePaneId
          return (
            <div
              key={pane.id}
              style={spec.place(i)}
              className={`relative flex min-h-0 min-w-0 flex-col ${hasBackground ? '' : 'bg-app'} ${
                multi && paneFrame === 'mac' ? 'overflow-hidden rounded-lg' : ''
              } ${multi && isActive ? 'ring-accent/70 ring-1 ring-inset' : ''}`}
              onMouseDownCapture={() => setActivePane(tab.id, pane.id)}
            >
              {multi && paneFrame === 'bar' && (
                <div
                  className={`flex h-5 shrink-0 items-center gap-1.5 px-2 text-[10px] ${
                    isActive ? 'bg-hover text-content' : 'bg-panel text-subtle'
                  }`}
                >
                  <span className={`size-1.5 shrink-0 rounded-full ${statusDot(pane.status)}`} />
                  <span className="min-w-0 flex-1 truncate" title={pane.subtitle ?? pane.title}>
                    {pane.title}
                  </span>
                  <button
                    className="text-subtle hover:bg-edge-strong hover:text-content rounded px-1 leading-none"
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
              {multi && paneFrame === 'mac' && (
                <div
                  className={`flex h-5 shrink-0 items-center gap-2 px-2 text-[10px] ${
                    isActive ? 'bg-hover text-content' : 'bg-panel text-subtle'
                  }`}
                >
                  {/* Nút đóng kiểu macOS: chấm tròn đỏ, hover hiện ✕ */}
                  <button
                    className="group/close bg-danger grid size-3 shrink-0 place-items-center rounded-full text-[7px] leading-none text-white/85"
                    title={t('tabs.closePane')}
                    onClick={(e) => {
                      e.stopPropagation()
                      closePane(tab.id, pane.id)
                    }}
                  >
                    <span className="opacity-0 group-hover/close:opacity-100">✕</span>
                  </button>
                  <span className="min-w-0 flex-1 truncate text-center" title={pane.subtitle ?? pane.title}>
                    {pane.title}
                  </span>
                  {/* Chấm trạng thái nhỏ bên phải để vẫn biết đang kết nối/rớt */}
                  <span className={`size-1.5 shrink-0 rounded-full ${statusDot(pane.status)}`} />
                </div>
              )}
              <div className="min-h-0 flex-1">
                <TerminalPane tabId={tab.id} pane={pane} paneActive={isActive} tabVisible={active} />
              </div>
            </div>
          )
        })}

        {/* Gutter kéo chỉnh kích thước — con absolute của grid nên KHÔNG chiếm ô grid.
            Layout main-* chỉ cho kéo tỷ lệ chính/phụ nên gate theo resizeCols/resizeRows. */}
        {spec.resizeCols &&
          colFr.slice(1).map((_, idx) => (
            <div
              key={`gutter-col-${idx + 1}`}
              className="hover:bg-accent/50 absolute top-0 bottom-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize"
              style={{ left: `${cutPct(colFr, idx + 1)}%` }}
              title={t('tabs.dragResize')}
              onMouseDown={(e) => startDrag(e, idx + 1, 'col')}
              onDoubleClick={() => setColFr(spec.defCol)}
            />
          ))}
        {spec.resizeRows &&
          rowFr.slice(1).map((_, idx) => (
            <div
              key={`gutter-row-${idx + 1}`}
              className="hover:bg-accent/50 absolute right-0 left-0 z-10 h-1.5 -translate-y-1/2 cursor-row-resize"
              style={{ top: `${cutPct(rowFr, idx + 1)}%` }}
              title={t('tabs.dragResize')}
              onMouseDown={(e) => startDrag(e, idx + 1, 'row')}
              onDoubleClick={() => setRowFr(spec.defRow)}
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
