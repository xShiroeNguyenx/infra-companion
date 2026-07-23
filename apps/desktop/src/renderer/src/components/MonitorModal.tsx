import { useEffect, useMemo, useState } from 'react'
import type { MonitorSettingsDto, MonitorThresholdsDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useMonitorStore } from '../stores/monitor'
import { useTabsStore } from '../stores/tabs'
import { useToastsStore } from '../stores/toasts'
import { QuickChip, useQuickPickChips } from './quickPick'
import { Button, Modal } from './ui'
import { useT } from '../i18n'

const INPUT_CLS =
  'border-edge bg-input text-content placeholder-subtle focus:border-accent w-16 rounded border px-2 py-1 text-xs outline-none'

type PctKey = 'loadPct' | 'memPct' | 'diskPct' | 'stealPct' | 'connCount'
const PCT_KEYS: PctKey[] = ['loadPct', 'memPct', 'diskPct', 'stealPct', 'connCount']
// Load %/CPU không bị chặn 100 (server bận thường trực 300-400%+); conn là số tuyệt đối
const PCT_MAX: Record<PctKey, number> = { loadPct: 10_000, memPct: 100, diskPct: 100, stealPct: 100, connCount: 1_000_000 }
const PCT_LABEL: Record<PctKey, string> = {
  loadPct: 'Load %',
  memPct: 'RAM %',
  diskPct: 'Disk %',
  stealPct: 'Steal %',
  connCount: 'Conn'
}

/** '' = null (tắt / kế thừa); số thì kẹp 0-max. */
function parsePct(raw: string, max: number): number | null {
  const v = raw.trim()
  if (v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(0, Math.round(n)))
}

/** Monitoring (F04): form chọn host + ngưỡng cảnh báo. Bấm bắt đầu → đóng modal,
 *  dashboard hiện ở MonitorDock (neo góc phải, sống độc lập với modal toàn cục). */
