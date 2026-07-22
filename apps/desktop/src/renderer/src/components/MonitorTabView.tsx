import { useMonitorStore } from '../stores/monitor'
import { useTabsStore, type AppTab } from '../stores/tabs'
import { useUiStore } from '../stores/ui'
import { MonitorCard } from './MonitorDock'
import { useT } from '../i18n'

/**
 * Monitoring hiển thị TRONG 1 TAB (như tab server). Đọc chung dữ liệu real-time từ useMonitorStore.
 * Card/chart/chữ dùng biến thể `large` (to hơn) + lưới nhiều cột cho dễ đọc.
 * Nút – (thu nhỏ) = ĐÓNG tab → dock góc phải hiện lại (App.tsx ẩn dock khi có tab monitor) →
 * kiểu "chuyển qua chuyển lại" giữa tab và dock. Layout ẩn bằng `hidden` khi không active.
 */
export function MonitorTabView({ tab, active }: { tab: AppTab; active: boolean }) {
  const t = useT()
  const data = useMonitorStore((s) => s.data)
  const stop = useMonitorStore((s) => s.stop)
  const closeTab = useTabsStore((s) => s.closeTab)
  const setModal = useUiStore((s) => s.setModal)
  const monitors = Object.values(data)

  // Thu về dock: đóng tab monitor (KHÔNG dừng theo dõi) → App.tsx cho dock góc phải hiện lại.
  const collapseToDock = (): void => closeTab(tab.id)

  return (
    <div className={`bg-app absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      <div className="border-edge bg-panel flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className="text-content min-w-0 flex-1 truncate text-sm font-medium">
          📊 {t('monitor.watching', { n: monitors.length })}
        </span>
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-1 text-xs"
          title={t('monitor.toDock')}
          onClick={collapseToDock}
        >
          – {t('monitor.toDockShort')}
        </button>
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-1 text-xs"
          onClick={() => setModal('monitor')}
        >
          {t('monitor.tabConfig')}
        </button>
        {monitors.length > 0 && (
          <button
            className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-1 text-xs font-medium"
            onClick={stop}
          >
            {t('monitor.stop')}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {monitors.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-subtle max-w-md text-sm leading-relaxed">{t('monitor.tabEmpty')}</p>
            <button
              className="border-accent/50 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60 rounded border px-3 py-1.5 text-sm"
              onClick={() => setModal('monitor')}
            >
              {t('monitor.tabConfig')}
            </button>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}
          >
            {monitors.map((m) => (
              <MonitorCard key={m.hostId} monitor={m} large />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
