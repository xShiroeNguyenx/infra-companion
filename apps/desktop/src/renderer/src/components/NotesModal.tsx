import type { HostDto } from '@infra/shared'
import { Button, Modal } from './ui'
import { useT } from '../i18n'

/** Xem nhanh ghi chú của host (read-only). Sửa thì mở host editor qua onEdit. */
export function NotesModal({ host, onEdit, onClose }: { host: HostDto; onEdit: () => void; onClose: () => void }) {
  const t = useT()
  return (
    <Modal title={`📝 ${host.label}`} onClose={onClose}>
      <div className="w-[min(460px,90vw)]">
        {host.notes ? (
          <pre className="border-edge bg-input/40 text-content max-h-[60vh] overflow-auto rounded border px-3 py-2 font-sans text-xs leading-relaxed break-words whitespace-pre-wrap">
            {host.notes}
          </pre>
        ) : (
          <p className="text-subtle text-xs">{t('host.notesEmpty')}</p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={onEdit}>{t('host.notesEdit')}</Button>
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
