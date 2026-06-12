import { useEffect, type ReactNode } from 'react'

export function Modal({
  title,
  children,
  onClose,
  danger = false,
  closeOnBackdrop = true
}: {
  title: string
  children: ReactNode
  onClose?: () => void
  danger?: boolean
  /** false cho form dài / prompt bảo mật — misclick backdrop không làm mất dữ liệu đang nhập. */
  closeOnBackdrop?: boolean
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
        className={`flex max-h-[92vh] w-fit max-w-[92vw] min-w-[min(420px,92vw)] flex-col overflow-hidden rounded-lg border bg-zinc-900 shadow-2xl ${
          danger ? 'border-red-700' : 'border-zinc-700'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`shrink-0 border-b px-4 py-2.5 text-sm font-semibold ${
            danger ? 'border-red-800 text-red-400' : 'border-zinc-800 text-zinc-200'
          }`}
        >
          {title}
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
  confirmLabel = 'Xoá',
  onConfirm,
  onCancel
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal title={title} onClose={onCancel} danger>
      <div className="mb-3 max-w-96 text-sm text-zinc-300">{message}</div>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Huỷ</Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 block text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{label}</span>
      {children}
    </label>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-blue-500 ${props.className ?? ''}`}
    />
  )
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-blue-500 ${props.className ?? ''}`}
    />
  )
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-blue-500 ${props.className ?? ''}`}
    />
  )
}

export function Button({
  variant = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const styles = {
    default: 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800',
    primary: 'bg-blue-600 text-white hover:bg-blue-500',
    danger: 'bg-red-700 text-white hover:bg-red-600'
  }[variant]
  return (
    <button
      {...props}
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ''}`}
    />
  )
}
