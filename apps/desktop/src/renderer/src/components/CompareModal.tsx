import { CompareView } from './CompareView'
import { useTabsStore } from '../stores/tabs'
import { Modal } from './ui'
import { useT } from '../i18n'

/**
 * F49 — So sánh file config trên NHIỀU host SSH (popup). Nội dung nằm trong CompareView (dùng
 * chung với tab). Nút "Mở ở tab" chuyển sang xem toàn màn hình như tab server.
 */
export function CompareModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const openCompareTab = useTabsStore((s) => s.openCompareTab)
  return (
    <Modal
      title={t('compare.title')}
      onClose={onClose}
      headerExtra={
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-0.5 text-xs"
          onClick={() => {
            openCompareTab()
            onClose()
          }}
        >
          ⊞ {t('compare.openInTab')}
        </button>
      }
    >
      <div className="flex h-[70vh] w-[min(1100px,90vw)] max-w-full flex-col">
        <CompareView />
      </div>
    </Modal>
  )
}
