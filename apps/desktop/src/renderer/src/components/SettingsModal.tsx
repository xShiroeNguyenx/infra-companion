import { useRef, useState } from 'react'
import { useT } from '../i18n'
import {
  TERM_FONT_DEFAULT,
  useSettingsStore,
  type BgFit,
  type BgPosition,
  type Language,
  type StartupPage,
  type TermCursor,
  type ThemeMode
} from '../stores/settings'
import { useToastsStore } from '../stores/toasts'
import { CustomPaletteSection } from './CustomPaletteSection'
import { Field, Modal, TextInput } from './ui'

/** Cạnh tối đa khi nén ảnh nền — đủ nét cho màn 4K, đủ nhỏ để vừa localStorage. */
const MAX_DIM = 2560
const JPEG_QUALITY = 0.82

/** Downscale 1 ảnh (cho qua src data/blob URL) về data URL JPEG gọn nhẹ. */
function downscaleSrc(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onerror = () => reject(new Error('decode failed'))
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('no 2d context'))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
    }
    img.src = src
  })
}

/** Đọc + downscale ảnh từ file local về data URL JPEG (giữ localStorage gọn, ~<1.5MB). */
function downscaleToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => downscaleSrc(reader.result as string).then(resolve, reject)
    reader.readAsDataURL(file)
  })
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const {
    theme,
    language,
    accentColor,
    backgroundImage,
    backgroundOpacity,
    backgroundBlur,
    backgroundPosition,
    backgroundFit,
    termFontFamily,
    termFontSize,
    termLineHeight,
    termCursor,
    startupPage,
    setTheme,
    setLanguage,
    setAccentColor,
    setBackgroundImage,
    setBackgroundOpacity,
    setBackgroundBlur,
    setBackgroundPosition,
    setBackgroundFit,
    setTermFontFamily,
    setTermFontSize,
    setTermLineHeight,
    setTermCursor,
    setStartupPage
  } = useSettingsStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const push = useToastsStore((s) => s.push)
  const [bgUrl, setBgUrl] = useState('')
  const [fetchingUrl, setFetchingUrl] = useState(false)

  const cursorOptions: Array<{ value: TermCursor; label: string }> = [
    { value: 'block', label: t('settings.termCursorBlock') },
    { value: 'bar', label: t('settings.termCursorBar') },
    { value: 'underline', label: t('settings.termCursorUnderline') }
  ]

  const positionOptions: Array<{ value: BgPosition; label: string }> = [
    { value: 'center', label: t('settings.bgPosCenter') },
    { value: 'left', label: t('settings.bgPosLeft') },
    { value: 'right', label: t('settings.bgPosRight') },
    { value: 'top', label: t('settings.bgPosTop') },
    { value: 'bottom', label: t('settings.bgPosBottom') }
  ]

  const fitOptions: Array<{ value: BgFit; label: string }> = [
    { value: 'cover', label: t('settings.bgFitCover') },
    { value: 'contain', label: t('settings.bgFitContain') }
  ]

  const themeOptions: Array<{ value: ThemeMode; label: string; swatch: string }> = [
    { value: 'dark', label: t('settings.themeDark'), swatch: '#0b0e14' },
    { value: 'light', label: t('settings.themeLight'), swatch: '#f4f5f7' }
  ]

  const startupOptions: Array<{ value: StartupPage; label: string }> = [
    { value: 'dashboard', label: t('settings.startupDashboard') },
    { value: 'terminal', label: t('settings.startupTerminal') }
  ]

  const langOptions: Array<{ value: Language; label: string }> = [
    { value: 'vi', label: t('settings.langVi') },
    { value: 'en', label: t('settings.langEn') },
    { value: 'ja', label: t('settings.langJa') }
  ]

  const onPickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const dataUrl = await downscaleToDataUrl(file)
      if (!setBackgroundImage(dataUrl)) push(t('settings.bgTooLarge'))
    } catch {
      push(t('settings.bgError'))
    }
  }

  const onAddUrl = async (): Promise<void> => {
    const url = bgUrl.trim()
    if (!url || fetchingUrl) return
    setFetchingUrl(true)
    try {
      const raw = await window.infra.net.fetchImage(url) // tải ở main → tránh CORS
      const dataUrl = await downscaleSrc(raw) // nén lại như ảnh local
      if (setBackgroundImage(dataUrl)) setBgUrl('')
      else push(t('settings.bgTooLarge'))
    } catch {
      push(t('settings.bgUrlError'))
    } finally {
      setFetchingUrl(false)
    }
  }

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

        <Field label={t('settings.startupPage')}>
          <div className="grid grid-cols-2 gap-2">
            {startupOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStartupPage(opt.value)}
                className={`rounded border px-3 py-2 text-sm ${
                  startupPage === opt.value
                    ? 'border-accent text-content bg-accent-soft/40'
                    : 'border-edge text-muted hover:bg-hover'
                }`}
              >
                {opt.value === 'dashboard' ? '🏠 ' : '>_ '}
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('settings.accent')}>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={accentColor ?? '#2563eb'}
              onChange={(e) => setAccentColor(e.target.value)}
              className="border-edge-strong h-8 w-12 shrink-0 cursor-pointer rounded border bg-transparent"
              title={t('settings.accent')}
            />
            <span className="text-muted flex-1 font-mono text-xs">{accentColor ?? t('settings.accentDefault')}</span>
            {accentColor && (
              <button
                onClick={() => setAccentColor(null)}
                className="border-edge text-muted hover:bg-hover rounded border px-3 py-1.5 text-sm"
              >
                {t('settings.accentReset')}
              </button>
            )}
          </div>
        </Field>

        <CustomPaletteSection />

        <Field label={t('settings.background')}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void onPickFile(e.target.files?.[0])
              e.target.value = '' // cho chọn lại cùng file
            }}
          />
          <div className="flex items-center gap-2">
            {backgroundImage && (
              <div
                className="border-edge-strong size-12 shrink-0 rounded border bg-cover bg-center"
                style={{ backgroundImage: `url(${backgroundImage})` }}
              />
            )}
            <button
              onClick={() => fileRef.current?.click()}
              className="border-edge text-muted hover:bg-hover flex-1 rounded border px-3 py-2 text-sm"
            >
              {backgroundImage ? t('settings.bgChange') : t('settings.bgChoose')}
            </button>
            {backgroundImage && (
              <button
                onClick={() => setBackgroundImage(null)}
                className="border-edge text-muted hover:bg-hover hover:text-danger rounded border px-3 py-2 text-sm"
              >
                {t('settings.bgRemove')}
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <TextInput
              type="url"
              value={bgUrl}
              placeholder={t('settings.bgUrlPlaceholder')}
              disabled={fetchingUrl}
              onChange={(e) => setBgUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void onAddUrl()
                }
              }}
            />
            <button
              onClick={() => void onAddUrl()}
              disabled={fetchingUrl || !bgUrl.trim()}
              className="border-edge text-muted hover:bg-hover shrink-0 rounded border px-3 py-2 text-sm disabled:opacity-50"
            >
              {fetchingUrl ? t('settings.bgUrlLoading') : t('settings.bgUrlAdd')}
            </button>
          </div>
          {!backgroundImage && <p className="text-subtle mt-1 text-[10px] leading-relaxed">{t('settings.bgHint')}</p>}
        </Field>

        {backgroundImage && (
          <>
            <Field label={t('settings.bgFit')}>
              <div className="grid grid-cols-2 gap-2">
                {fitOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setBackgroundFit(opt.value)}
                    className={`rounded border px-3 py-2 text-sm ${
                      backgroundFit === opt.value
                        ? 'border-accent text-content bg-accent-soft/40'
                        : 'border-edge text-muted hover:bg-hover'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t('settings.bgPosition')}>
              <div className="grid grid-cols-5 gap-1.5">
                {positionOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setBackgroundPosition(opt.value)}
                    className={`rounded border px-1 py-2 text-xs ${
                      backgroundPosition === opt.value
                        ? 'border-accent text-content bg-accent-soft/40'
                        : 'border-edge text-muted hover:bg-hover'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={`${t('settings.bgOpacity')} — ${Math.round(backgroundOpacity * 100)}%`}>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={Math.round(backgroundOpacity * 100)}
                onChange={(e) => setBackgroundOpacity(Number(e.target.value) / 100)}
                className="accent-accent w-full"
              />
            </Field>
            <Field label={`${t('settings.bgBlur')} — ${backgroundBlur}px`}>
              <input
                type="range"
                min={0}
                max={24}
                step={1}
                value={backgroundBlur}
                onChange={(e) => setBackgroundBlur(Number(e.target.value))}
                className="accent-accent w-full"
              />
            </Field>
          </>
        )}

        <div className="text-subtle mt-4 mb-2 text-[10px] font-semibold tracking-wider uppercase">
          {t('settings.terminal')}
        </div>

        <Field label={`${t('settings.termFontSize')} — ${termFontSize}px`}>
          <input
            type="range"
            min={8}
            max={28}
            step={1}
            value={termFontSize}
            onChange={(e) => setTermFontSize(Number(e.target.value))}
            className="accent-accent w-full"
          />
        </Field>

        <Field label={`${t('settings.termLineHeight')} — ${termLineHeight.toFixed(2)}`}>
          <input
            type="range"
            min={1}
            max={2}
            step={0.05}
            value={termLineHeight}
            onChange={(e) => setTermLineHeight(Number(e.target.value))}
            className="accent-accent w-full"
          />
        </Field>

        <Field label={t('settings.termCursor')}>
          <div className="grid grid-cols-3 gap-2">
            {cursorOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTermCursor(opt.value)}
                className={`rounded border px-2 py-2 text-sm ${
                  termCursor === opt.value
                    ? 'border-accent text-content bg-accent-soft/40'
                    : 'border-edge text-muted hover:bg-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('settings.termFont')}>
          <div className="flex gap-2">
            <TextInput
              value={termFontFamily}
              onChange={(e) => setTermFontFamily(e.target.value)}
              placeholder={TERM_FONT_DEFAULT}
              className="!font-mono !text-xs"
            />
            <button
              onClick={() => setTermFontFamily(TERM_FONT_DEFAULT)}
              className="border-edge text-muted hover:bg-hover shrink-0 rounded border px-3 text-sm"
              title={t('settings.termFontReset')}
            >
              ↺
            </button>
          </div>
          <p className="text-subtle mt-1 text-[10px] leading-relaxed">{t('settings.termFontHint')}</p>
        </Field>
      </div>
    </Modal>
  )
}
