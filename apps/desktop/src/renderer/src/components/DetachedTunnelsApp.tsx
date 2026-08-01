import { useEffect, type CSSProperties } from 'react'
import { useDataStore } from '../stores/data'
import { useT } from '../i18n'

// Cửa sổ không khung → header là vùng kéo cửa sổ (drag), các nút phải là no-drag để bấm được.
const DRAG = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties

/**
 * App rút gọn chạy trong CỬA SỔ TUNNEL TÁCH RỜI (main mở index.html#tunnels).
 *
 * Mục đích: theo dõi + bật/tắt tunnel khi app chính đang bị che (đúng lúc đang làm việc trong
 * Navicat/HeidiSQL thì cần nhìn tunnel còn sống không). KHÔNG có luồng dữ liệu riêng: gọi cùng
 * IPC như cửa sổ chính (vault đã mở khoá ở main) và `TUNNELS_EVENT` vốn broadcast tới mọi cửa sổ.
 *
 * Danh sách đã được store sắp theo TÊN nên thứ tự khớp với cửa sổ chính.
 */
export function DetachedTunnelsApp() {
  const t = useT()
  const tunnels = useDataStore((s) => s.tunnels)
  const tunnelStates = useDataStore((s) => s.tunnelStates)
  const hosts = useDataStore((s) => s.hosts)
  const refresh = useDataStore((s) => s.refreshAll)
  const startTunnel = useDataStore((s) => s.startTunnel)
  const stopTunnel = useDataStore((s) => s.stopTunnel)
  const applyTunnelState = useDataStore((s) => s.applyTunnelState)

  useEffect(() => {
    void refresh()
    return window.infra.tunnels.onState((e) => applyTunnelState(e.ruleId, e.status, e.detail))
  }, [refresh, applyTunnelState])

  const hostLabel = (id: string): string => hosts.find((h) => h.id === id)?.label ?? t('tunnel.hostDeleted')
  const running = tunnels.filter((r) => {
    const s = tunnelStates[r.id]?.status
    return s === 'active' || s === 'starting'
  }).length

  return (
    <div className="bg-app text-content flex h-screen w-screen flex-col overflow-hidden">
      <div className="border-edge flex shrink-0 items-center gap-2 border-b px-3 py-2 select-none" style={DRAG}>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          🔀 {t('tunnel.detachedTitle', { running: String(running), total: String(tunnels.length) })}
        </span>
        <div className="flex shrink-0 items-center gap-1" style={NO_DRAG}>
          <button
            className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-0.5 text-[11px]"
            title={t('tunnel.reattach')}
            onClick={() => window.infra.tunnels.closeDetached()}
          >
            ⧉ {t('monitor.reattachShort')}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {tunnels.length === 0 && <p className="text-subtle p-4 text-center text-xs">{t('tunnel.empty')}</p>}
        {tunnels.map((rule) => {
          const state = tunnelStates[rule.id]?.status ?? 'stopped'
          const detail = tunnelStates[rule.id]?.detail
          const on = state === 'active' || state === 'starting'
          const route = rule.type === 'D' ? `SOCKS5 :${rule.bindPort}` : `:${rule.bindPort} → ${rule.destHost}:${rule.destPort}`
          return (
            <div key={rule.id} className="border-edge bg-input flex items-center gap-2 rounded border px-2 py-1.5">
              <span
                className={`size-2 shrink-0 rounded-full ${
                  state === 'active'
                    ? 'bg-success'
                    : state === 'starting'
                      ? 'bg-warning animate-pulse'
                      : state === 'error'
                        ? 'bg-danger'
                        : 'bg-edge-strong'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-content truncate text-[11px]">{rule.label || route}</div>
                <div
                  className={`truncate text-[10px] ${detail ? 'text-danger' : 'text-subtle'}`}
                  title={detail ?? `${hostLabel(rule.hostId)} · ${route}`}
                >
                  {detail ?? `${hostLabel(rule.hostId)} · ${route}`}
                </div>
              </div>
              <button
                className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${
                  on
                    ? 'border-edge-strong text-muted hover:bg-hover'
                    : 'border-accent/50 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60'
                }`}
                onClick={() => void (on ? stopTunnel(rule.id) : startTunnel(rule.id))}
              >
                {on ? t('tunnel.stop') : t('tunnel.start')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
