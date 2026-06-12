import { useState } from 'react'
import { useTabsStore, type AppTab } from '../../stores/tabs'
import { useToastsStore } from '../../stores/toasts'
import { TerminalPane } from './TerminalPane'

function statusDot(status: string): string {
  if (status === 'connected') return 'bg-emerald-500'
  if (status === 'exited') return 'bg-red-500'
  return 'bg-amber-400 animate-pulse'
}

/** Render các pane của 1 tab terminal dạng lưới + thanh công cụ pane (split, broadcast, log). */
export function TerminalTabView({ tab, active }: { tab: AppTab; active: boolean }) {
  const { setActivePane, closePane, toggleBroadcast, splitLocal } = useTabsStore()
  const [logging, setLogging] = useState<Set<string>>(new Set())
  const [recording, setRecording] = useState<Set<string>>(new Set())
  const count = tab.panes.length
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const multi = count > 1
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

  return (
    <div className={`absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      {/* Thanh công cụ chỉ hiện khi có nhiều pane hoặc để bật split/broadcast */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-zinc-800/70 bg-[#0e121b] px-2 text-[11px]">
        <button
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          title="Tách thêm 1 pane terminal local trong tab này"
          onClick={() => void splitLocal()}
        >
          ⊞ Split
        </button>
        <button
          className={`rounded border px-1.5 py-0.5 ${
            tab.broadcast
              ? 'border-amber-500 bg-amber-500/15 text-amber-300'
              : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
          }`}
          title="Broadcast: gõ ở 1 pane sẽ gửi lệnh tới TẤT CẢ pane trong tab"
          onClick={() => toggleBroadcast(tab.id)}
        >
          📡 Broadcast {tab.broadcast ? 'ON' : 'OFF'}
        </button>
        <button
          className={`rounded border px-1.5 py-0.5 ${
            activeLogging
              ? 'border-red-500 bg-red-500/15 text-red-300'
              : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
          }`}
          title="Ghi log output của pane đang chọn ra file text"
          onClick={() => void toggleLog()}
        >
          {activeLogging ? '⏺ Đang ghi log' : '⏺ Ghi log'}
        </button>
        <button
          className={`rounded border px-1.5 py-0.5 ${
            activeRecording
              ? 'border-rose-500 bg-rose-500/15 text-rose-300'
              : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
          }`}
          title="Ghi hình phiên (asciicast) — xem lại replay trong mục Recordings"
          onClick={() => void toggleRecord()}
        >
          {activeRecording ? '⏯ Đang ghi hình' : '⏯ Ghi hình'}
        </button>
        {multi && <span className="text-zinc-600">{count} panes</span>}
        {tab.broadcast && multi && (
          <span className="text-amber-400">— mọi phím gõ sẽ vào cả {count} pane</span>
        )}
      </div>

      <div
        className="grid min-h-0 flex-1 gap-px bg-zinc-800"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
        }}
      >
        {tab.panes.map((pane) => {
          const isActive = pane.id === tab.activePaneId
          return (
            <div
              key={pane.id}
              className={`relative flex min-h-0 min-w-0 flex-col bg-[#0b0e14] ${
                multi && isActive ? 'ring-1 ring-inset ring-blue-500/70' : ''
              }`}
              onMouseDownCapture={() => setActivePane(tab.id, pane.id)}
            >
              {multi && (
                <div
                  className={`flex h-6 shrink-0 items-center gap-1.5 px-2 text-[10px] ${
                    isActive ? 'bg-zinc-800 text-zinc-200' : 'bg-[#11151f] text-zinc-500'
                  }`}
                >
                  <span className={`size-1.5 shrink-0 rounded-full ${statusDot(pane.status)}`} />
                  <span className="min-w-0 flex-1 truncate" title={pane.subtitle ?? pane.title}>
                    {pane.title}
                  </span>
                  <button
                    className="rounded px-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
                    title="Đóng pane"
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
      </div>
    </div>
  )
}
