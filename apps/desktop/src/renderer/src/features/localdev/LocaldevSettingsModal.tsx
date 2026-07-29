import { LocaldevSettingsView } from './LocaldevSettingsView'
import { Button, Modal } from '../../components/ui'
import { useT } from '../../i18n'

/** Wrapper mỏng: mở form cài đặt Local dev từ trong tab (nút ⚙) mà không phải rời tab. */
export function LocaldevSettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <Modal title={`🧱 ${t('settings.localdev')}`} onClose={onClose} closeOnBackdrop={false}>
      <div className="flex w-[min(620px,90vw)] max-w-full flex-col">
        <LocaldevSettingsView />
        <div className="mt-2 flex justify-end">
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Modal>
  )
}
