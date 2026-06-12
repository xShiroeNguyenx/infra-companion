import { useEffect, useState } from 'react'
import type { MetricSampleDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, Modal } from './ui'
import { useT } from '../i18n'

const HISTORY = 30

interface HostMonitor {
  hostId: string
  label: string
  sample: MetricSampleDto | null
  loadHistory: number[]
}

/** Monitoring dashboard (F04): theo dõi load/mem/disk/uptime realtime nhiều host qua SSH. */
export function MonitorModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const [monitoring, setMonitoring] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [data, setData] = useState<Record<string, HostMonitor>>({})

  useEffect(() => {
    const off = window.infra.monitor.onSample((s) => {
      setData((prev) => {
        const cur = prev[s.hostId]
        if (!cur) return prev
        const loadHistory = s.load1 !== null ? [...cur.loadHistory, s.load1].slice(-HISTORY) : cur.loadHistory
        return { ...prev, [s.hostId]: { ...cur, sample: s, loadHistory } }
      })
    })
    return off
  }, [])

  // Dừng mọi monitor khi đóng modal
  useEffect(() => {
    return () => window.infra.monitor.stopAll()
  }, [])

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const start = async (): Promise<void> => {
    if (selected.size === 0) return
    const initial: Record<string, HostMonitor> = {}
    for (const id of selected) {
      initial[id] = { hostId: id, label: hosts.find((h) => h.id === id)?.label ?? id, sample: null, loadHistory: [] }
    }
    setData(initial)
    setMonitoring(true)
    await window.infra.monitor.start([...selected])
  }

  const stop = (): void => {
    window.infra.monitor.stopAll()
    setMonitoring(false)
  }

  return (
    <Modal title={t('monitor.title')} onClose={onClose}>
      <div className="w-[700px] max-w-full">
        {!monitoring ? (
          <>
            <div className="mb-2 flex items-center justify-between text-[11px] text-subtle">
              <span>{t('monitor.choose', { n: selected.size })}</span>
              <button className="hover:text-content" onClick={() => setSelected(new Set(hosts.map((h) => h.id)))}>
                {t('bulk.selectAll')}
              </button>
            </div>
            <div className="mb-3 grid max-h-40 grid-cols-3 gap-x-3 gap-y-0.5 overflow-y-auto rounded border border-edge bg-input p-2">
              {hosts.map((host) => (
                <label key={host.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-content select-none">
                  <input type="checkbox" checked={selected.has(host.id)} onChange={() => toggle(host.id)} />
                  <span className="truncate">{host.label}</span>
                </label>
              ))}
              {hosts.length === 0 && <span className="col-span-3 py-2 text-center text-xs text-subtle">{t('bulk.noSsh')}</span>}
            </div>
            <p className="mb-3 text-[11px] text-subtle">
              {t('monitor.note')}
            </p>
            <div className="flex justify-end">
              <Button variant="primary" disabled={selected.size === 0} onClick={() => void start()}>
                {t('monitor.start', { n: selected.size })}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-subtle">{t('monitor.watching', { n: Object.keys(data).length })}</span>
              <Button onClick={stop}>{t('monitor.stop')}</Button>
            </div>
            <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto">
              {Object.values(data).map((m) => (
                <MonitorCard key={m.hostId} monitor={m} />
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
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
