import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'

/**
 * Lớp chứa mọi `Modal`, đặt ở gốc App (xem `App.tsx`). `display: contents` nên bản thân nó
 * không chiếm chỗ — modal `absolute inset-0` bên trong bám vào gốc App (`relative isolate`).
 *
 * Vì sao phải portal: `absolute` bám vào tổ tiên GẦN NHẤT có `position`. Modal mở từ Sidebar
 * nằm trong `SidePanel` của theme Workbench — mà panel đó `relative` (cho tay kéo đổi bề rộng)
 * và `select-none` — nên hộp "Sửa host" bị nhốt trong cột ~300px, form tối thiểu 420px bị cắt
 * mất nửa trái, không sửa được gì. Theme Infra không lộ lỗi chỉ vì Sidebar ở đó không có
 * tổ tiên `relative` nào. Portal thì modal luôn phủ cả app, bất kể ai mở nó từ đâu.
 *
 * Lớp nằm TRƯỚC màn khoá vault (z-100) và toast trong DOM: toast vẫn nổi trên backdrop như cũ.
 */
export const MODAL_LAYER_ID = 'modal-layer'

export function Modal({
  title,
  children,
  onClose,
  danger = false,
  closeOnBackdrop = true,
  headerExtra,
  inline = false
}: {
  title: string
  children: ReactNode
  onClose?: () => void
  danger?: boolean
  /** false cho form dài / prompt bảo mật — misclick backdrop không làm mất dữ liệu đang nhập. */
  closeOnBackdrop?: boolean
  /** Nút phụ neo bên phải header (vd nút thu nhỏ). */
  headerExtra?: ReactNode
  /**
   * true = chỉ phủ khung chứa gần nhất thay vì cả app (không portal). Dành cho hộp thoại GẮN
   * VỚI MỘT VÙNG — vd guard lệnh nhạy cảm của một pane terminal: chia pane/broadcast thì phải
   * thấy nó thuộc pane nào, và đổi tab thì nó ẩn theo tab chứ không nằm đè lên tab khác.
   */
  inline?: boolean
}) {
  useEffect(() => {
    if (!onClose) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const closeLabel = useT()('common.close')
  // Không có lớp (cửa sổ tách rời #tunnels/#monitor không dựng App) → vẽ tại chỗ như trước.
  // Chốt MỘT LẦN lúc mount: đổi qua lại giữa tại-chỗ và portal là React remount nội dung → mất
  // những gì đang gõ (modal mở ngay lần render đầu, khi lớp chưa vào DOM, sẽ cứ ở tại chỗ).
  const [layer] = useState(() => (inline ? null : document.getElementById(MODAL_LAYER_ID)))

  const node = (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={closeOnBackdrop ? onClose : undefined}
    >
      {/* w-fit + min/max: form thường giữ tối thiểu 420px, nội dung rộng hơn (560–700px) tự nới ra, trần 92vw */}
      <div
        className={`bg-elevated flex max-h-[92vh] w-fit max-w-[92vw] min-w-[min(420px,92vw)] flex-col overflow-hidden rounded-lg border shadow-2xl ${
          danger ? 'border-danger' : 'border-edge-strong'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`flex shrink-0 items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold ${
            danger ? 'border-danger/60 text-danger' : 'border-edge text-content'
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {headerExtra}
          {/* Nút đóng nằm ở ĐÂY chứ không ở từng modal: trước đó không modal nào có, và những
              hộp thoại đặt `closeOnBackdrop={false}` (form dài, prompt bảo mật) thành ra không
              có đường đóng nào ngoài phím Esc — người không biết Esc thì bị kẹt hẳn. */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title={`${closeLabel} (Esc)`}
              aria-label={closeLabel}
              className="text-subtle hover:bg-hover hover:text-content -mr-1 shrink-0 rounded px-1.5 py-0.5 text-base leading-none"
            >
              ×
            </button>
          )}
        </div>
        <div className="overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
  )
  return layer ? createPortal(node, layer) : node
}

/**
 * Bọc nội dung một công cụ: mặc định là MODAL, `embedded` thì phẳng ra để nhúng vào tab.
 *
 * Vì sao cần: mấy công cụ dài (Tunnels, Tiến trình, Services, AI chẩn đoán) mở dạng popup thì
 * KHOÁ cả app — user không làm được việc khác trong lúc chờ. Mở trong tab giải quyết đúng chuyện
 * đó. Dùng 1 wrapper thay vì copy component ra bản thứ hai: sửa logic một chỗ, hai nơi cùng hưởng.
 */
export function ModalOrPanel({
  embedded = false,
  title,
  children,
  onClose,
  headerExtra,
  closeOnBackdrop = true
}: {
  embedded?: boolean
  title: string
  children: ReactNode
  onClose?: () => void
  headerExtra?: ReactNode
  closeOnBackdrop?: boolean
}) {
  // `@container`: danh sách bên trong tự xếp 2 cột khi vùng nhúng đủ rộng (`@3xl:grid-cols-2`) —
  // trang Navigator / tab công cụ thì 2 cột, panel phụ Workbench 200–520px thì vẫn 1 cột.
  if (embedded) return <div className="@container min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
  return (
    <Modal title={title} onClose={onClose} headerExtra={headerExtra} closeOnBackdrop={closeOnBackdrop}>
      {children}
    </Modal>
  )
}

/** Hộp xác nhận cho hành động phá huỷ (xoá host/key/file…) — backend xoá là vĩnh viễn. */
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useT()
  return (
    <Modal title={title} onClose={onCancel} danger>
      <div className="text-content mb-3 max-w-96 text-sm">{message}</div>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel ?? t('common.delete')}
        </Button>
      </div>
    </Modal>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-2.5 block">
      <span className="text-muted mb-1 block text-[11px] font-medium tracking-wide uppercase">{label}</span>
      {children}
    </label>
  )
}

export function TextInput(props: React.ComponentPropsWithRef<'input'>) {
  return (
    <input
      {...props}
      className={`border-edge-strong bg-input text-content placeholder-subtle focus:border-accent w-full rounded border px-2.5 py-1.5 text-sm outline-none ${props.className ?? ''}`}
    />
  )
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`border-edge-strong bg-input text-content placeholder-subtle focus:border-accent w-full rounded border px-2.5 py-1.5 font-mono text-xs outline-none ${props.className ?? ''}`}
    />
  )
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`border-edge-strong bg-input text-content focus:border-accent w-full rounded border px-2 py-1.5 text-sm outline-none ${props.className ?? ''}`}
    />
  )
}

export function Button({
  variant = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const styles = {
    default: 'border border-edge-strong text-muted hover:bg-hover',
    primary: 'bg-accent text-white hover:bg-accent-hover',
    danger: 'bg-danger text-white hover:opacity-90'
  }[variant]
  return (
    <button
      {...props}
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ''}`}
    />
  )
}
