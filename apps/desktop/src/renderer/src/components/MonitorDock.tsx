import { useMonitorStore, type HostMonitor } from '../stores/monitor'
import { useT } from '../i18n'

/** Dashboard monitoring neo góc phải — mờ khi không rê chuột, KHÔNG backdrop nên
 *  vẫn thao tác terminal bình thường. Chỉ biến mất khi user bấm Dừng. */
export function MonitorDock() {
  const t = useT()
  const data = useMonitorStore((s) => s.data)
  const stop = useMonitorStore((s) => s.stop)
  const monitors = Object.values(data)
  return (
    <div className="bg-elevated/95 border-edge-strong absolute top-14 right-3 z-30 flex max-h-[calc(100%-6rem)] w-[320px] max-w-[85vw] flex-col overflow-hidden rounded-lg border opacity-75 shadow-2xl transition-opacity duration-150 hover:opacity-100">
      <div className="border-edge flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-subtle truncate text-[11px]">{t('monitor.watching', { n: monitors.length })}</span>
        <button
          className="border-edge-strong text-muted hover:bg-hover shrink-0 rounded border px-2 py-0.5 text-xs font-medium"
          onClick={stop}
        >
          {t('monitor.stop')}
        </button>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto p-2">
        {monitors.map((m) => (
          <MonitorCard key={m.hostId} monitor={m} />
        ))}
      </div>
    </div>
  )
}

function MonitorCard({ monitor }: { monitor: HostMonitor }) {
  const t = useT()
  const s = monitor.sample
  return (
    <div className="rounded border border-edge bg-input p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`size-1.5 rounded-full ${!s ? 'bg-warning animate-pulse' : s.ok ? 'bg-success' : 'bg-danger'}`} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-content">{monitor.label}</span>
        {s?.uptimeSec != null && <span className="text-[10px] text-subtle">up {formatUptime(s.uptimeSec)}</span>}
      </div>
      {!s && <p className="text-[11px] text-subtle">{t('monitor.connecting')}</p>}
      {s && !s.ok && <p className="text-[11px] text-danger">{s.error}</p>}
      {s?.ok && (
        <div className="space-y-1.5">
          <Sparkline values={monitor.loadHistory} cpuCount={s.cpuCount} />
          <Bar label={`Load ${s.loadText ?? ''}`} pct={loadPct(s.load1, s.cpuCount)} />
          <Bar label="RAM" pct={s.memUsedPct} />
          <Bar label="Disk /" pct={s.diskUsedPct} />
        </div>
      )}
    </div>
  )
}

function Bar({ label, pct }: { label: string; pct: number | null }) {
  const value = pct ?? 0
  const color = value > 90 ? 'bg-danger' : value > 70 ? 'bg-warning' : 'bg-success'
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-24 shrink-0 truncate text-subtle">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-hover">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-muted">{pct === null ? '—' : `${value}%`}</span>
    </div>
  )
}

function Sparkline({ values, cpuCount }: { values: number[]; cpuCount: number | null }) {
  if (values.length < 2) return <div className="h-8" />
  const max = Math.max(...values, cpuCount ?? 1)
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 28}`)
    .join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full">
      <polyline points={points} fill="none" stroke="#7aa2f7" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function loadPct(load: number | null, cpuCount: number | null): number | null {
  if (load === null) return null
  return Math.round((load / (cpuCount ?? 1)) * 100)
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}
