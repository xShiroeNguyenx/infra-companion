import { useEffect, useState } from 'react'
import type { ReplSettingsDto, ReplThresholdsDto } from '@infra/shared'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { Button, Field, Modal, TextInput } from './ui'
import { useT } from '../i18n'

/**
 * F55 — Ngưỡng cảnh báo replication (mức mặc định, áp cho mọi cặp).
 *
 * Ngưỡng nằm ngoài vault (repl-settings.json) nên cảnh báo vẫn chạy khi vault tự khoá sau 15
 * phút. Ô số để trống = TẮT metric đó, không phải "0".
 */
export function ReplicationSettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [settings, setSettings] = useState<ReplSettingsDto | null>(null)
  const [lagSec, setLagSec] = useState('')
  const [applyGapMb, setApplyGapMb] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await window.infra.replication.getSettings()
      setSettings(s)
      setLagSec(s.defaults.lagSec === null ? '' : String(s.defaults.lagSec))
      // Lưu bằng byte nhưng nhập bằng MB — không ai muốn gõ 67108864
      setApplyGapMb(s.defaults.applyGapBytes === null ? '' : String(Math.round(s.defaults.applyGapBytes / 1024 / 1024)))
    })()
  }, [])

  if (!settings) return null

  const setFlag = (key: keyof Pick<ReplThresholdsDto, 'threads' | 'error' | 'writable' | 'probe'>, on: boolean): void =>
    setSettings({ ...settings, defaults: { ...settings.defaults, [key]: on } })

  /** Ô trống = tắt (null). Số rác cũng về null thay vì 0 — 0 nghĩa là "báo mọi lúc". */
  const parseOrNull = (text: string, scale = 1): number | null => {
    const trimmed = text.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) && n >= 0 ? Math.round(n * scale) : null
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.infra.replication.setSettings({
        ...settings,
        defaults: {
          ...settings.defaults,
          lagSec: parseOrNull(lagSec),
          applyGapBytes: parseOrNull(applyGapMb, 1024 * 1024)
        }
      })
      onClose()
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('repl.settings.title')} onClose={onClose} closeOnBackdrop={false}>
      <div className="w-[480px] max-w-full">
        <p className="text-subtle mb-3 text-[11px] leading-relaxed">{t('repl.settings.intro')}</p>

        <div className="grid grid-cols-2 gap-x-3">
          <Field label={t('repl.settings.lagSec')}>
            <TextInput
              value={lagSec}
              inputMode="numeric"
              placeholder={t('repl.settings.offPh')}
              onChange={(e) => setLagSec(e.target.value)}
            />
          </Field>
          <Field label={t('repl.settings.applyGapMb')}>
            <TextInput
              value={applyGapMb}
              inputMode="numeric"
              placeholder={t('repl.settings.offPh')}
              onChange={(e) => setApplyGapMb(e.target.value)}
            />
          </Field>
        </div>

        <div className="mb-3 flex flex-col gap-1.5">
          <Toggle
            label={t('repl.settings.threads')}
            checked={settings.defaults.threads}
            onChange={(v) => setFlag('threads', v)}
          />
          <Toggle label={t('repl.settings.error')} checked={settings.defaults.error} onChange={(v) => setFlag('error', v)} />
          <Toggle
            label={t('repl.settings.writable')}
            checked={settings.defaults.writable}
            onChange={(v) => setFlag('writable', v)}
          />
          <Toggle label={t('repl.settings.probe')} checked={settings.defaults.probe} onChange={(v) => setFlag('probe', v)} />
        </div>

        <Field label={t('repl.settings.webhook')}>
          <TextInput
            value={settings.webhookUrl}
            placeholder="https://hooks.slack.com/… · https://chat.googleapis.com/… · Discord · Telegram"
            onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })}
          />
        </Field>
        <div className="mb-3">
          <Toggle
            label={t('repl.settings.osNotify')}
            checked={settings.osNotify}
            onChange={(v) => setSettings({ ...settings, osNotify: v })}
          />
        </div>

        <p className="text-subtle mb-3 text-[10px] leading-relaxed">{t('repl.settings.note')}</p>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? '…' : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="text-muted flex cursor-pointer items-center gap-2 text-xs select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
