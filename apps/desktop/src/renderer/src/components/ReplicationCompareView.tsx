import { useState } from 'react'
import type { ReplChecksumRowDto, ReplCompareResultDto } from '@infra/shared'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { Button } from './ui'
import { ChecksumSection, Section, SchemaSection, TableDiffTable, VarsSection } from './ReplicationCompareTables'
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
 *
 * Mỗi lần chạy được main TỰ LƯU vào lịch sử (tab Lịch sử) — xem `saveRun` ở main/ipc/replication.
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
            <TableDiffTable diffs={tables} picked={picked} onToggle={toggle} emptyText={t('repl.cmp.tablesOk')} />
          </Section>

          {rows && <ChecksumSection rows={rows} />}

          <SchemaSection title={t('repl.cmp.columns')} diffs={result.columns} />
          <SchemaSection title={t('repl.cmp.indexes')} diffs={result.indexes} />
          <VarsSection variables={result.variables} />

          <p className="text-subtle mt-2 text-[10px] leading-relaxed">{t('repl.cmp.estimateNote')}</p>
        </>
      )}
    </div>
  )
}
