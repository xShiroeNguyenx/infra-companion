import { useEffect, type CSSProperties } from 'react'
import { useMonitorStore, type HostMonitor } from '../stores/monitor'
import { MonitorCard } from './MonitorDock'
import { useT } from '../i18n'

// Cửa sổ không khung → header là vùng kéo cửa sổ (drag), các nút phải là no-drag để bấm được.
const DRAG = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties

/**
 * App rút gọn chạy trong CỬA SỔ MONITOR TÁCH RỜI (main mở index.html#monitor).
 * KHÔNG mở SSH riêng: lấy danh sách host từ main (detachedInit) rồi subscribe vào cùng luồng
 * broadcast sample của MonitorService — nên vẫn cập nhật real-time cả khi app chính đã thu nhỏ.
 * Cửa sổ này always-on-top (đặt ở main). Dừng/gộp lại → main đóng cửa sổ.
 */
export function DetachedMonitorApp() {
  const t = useT()
  const data = useMonitorStore((s) => s.data)
  const monitors = Object.values(data)

  useEffect(() => {
    // onSample phải gắn TRƯỚC khi subscribe() để bắt được các sample replay từ main
    const off = window.infra.monitor.onSample((s) => useMonitorStore.getState().applySample(s))
    void window.infra.monitor.detachedInit().then(({ hosts }) => {
      const seeded: Record<string, HostMonitor> = {}
      for (const h of hosts) seeded[h.id] = { hostId: h.id, label: h.label, sample: null, loadHistory: [] }
      useMonitorStore.setState({ data: seeded, active: true })
      window.infra.monitor.subscribe() // join broadcast + nhận replay sample gần nhất
    })
    return off
  }, [])

  return (
    <div className="bg-app text-content flex h-screen w-screen flex-col overflow-hidden">
      <div
        className="border-edge flex shrink-0 items-center gap-2 border-b px-3 py-2 select-none"
        style={DRAG}
      >
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          📊 {t('monitor.watching', { n: monitors.length })}
        </span>
        <div className="flex shrink-0 items-center gap-1" style={NO_DRAG}>
          <button
            className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-0.5 text-[11px]"
            title={t('monitor.reattach')}
            onClick={() => window.infra.monitor.closeDetached()}
          >
            ⧉ {t('monitor.reattachShort')}
          </button>
          <button
            className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-0.5 text-[11px] font-medium"
            title={t('monitor.stop')}
            onClick={() => window.infra.monitor.stopAll()}
          >
            {t('monitor.stop')}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {monitors.length === 0 ? (
          <p className="text-subtle p-4 text-center text-xs">{t('monitor.connecting')}</p>
        ) : (
          monitors.map((m) => <MonitorCard key={m.hostId} monitor={m} />)
        )}
      </div>
    </div>
  )
}
