import { useEffect, useState } from 'react'
import type { MetricHistoryPointDto } from '@infra/shared'
import { Modal } from './ui'
import { useT } from '../i18n'

type Range = '1h' | '24h'

/** 1h → bucket phút (res 1), 24h → bucket 10 phút (res 10). */
const RANGE_CFG: Record<Range, { ms: number; res: 1 | 10 }> = {
  '1h': { ms: 3_600_000, res: 1 },
  '24h': { ms: 24 * 3_600_000, res: 10 }
}

const REFRESH_MS = 60_000

/** F32 — Lịch sử metrics 1 host: 3 chart Load/RAM/Disk (SVG tự vẽ, thang 0-100%). */
export function MetricsHistoryModal({ hostId, label, onClose }: { hostId: string; label: string; onClose: () => void }) {
  const t = useT()
  const [range, setRange] = useState<Range>('1h')
  const [points, setPoints] = useState<MetricHistoryPointDto[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      const now = Date.now()
      const cfg = RANGE_CFG[range]
      void window.infra.monitor.queryHistory(hostId, now - cfg.ms, now, cfg.res).then((rows) => {
        if (alive) setPoints(rows)
      })
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [hostId, range])

  const cfg = RANGE_CFG[range]
  const hasData = points !== null && points.length > 0

  return (
    <Modal title={`📈 ${t('monitor.historyTitle', { host: label })}`} onClose={onClose}>
      <div className="w-[640px] max-w-full">
        <div className="mb-3 flex gap-2">
          {(['1h', '24h'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded border px-3 py-1 text-xs ${
                range === r ? 'border-accent text-content bg-accent-soft/40' : 'border-edge text-muted hover:bg-hover'
              }`}
            >
              {r === '1h' ? t('monitor.range1h') : t('monitor.range24h')}
            </button>
          ))}
        </div>

        {points === null && <p className="text-subtle py-6 text-center text-xs">…</p>}
        {points !== null && !hasData && (
          <p className="text-subtle py-6 text-center text-xs leading-relaxed">{t('monitor.historyEmpty')}</p>
        )}
        {hasData && (
          <div className="space-y-3">
            {/* Load %/CPU vượt được 100% (server bận 300-400%+) → thang tự giãn theo dữ liệu */}
            <MetricChart label={`Load (${t('monitor.loadNorm')})`} points={points} field="loadPct" resMs={cfg.res * 60_000} autoScale />
            <MetricChart label="CPU" points={points} field="cpuPct" resMs={cfg.res * 60_000} />
            <MetricChart label="CPU steal" points={points} field="stealPct" resMs={cfg.res * 60_000} />
            <MetricChart label="RAM" points={points} field="memPct" resMs={cfg.res * 60_000} />
            <MetricChart label="Disk" points={points} field="diskPct" resMs={cfg.res * 60_000} />
            <MetricChart label={t('monitor.metricConn')} points={points} field="conns" resMs={cfg.res * 60_000} autoScale unit="" />
          </div>
        )}
      </div>
    </Modal>
  )
}

type ChartField = 'loadPct' | 'cpuPct' | 'stealPct' | 'memPct' | 'diskPct' | 'conns'

/** 1 chart đường: thang Y 0-100% (autoScale: giãn theo max dữ liệu — cho Load/Kết nối),
 *  tách đoạn tại khoảng trống dữ liệu (offline/app tắt). Metric không có dữ liệu
 *  (bản ghi cũ trước v2, server thiếu lệnh) → ẩn chart.
 *  compact: bản thu gọn nhúng trong card MonitorDock (padding/chiều cao nhỏ). */
export function MetricChart({
  label,
  points,
  field,
  resMs,
  autoScale = false,
  unit = '%',
  compact = false
}: {
  label: string
  points: MetricHistoryPointDto[]
  field: ChartField
  resMs: number
  autoScale?: boolean
  unit?: string
  compact?: boolean
}) {
  if (!points.some((p) => p[field] !== null)) return null
  const from = points[0]!.ts
  const to = points[points.length - 1]!.ts
  const span = Math.max(to - from, 1)
  // Trần thang Y: 100 hoặc max dữ liệu làm tròn lên bậc 50 (vd 368% → 400)
  const dataMax = autoScale ? points.reduce((m, p) => Math.max(m, p[field] ?? 0), 0) : 0
  const yMax = autoScale ? Math.max(100, Math.ceil(dataMax / 50) * 50) : 100

  // Tách polyline thành các đoạn liên tục: gap > 2 bucket hoặc giá trị null = ngắt đoạn
  const segments: string[] = []
  let current: string[] = []
  let prevTs: number | null = null
  for (const p of points) {
    const v = p[field]
    const gap = prevTs !== null && p.ts - prevTs > 2 * resMs
    if (v === null || gap) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      if (v === null) {
        prevTs = p.ts
        continue
      }
    }
    const x = ((p.ts - from) / span) * 100
    const y = 30 - (Math.min(yMax, Math.max(0, v!)) / yMax) * 28 - 1
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`)
    prevTs = p.ts
  }
  if (current.length > 1) segments.push(current.join(' '))

  const last = [...points].reverse().find((p) => p[field] !== null)?.[field]
  const fmt = (ts: number): string => {
    const d = new Date(ts)
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return span > 3_700_000 ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hm}` : hm
  }

  return (
    <div className={compact ? '' : 'border-edge bg-input rounded border p-3'}>
      <div className={`flex items-center justify-between ${compact ? 'mb-0.5 text-[10px]' : 'mb-1.5 text-[11px]'}`}>
        <span className="text-subtle">
          {label}
          {yMax !== 100 && (
            <span className="text-subtle/70">
              {' '}
              · 0–{yMax}
              {unit}
            </span>
          )}
        </span>
        <span className="text-muted">{last === null || last === undefined ? '—' : `${last}${unit}`}</span>
      </div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`w-full ${compact ? 'h-10' : 'h-20'}`}>
        {/* gridline 0/50/100% */}
        {[1, 15, 29].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="currentColor" strokeOpacity="0.12" strokeWidth="0.3" />
        ))}
        {segments.map((pts, i) => (
          <polyline key={i} points={pts} fill="none" stroke="#7aa2f7" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        ))}
        {segments.length === 0 && points.length === 1 && (
          // 1 điểm duy nhất → chấm thay vì đường
          <circle cx="50" cy="15" r="1" fill="#7aa2f7" />
        )}
      </svg>
      {!compact && (
        <div className="text-subtle mt-1 flex justify-between text-[10px]">
          <span>{fmt(from)}</span>
          <span>{fmt(to)}</span>
        </div>
      )}
    </div>
  )
}
