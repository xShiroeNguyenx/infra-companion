import { useState } from 'react'
import { useT, type I18nKey } from '../i18n'
import { CUSTOM_PALETTE_VARS, useSettingsStore, type PaletteVar } from '../stores/settings'
import { useToastsStore } from '../stores/toasts'
import { Button } from './ui'

const LABEL_KEY: Record<PaletteVar, I18nKey> = {
  '--c-app': 'theme.color.app',
  '--c-panel': 'theme.color.panel',
  '--c-elevated': 'theme.color.elevated',
  '--c-input': 'theme.color.input',
  '--c-hover': 'theme.color.hover',
  '--c-edge-strong': 'theme.color.border',
  '--c-content': 'theme.color.content',
  '--c-muted': 'theme.color.muted',
  '--c-danger': 'theme.color.danger',
  '--c-success': 'theme.color.success',
  '--c-warning': 'theme.color.warning'
}

/** Màu đang hiệu lực của 1 biến (override nếu có, không thì mặc định theo theme). */
function effectiveColor(v: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(v).trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : '#000000'
}

/** Tuỳ biến bảng màu UI theo base theme + xuất/nhập theme (JSON). Gập lại mặc định. */
export function CustomPaletteSection() {
  const t = useT()
  const theme = useSettingsStore((s) => s.theme)
  const customColors = useSettingsStore((s) => s.customColors)
  const setCustomColor = useSettingsStore((s) => s.setCustomColor)
  const resetCustomColors = useSettingsStore((s) => s.resetCustomColors)
  const exportThemeJson = useSettingsStore((s) => s.exportThemeJson)
  const importThemeJson = useSettingsStore((s) => s.importThemeJson)
  const push = useToastsStore((s) => s.push)
  const [ioOpen, setIoOpen] = useState(false)
  const [ioText, setIoText] = useState('')

  const overrides = customColors[theme]

  const openIo = (): void => {
    setIoText(exportThemeJson())
    setIoOpen(true)
  }
  const applyIo = (): void => {
    push(importThemeJson(ioText) ? t('settings.themeImportOk') : t('settings.themeImportErr'))
  }

  return (
    <details className="border-edge mb-2.5 rounded border">
      <summary className="text-muted cursor-pointer px-2.5 py-1.5 text-[11px] font-medium tracking-wide uppercase">
        {t('settings.customPalette')}
      </summary>
      <div className="px-2.5 pb-2.5">
        <p className="text-subtle mb-2 text-[10px] leading-relaxed">{t('settings.customPaletteHint')}</p>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {CUSTOM_PALETTE_VARS.map((v) => {
            const overridden = overrides[v] !== undefined
            return (
              <label key={v} className="flex items-center gap-2">
                <input
                  type="color"
                  value={effectiveColor(v)}
                  onChange={(e) => setCustomColor(v, e.target.value)}
                  className="border-edge-strong h-6 w-8 shrink-0 cursor-pointer rounded border bg-transparent"
                />
                <span className={`flex-1 truncate text-xs ${overridden ? 'text-content' : 'text-muted'}`}>
                  {t(LABEL_KEY[v])}
                </span>
                {overridden && (
                  <button
                    className="text-subtle hover:text-content shrink-0 text-[11px]"
                    onClick={() => setCustomColor(v, null)}
                  >
                    ✕
                  </button>
                )}
              </label>
            )
          })}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button className="!px-2 !py-1 !text-xs" onClick={resetCustomColors}>
            {t('settings.customReset')}
          </Button>
          <Button className="!px-2 !py-1 !text-xs" onClick={() => (ioOpen ? setIoOpen(false) : openIo())}>
            {t('settings.themeIO')}
          </Button>
        </div>

        {ioOpen && (
          <div className="mt-2">
            <textarea
              value={ioText}
              onChange={(e) => setIoText(e.target.value)}
              spellCheck={false}
              className="border-edge-strong bg-input text-content h-32 w-full rounded border px-2 py-1.5 font-mono text-[10px] outline-none"
            />
            <div className="mt-1.5 flex gap-2">
              <Button className="!px-2 !py-1 !text-xs" variant="primary" onClick={applyIo}>
                {t('settings.themeImport')}
              </Button>
              <Button className="!px-2 !py-1 !text-xs" onClick={() => void navigator.clipboard.writeText(ioText)}>
                {t('settings.themeCopy')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </details>
  )
}
