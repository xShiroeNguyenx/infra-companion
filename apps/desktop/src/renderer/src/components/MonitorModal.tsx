import { useEffect, useState } from 'react'
import type { MetricSampleDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, Modal } from './ui'

const HISTORY = 30

interface HostMonitor {
  hostId: string
  label: string
  sample: MetricSampleDto | null
  loadHistory: number[]
}

/** Monitoring dashboard (F04): theo dõi load/mem/disk/uptime realtime nhiều host qua SSH. */
export function MonitorModal({ onClose }: { onClose: () => void }) {
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
    <Modal title="Monitoring Dashboard" onClose={onClose}>
      <div className="w-[700px] max-w-full">
        {!monitoring ? (
          <>
            <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500">
              <span>Chọn host để theo dõi ({selected.size})</span>
              <button className="hover:text-zinc-200" onClick={() => setSelected(new Set(hosts.map((h) => h.id)))}>
                Chọn hết
              </button>
            </div>
            <div className="mb-3 grid max-h-40 grid-cols-3 gap-x-3 gap-y-0.5 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-2">
              {hosts.map((host) => (
                <label key={host.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300 select-none">
                  <input type="checkbox" checked={selected.has(host.id)} onChange={() => toggle(host.id)} />
                  <span className="truncate">{host.label}</span>
                </label>
              ))}
              {hosts.length === 0 && <span className="col-span-3 py-2 text-center text-xs text-zinc-500">Chưa có host SSH</span>}
            </div>
            <p className="mb-3 text-[11px] text-zinc-600">
              Thu thập qua SSH (đọc /proc + df) mỗi 3s — không cần cài agent trên server. Chỉ hỗ trợ Linux.
            </p>
            <div className="flex justify-end">
              <Button variant="primary" disabled={selected.size === 0} onClick={() => void start()}>
                ▶ Bắt đầu theo dõi ({selected.size})
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-zinc-500">Đang theo dõi {Object.keys(data).length} host · cập nhật mỗi 3s</span>
              <Button onClick={stop}>■ Dừng</Button>
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
  const s = monitor.sample
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`size-1.5 rounded-full ${!s ? 'bg-amber-400 animate-pulse' : s.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">{monitor.label}</span>
        {s?.uptimeSec != null && <span className="text-[10px] text-zinc-500">up {formatUptime(s.uptimeSec)}</span>}
      </div>
      {!s && <p className="text-[11px] text-zinc-500">đang kết nối…</p>}
      {s && !s.ok && <p className="text-[11px] text-red-400">{s.error}</p>}
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
  const color = value > 90 ? 'bg-red-500' : value > 70 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-24 shrink-0 truncate text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-800">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-zinc-400">{pct === null ? '—' : `${value}%`}</span>
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
