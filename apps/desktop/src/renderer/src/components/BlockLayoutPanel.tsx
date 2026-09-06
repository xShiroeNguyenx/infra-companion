import { useState } from 'react'
import { useT } from '../i18n'

/**
 * Hộp cấu hình "mục nào hiện, theo thứ tự nào" — phần vẽ, dùng chung cho:
 *  · khối của sidebar theme Infra (`SidebarLayoutPanel`),
 *  · mục menu của theme Navigator (`NavLayoutPanel` trong `NavRail.tsx`).
 *
 * MỘT danh sách duy nhất (không tách "đang bật / đang tắt" thành hai khu): thứ tự là thuộc
 * tính của cả danh sách, nên tick tắt một mục rồi bật lại phải thấy nó về đúng chỗ cũ, chứ
 * không nhảy xuống cuối một khu khác. Mục `locked` vẫn kéo được, chỉ khoá ô tick.
 */
export interface LayoutRow<Id extends string> {
  readonly id: Id
  readonly icon: string
  readonly label: string
  readonly on: boolean
  /** Không tắt được (vd Hosts ở theme Navigator) — ô tick disabled + lời giải thích ở `lockedHint`. */
  readonly locked?: boolean
}

export function BlockLayoutPanel<Id extends string>({
  title,
  rows,
  lockedHint,
  onToggle,
  onMove,
  onReset,
  onClose
}: {
  readonly title: string
  readonly rows: readonly LayoutRow<Id>[]
  readonly lockedHint?: string
  readonly onToggle: (id: Id) => void
  /** `to` là chỉ số ĐÍCH trong `rows`. */
  readonly onMove: (id: Id, to: number) => void
  readonly onReset: () => void
  readonly onClose: () => void
}) {
  const t = useT()
  const [dragId, setDragId] = useState<Id | null>(null)

  return (
    <div className="border-edge bg-elevated mt-1.5 rounded-md border p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-subtle text-[10px] font-semibold tracking-wider uppercase">{title}</span>
        <button className="text-subtle hover:text-content text-[11px]" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
      </div>

      <div className="space-y-0.5">
        {rows.map((row, i) => (
          <div
            key={row.id}
            draggable
            onDragStart={() => setDragId(row.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId && dragId !== row.id) onMove(dragId, i)
              setDragId(null)
            }}
            className={`hover:bg-hover flex cursor-grab items-center gap-1.5 rounded px-1 py-1 text-[11px] ${
              dragId === row.id ? 'opacity-40' : ''
            }`}
            title={row.locked && lockedHint ? lockedHint : t('sidebar.layoutDragHint')}
          >
            <span className="text-subtle shrink-0">⠿</span>
            {/* label bọc checkbox: bấm cả dòng là tick, không phải nhắm đúng ô vuông 12px */}
            <label className={`flex min-w-0 flex-1 items-center gap-1.5 ${row.locked ? 'cursor-default' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={row.on}
                disabled={row.locked}
                onChange={() => onToggle(row.id)}
                className="accent-accent"
              />
              <span className="shrink-0">{row.icon}</span>
              <span className={`min-w-0 truncate ${row.on ? 'text-content' : 'text-subtle'}`}>{row.label}</span>
              {row.locked && <span className="text-subtle shrink-0 text-[10px]">🔒</span>}
            </label>
          </div>
        ))}
      </div>

      <button className="text-subtle hover:text-danger mt-1.5 text-[10px] hover:underline" onClick={onReset}>
        {t('sidebar.layoutReset')}
      </button>
    </div>
  )
}
