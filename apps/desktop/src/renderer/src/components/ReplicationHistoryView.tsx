import { useCallback, useEffect, useState } from 'react'
import type { ReplRunDetailDto, ReplRunDto } from '@infra/shared'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { Button, ConfirmModal } from './ui'
import { ChecksumSection, SchemaSection, Section, TableDiffTable, VarsSection } from './ReplicationCompareTables'
import { useT } from '../i18n'

/**
 * F59 — Lịch sử các lần so lệch.
 *
 * Vì sao có tab này: vá dữ liệu lệch là việc kéo dài nhiều ngày, mà mỗi lần bấm "Quét nhanh" là
 * kết quả cũ biến mất khỏi màn hình. Không lưu lại thì không ai trả lời được câu quan trọng
 * nhất — "so với lần trước thì đã bớt lệch chưa, còn đúng những bảng nào".
 *
 * Ghi là TỰ ĐỘNG (main lưu ngay sau mỗi lần quét/đếm/checksum), xoá là THỦ CÔNG: chỉ user mới
 * biết bản ghi nào còn cần để đối chiếu.
 */

/** Cùng trần với `VaultService.REPL_RUN_CAP` — nói thẳng ra để user biết bản cũ sẽ rơi. */
const RUN_CAP = 200

export function ReplicationHistoryView({ pairId, pairName }: { pairId: string; pairName: string }) {
  const t = useT()
  const [allPairs, setAllPairs] = useState(false)
  const [runs, setRuns] = useState<ReplRunDto[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReplRunDetailDto | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setRuns(await window.infra.replication.historyList(allPairs ? undefined : pairId))
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
      setRuns([])
    }
  }, [allPairs, pairId])

  useEffect(() => {
    // Đổi cụm / đổi phạm vi → chi tiết đang mở không còn thuộc danh sách nữa
    setOpenId(null)
    setDetail(null)
    void load()
  }, [load])

  const openRun = async (run: ReplRunDto): Promise<void> => {
    if (openId === run.id) {
      setOpenId(null)
      setDetail(null)
      return
    }
    setOpenId(run.id)
    setDetail(null)
    setDetailBusy(true)
    try {
      setDetail(await window.infra.replication.historyGet(run.id))
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setDetailBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await window.infra.replication.historyDelete(id)
      if (openId === id) {
        setOpenId(null)
        setDetail(null)
      }
      await load()
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  const clear = async (): Promise<void> => {
    setConfirmClear(false)
    try {
      const n = await window.infra.replication.historyClear(allPairs ? undefined : pairId)
      useToastsStore.getState().push(t('repl.hist.cleared', { n }), 'info')
      setOpenId(null)
      setDetail(null)
      await load()
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button className="!px-2 !py-1 !text-xs" onClick={() => void load()}>
          ↻
        </Button>
        <label className="text-muted flex cursor-pointer items-center gap-1.5 text-xs select-none">
          <input type="checkbox" checked={allPairs} onChange={(e) => setAllPairs(e.target.checked)} />
          {t('repl.hist.allPairs')}
        </label>
        <span className="text-subtle text-[10px]">{t('repl.hist.count', { n: runs?.length ?? 0 })}</span>
        <Button
          className="!px-2 !py-1 !text-xs"
          disabled={(runs?.length ?? 0) === 0}
          onClick={() => setConfirmClear(true)}
        >
          {t('repl.hist.clear')}
        </Button>
      </div>

      {runs !== null && runs.length === 0 && (
        <p className="text-subtle px-2 py-8 text-center text-xs">{t('repl.hist.empty')}</p>
      )}

      <div className="flex flex-col gap-1.5">
        {(runs ?? []).map((run) => (
          <div key={run.id} className="border-edge bg-panel rounded border">
            <div className="hover:bg-hover/40 flex items-center gap-2 px-2 py-1.5">
              <button className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left" onClick={() => void openRun(run)}>
                <span className="text-content shrink-0 font-mono text-[11px]">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
                <KindBadge kind={run.kind} />
                <span className="text-muted min-w-0 truncate text-[11px]">
                  {run.masterLabel || '—'} → {run.replicaLabel || '—'}
                  {allPairs && <span className="text-subtle"> · {run.pairName}</span>}
                </span>
                <Summary run={run} />
              </button>
              <button
                className="text-subtle hover:text-danger shrink-0 px-1 text-xs"
                title={t('repl.hist.delete')}
                onClick={() => void remove(run.id)}
              >
                ✕
              </button>
              <span className="text-subtle shrink-0 text-xs">{openId === run.id ? '▾' : '▸'}</span>
            </div>

            {openId === run.id && (
              <div className="border-edge/60 border-t px-2 py-2">
                {detailBusy && <p className="text-subtle px-2 py-4 text-center text-xs">…</p>}
                {!detailBusy && detail && <RunDetail detail={detail} />}
                {!detailBusy && !detail && (
                  <p className="text-subtle px-2 py-4 text-center text-xs">{t('repl.hist.gone')}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-subtle mt-2 text-[10px] leading-relaxed">{t('repl.hist.note', { n: RUN_CAP })}</p>

      {confirmClear && (
        <ConfirmModal
          title={t('repl.hist.clearTitle')}
          message={allPairs ? t('repl.hist.clearAllAsk') : t('repl.hist.clearPairAsk', { name: pairName })}
          confirmLabel={t('repl.hist.clear')}
          onConfirm={() => void clear()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}

function KindBadge({ kind }: { kind: ReplRunDto['kind'] }) {
  const t = useT()
  const label = t(kind === 'scan' ? 'repl.hist.kind.scan' : kind === 'count' ? 'repl.hist.kind.count' : 'repl.hist.kind.checksum')
  // Quét nhanh chỉ đọc information_schema; đếm/checksum quét toàn bảng → tô khác để nhìn phát
  // biết bản ghi nào là kết luận CHẮC CHẮN, bản nào chỉ là ước lượng
  const tone = kind === 'scan' ? 'border-edge text-subtle' : 'border-accent/60 text-accent-fg'
  return <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase ${tone}`}>{label}</span>
}

/** Con số tóm tắt — đọc thẳng từ cột trong vault, không phải giải mã chi tiết. */
function Summary({ run }: { run: ReplRunDto }) {
  const t = useT()
  const chips: string[] = []
  if (run.kind === 'scan') {
    if (run.tableDiffs > 0) chips.push(t('repl.hist.sumTables', { n: run.tableDiffs }))
    if (run.columnDiffs > 0) chips.push(t('repl.hist.sumColumns', { n: run.columnDiffs }))
    if (run.indexDiffs > 0) chips.push(t('repl.hist.sumIndexes', { n: run.indexDiffs }))
    if (run.varDiffs > 0) chips.push(t('repl.hist.sumVars', { n: run.varDiffs }))
  } else if (run.mismatches > 0) {
    chips.push(t('repl.hist.sumMismatch', { n: run.mismatches, total: run.checked }))
  } else {
    chips.push(t('repl.hist.sumChecked', { n: run.checked }))
  }
  const clean = chips.length === 0 || (run.kind !== 'scan' && run.mismatches === 0)
  return (
    <span className={`ml-auto shrink-0 text-[11px] ${clean ? 'text-subtle' : 'text-warning font-medium'}`}>
      {chips.length > 0 ? chips.join(' · ') : t('repl.hist.clean')}
    </span>
  )
}

function RunDetail({ detail }: { detail: ReplRunDetailDto }) {
  const t = useT()
  if (detail.locked) return <p className="text-warning px-2 py-4 text-center text-xs">{t('repl.hist.locked')}</p>
  const empty =
    detail.tables.length === 0 &&
    detail.columns.length === 0 &&
    detail.indexes.length === 0 &&
    detail.variables.length === 0 &&
    detail.rows.length === 0
  return (
    <>
      {detail.truncated && <p className="text-warning mb-2 text-[10px]">{t('repl.hist.truncated')}</p>}
      {detail.hasFilters && <p className="text-subtle mb-2 text-[10px]">{t('repl.cmp.filterNote')}</p>}
      {empty && <p className="text-subtle px-2 py-4 text-center text-xs">{t('repl.hist.clean')}</p>}
      {detail.tables.length > 0 && (
        <Section title={t('repl.cmp.tables')} count={detail.tables.length}>
          <TableDiffTable diffs={detail.tables} emptyText={t('repl.cmp.tablesOk')} />
        </Section>
      )}
      {detail.rows.length > 0 && <ChecksumSection rows={detail.rows} />}
      <SchemaSection title={t('repl.cmp.columns')} diffs={detail.columns} />
      <SchemaSection title={t('repl.cmp.indexes')} diffs={detail.indexes} />
      {detail.variables.length > 0 && <VarsSection variables={detail.variables} />}
    </>
  )
}
