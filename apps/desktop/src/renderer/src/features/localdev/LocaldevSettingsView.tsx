import { useEffect } from 'react'
import { useLocaldevStore } from '../../stores/localdev'
import { Field, TextInput } from '../../components/ui'
import { useT } from '../../i18n'

/**
 * Form cài đặt Local dev — layout-neutral (dùng được cả trong Settings toàn màn hình lẫn
 * modal riêng mở từ tab), theo đúng khuôn CompareView + 2 wrapper mỏng.
 *
 * Chứa TOGGLE TỔNG (mặc định TẮT): tắt thì mọi entry point của tính năng bị ẩn hoàn toàn —
 * đây là phòng thủ chính chống "loãng UI" cho user chỉ dùng Infra để SSH.
 */
export function LocaldevSettingsView() {
  const t = useT()
  const enabled = useLocaldevStore((s) => s.enabled)
  const settings = useLocaldevStore((s) => s.settings)
  const setEnabled = useLocaldevStore((s) => s.setEnabled)
  const saveSettings = useLocaldevStore((s) => s.saveSettings)

  // Mở được cả khi tính năng đang tắt (đây chính là nơi để bật) → phải tự nạp settings.
  useEffect(() => {
    if (settings) return
    void window.infra.localdev
      .settingsGet()
      .then((s) => useLocaldevStore.setState({ settings: s, enabled: s.enabled }))
      .catch(() => {
        /* để trống — form chờ, không làm ồn */
      })
  }, [settings])

  const pickRoot = async (): Promise<void> => {
    const dir = await window.infra.localdev.sitePickFolder()
    if (dir) await saveSettings({ root: dir })
  }

  const patchLocal = (patch: Partial<NonNullable<typeof settings>>): void => {
    if (settings) useLocaldevStore.setState({ settings: { ...settings, ...patch } })
  }

  return (
    <>
      <Field label={t('settings.localdevEnable')}>
        <div className="grid grid-cols-2 gap-2">
          {([true, false] as const).map((on) => (
            <button
              key={String(on)}
              onClick={() => void setEnabled(on)}
              className={`rounded border px-2 py-2 text-sm ${
                enabled === on
                  ? 'border-accent text-content bg-accent-soft/40'
                  : 'border-edge text-muted hover:bg-hover'
              }`}
            >
              {on ? t('plugins.enable') : t('plugins.disable')}
            </button>
          ))}
        </div>
        <p className="text-subtle mt-1 text-[11px] leading-relaxed">{t('settings.localdevHint')}</p>
      </Field>

      {settings && (
        <>
          <Field label={t('settings.localdevRoot')}>
            <div className="flex gap-2">
              <TextInput
                value={settings.root}
                onChange={(e) => patchLocal({ root: e.target.value })}
                onBlur={(e) => void saveSettings({ root: e.target.value })}
                className="!font-mono !text-xs"
              />
              <button
                onClick={() => void pickRoot()}
                className="border-edge text-muted hover:bg-hover shrink-0 rounded border px-3 text-sm"
                title={t('localdev.openFolder')}
              >
                …
              </button>
            </div>
            <p className="text-subtle mt-1 text-[11px] leading-relaxed">{t('settings.localdevRootHint')}</p>
          </Field>

          <Field label={t('settings.localdevPorts')}>
            <div className="flex items-center gap-2">
              <TextInput
                className="!w-24 !text-xs"
                inputMode="numeric"
                value={String(settings.httpPortFrom)}
                onChange={(e) => patchLocal({ httpPortFrom: Number(e.target.value) || 0 })}
                onBlur={() => void saveSettings({ httpPortFrom: settings.httpPortFrom })}
              />
              <span className="text-subtle text-xs">–</span>
              <TextInput
                className="!w-24 !text-xs"
                inputMode="numeric"
                value={String(settings.httpPortTo)}
                onChange={(e) => patchLocal({ httpPortTo: Number(e.target.value) || 0 })}
                onBlur={() => void saveSettings({ httpPortTo: settings.httpPortTo })}
              />
            </div>
            <p className="text-subtle mt-1 text-[11px] leading-relaxed">{t('settings.localdevPortsHint')}</p>
          </Field>

          <Field label={t('settings.localdevPort80')}>
            <div className="grid grid-cols-2 gap-2">
              {([false, true] as const).map((on) => (
                <button
                  key={String(on)}
                  onClick={() => void saveSettings({ usePort80: on })}
                  className={`rounded border px-2 py-2 text-sm ${
                    settings.usePort80 === on
                      ? 'border-accent text-content bg-accent-soft/40'
                      : 'border-edge text-muted hover:bg-hover'
                  }`}
                >
                  {on ? t('plugins.enable') : t('plugins.disable')}
                </button>
              ))}
            </div>
            <p className="text-subtle mt-1 text-[11px] leading-relaxed">{t('settings.localdevPort80Hint')}</p>
          </Field>

          <Field label={`${t('settings.localdevPhpPool')} — ${settings.phpPoolSize}`}>
            <input
              type="range"
              min={1}
              max={16}
              step={1}
              value={settings.phpPoolSize}
              onChange={(e) => patchLocal({ phpPoolSize: Number(e.target.value) })}
              onMouseUp={() => void saveSettings({ phpPoolSize: settings.phpPoolSize })}
              className="accent-accent w-full"
            />
            <p className="text-subtle mt-1 text-[11px] leading-relaxed">{t('settings.localdevPhpPoolHint')}</p>
          </Field>

          <Field label={t('settings.localdevAutoStart')}>
            <div className="grid grid-cols-2 gap-2">
              {([false, true] as const).map((on) => (
                <button
                  key={String(on)}
                  onClick={() => void saveSettings({ autoStart: on })}
                  className={`rounded border px-2 py-2 text-sm ${
                    settings.autoStart === on
                      ? 'border-accent text-content bg-accent-soft/40'
                      : 'border-edge text-muted hover:bg-hover'
                  }`}
                >
                  {on ? t('plugins.enable') : t('plugins.disable')}
                </button>
              ))}
            </div>
            <p className="text-subtle mt-1 text-[11px]">{t('settings.localdevAutoStartHint')}</p>
          </Field>
        </>
      )}
    </>
  )
}
