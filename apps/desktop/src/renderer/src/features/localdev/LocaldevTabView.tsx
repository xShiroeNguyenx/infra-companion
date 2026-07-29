import { useEffect, useState } from 'react'
import { useLocaldevStore, stackDot, type LdStackDot } from '../../stores/localdev'
import { useUiStore } from '../../stores/ui'
import { LogsPanel } from './LogsPanel'
import { RuntimesPanel } from './RuntimesPanel'
import { ServicesPanel } from './ServicesPanel'
import { SitesPanel } from './SitesPanel'
import { useT } from '../../i18n'

type LdNav = 'services' | 'sites' | 'runtimes' | 'logs'
const NAV: LdNav[] = ['services', 'sites', 'runtimes', 'logs']
const NAV_KEY = 'infra.localdev.nav'

const DOT_CLASS: Record<LdStackDot, string> = {
  running: 'bg-success',
  partial: 'bg-warning',
  stopped: 'bg-subtle',
  error: 'bg-danger'
}

/**
 * Tab "Local dev" — stack local (PHP/MariaDB/Nginx do app tự tải & supervise) + site local.
 * Dùng 1 TabKind duy nhất với sub-nav bên trong: thanh tab là tài sản của trải nghiệm SSH,
 * thêm nhiều kind sẽ làm loãng (xem plan §kiến-trúc-tích-hợp).
 *
 * Ẩn bằng `hidden` khi không active (khuôn CompareTabView/MonitorTabView) — KHÔNG unmount,
 * để giữ vị trí cuộn/sub-nav khi chuyển qua lại.
 */
export function LocaldevTabView({ active }: { active: boolean }) {
  const t = useT()
  const enabled = useLocaldevStore((s) => s.enabled)
  const health = useLocaldevStore((s) => s.health)
  const services = useLocaldevStore((s) => s.services)
  const sites = useLocaldevStore((s) => s.sites)
  const runtimes = useLocaldevStore((s) => s.runtimes)
  const dot = useLocaldevStore(stackDot)
  const stopAll = useLocaldevStore((s) => s.stopAll)
  const startAll = useLocaldevStore((s) => s.startAll)
  const setModal = useUiStore((s) => s.setModal)
  const [nav, setNav] = useState<LdNav>(() => {
    const saved = localStorage.getItem(NAV_KEY)
    return NAV.includes(saved as LdNav) ? (saved as LdNav) : 'services'
  })

  useEffect(() => {
    try {
      localStorage.setItem(NAV_KEY, nav)
    } catch {
      /* localStorage lỗi — chỉ mất persist */
    }
  }, [nav])

  // Chỉ nạp khi tab thực sự được xem (tránh gọi IPC cho tab đang ẩn)
  useEffect(() => {
    if (active && enabled) void useLocaldevStore.getState().refreshAll()
  }, [active, enabled])

  return (
    <div className={`bg-app absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      <div className="border-edge bg-panel flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className={`size-2 shrink-0 rounded-full ${DOT_CLASS[dot]}`} />
        <span className="text-content text-sm font-medium">🧱 {t('localdev.title')}</span>
        {enabled && (
          <span className="text-subtle ml-1 truncate text-[11px]">
            {t('localdev.health.runtimes', { n: runtimes.filter((r) => r.installed).length })} ·{' '}
            {t('localdev.health.services', { n: services.filter((s) => s.state === 'running').length })} ·{' '}
            {t('localdev.health.sites', { n: sites.length })}
          </span>
        )}
        <div className="flex-1" />
        {enabled && services.length > 0 && (
          <>
            {/* Chạy cả stack 1 nút: php pool trước rồi nginx (ngược lại thì request đầu 502) */}
            {services.some((s) => s.state !== 'running') && (
              <button
                className="border-accent/50 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60 rounded border px-2 py-1 text-xs"
                onClick={() => void startAll()}
              >
                {t('localdev.startAll')}
              </button>
            )}
            <button
              className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-1 text-xs"
              onClick={() => void stopAll()}
            >
              {t('localdev.stopAll')}
            </button>
          </>
        )}
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-1 text-xs"
          onClick={() => setModal('localdev-settings')}
        >
          ⚙
        </button>
      </div>

      {!enabled ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-content text-sm font-medium">{t('localdev.off')}</p>
          <p className="text-subtle max-w-lg text-xs leading-relaxed">{t('localdev.offHint')}</p>
          <button
            className="border-accent/50 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60 rounded border px-3 py-1.5 text-sm"
            onClick={() => setModal('localdev-settings')}
          >
            {t('localdev.openSettings')}
          </button>
        </div>
      ) : (
        <>
          <div className="border-edge flex shrink-0 items-center gap-1.5 border-b px-4 py-1.5">
            {NAV.map((n) => (
              <button
                key={n}
                onClick={() => setNav(n)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  nav === n
                    ? 'border-accent/50 bg-accent-soft/50 text-accent-fg'
                    : 'border-edge bg-input text-muted hover:bg-hover hover:text-content'
                }`}
              >
                {t(`localdev.nav.${n}`)}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {health && health.warnings.length > 0 && (
              <div className="border-warning/40 bg-warning/10 mb-3 rounded border p-2.5">
                {health.warnings.map((w) => (
                  <p key={w} className="text-warning text-[11px] leading-relaxed">
                    ⚠ {w}
                  </p>
                ))}
              </div>
            )}
            {health && health.reaped > 0 && (
              <p className="text-muted mb-3 text-[11px]">{t('localdev.reaped', { n: health.reaped })}</p>
            )}

            {nav === 'services' && <ServicesPanel />}
            {nav === 'sites' && <SitesPanel />}
            {nav === 'runtimes' && <RuntimesPanel />}
            {nav === 'logs' && <LogsPanel />}

            {health && (
              <div className="border-edge/60 text-subtle mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-[11px]">
                <span className="truncate font-mono">{health.root}</span>
                <button
                  className="hover:text-content underline"
                  onClick={() => window.infra.localdev.openFolder('root')}
                >
                  {t('localdev.openFolder')}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

