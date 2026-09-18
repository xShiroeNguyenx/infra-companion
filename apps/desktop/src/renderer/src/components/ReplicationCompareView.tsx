import { useEffect, useRef, useState } from 'react'
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
 *     Bước này TỰ CHẠY khi mở tab: nó chỉ đọc information_schema (vài giây, không quét dữ liệu),
 *     mà để màn hình trống thì hai nút so chính xác — vốn chỉ hiện sau khi có kết quả — không bao
 *     giờ lộ ra. Tính năng có sẵn mà người dùng không thấy thì coi như không có.
 *  2. Tick bảng đáng ngờ rồi mới đếm chính xác / checksum — mỗi bảng quét toàn bộ ở CẢ HAI
 *     server nên phải là hành động có chủ đích, KHÔNG BAO GIỜ chạy tự động.
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

  /**
   * Tự quét nhanh khi mở tab — và quét lại khi đổi cặp / đổi slave.
   *
   * Đọc `scan` qua ref: nó là hàm mới mỗi lần render nên để trong deps là quét lại liên tục
   * (mỗi kết quả trả về lại `setState` → render → quét tiếp). Khoá theo `pairId|replicaId` để
   * biết đã quét cho tổ hợp nào rồi, tránh cả trường hợp effect chạy hai lần ở StrictMode.
   */
  const scanRef = useRef(scan)
  scanRef.current = scan
  const autoScannedFor = useRef<string | null>(null)
  useEffect(() => {
    const key = `${pairId}|${replicaId ?? ''}`
    if (autoScannedFor.current === key) return
    autoScannedFor.current = key
    void scanRef.current()
  }, [pairId, replicaId])

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
            {/* Nút mờ khi chưa tick bảng nào — `title` nói vì sao, không để user đoán */}
            <Button
              className="!px-2 !py-1 !text-xs"
              disabled={deepBusy || picked.size === 0}
              title={picked.size === 0 ? t('repl.cmp.needPick') : t('repl.cmp.countTip')}
              onClick={() => void runDeep('count')}
            >
              {deepBusy ? '…' : t('repl.cmp.count')}
            </Button>
            <Button
              className="!px-2 !py-1 !text-xs"
              disabled={deepBusy || picked.size === 0}
              title={picked.size === 0 ? t('repl.cmp.needPick') : t('repl.cmp.checksumTip')}
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

      {/* Quét nhanh tự chạy lúc mở tab, nên trạng thái "chưa có kết quả" gần như chỉ là lúc đang chạy */}
      {!result && <p className="text-subtle px-2 py-8 text-center text-xs">{t('repl.cmp.hint')}</p>}
      {result && !result.ok && <p className="text-danger px-2 py-4 text-xs">{result.error}</p>}

      {result?.ok && (
        <>
          {/* Nói rõ bước 2 TỒN TẠI: hai nút kia chỉ hiện sau khi quét xong, mà trước đây không có
              câu nào nhắc tới chúng — tính năng có sẵn mà người dùng không thấy thì như không có. */}
          <p className="text-subtle mb-2 text-[10px]">{t('repl.cmp.step2')}</p>
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
