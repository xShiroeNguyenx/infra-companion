import { useT } from '../i18n'
import { useSettingsStore, type Language, type ThemeMode } from '../stores/settings'
import { Field, Modal } from './ui'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { theme, language, setTheme, setLanguage } = useSettingsStore()

  const themeOptions: Array<{ value: ThemeMode; label: string; swatch: string }> = [
    { value: 'dark', label: t('settings.themeDark'), swatch: '#0b0e14' },
    { value: 'light', label: t('settings.themeLight'), swatch: '#f4f5f7' }
  ]

  const langOptions: Array<{ value: Language; label: string }> = [
    { value: 'vi', label: t('settings.langVi') },
    { value: 'en', label: t('settings.langEn') },
    { value: 'ja', label: t('settings.langJa') }
  ]

  return (
    <Modal title={t('settings.title')} onClose={onClose}>
      <div className="w-[min(440px,88vw)]">
        <div className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
          {t('settings.appearance')}
        </div>

        <Field label={t('settings.theme')}>
          <div className="grid grid-cols-2 gap-2">
            {themeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                  theme === opt.value
                    ? 'border-accent text-content bg-accent-soft/40'
                    : 'border-edge text-muted hover:bg-hover'
                }`}
              >
                <span
                  className="border-edge-strong size-4 shrink-0 rounded-full border"
                  style={{ background: opt.swatch }}
                />
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('settings.language')}>
          <div className="grid grid-cols-3 gap-2">
            {langOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLanguage(opt.value)}
                className={`rounded border px-3 py-2 text-sm ${
                  language === opt.value
                    ? 'border-accent text-content bg-accent-soft/40'
                    : 'border-edge text-muted hover:bg-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  )
}
