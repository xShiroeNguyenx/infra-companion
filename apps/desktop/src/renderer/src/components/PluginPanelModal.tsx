import type { PluginPanelDto } from '@infra/shared'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { Button, Modal } from './ui'

/** Panel hiển thị nội dung do plugin tạo (markdown hoặc text thuần). */
export function PluginPanelModal({ panel, onClose }: { panel: PluginPanelDto; onClose: () => void }) {
  const t = useT()
  return (
    <Modal title={panel.title} onClose={onClose}>
      <div className="w-[560px] max-w-full">
        <div className="max-h-[60vh] overflow-y-auto">
          {panel.markdown !== undefined ? (
            <MiniMarkdown source={panel.markdown} />
          ) : (
            <pre className="text-content whitespace-pre-wrap break-words text-xs">{panel.text ?? ''}</pre>
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={onClose}>{t('panel.close')}</Button>
        </div>
      </div>
    </Modal>
  )
}
