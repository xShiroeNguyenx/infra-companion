import { useState } from 'react'
import { useDataStore } from '../stores/data'
import { useMonitorStore } from '../stores/monitor'
import { Button, Modal } from './ui'
import { useT } from '../i18n'

/** Monitoring (F04): modal này CHỈ là form chọn host. Bấm bắt đầu → đóng modal,
 *  dashboard hiện ở MonitorDock (neo góc phải, sống độc lập với modal toàn cục). */
export function MonitorModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  // Đang theo dõi dở → tick sẵn tập host đó, sửa rồi start lại là THAY tập cũ
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(Object.keys(useMonitorStore.getState().data))
  )

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const start = async (): Promise<void> => {
    if (selected.size === 0) return
    const picked = hosts.filter((h) => selected.has(h.id)).map((h) => ({ id: h.id, label: h.label }))
    onClose()
    await useMonitorStore.getState().start(picked)
  }

  return (
    <Modal title={t('monitor.title')} onClose={onClose}>
      <div className="w-[700px] max-w-full">
        <div className="mb-2 flex items-center justify-between text-[11px] text-subtle">
          <span>{t('monitor.choose', { n: selected.size })}</span>
          <button className="hover:text-content" onClick={() => setSelected(new Set(hosts.map((h) => h.id)))}>
            {t('bulk.selectAll')}
          </button>
        </div>
        <div className="mb-3 grid max-h-40 grid-cols-3 gap-x-3 gap-y-0.5 overflow-y-auto rounded border border-edge bg-input p-2">
          {hosts.map((host) => (
            <label key={host.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-content select-none">
              <input type="checkbox" checked={selected.has(host.id)} onChange={() => toggle(host.id)} />
              <span className="truncate">{host.label}</span>
            </label>
          ))}
          {hosts.length === 0 && <span className="col-span-3 py-2 text-center text-xs text-subtle">{t('bulk.noSsh')}</span>}
        </div>
        <p className="mb-3 text-[11px] text-subtle">
          {t('monitor.note')}
        </p>
        <div className="flex justify-end">
          <Button variant="primary" disabled={selected.size === 0} onClick={() => void start()}>
            {t('monitor.start', { n: selected.size })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
