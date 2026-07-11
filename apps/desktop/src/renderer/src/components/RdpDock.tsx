import { useEffect } from 'react'
import { useT } from '../i18n'
import { useRdpStore } from '../stores/rdp'

/** F13 — Dock nhỏ liệt kê các tunnel RDP đang mở (client chạy ngoài app) + nút Dừng.
 *  Neo góc DƯỚI-TRÁI để không đè MonitorDock (phải) / panel AI (trên phải). */
export function RdpDock() {
  const t = useT()
  const sessions = useRdpStore((s) => s.sessions)
  const close = useRdpStore((s) => s.close)

  useEffect(() => useRdpStore.getState().subscribe(), [])

  if (sessions.length === 0) return null
  return (
    <div className="bg-elevated/95 border-edge-strong absolute bottom-8 left-3 z-30 flex max-w-[280px] flex-col gap-1 rounded-lg border p-2 opacity-80 shadow-2xl transition-opacity duration-150 hover:opacity-100">
      <span className="text-subtle px-1 text-[10px] tracking-wide uppercase">🖥 {t('rdp.dockTitle')}</span>
      {sessions.map((s) => (
        <div key={s.sessionId} className="flex items-center gap-2 text-xs">
          <span className="text-content min-w-0 flex-1 truncate" title={`127.0.0.1:${s.localPort}`}>
            {s.label}
          </span>
          <button
            className="border-edge-strong text-muted hover:bg-hover rounded border px-1.5 py-0.5 text-[11px]"
            onClick={() => close(s.sessionId)}
          >
            {t('rdp.stop')}
          </button>
        </div>
      ))}
    </div>
  )
}
