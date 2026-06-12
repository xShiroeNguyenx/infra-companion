import { useState } from 'react'
import { useTabsStore, type AppTab } from '../../stores/tabs'
import { useToastsStore } from '../../stores/toasts'
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
      <div className="border-edge bg-panel flex h-7 shrink-0 items-center gap-2 border-b px-2 text-[11px]">
        <button
          className="border-edge-strong text-muted hover:bg-hover hover:text-content rounded border px-1.5 py-0.5"
          title={t('tabs.splitTip')}
          onClick={() => void splitLocal()}
        >
          {t('tabs.split')}
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
        className="bg-edge grid min-h-0 flex-1 gap-px"
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
              className={`bg-app relative flex min-h-0 min-w-0 flex-col ${
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
      </div>
    </div>
  )
}
