import { useMemo, useRef, useState } from 'react'
import { useDataStore } from '../stores/data'
import { diffLines, type DiffResult, type DiffRow } from '../lib/lineDiff'
import { clearCompareHistory, pushCompareHistory, readCompareHistory } from '../lib/compareHistory'
import { QuickChip, useQuickPickChips } from './quickPick'
import { Button, Select } from './ui'
import { useT } from '../i18n'

/** Kiểu hiển thị khi so nhiều server. */
type CompareMode = 'baseline' | 'group' | 'columns'
const MODES: CompareMode[] = ['baseline', 'group', 'columns']

interface FileResult {
  hostId: string
  label: string
  ok: boolean
  content: string
  error?: string
}

const COLUMNS_MAX_ROWS = 4000

/**
 * So sánh 1 file config trên NHIỀU host SSH (nâng cấp F49 từ 2 host). Đọc nội dung qua kênh exec
 * riêng (hostTools.readFile), người dùng chọn KIỂU hiển thị trước khi diff:
 * - baseline: 1 server làm chuẩn, mỗi server còn lại hiện số dòng khác + diff side-by-side.
 * - group:    gom server có nội dung GIỐNG nhau, diff nhóm khác vs nhóm lớn nhất.
 * - columns:  N cột cạnh nhau, tô dòng khác biệt (căn theo số dòng).
 * Component layout-neutral: fill chiều cao cha (Modal hoặc Tab đều dùng được).
 */
