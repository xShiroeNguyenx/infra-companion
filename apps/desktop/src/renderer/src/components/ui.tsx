import { useEffect, type ReactNode } from 'react'
import { useT } from '../i18n'

export function Modal({
  title,
  children,
  onClose,
  danger = false,
  closeOnBackdrop = true,
  headerExtra
}: {
  title: string
  children: ReactNode
  onClose?: () => void
  danger?: boolean
  /** false cho form dài / prompt bảo mật — misclick backdrop không làm mất dữ liệu đang nhập. */
  closeOnBackdrop?: boolean
  /** Nút phụ neo bên phải header (vd nút thu nhỏ). */
  headerExtra?: ReactNode
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

  return (
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
        </div>
        <div className="overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
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

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
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