export function MonitorModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const push = useToastsStore((s) => s.push)
  const allHosts = useDataStore((s) => s.hosts)
  const hosts = useMemo(() => allHosts.filter((h) => h.protocol === 'ssh'), [allHosts])
  // Đang theo dõi dở → tick sẵn tập host đó, sửa rồi start lại là THAY tập cũ
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(Object.keys(useMonitorStore.getState().data))
  )

  const { groupChips, wsChips } = useQuickPickChips(hosts)

  /** Chọn nhanh 1 nhóm/workspace: đã chọn hết → bỏ chọn cả cụm; chưa → thêm cả cụm. */
  const toggleMany = (ids: string[]): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      const allOn = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allOn) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }
  const [settings, setSettings] = useState<MonitorSettingsDto | null>(null)
  const [showPerHost, setShowPerHost] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void window.infra.monitor.getSettings().then(setSettings)
  }, [])

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setDefault = (key: keyof MonitorThresholdsDto, value: number | null | boolean): void => {
    setSettings((s) => (s ? { ...s, defaults: { ...s.defaults, [key]: value } } : s))
  }

  /** Override per-host: input trống = kế thừa defaults (xoá key), số = override. */
  const setOverride = (hostId: string, key: PctKey, raw: string): void => {
    setSettings((s) => {
      if (!s) return s
      const perHost = { ...s.perHost }
      const over = { ...(perHost[hostId] ?? {}) }
      const v = parsePct(raw, PCT_MAX[key])
      if (raw.trim() === '' || v === null) delete over[key]
      else over[key] = v
      if (Object.keys(over).length === 0) delete perHost[hostId]
      else perHost[hostId] = over
      return { ...s, perHost }
    })
  }

  const persist = async (): Promise<void> => {
    if (settings) await window.infra.monitor.setSettings(settings)
  }

  const save = async (): Promise<void> => {
    await persist()
    push(t('monitor.thresholdsSaved'), 'info')
  }

  const testWebhook = async (): Promise<void> => {
    if (!settings?.webhookUrl) return
    setTesting(true)
    try {
      const res = await window.infra.monitor.testWebhook(settings.webhookUrl)
      push(res.message, res.ok ? 'info' : 'error')
    } finally {
      setTesting(false)
    }
  }

  const start = async (): Promise<void> => {
    if (selected.size === 0) return
    const picked = hosts.filter((h) => selected.has(h.id)).map((h) => ({ id: h.id, label: h.label }))
    await persist() // ngưỡng đang nhập có hiệu lực ngay cho phiên theo dõi này
    onClose()
    await useMonitorStore.getState().start(picked)
  }

  /** Bắt đầu theo dõi VÀ mở thành 1 tab riêng (thay vì dock góc phải) — chart/chữ to, dễ xem. */
  const startInTab = async (): Promise<void> => {
    if (selected.size === 0) return
    const picked = hosts.filter((h) => selected.has(h.id)).map((h) => ({ id: h.id, label: h.label }))
    await persist()
    onClose()
    useTabsStore.getState().openMonitorTab()
    await useMonitorStore.getState().start(picked)
  }

  const selectedHosts = hosts.filter((h) => selected.has(h.id))

  return (
    <Modal title={t('monitor.title')} onClose={onClose}>
      <div className="w-[700px] max-w-full">
        <div className="mb-2 flex items-center justify-between text-[11px] text-subtle">
          <span>{t('monitor.choose', { n: selected.size })}</span>
          <button className="hover:text-content" onClick={() => setSelected(new Set(hosts.map((h) => h.id)))}>
            {t('bulk.selectAll')}
          </button>
        </div>

        {(groupChips.length > 0 || wsChips.length > 0) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-subtle mr-0.5 text-[10px] tracking-wider uppercase">{t('monitor.quickPick')}</span>
            {groupChips.map((g) => (
              <QuickChip
                key={`g-${g.id}`}
                label={g.name}
                count={g.hostIds.length}
                active={g.hostIds.every((id) => selected.has(id))}
                title={t('sidebar.openGroup', { n: g.hostIds.length })}
                onClick={() => toggleMany(g.hostIds)}
              />
            ))}
            {wsChips.map((ws) => (
              <QuickChip
                key={`w-${ws.id}`}
                label={`🗂 ${ws.name}`}
                count={ws.hostIds.length}
                active={ws.hostIds.every((id) => selected.has(id))}
                title={t('monitor.pickWorkspace', { n: ws.hostIds.length })}
                onClick={() => toggleMany(ws.hostIds)}
              />
            ))}
          </div>
        )}

        <div className="mb-3 grid max-h-40 grid-cols-3 gap-x-3 gap-y-0.5 overflow-y-auto rounded border border-edge bg-input p-2">
          {hosts.map((host) => (
            <label key={host.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-content select-none">
              <input type="checkbox" checked={selected.has(host.id)} onChange={() => toggle(host.id)} />
              <span className="truncate">{host.label}</span>
            </label>
          ))}
          {hosts.length === 0 && <span className="col-span-3 py-2 text-center text-xs text-subtle">{t('bulk.noSsh')}</span>}
        </div>

        {settings && (
          <div className="border-edge mb-3 rounded border p-3">
            <div className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
              ⚠ {t('monitor.thresholds')}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-content">
              {PCT_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-1.5">
                  {PCT_LABEL[key]}
                  <input
                    className={INPUT_CLS}
                    inputMode="numeric"
                    placeholder={t('monitor.thresholdOff')}
                    value={settings.defaults[key] ?? ''}
                    onChange={(e) => setDefault(key, parsePct(e.target.value, PCT_MAX[key]))}
                  />
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-1.5 select-none">
                <input
                  type="checkbox"
                  checked={settings.defaults.offline}
                  onChange={(e) => setDefault('offline', e.target.checked)}
                />
                {t('monitor.thresholdOffline')}
              </label>
            </div>
            <p className="text-subtle mt-1.5 text-[10px]">{t('monitor.thresholdsHint')}</p>

            {selectedHosts.length > 0 && (
              <div className="mt-2">
                <button
                  className="text-accent text-[11px] hover:underline"
                  onClick={() => setShowPerHost((v) => !v)}
                >
                  {showPerHost ? '▾' : '▸'} {t('monitor.perHostOverrides')}
                </button>
                {showPerHost && (
                  <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
                    {selectedHosts.map((host) => (
                      <div key={host.id} className="flex items-center gap-2 text-[11px]">
                        <span className="text-muted w-32 shrink-0 truncate">{host.label}</span>
                        {PCT_KEYS.map((key) => (
                          <input
                            key={key}
                            className={INPUT_CLS}
                            inputMode="numeric"
                            placeholder={String(settings.defaults[key] ?? '—')}
                            title={PCT_LABEL[key]}
                            value={settings.perHost[host.id]?.[key] ?? ''}
                            onChange={(e) => setOverride(host.id, key, e.target.value)}
                          />
                        ))}
                      </div>
                    ))}
                    <p className="text-subtle text-[10px]">{t('monitor.perHostHint')}</p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className="border-edge bg-input text-content placeholder-subtle focus:border-accent min-w-0 flex-1 rounded border px-2 py-1 text-xs outline-none"
                placeholder={t('monitor.webhookPlaceholder')}
                value={settings.webhookUrl}
                onChange={(e) => setSettings((s) => (s ? { ...s, webhookUrl: e.target.value } : s))}
              />
              <Button
                className="!px-2 !py-1 !text-xs"
                disabled={!settings.webhookUrl.trim() || testing}
                onClick={() => void testWebhook()}
              >
                {testing ? '…' : t('monitor.webhookTest')}
              </Button>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-content select-none">
                <input
                  type="checkbox"
                  checked={settings.osNotify}
                  onChange={(e) => setSettings((s) => (s ? { ...s, osNotify: e.target.checked } : s))}
                />
                {t('monitor.osNotify')}
              </label>
            </div>
          </div>
        )}

        <p className="mb-3 text-[11px] text-subtle">
          {t('monitor.note')}
        </p>
        <div className="flex justify-end gap-2">
          {settings && (
            <Button onClick={() => void save()}>{t('monitor.saveThresholds')}</Button>
          )}
          <Button disabled={selected.size === 0} onClick={() => void startInTab()}>
            {t('monitor.startInTab')}
          </Button>
          <Button variant="primary" disabled={selected.size === 0} onClick={() => void start()}>
            {t('monitor.start', { n: selected.size })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