export function CompareView() {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [path, setPath] = useState('')
  const [mode, setMode] = useState<CompareMode>('baseline')
  const [baselineId, setBaselineId] = useState('')
  const [diffOnly, setDiffOnly] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<FileResult[] | null>(null)
  const [history, setHistory] = useState<string[]>(readCompareHistory())
  const gen = useRef(0)
  const { groupChips, wsChips } = useQuickPickChips(hosts)

  const labelOf = (id: string): string => hosts.find((h) => h.id === id)?.label ?? id

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Chọn/bỏ nhanh cả 1 cụm host (group/workspace): đã chọn hết → bỏ cả cụm; chưa → thêm cả cụm. */
  const toggleMany = (ids: string[]): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      const allOn = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allOn) next.delete(id)
        else next.add(id)
      }
      return next
    })

  const run = async (): Promise<void> => {
    const ids = [...selected]
    if (ids.length < 2) {
      setError(t('compare.needHostsN'))
      return
    }
    const p = path.trim()
    if (!p) {
      setError(t('compare.needPath'))
      return
    }
    const my = ++gen.current
    setBusy(true)
    setError(null)
    setResults(null)
    setHistory(pushCompareHistory(p))
    const reads = await Promise.all(
      ids.map(async (id): Promise<FileResult> => {
        const r = await window.infra.hostTools.readFile(id, p)
        return { hostId: id, label: labelOf(id), ok: r.ok, content: r.ok ? r.stdout : '', error: r.error }
      })
    )
    if (my !== gen.current) return
    setBusy(false)
    setResults(reads)
    // baseline mặc định = host đầu tiên đọc thành công
    const firstOk = reads.find((r) => r.ok)
    if (firstOk) setBaselineId((cur) => (reads.some((r) => r.hostId === cur && r.ok) ? cur : firstOk.hostId))
  }

  const canRun = selected.size >= 2 && !!path.trim() && !busy

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Chọn host (nhiều) */}
      <div className="text-subtle mb-1 flex items-center justify-between text-[11px]">
        <span>{t('compare.chooseHostsN', { n: selected.size })}</span>
        <button className="hover:text-content" onClick={() => setSelected(new Set(hosts.map((h) => h.id)))}>
          {t('bulk.selectAll')}
        </button>
      </div>

      {/* Chọn nhanh theo nhóm / workspace */}
      {(groupChips.length > 0 || wsChips.length > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-subtle mr-0.5 text-[10px] tracking-wider uppercase">{t('compare.quickPick')}</span>
          {groupChips.map((g) => (
            <QuickChip
              key={`g-${g.id}`}
              label={g.name}
              count={g.hostIds.length}
              active={g.hostIds.every((id) => selected.has(id))}
              onClick={() => toggleMany(g.hostIds)}
            />
          ))}
          {wsChips.map((w) => (
            <QuickChip
              key={`w-${w.id}`}
              label={`🗂 ${w.name}`}
              count={w.hostIds.length}
              active={w.hostIds.every((id) => selected.has(id))}
              onClick={() => toggleMany(w.hostIds)}
            />
          ))}
        </div>
      )}

      <div className="border-edge bg-input mb-2 grid max-h-32 grid-cols-3 gap-x-3 gap-y-0.5 overflow-y-auto rounded border p-2">
        {hosts.map((h) => (
          <label key={h.id} className="text-content flex cursor-pointer items-center gap-1.5 text-xs select-none">
            <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggle(h.id)} />
            <span className="truncate">{h.label}</span>
          </label>
        ))}
        {hosts.length === 0 && <span className="text-subtle col-span-3 py-2 text-center text-xs">{t('bulk.noSsh')}</span>}
      </div>

      {/* Đường dẫn + kiểu hiển thị + Run */}
      <input
        value={path}
        onChange={(e) => {
          setPath(e.target.value)
          setResults(null)
        }}
        placeholder={t('compare.pathPh')}
        className="border-edge-strong bg-input text-content placeholder-subtle focus:border-accent mb-2 w-full rounded border px-2 py-1.5 font-mono text-xs outline-none"
      />

      {/* Lịch sử đường dẫn đã compare — bấm để điền lại */}
      {history.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-subtle mr-0.5 text-[10px] tracking-wider uppercase">{t('compare.history')}</span>
          {history.map((h) => (
            <button
              key={h}
              title={h}
              onClick={() => {
                setPath(h)
                setResults(null)
              }}
              className="border-edge bg-input text-muted hover:bg-hover hover:text-content max-w-[16rem] truncate rounded-full border px-2.5 py-0.5 font-mono text-[11px]"
            >
              {h}
            </button>
          ))}
          <button className="text-subtle hover:text-danger text-[10px]" onClick={() => setHistory(clearCompareHistory())}>
            {t('compare.historyClear')}
          </button>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-subtle text-[10px] font-semibold tracking-wide uppercase">{t('compare.mode')}</span>
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              mode === m
                ? 'border-accent/50 bg-accent-soft/50 text-accent-fg'
                : 'border-edge bg-input text-muted hover:bg-hover hover:text-content'
            }`}
            title={t(`compare.mode.${m}Hint`)}
          >
            {t(`compare.mode.${m}`)}
          </button>
        ))}
        <div className="flex-1" />
        <Button variant="primary" className="!px-3 !py-1 !text-xs" disabled={!canRun} onClick={() => void run()}>
          {busy ? t('compare.reading') : t('compare.run')}
        </Button>
      </div>

      {error && <p className="text-danger mb-2 text-xs break-words">{error}</p>}

      {results && (
        <div className="border-edge bg-app flex min-h-0 flex-1 flex-col overflow-hidden rounded border">
          {mode === 'baseline' && (
            <BaselineView
              results={results}
              baselineId={baselineId}
              onBaseline={setBaselineId}
              labelOf={labelOf}
            />
          )}
          {mode === 'group' && <GroupView results={results} />}
          {mode === 'columns' && (
            <ColumnsView results={results} diffOnly={diffOnly} onDiffOnly={setDiffOnly} />
          )}
        </div>
      )}

      {!results && !error && <p className="text-subtle py-6 text-center text-xs">{t('compare.hintN')}</p>}
    </div>
  )
}

// ── Baseline: 1 chuẩn, các server khác diff so với chuẩn ──────────────────────
function BaselineView({
  results,
  baselineId,
  onBaseline,
  labelOf
}: {
  results: FileResult[]
  baselineId: string
  onBaseline: (id: string) => void
  labelOf: (id: string) => string
}) {
  const t = useT()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const baseline = results.find((r) => r.hostId === baselineId) ?? results.find((r) => r.ok)
  const others = results.filter((r) => r.hostId !== baseline?.hostId)

  const diffs = useMemo(() => {
    const map = new Map<string, DiffResult | null>()
    if (baseline?.ok) {
      for (const o of others) map.set(o.hostId, o.ok ? diffLines(baseline.content, o.content) : null)
    }
    return map
  }, [baseline, others])

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-edge bg-panel flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="text-subtle">{t('compare.baselineLabel')}</span>
        <Select className="!py-0.5 !text-xs" value={baseline?.hostId ?? ''} onChange={(e) => onBaseline(e.target.value)}>
          {results.map((r) => (
            <option key={r.hostId} value={r.hostId} disabled={!r.ok}>
              {r.label}
              {r.ok ? '' : ' (lỗi)'}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!baseline?.ok && <p className="text-danger p-3 text-xs">{t('compare.baselineErr')}</p>}
        {baseline?.ok &&
          others.map((o) => {
            const d = diffs.get(o.hostId)
            const open = expanded.has(o.hostId)
            return (
              <div key={o.hostId} className="border-edge/60 border-b">
                <button
                  className="hover:bg-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
                  onClick={() => o.ok && toggle(o.hostId)}
                >
                  <span className="text-subtle w-3">{o.ok ? (open ? '▾' : '▸') : '⚠'}</span>
                  <span className="text-content min-w-0 flex-1 truncate">{o.label}</span>
                  {!o.ok && <span className="text-danger truncate">{o.error ?? t('compare.readErr')}</span>}
                  {o.ok && d && (
                    <span>
                      {d.identical ? (
                        <span className="text-success">{t('compare.identical')}</span>
                      ) : (
                        <>
                          <span className="text-success">+{d.added}</span>{' '}
                          <span className="text-danger">−{d.removed}</span>{' '}
                          <span className="text-warning">~{d.changed}</span>
                        </>
                      )}
                    </span>
                  )}
                </button>
                {open && o.ok && d && (
                  <DiffTable rows={d.rows} leftLabel={labelOf(baseline.hostId)} rightLabel={o.label} truncated={d.truncated} />
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

// ── Group: gom server có nội dung giống nhau ─────────────────────────────────
function GroupView({ results }: { results: FileResult[] }) {
  const t = useT()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const ok = results.filter((r) => r.ok)
  const errored = results.filter((r) => !r.ok)

  const groups = useMemo(() => {
    const map = new Map<string, FileResult[]>()
    for (const r of ok) {
      const arr = map.get(r.content) ?? []
      arr.push(r)
      map.set(r.content, arr)
    }
    return [...map.values()].sort((a, b) => b.length - a.length)
  }, [ok])

  const base = groups[0]
  const toggle = (i: number): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
      {groups.length === 1 && ok.length > 1 && (
        <p className="text-success mb-2">{t('compare.allIdentical', { n: ok.length })}</p>
      )}
      {groups.map((g, i) => {
        const isBase = i === 0
        const open = expanded.has(i)
        const d = !isBase && base ? diffLines(base[0]!.content, g[0]!.content) : null
        return (
          <div key={i} className="border-edge mb-2 rounded border">
            <div className="bg-panel flex items-center gap-2 px-2.5 py-1.5">
              <span className={`size-2 shrink-0 rounded-full ${isBase ? 'bg-success' : 'bg-warning'}`} />
              <span className="text-content font-medium">
                {isBase ? t('compare.groupBase', { n: g.length }) : t('compare.groupN', { i: i + 1, n: g.length })}
              </span>
              {!isBase && (
                <button className="text-accent ml-auto hover:underline" onClick={() => toggle(i)}>
                  {open ? t('compare.hideDiff') : t('compare.showDiffVsBase')}
                </button>
              )}
            </div>
            <div className="text-muted flex flex-wrap gap-1.5 px-2.5 py-1.5">
              {g.map((r) => (
                <span key={r.hostId} className="border-edge bg-input rounded border px-1.5 py-0.5">
                  {r.label}
                </span>
              ))}
            </div>
            {open && d && <DiffTable rows={d.rows} leftLabel={t('compare.groupBaseShort')} rightLabel={t('compare.groupNShort', { i: i + 1 })} truncated={d.truncated} />}
          </div>
        )
      })}
      {errored.length > 0 && (
        <div className="border-danger/40 mt-2 rounded border p-2">
          <div className="text-danger mb-1 text-[11px] font-semibold">{t('compare.readFailed', { n: errored.length })}</div>
          {errored.map((r) => (
            <div key={r.hostId} className="text-subtle truncate text-[11px]">
              {r.label}: {r.error ?? t('compare.readErr')}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Columns: N cột cạnh nhau, tô dòng khác ───────────────────────────────────
function ColumnsView({
  results,
  diffOnly,
  onDiffOnly
}: {
  results: FileResult[]
  diffOnly: boolean
  onDiffOnly: (v: boolean) => void
}) {
  const t = useT()
  const ok = results.filter((r) => r.ok)
  const errored = results.filter((r) => !r.ok)

  const { rows, total } = useMemo(() => {
    const linesPer = ok.map((r) => r.content.replace(/\n$/, '').split('\n'))
    const max = linesPer.reduce((m, l) => Math.max(m, l.length), 0)
    const out: { no: number; cells: string[]; differ: boolean }[] = []
    for (let i = 0; i < max && out.length < COLUMNS_MAX_ROWS; i++) {
      const cells = linesPer.map((l) => l[i] ?? '')
      const differ = new Set(cells).size > 1
      if (diffOnly && !differ) continue
      out.push({ no: i + 1, cells, differ })
    }
    return { rows: out, total: max }
  }, [ok, diffOnly])

  const gridCols = `4rem repeat(${ok.length}, minmax(12rem, 1fr))`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-edge bg-panel flex shrink-0 items-center gap-3 border-b px-3 py-1.5 text-xs">
        <label className="text-muted flex cursor-pointer items-center gap-1.5 select-none">
          <input type="checkbox" checked={diffOnly} onChange={(e) => onDiffOnly(e.target.checked)} />
          {t('compare.diffOnly')}
        </label>
        {rows.length >= COLUMNS_MAX_ROWS && <span className="text-subtle text-[10px]">{t('compare.truncated')}</span>}
        {errored.length > 0 && (
          <span className="text-danger text-[10px]">{t('compare.readFailed', { n: errored.length })}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed">
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, minWidth: 'max-content' }}>
          {/* header */}
          <div className="bg-panel text-subtle border-edge sticky top-0 z-10 border-b border-r px-2 py-1 text-[10px]">#</div>
          {ok.map((r) => (
            <div key={r.hostId} className="bg-panel text-subtle border-edge sticky top-0 z-10 truncate border-b border-r px-2 py-1 text-[10px]" title={r.label}>
              {r.label}
            </div>
          ))}
          {/* body */}
          {rows.map((row) => (
            <Row key={row.no} no={row.no} cells={row.cells} differ={row.differ} />
          ))}
        </div>
        {rows.length === 0 && (
          <p className="text-subtle py-6 text-center text-xs">
            {diffOnly ? t('compare.noDiff', { n: total }) : t('compare.emptyFiles')}
          </p>
        )}
      </div>
    </div>
  )
}

function Row({ no, cells, differ }: { no: number; cells: string[]; differ: boolean }) {
  return (
    <>
      <div className={`text-subtle border-edge/50 border-r border-b px-2 text-right select-none ${differ ? 'bg-warning/10' : ''}`}>
        {no}
      </div>
      {cells.map((c, i) => (
        <div
          key={i}
          className={`border-edge/50 text-content border-r border-b px-2 break-all whitespace-pre-wrap ${differ ? 'bg-warning/10' : ''}`}
        >
          {c}
        </div>
      ))}
    </>
  )
}

// ── Bảng diff side-by-side dùng chung (baseline + group) ─────────────────────
function DiffTable({
  rows,
  leftLabel,
  rightLabel,
  truncated
}: {
  rows: DiffRow[]
  leftLabel: string
  rightLabel: string
  truncated?: boolean
}) {
  const t = useT()
  return (
    <div className="border-edge/60 max-h-[50vh] overflow-auto border-t font-mono text-[11px] leading-relaxed">
      <div className="bg-panel text-subtle sticky top-0 z-10 grid grid-cols-2 border-b text-[10px]">
        <div className="border-edge truncate border-r px-2 py-1">{leftLabel}</div>
        <div className="truncate px-2 py-1">{rightLabel}</div>
      </div>
      {rows.map((row, i) => (
        <DiffRowView key={i} row={row} />
      ))}
      {truncated && <div className="text-subtle px-2 py-1 text-[10px]">{t('compare.truncated')}</div>}
    </div>
  )
}

function DiffRowView({ row }: { row: DiffRow }) {
  const leftBg = row.type === 'del' || row.type === 'change' ? 'bg-danger/15' : ''
  const rightBg = row.type === 'add' || row.type === 'change' ? 'bg-success/15' : ''
  return (
    <div className="grid grid-cols-2">
      <Cell no={row.leftNo} text={row.left} bg={leftBg} border />
      <Cell no={row.rightNo} text={row.right} bg={rightBg} />
    </div>
  )
}

function Cell({ no, text, bg, border }: { no?: number; text?: string; bg: string; border?: boolean }) {
  return (
    <div className={`flex ${border ? 'border-edge border-r' : ''} ${bg}`}>
      <span className="text-subtle border-edge/60 w-10 shrink-0 border-r px-1 text-right select-none">{no ?? ''}</span>
      <span className="text-content min-w-0 flex-1 px-2 break-all whitespace-pre-wrap">{text ?? ''}</span>
    </div>
  )
}
