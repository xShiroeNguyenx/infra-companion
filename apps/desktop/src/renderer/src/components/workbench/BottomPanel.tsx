import { useState } from 'react'
import { useDataStore } from '../../stores/data'
import { useMonitorStore } from '../../stores/monitor'
import { useUiStore } from '../../stores/ui'
import { WORKBENCH_BOTTOM_TABS_META } from '../../features/workbench/workbench'
import { LogTailModal } from '../LogTailModal'
import { MonitorCard } from '../MonitorDock'
import { TunnelsModal } from '../TunnelsModal'
import { useT } from '../../i18n'

/**
 * Panel ĐÁY của theme **Workbench** — nằm dưới vùng tab, trên StatusBar, kiểu VS Code (`Ctrl+J`).
 *
 * Ba tab: 📊 Theo dõi (các card của MonitorDock, xếp lưới theo bề rộng) · 🪵 Xem log
 * (`LogTailModal embedded fill`) · 🔀 Tunnels (`TunnelsModal embedded` — bảng đủ nút Chạy/Sửa/Xoá).
 * Ở theme này Monitoring bật lên là vào đây thay vì dock nổi góc phải (App.tsx không vẽ MonitorDock
 * khi layout = workbench) — đúng điều docs/theme.md đề ra: "chỗ ở cố định cho những thứ đang nổi".
 *
 * Cả ba tab đều MOUNTED và ẩn bằng `hidden` (khuôn ToolTabView): phiên tail log đang chạy hay form
 * tunnel đang điền không mất khi chuyển tab. Kéo mép TRÊN để đổi chiều cao (120–600px, nhớ qua
 * localStorage); lúc kéo phủ lớp `fixed` để xterm bên trên không nuốt mousemove.
 */
export function BottomPanel() {
  const t = useT()
  const tab = useUiStore((s) => s.workbenchBottomTab)
  const height = useUiStore((s) => s.workbenchBottomHeight)
  const setHeight = useUiStore((s) => s.setWorkbenchBottomHeight)
  const open = useUiStore((s) => s.openWorkbenchBottom)
  const close = useUiStore((s) => s.closeWorkbenchBottom)
  const setModal = useUiStore((s) => s.setModal)
  const monitorActive = useMonitorStore((s) => s.active)
  const monitorData = useMonitorStore((s) => s.data)
  const stopMonitor = useMonitorStore((s) => s.stop)
  const tunnels = useDataStore((s) => s.tunnels)
  const tunnelStates = useDataStore((s) => s.tunnelStates)
  const [dragging, setDragging] = useState(false)

  const monitors = Object.values(monitorData)
  const runningTunnels = tunnels.filter((r) => tunnelStates[r.id]?.status === 'active').length
  const counts: Partial<Record<typeof tab, number>> = { monitor: monitors.length, tunnels: runningTunnels }

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    setDragging(true)
    // Kéo LÊN là cao thêm: chênh lệch âm của clientY cộng vào chiều cao. Store tự kẹp min/max.
    const onMove = (ev: MouseEvent): void => setHeight(startH - (ev.clientY - startY))
    const onUp = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="border-edge bg-panel relative flex shrink-0 flex-col border-t select-none" style={{ height }}>
      {/* Tay kéo đổi chiều cao — đè lên mép trên 6px */}
      <div
        role="separator"
        aria-orientation="horizontal"
        title={t('workbench.bottomResize')}
        onMouseDown={startDrag}
        className={`hover:bg-accent/40 absolute inset-x-0 -top-[3px] z-10 h-1.5 cursor-row-resize ${dragging ? 'bg-accent/60' : ''}`}
      />
      {dragging && <div className="fixed inset-0 z-[60] cursor-row-resize" />}

      <div className="border-edge flex shrink-0 items-center gap-0.5 border-b px-1.5">
        {WORKBENCH_BOTTOM_TABS_META.map((meta) => {
          const active = meta.id === tab
          const count = counts[meta.id]
          return (
            <button
              key={meta.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => open(meta.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] ${
                active ? 'text-content' : 'text-muted hover:text-content'
              }`}
              // Vạch accent dưới tab đang chọn — cùng ngôn ngữ với vạch trái của activity bar
              style={active ? { boxShadow: 'inset 0 -2px 0 var(--c-accent)' } : undefined}
            >
              <span className="leading-none">{meta.icon}</span>
              <span>{t(meta.titleKey)}</span>
              {count !== undefined && count > 0 && <span className="text-subtle text-[10px]">{count}</span>}
            </button>
          )
        })}
        <div className="flex-1" />
        {tab === 'monitor' && monitorActive && (
          <button
            type="button"
            className="border-edge-strong text-muted hover:bg-hover mr-1 rounded border px-2 py-0.5 text-[11px]"
            onClick={stopMonitor}
          >
            {t('monitor.stop')}
          </button>
        )}
        <button
          type="button"
          className="text-subtle hover:bg-hover hover:text-content rounded px-1.5 py-0.5 text-sm leading-none"
          title={`${t('panel.close')} (Ctrl+J)`}
          aria-label={t('panel.close')}
          onClick={close}
        >
          ✕
        </button>
      </div>

      <div className={tab === 'monitor' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        {monitors.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-subtle max-w-md text-xs leading-relaxed">{t('workbench.bottomMonitorEmpty')}</p>
            <button
              type="button"
              className="border-accent/50 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60 rounded border px-3 py-1 text-xs"
              onClick={() => setModal('monitor')}
            >
              {t('monitor.tabConfig')}
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {monitors.map((m) => (
                <MonitorCard key={m.hostId} monitor={m} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className={tab === 'log' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <LogTailModal embedded fill />
      </div>
      <div className={tab === 'tunnels' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <TunnelsModal embedded />
      </div>
    </div>
  )
}
