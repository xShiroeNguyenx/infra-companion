import { useEffect, useRef, type ReactNode } from 'react'
import { GridIcon, PencilIcon, TrashIcon } from './icons'
import { useT } from '../i18n'

/**
 * Nút `⋯` trên header group + menu nhỏ chứa ba việc của group.
 *
 * Trước đây ba việc này là ba icon 11px hiện lúc hover ngay cạnh nhau: chúng chen với số host
 * khi group gập, bắt người dùng nhắm đúng một ô bé xíu, và đặt nút **xoá** sát hai nút vô hại.
 * Gom vào một dấu `⋯` thì header chỉ còn tên + số, còn hành động phá huỷ phải qua hai bước.
 *
 * Menu đóng khi bấm ra ngoài, khi bấm Escape, và khi CUỘN danh sách: nó neo `absolute` bên
 * trong vùng cuộn nên cuộn tiếp là nó trôi khỏi cái nút đã sinh ra nó.
 *
 * Dùng ở cả cột host (theme Infra) lẫn card nhóm của trang Hosts (theme Navigator) — nút chỉ
 * hiện lúc hover **phần tử cha có class `group/header`**; nơi dùng phải đặt class đó.
 */
export function GroupMenuButton({
  open,
  onToggle,
  onOpenAll,
  hostCount,
  onEdit,
  onDelete,
  alwaysVisible = false
}: {
  readonly open: boolean
  readonly onToggle: () => void
  /** Mở cả nhóm thành các pane — undefined khi nhóm chỉ có 1 host (split với chính nó là vô nghĩa). */
  readonly onOpenAll?: () => void
  readonly hostCount: number
  /** undefined cho mục "Khác"/"Global": nó không phải group thật nên không sửa/xoá được. */
  readonly onEdit?: () => void
  readonly onDelete?: () => void
  /** Hiện thường trực thay vì chỉ lúc hover — cho nơi không có trạng thái hover rõ (header trang). */
  readonly alwaysVisible?: boolean
}) {
  const t = useT()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => {
      if (event.type === 'mousedown' && boxRef.current?.contains(event.target as Node)) return
      onToggle()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onToggle()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    // `capture: true` để bắt cuộn của vùng danh sách (scroll KHÔNG nổi bọt lên window)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, onToggle])

  return (
    <div className="relative shrink-0" ref={boxRef}>
      <button
        className={`hover:bg-hover hover:text-content rounded px-1 leading-none ${
          // Mở menu thì nút phải HIỆN THƯỜNG TRỰC: nó chỉ hiện lúc hover, mà chuột đã rời
          // header để xuống menu thì nút biến mất và menu trông như treo lơ lửng.
          open || alwaysVisible ? 'text-content' : 'text-subtle opacity-0 group-hover/header:opacity-100'
        }`}
        title={t('sidebar.groupActions')}
        aria-label={t('sidebar.groupActions')}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        ⋯
      </button>
      {open && (
        // `max-w-52` + `truncate` từng dòng: sidebar chỉ rộng 240px, mà một dòng
        // `whitespace-nowrap` gặp bản dịch dài sẽ nới menu ra ngoài mép cột. Chặn bề rộng
        // ở đây thì không bản dịch nào phá được layout.
        <div
          className="border-edge-strong bg-elevated absolute top-full right-0 z-50 mt-0.5 max-w-52 min-w-36 rounded-md border py-1 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {onOpenAll && (
            <GroupMenuItem
              icon={<GridIcon />}
              // Nhãn NGẮN cho dòng menu; lời giải thích dài đi vào tooltip. Dùng chuỗi dài làm
              // nhãn thì nó bọc 3 dòng và phá layout menu (đã dính thật).
              label={t('sidebar.openGroupShort', { n: hostCount })}
              title={t('sidebar.openGroup', { n: hostCount })}
              onClick={() => {
                onToggle()
                onOpenAll()
              }}
            />
          )}
          {onEdit && (
            <GroupMenuItem
              icon={<PencilIcon />}
              label={t('sidebar.editGroup')}
              onClick={() => {
                onToggle()
                onEdit()
              }}
            />
          )}
          {/* Xoá tách khỏi hai mục trên bằng một vạch, và tô đỏ khi hover — nó là mục duy
              nhất ở đây làm mất dữ liệu. (Vẫn còn hộp xác nhận phía sau.) */}
          {onDelete && (
            <>
              {(onOpenAll || onEdit) && <div className="border-edge my-1 border-t" />}
              <GroupMenuItem
                icon={<TrashIcon />}
                label={t('sidebar.deleteGroup')}
                danger
                onClick={() => {
                  onToggle()
                  onDelete()
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function GroupMenuItem({
  icon,
  label,
  title,
  danger,
  onClick
}: {
  readonly icon: ReactNode
  /** Nhãn NGẮN — dòng menu là `whitespace-nowrap`, chuỗi dài sẽ nới menu ra ngoài sidebar. */
  readonly label: string
  /** Lời giải thích dài (tuỳ chọn) — chỗ dành cho nó là tooltip, không phải nhãn. */
  readonly title?: string
  readonly danger?: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      className={`hover:bg-hover flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] whitespace-nowrap ${
        danger ? 'text-muted hover:text-danger' : 'text-muted hover:text-content'
      }`}
      title={title}
      onClick={onClick}
    >
      <span className="shrink-0">{icon}</span>
      {/* `truncate` (cần `min-w-0` trong flex): `whitespace-nowrap` một mình sẽ TRÀN ra ngoài
          hộp đã chặn `max-w`, chứ không tự cắt. */}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}
