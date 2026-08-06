import { useState } from 'react'
import type {
  ReplChecksumRowDto,
  ReplCompareResultDto,
  ReplSchemaDiffDto,
  ReplTableDiffDto
} from '@infra/shared'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { Button } from './ui'
import { useT } from '../i18n'

/** Cùng trần với main (MAX_CHECKSUM_TABLES) — hiện ra để user biết trước, không cắt âm thầm. */
const MAX_PICK = 50

/**
 * F55 — So lệch THỰC TẾ giữa hai bên, chạy theo yêu cầu.
 *
 * Hai bước cố ý tách rời:
 *  1. "Quét nhanh" đọc information_schema — vài giây, nhưng số dòng chỉ là ƯỚC LƯỢNG.
 *  2. Tick bảng đáng ngờ rồi mới đếm chính xác / checksum — mỗi bảng quét toàn bộ ở CẢ HAI
 *     server nên phải là hành động có chủ đích, không bao giờ chạy tự động.
 */
export function ReplicationCompareView({ pairId, replicaId }: { pairId: string; replicaId?: string }) {
  const t = useT()
  const [result, setResult] = useState<ReplCompareResultDto | null>(null)
  const [scanning, setScanning] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<ReplChecksumRowDto[] | null>(null)
  const [deepBusy, setDeepBusy] = useState(false)
  const [showSame, setShowSame] = useState(false)

  const scan = async (): Promise<void> => {
    setScanning(true)
    setRows(null)
    setPicked(new Set())
    try {
      setResult(await window.infra.replication.compare(pairId, replicaId))
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setScanning(false)
    }
  }

  const runDeep = async (mode: 'count' | 'checksum'): Promise<void> => {
    const tables = (result?.tables ?? [])
      .filter((d) => picked.has(`${d.schema}.${d.name}`))
      .map((d) => ({ schema: d.schema, name: d.name }))
    if (tables.length === 0) return
    setDeepBusy(true)
    try {
      setRows(await window.infra.replication.checksum(pairId, tables, mode, replicaId))
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setDeepBusy(false)
    }
  }

  const toggle = (key: string): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < MAX_PICK) next.add(key)
      return next
    })

  const tables = (result?.tables ?? []).filter((d) => showSame || d.status !== 'same')
  const sameCount = (result?.tables ?? []).filter((d) => d.status === 'same').length

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button className="!px-2 !py-1 !text-xs" disabled={scanning} onClick={() => void scan()}>
          {scanning ? '…' : t('repl.cmp.scan')}
        </Button>
        {result?.ok && (
          <>
            <span className="text-subtle text-[10px]">
              {t('repl.cmp.picked', { n: picked.size, max: MAX_PICK })}
            </span>
            <Button
              className="!px-2 !py-1 !text-xs"
              disabled={deepBusy || picked.size === 0}
              onClick={() => void runDeep('count')}
            >
              {deepBusy ? '…' : t('repl.cmp.count')}
            </Button>
            <Button
              className="!px-2 !py-1 !text-xs"
              disabled={deepBusy || picked.size === 0}
              onClick={() => void runDeep('checksum')}
            >
              {deepBusy ? '…' : t('repl.cmp.checksum')}
            </Button>
            <label className="text-muted ml-auto flex cursor-pointer items-center gap-1.5 text-xs select-none">
              <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
              {t('repl.cmp.showSame', { n: sameCount })}
            </label>
          </>
        )}
      </div>

      {!result && !scanning && <p className="text-subtle px-2 py-8 text-center text-xs">{t('repl.cmp.hint')}</p>}
      {result && !result.ok && <p className="text-danger px-2 py-4 text-xs">{result.error}</p>}

      {result?.ok && (
        <>
          {result.hasFilters && <p className="text-subtle mb-2 text-[10px]">{t('repl.cmp.filterNote')}</p>}

          <Section title={t('repl.cmp.tables')} count={tables.length}>
            <table className="w-full text-[11px]">
              <thead className="bg-panel text-subtle sticky top-0 text-left">
                <tr>
                  <th className="w-6 px-2 py-1.5" />
                  <th className="px-2 py-1.5 font-medium">{t('repl.cmp.table')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('repl.cmp.status')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t('repl.cmp.rowsMaster')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t('repl.cmp.rowsReplica')}</th>
                  <th className="px-2 py-1.5 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody className="divide-edge/60 divide-y">
                {tables.map((d) => (
                  <TableRow
                    key={`${d.schema}.${d.name}`}
                    diff={d}
                    picked={picked.has(`${d.schema}.${d.name}`)}
                    onToggle={() => toggle(`${d.schema}.${d.name}`)}
                  />
                ))}
                {tables.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-subtle px-2 py-6 text-center">
                      {t('repl.cmp.tablesOk')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Section>

          {rows && <ChecksumSection rows={rows} />}

          <SchemaSection title={t('repl.cmp.columns')} diffs={result.columns} />
          <SchemaSection title={t('repl.cmp.indexes')} diffs={result.indexes} />

          <Section title={t('repl.cmp.vars')} count={result.variables.length}>
            <table className="w-full text-[11px]">
              <tbody className="divide-edge/60 divide-y">
                {result.variables.map((v) => (
                  <tr key={v.name} className={v.expected ? 'opacity-60' : ''}>
                    <td className="text-content px-2 py-1 font-mono">{v.name}</td>
                    <td className="text-muted px-2 py-1 font-mono">{v.master}</td>
                    <td className="text-muted px-2 py-1 font-mono">{v.replica}</td>
                    <td className="text-subtle px-2 py-1 text-[10px]">
                      {v.expected ? `${t('repl.cmp.expected')} — ${v.note}` : v.note}
                    </td>
                  </tr>
                ))}
                {result.variables.length === 0 && (
                  <tr>
                    <td className="text-subtle px-2 py-4 text-center">{t('repl.cmp.varsOk')}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Section>

          <p className="text-subtle mt-2 text-[10px] leading-relaxed">{t('repl.cmp.estimateNote')}</p>
        </>
      )}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-subtle mb-1 text-[10px] font-medium tracking-wide uppercase">
        {title} {count > 0 && `(${count})`}
      </p>
      <div className="border-edge max-h-[36vh] overflow-auto rounded border">{children}</div>
    </div>
  )
}

const STATUS_STYLE: Record<ReplTableDiffDto['status'], string> = {
  'missing-on-replica': 'text-danger font-semibold',
  'missing-on-master': 'text-danger font-semibold',
  'engine-differs': 'text-warning',
  'collation-differs': 'text-warning',
  'rows-differ': 'text-warning',
  same: 'text-subtle'
}

function TableRow({
  diff,
  picked,
  onToggle
}: {
  diff: ReplTableDiffDto
  picked: boolean
  onToggle: () => void
}) {
  const t = useT()
  const statusKey = {
    'missing-on-replica': 'repl.cmp.st.missingReplica',
    'missing-on-master': 'repl.cmp.st.missingMaster',
    'engine-differs': 'repl.cmp.st.engine',
    'collation-differs': 'repl.cmp.st.collation',
    'rows-differ': 'repl.cmp.st.rows',
    same: 'repl.cmp.st.same'
  } as const
  return (
    <tr className={`hover:bg-hover ${diff.filtered ? 'opacity-50' : ''}`}>
      <td className="px-2 py-1">
        {/* Chỉ bảng có ở CẢ HAI bên mới đếm/checksum được */}
        <input type="checkbox" checked={picked} disabled={!diff.master || !diff.replica} onChange={onToggle} />
      </td>
      <td className="text-content px-2 py-1 font-mono">
        {diff.schema}.{diff.name}
        {diff.filtered && <span className="text-subtle ml-1 text-[9px]">({t('repl.cmp.filtered')})</span>}
      </td>
      <td className={`px-2 py-1 ${STATUS_STYLE[diff.status]}`}>{t(statusKey[diff.status])}</td>
      <td className="text-muted px-2 py-1 text-right font-mono">{diff.master?.rowsEstimate?.toLocaleString() ?? '—'}</td>
      <td className="text-muted px-2 py-1 text-right font-mono">{diff.replica?.rowsEstimate?.toLocaleString() ?? '—'}</td>
      <td className={`px-2 py-1 text-right font-mono ${diff.rowDelta ? 'text-warning' : 'text-subtle'}`}>
        {diff.rowDelta === null ? '—' : diff.rowDelta > 0 ? `+${diff.rowDelta.toLocaleString()}` : diff.rowDelta.toLocaleString()}
      </td>
    </tr>
  )
}

function ChecksumSection({ rows }: { rows: ReplChecksumRowDto[] }) {
  const t = useT()
  const mismatch = (r: ReplChecksumRowDto): boolean =>
    (r.masterCount !== null && r.masterCount !== r.replicaCount) ||
    (r.masterChecksum !== null && r.masterChecksum !== r.replicaChecksum)
  return (
    <Section title={t('repl.cmp.exact')} count={rows.length}>
      <table className="w-full text-[11px]">
        <tbody className="divide-edge/60 divide-y">
          {rows.map((r) => (
            <tr key={`${r.schema}.${r.name}`} className={mismatch(r) ? 'bg-danger/5' : ''}>
              <td className="text-content px-2 py-1 font-mono">
                {r.schema}.{r.name}
              </td>
              <td className="text-muted px-2 py-1 text-right font-mono">
                {r.masterCount?.toLocaleString() ?? r.masterChecksum ?? '—'}
              </td>
              <td className="text-muted px-2 py-1 text-right font-mono">
                {r.replicaCount?.toLocaleString() ?? r.replicaChecksum ?? '—'}
              </td>
              <td className={`px-2 py-1 text-[10px] ${mismatch(r) ? 'text-danger font-semibold' : 'text-subtle'}`}>
                {r.error ?? (mismatch(r) ? t('repl.cmp.mismatch') : t('repl.cmp.match'))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

function SchemaSection({ title, diffs }: { title: string; diffs: ReplSchemaDiffDto[] }) {
  const t = useT()
  if (diffs.length === 0) return null
  return (
    <Section title={title} count={diffs.length}>
      <table className="w-full text-[11px]">
        <tbody className="divide-edge/60 divide-y">
          {diffs.map((d) => (
            <tr key={`${d.table}::${d.item}`}>
              <td className="text-content px-2 py-1 font-mono">
                {d.table}.<span className="font-semibold">{d.item}</span>
              </td>
              <td className="text-muted px-2 py-1 font-mono text-[10px]">{d.masterSignature ?? t('repl.cmp.absent')}</td>
              <td className="text-muted px-2 py-1 font-mono text-[10px]">{d.replicaSignature ?? t('repl.cmp.absent')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}
