import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import {
  PANE_FRAMES,
  PANE_LAYOUTS,
  TERM_FONT_DEFAULT,
  useSettingsStore,
  type BgFit,
  type BgPosition,
  type Language,
  type PaneFrame,
  type StartupPage,
  type TermCursor,
  type ThemeMode
} from '../stores/settings'
import { useToastsStore } from '../stores/toasts'
import { DEFAULT_GUARD_PATTERNS } from '../lib/commandGuard'
import { CustomPaletteSection } from './CustomPaletteSection'
import { LayoutGlyph } from './LayoutGlyph'
import { Button, Field, TextArea, TextInput } from './ui'

/** Các nhóm cài đặt hiển thị ở cột điều hướng bên trái của màn hình Settings. */
type SettingsSection = 'appearance' | 'background' | 'terminal' | 'guard'

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

/** Ảnh xem trước nhỏ cho từng kiểu khung pane trong picker. */
function FramePreview({ frame }: { frame: PaneFrame }) {
  const mac = frame === 'mac'
  return (
    <div className={`border-edge-strong bg-app w-full overflow-hidden border ${mac ? 'rounded-lg' : 'rounded'}`}>
      <div className="bg-panel flex h-4 items-center gap-1 px-1.5">
        {mac ? (
          <>
            {/* Kiểu Mac: nút đóng tròn đỏ bên trái, khung bo góc */}
            <span className="bg-danger size-1.5 rounded-full" />
            <span className="text-subtle flex-1 text-center text-[7px] leading-none">web-01</span>
            <span className="bg-success size-1 rounded-full" />
          </>
        ) : (
          <>
            <span className="bg-success size-1.5 rounded-full" />
            <span className="text-subtle flex-1 truncate text-[7px] leading-none">web-01</span>
            <span className="text-subtle text-[7px] leading-none">✕</span>
          </>
        )}
      </div>
      <div className="h-5" />
    </div>
  )
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
    termWebgl,
    paneLayout,
    paneFrame,
    startupPage,
    commandGuardEnabled,
    commandGuardPatterns,
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
    setTermWebgl,
    setPaneLayout,
    setPaneFrame,
    setStartupPage,
    setCommandGuardEnabled,
    setCommandGuardPatterns
  } = useSettingsStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const push = useToastsStore((s) => s.push)
  const [bgUrl, setBgUrl] = useState('')
  const [fetchingUrl, setFetchingUrl] = useState(false)
  const [section, setSection] = useState<SettingsSection>('appearance')
  // Text thô của whitelist (mỗi dòng 1 mẫu) — giữ tách store để user gõ dòng trống tạm thời được
  const [guardText, setGuardText] = useState(commandGuardPatterns.join('\n'))

  // Esc để đóng màn hình (trước dùng Modal lo việc này)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const applyGuardText = (text: string): void => {
    setGuardText(text)
    setCommandGuardPatterns(text.split('\n').map((s) => s.trim()).filter(Boolean))
  }
  const resetGuard = (): void => {
    setGuardText(DEFAULT_GUARD_PATTERNS.join('\n'))
    setCommandGuardPatterns([...DEFAULT_GUARD_PATTERNS])
  }

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

  const navItems: Array<{ id: SettingsSection; label: string; icon: string }> = [
    { id: 'appearance', label: t('settings.appearance'), icon: '🎨' },
    { id: 'background', label: t('settings.background'), icon: '🖼️' },
    { id: 'terminal', label: t('settings.terminal'), icon: '▮' },
    { id: 'guard', label: t('settings.cmdGuard'), icon: '🛡️' }
  ]
  const activeLabel = navItems.find((n) => n.id === section)?.label ?? ''

  return (
    // Màn hình Settings toàn cửa sổ (thay cho hộp thoại nhỏ trước đây): cột trái điều hướng nhóm,
    // phải là nội dung cuộn riêng — mỗi nhóm đủ chỗ, không còn chật như modal.
    <div className="bg-app text-content absolute inset-0 z-50 flex flex-col">
      <header className="border-edge flex shrink-0 items-center justify-between border-b px-5 py-3">
        <h1 className="text-sm font-semibold">{t('settings.title')}</h1>
        <button
          onClick={onClose}
          title={t('common.close')}
          className="text-subtle hover:bg-hover hover:text-content rounded px-2 py-1 text-base leading-none"
        >
          ✕
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="border-edge w-52 shrink-0 space-y-1 overflow-y-auto border-r p-3">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`flex w-full items-center gap-2.5 rounded px-3 py-2 text-left text-sm ${
                section === item.id
                  ? 'bg-accent-soft/40 text-content font-medium'
                  : 'text-muted hover:bg-hover'
              }`}
            >
              <span className="w-4 shrink-0 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-5">
            <h2 className="text-content mb-4 text-base font-semibold">{activeLabel}</h2>

            {section === 'appearance' && (
              <>
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
                    <span className="text-muted flex-1 font-mono text-xs">
                      {accentColor ?? t('settings.accentDefault')}
                    </span>
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
              </>
            )}

            {section === 'background' && (
              <>
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
                  {!backgroundImage && (
                    <p className="text-subtle mt-1 text-[10px] leading-relaxed">{t('settings.bgHint')}</p>
                  )}
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
              </>
            )}

            {section === 'terminal' && (
              <>
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

                <Field label={t('settings.termWebgl')}>
                  <div className="grid grid-cols-2 gap-2">
                    {([true, false] as const).map((on) => (
                      <button
                        key={String(on)}
                        onClick={() => setTermWebgl(on)}
                        className={`rounded border px-2 py-2 text-sm ${
                          termWebgl === on
                            ? 'border-accent text-content bg-accent-soft/40'
                            : 'border-edge text-muted hover:bg-hover'
                        }`}
                      >
                        {on ? t('plugins.enable') : t('plugins.disable')}
                      </button>
                    ))}
                  </div>
                  <p className="text-subtle mt-1 text-[11px]">{t('settings.termWebglHint')}</p>
                </Field>

                <Field label={t('settings.termLayout')}>
                  <div className="grid grid-cols-5 gap-1.5">
                    {PANE_LAYOUTS.map((l) => (
                      <button
                        key={l}
                        onClick={() => setPaneLayout(l)}
                        className={`flex flex-col items-center gap-1 rounded border px-1 py-2 text-[10px] ${
                          paneLayout === l
                            ? 'border-accent text-content bg-accent-soft/40'
                            : 'border-edge text-muted hover:bg-hover'
                        }`}
                      >
                        <LayoutGlyph kind={l} className="size-5" />
                        <span className="text-center leading-tight">{t(`tabs.layout.${l}`)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-subtle mt-1 text-[11px]">{t('settings.termLayoutHint')}</p>
                </Field>

                <Field label={t('settings.paneFrame')}>
                  <div className="grid grid-cols-2 gap-2">
                    {PANE_FRAMES.map((f) => (
                      <button
                        key={f}
                        onClick={() => setPaneFrame(f)}
                        className={`flex flex-col items-center gap-1.5 rounded border px-2 py-2 text-[11px] ${
                          paneFrame === f
                            ? 'border-accent text-content bg-accent-soft/40'
                            : 'border-edge text-muted hover:bg-hover'
                        }`}
                      >
                        <FramePreview frame={f} />
                        <span>{t(`settings.paneFrame.${f}`)}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-subtle mt-1 text-[11px]">{t('settings.paneFrameHint')}</p>
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
              </>
            )}

            {section === 'guard' && (
              <>
                <Field label={t('settings.cmdGuardEnable')}>
                  <div className="grid grid-cols-2 gap-2">
                    {([true, false] as const).map((on) => (
                      <button
                        key={String(on)}
                        onClick={() => setCommandGuardEnabled(on)}
                        className={`rounded border px-2 py-2 text-sm ${
                          commandGuardEnabled === on
                            ? 'border-accent text-content bg-accent-soft/40'
                            : 'border-edge text-muted hover:bg-hover'
                        }`}
                      >
                        {on ? t('plugins.enable') : t('plugins.disable')}
                      </button>
                    ))}
                  </div>
                  <p className="text-subtle mt-1 text-[11px] leading-relaxed">{t('settings.cmdGuardHint')}</p>
                </Field>

                {commandGuardEnabled && (
                  <Field label={t('settings.cmdGuardPatterns')}>
                    <TextArea
                      rows={10}
                      spellCheck={false}
                      value={guardText}
                      onChange={(e) => applyGuardText(e.target.value)}
                    />
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="text-subtle text-[10px] leading-relaxed">{t('settings.cmdGuardPatternsHint')}</p>
                      <Button onClick={resetGuard} className="shrink-0 !py-1 !text-xs">
                        {t('settings.cmdGuardReset')}
                      </Button>
                    </div>
                  </Field>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
