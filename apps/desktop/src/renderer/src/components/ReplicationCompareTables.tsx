import type { ReplChecksumRowDto, ReplSchemaDiffDto, ReplTableDiffDto, ReplVarDiffDto } from '@infra/shared'
import { useT } from '../i18n'

/**
 * Phần HIỂN THỊ kết quả so lệch master ↔ slave, dùng chung cho hai nơi:
 *  - tab "So lệch dữ liệu" (kết quả vừa quét, có tick chọn bảng để đếm/checksum)
 *  - tab "Lịch sử" (bản ghi đã lưu, chỉ đọc)
 *
 * Tách ra vì hai nơi phải trông GIỐNG HỆT nhau: đọc lại lịch sử mà bố cục khác lúc quét thì
 * người xem phải học lại cách đọc đúng lúc đang so hai lần chạy với nhau.
 */

export function Section({
  title,
  count,
  children
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <div className="mb-3">
      <p className="text-subtle mb-1 text-[10px] font-medium tracking-wide uppercase">
        {title} {count !== undefined && count > 0 && `(${count})`}
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
  /**
   * `text-subtle` chứ KHÔNG phải `text-warning`: đây là **gợi ý đi đếm**, không phải kết luận.
   *
   * Nguồn của nó là `TABLE_ROWS` ước lượng, mà InnoDB cho con số lệch 40–50% giữa hai máy có
   * cùng dữ liệu. Tô cảnh báo ở đây là nói với user một điều tool không biết — và họ tin, rồi
   * đi đếm tay thấy đủ, rồi mất niềm tin vào cả những cảnh báo thật.
   */
  'rows-suspect': 'text-subtle',
  same: 'text-subtle'
}

const STATUS_KEY = {
  'missing-on-replica': 'repl.cmp.st.missingReplica',
  'missing-on-master': 'repl.cmp.st.missingMaster',
  'engine-differs': 'repl.cmp.st.engine',
  'collation-differs': 'repl.cmp.st.collation',
  'rows-suspect': 'repl.cmp.st.rows',
  same: 'repl.cmp.st.same'
} as const

/**
 * Bảng kiểm kê. `onToggle` vắng mặt = chế độ CHỈ ĐỌC (lịch sử) → không có cột tick, vì tick ở
 * đó chẳng dẫn tới hành động nào.
 */
export function TableDiffTable({
  diffs,
  picked,
  onToggle,
  emptyText
}: {
  diffs: ReplTableDiffDto[]
  picked?: Set<string>
  onToggle?: (key: string) => void
  emptyText: string
}) {
  const t = useT()
  const selectable = onToggle !== undefined
  return (
    <table className="w-full text-[11px]">
      <thead className="bg-panel text-subtle sticky top-0 text-left">
        <tr>
          {/**
           * Mọi cột đều ghim, **cột cuối nuốt phần dư**.
           *
           * Ở tab, bảng rộng gấp đôi modal. Bản đầu chỉ ghim bốn cột số và để cột tên co giãn —
           * nhưng tên bảng chỉ ~180px, nên nó phình ra hơn 1000px và mấy con số dạt hẳn sang mép
           * phải, cách tên cả màn hình. Nay tên bảng cũng ghim (đủ cho tên dài, dài hơn thì
           * `break-all` xuống dòng), và một cột đệm vô hình cuối bảng ăn hết chỗ thừa.
           */}
          {selectable && <th className="w-6 px-2 py-1.5" />}
          <th className="w-96 px-2 py-1.5 font-medium">{t('repl.cmp.table')}</th>
          <th className="w-28 px-2 py-1.5 font-medium">{t('repl.cmp.status')}</th>
          <th className="w-32 px-2 py-1.5 text-right font-medium">{t('repl.cmp.rowsMaster')}</th>
          <th className="w-32 px-2 py-1.5 text-right font-medium">{t('repl.cmp.rowsReplica')}</th>
          <th className="w-28 px-2 py-1.5 text-right font-medium">Δ</th>
          {/* Cột đệm: hút hết bề ngang thừa để năm cột trên đứng sát nhau bên trái */}
          <th />
        </tr>
      </thead>
      <tbody className="divide-edge/60 divide-y">
        {diffs.map((d) => {
          const key = `${d.schema}.${d.name}`
          return (
            <tr key={key} className={`hover:bg-hover ${d.filtered ? 'opacity-50' : ''}`}>
              {selectable && (
                <td className="px-2 py-1">
                  {/* Chỉ bảng có ở CẢ HAI bên mới đếm/checksum được */}
                  <input
                    type="checkbox"
                    checked={picked?.has(key) ?? false}
                    disabled={!d.master || !d.replica}
                    onChange={() => onToggle(key)}
                  />
                </td>
              )}
              <td className="text-content px-2 py-1 font-mono">
                {key}
                {d.filtered && <span className="text-subtle ml-1 text-[9px]">({t('repl.cmp.filtered')})</span>}
              </td>
              <td className={`px-2 py-1 ${STATUS_STYLE[d.status]}`}>{t(STATUS_KEY[d.status])}</td>
              <td className="text-muted px-2 py-1 text-right font-mono">
                {d.master?.rowsEstimate?.toLocaleString() ?? '—'}
              </td>
              <td className="text-muted px-2 py-1 text-right font-mono">
                {d.replica?.rowsEstimate?.toLocaleString() ?? '—'}
              </td>
              <td className={`px-2 py-1 text-right font-mono ${d.rowDelta ? 'text-warning' : 'text-subtle'}`}>
                {d.rowDelta === null
                  ? '—'
                  : d.rowDelta > 0
                    ? `+${d.rowDelta.toLocaleString()}`
                    : d.rowDelta.toLocaleString()}
              </td>
              {/* Ô đệm cho cột hút chỗ thừa — xem chú thích ở `<thead>` */}
              <td />
            </tr>
          )
        })}
        {diffs.length === 0 && (
          <tr>
            <td colSpan={selectable ? 7 : 6} className="text-subtle px-2 py-6 text-center">
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/**
 * Một dòng đếm/checksum có lệch không. Cùng quy ước với `isChecksumMismatch` ở core: `null` là
 * KHÔNG ĐỌC ĐƯỢC chứ không phải "khác" — coi null là lệch sẽ báo động giả hàng loạt.
 * (Renderer không được import @infra/core nên chép lại đúng 3 dòng này.)
 */
export function isChecksumMismatch(r: ReplChecksumRowDto): boolean {
  return (
    (r.masterCount !== null && r.replicaCount !== null && r.masterCount !== r.replicaCount) ||
    (r.masterChecksum !== null && r.replicaChecksum !== null && r.masterChecksum !== r.replicaChecksum)
  )
}

export function ChecksumSection({ rows }: { rows: ReplChecksumRowDto[] }) {
  const t = useT()
  return (
    <Section title={t('repl.cmp.exact')} count={rows.length}>
      <table className="w-full text-[11px]">
        {/* Không có `<thead>` để gắn bề ngang, nên ghim bằng `<colgroup>`. Cột cuối để trống =
            hút hết chỗ thừa, đúng cách bảng kiểm kê làm — ở tab rộng, số không được dạt sang
            mép phải cách tên bảng cả màn hình. */}
        <colgroup>
          <col className="w-96" />
          <col className="w-32" />
          <col className="w-32" />
          <col className="w-28" />
          <col />
        </colgroup>
        <tbody className="divide-edge/60 divide-y">
          {rows.map((r) => {
            const bad = isChecksumMismatch(r)
            return (
              <tr key={`${r.schema}.${r.name}`} className={bad ? 'bg-danger/5' : ''}>
                <td className="text-content px-2 py-1 font-mono">
                  {r.schema}.{r.name}
                </td>
                <td className="text-muted px-2 py-1 text-right font-mono">
                  {r.masterCount?.toLocaleString() ?? r.masterChecksum ?? '—'}
                </td>
                <td className="text-muted px-2 py-1 text-right font-mono">
                  {r.replicaCount?.toLocaleString() ?? r.replicaChecksum ?? '—'}
                </td>
                <td className={`px-2 py-1 text-[10px] ${bad ? 'text-danger font-semibold' : 'text-subtle'}`}>
                  {r.error ?? (bad ? t('repl.cmp.mismatch') : t('repl.cmp.match'))}
                </td>
                {/* Ô đệm — xem chú thích ở `<colgroup>` */}
                <td />
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}

export function SchemaSection({ title, diffs }: { title: string; diffs: ReplSchemaDiffDto[] }) {
  const t = useT()
  if (diffs.length === 0) return null
  return (
    <Section title={title} count={diffs.length}>
      <table className="w-full text-[11px]">
        {/* Hai chữ ký (master / slave) cần so với nhau nên đặt CẠNH nhau và rộng bằng nhau;
            cột cuối để trống hút chỗ thừa, không để hai chữ ký dạt ra hai đầu màn hình. */}
        <colgroup>
          <col className="w-96" />
          <col className="w-64" />
          <col className="w-64" />
          <col />
        </colgroup>
        <tbody className="divide-edge/60 divide-y">
          {diffs.map((d) => (
            <tr key={`${d.table}::${d.item}`}>
              <td className="text-content px-2 py-1 font-mono">
                {d.table}.<span className="font-semibold">{d.item}</span>
              </td>
              <td className="text-muted px-2 py-1 font-mono text-[10px]">{d.masterSignature ?? t('repl.cmp.absent')}</td>
              <td className="text-muted px-2 py-1 font-mono text-[10px]">
                {d.replicaSignature ?? t('repl.cmp.absent')}
              </td>
              {/* Ô đệm — xem chú thích ở `<colgroup>` */}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

export function VarsSection({ variables }: { variables: ReplVarDiffDto[] }) {
  const t = useT()
  return (
    <Section title={t('repl.cmp.vars')} count={variables.length}>
      <table className="w-full text-[11px]">
        {/* Tên biến và hai giá trị đều ngắn và cố định; **lời giải thích** mới là thứ dài và đáng
            nuốt phần dư. Không ghim thì ở tab rộng, `MIXED` / `STATEMENT` trôi ra giữa màn hình
            cách tên biến cả gang tay. */}
        <colgroup>
          <col className="w-56" />
          <col className="w-28" />
          <col className="w-28" />
          <col />
        </colgroup>
        <tbody className="divide-edge/60 divide-y">
          {variables.map((v) => (
            <tr key={v.name} className={v.expected ? 'opacity-60' : ''}>
              <td className="text-content px-2 py-1 font-mono">{v.name}</td>
              <td className="text-muted px-2 py-1 font-mono">{v.master}</td>
              <td className="text-muted px-2 py-1 font-mono">{v.replica}</td>
              <td className="text-subtle px-2 py-1 text-[10px]">
                {v.expected ? `${t('repl.cmp.expected')} — ${v.note}` : v.note}
              </td>
            </tr>
          ))}
          {variables.length === 0 && (
            <tr>
              <td className="text-subtle px-2 py-4 text-center">{t('repl.cmp.varsOk')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </Section>
  )
}
