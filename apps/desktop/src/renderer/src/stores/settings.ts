import { create } from 'zustand'

export type ThemeMode = 'dark' | 'light'
export type Language = 'vi' | 'en' | 'ja'
/** Vị trí ảnh nền (background-position keyword). */
export type BgPosition = 'center' | 'left' | 'right' | 'top' | 'bottom'
/** Kiểu lấp khung: cover = phủ kín (cắt bớt), contain = vừa khung (không cắt). */
export type BgFit = 'cover' | 'contain'
/** Kiểu con trỏ terminal (xterm cursorStyle). */
export type TermCursor = 'block' | 'bar' | 'underline'

const THEME_KEY = 'infra.theme'
const LANG_KEY = 'infra.lang'
const ACCENT_KEY = 'infra.accent'
const BG_IMAGE_KEY = 'infra.bg.image'
const BG_OPACITY_KEY = 'infra.bg.opacity'
const BG_BLUR_KEY = 'infra.bg.blur'
const BG_POSITION_KEY = 'infra.bg.position'
const BG_FIT_KEY = 'infra.bg.fit'
const TERM_FONT_KEY = 'infra.term.font'
const TERM_SIZE_KEY = 'infra.term.size'
const TERM_LH_KEY = 'infra.term.lineHeight'
const TERM_CURSOR_KEY = 'infra.term.cursor'

const BG_OPACITY_DEFAULT = 0.25
const BG_BLUR_DEFAULT = 0
const BG_POSITIONS: BgPosition[] = ['center', 'left', 'right', 'top', 'bottom']

/** Font terminal mặc định (khớp giá trị cũ hardcode để không đổi hiển thị của user hiện tại). */
export const TERM_FONT_DEFAULT = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace'
const TERM_SIZE_DEFAULT = 14
const TERM_LH_DEFAULT = 1.2

function readTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' ? 'light' : 'dark'
}

function readLang(): Language {
  const v = localStorage.getItem(LANG_KEY)
  return v === 'en' || v === 'ja' ? v : 'vi'
}

/** Hex màu accent tùy chỉnh (#rrggbb) hoặc null = dùng accent mặc định của theme. */
function readAccent(): string | null {
  const v = localStorage.getItem(ACCENT_KEY)
  return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null
}

function readBgImage(): string | null {
  return localStorage.getItem(BG_IMAGE_KEY)
}

function readBgOpacity(): number {
  const v = Number(localStorage.getItem(BG_OPACITY_KEY))
  return Number.isFinite(v) && v > 0 ? Math.min(v, 1) : BG_OPACITY_DEFAULT
}

function readBgBlur(): number {
  const v = Number(localStorage.getItem(BG_BLUR_KEY))
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 24) : BG_BLUR_DEFAULT
}

function readBgPosition(): BgPosition {
  const v = localStorage.getItem(BG_POSITION_KEY) as BgPosition | null
  return v && BG_POSITIONS.includes(v) ? v : 'center'
}

function readBgFit(): BgFit {
  return localStorage.getItem(BG_FIT_KEY) === 'contain' ? 'contain' : 'cover'
}

function readTermFont(): string {
  return localStorage.getItem(TERM_FONT_KEY) || TERM_FONT_DEFAULT
}

function readTermSize(): number {
  const v = Number(localStorage.getItem(TERM_SIZE_KEY))
  return Number.isFinite(v) && v >= 8 && v <= 28 ? v : TERM_SIZE_DEFAULT
}

function readTermLineHeight(): number {
  const v = Number(localStorage.getItem(TERM_LH_KEY))
  return Number.isFinite(v) && v >= 1 && v <= 2 ? v : TERM_LH_DEFAULT
}

function readTermCursor(): TermCursor {
  const v = localStorage.getItem(TERM_CURSOR_KEY)
  return v === 'bar' || v === 'underline' ? v : 'block'
}

/** Áp theme + lang lên <html>. Gọi sớm (main.tsx) để tránh nháy màu khi load. */
export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme
}
export function applyLang(lang: Language): void {
  document.documentElement.lang = lang
}
/** data-bg='on' → CSS làm nền terminal trong suốt để lộ ảnh nền phía sau. */
export function applyBackground(image: string | null): void {
  document.documentElement.dataset.bg = image ? 'on' : 'off'
}

/** Làm tối 1 màu hex theo tỉ lệ (0–1) — dùng cho accent-hover. */
function darkenHex(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const f = 1 - amount
  const r = Math.round(((n >> 16) & 0xff) * f)
  const g = Math.round(((n >> 8) & 0xff) * f)
  const b = Math.round((n & 0xff) * f)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/**
 * Ghi đè màu accent qua CSS var inline trên <html> (thắng stylesheet theme).
 * Một màu picked → accent + hover (tối hơn); accent-fg/soft = chính màu đó
 * (soft chỉ dùng kèm alpha modifier nên thành tint nhạt). null = gỡ override.
 */
export function applyAccent(color: string | null): void {
  const root = document.documentElement
  const vars = ['--c-accent', '--c-accent-hover', '--c-accent-fg', '--c-accent-soft']
  if (!color) {
    for (const v of vars) root.style.removeProperty(v)
    return
  }
  root.style.setProperty('--c-accent', color)
  root.style.setProperty('--c-accent-hover', darkenHex(color, 0.14))
  root.style.setProperty('--c-accent-fg', color)
  root.style.setProperty('--c-accent-soft', color)
}

interface SettingsState {
  theme: ThemeMode
  language: Language
  /** Màu accent tùy chỉnh (#rrggbb) — null = mặc định theo theme. */
  accentColor: string | null
  /** Ảnh nền dạng data URL (đã downscale) — null = không dùng. */
  backgroundImage: string | null
  /** Độ hiện của ảnh nền (0–1). */
  backgroundOpacity: number
  /** Độ mờ (blur) ảnh nền tính bằng px — giúp chữ dễ đọc trên ảnh rối. */
  backgroundBlur: number
  /** Vị trí canh ảnh (giữa/trái/phải/trên/dưới). */
  backgroundPosition: BgPosition
  /** Phủ kín (cover) hay vừa khung (contain). */
  backgroundFit: BgFit
  /** Font terminal (CSS font-family). */
  termFontFamily: string
  /** Cỡ chữ terminal (px). */
  termFontSize: number
  /** Giãn dòng terminal. */
  termLineHeight: number
  /** Kiểu con trỏ terminal. */
  termCursor: TermCursor
  setTheme: (t: ThemeMode) => void
  setLanguage: (l: Language) => void
  setAccentColor: (c: string | null) => void
  /** Lưu/xoá ảnh nền. Trả về false nếu localStorage đầy (ảnh quá lớn). */
  setBackgroundImage: (image: string | null) => boolean
  setBackgroundOpacity: (v: number) => void
  setBackgroundBlur: (v: number) => void
  setBackgroundPosition: (p: BgPosition) => void
  setBackgroundFit: (f: BgFit) => void
  setTermFontFamily: (f: string) => void
  setTermFontSize: (n: number) => void
  setTermLineHeight: (n: number) => void
  setTermCursor: (c: TermCursor) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: readTheme(),
  language: readLang(),
  accentColor: readAccent(),
  backgroundImage: readBgImage(),
  backgroundOpacity: readBgOpacity(),
  backgroundBlur: readBgBlur(),
  backgroundPosition: readBgPosition(),
  backgroundFit: readBgFit(),
  termFontFamily: readTermFont(),
  termFontSize: readTermSize(),
  termLineHeight: readTermLineHeight(),
  termCursor: readTermCursor(),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },
  setLanguage: (language) => {
    localStorage.setItem(LANG_KEY, language)
    applyLang(language)
    set({ language })
  },
  setAccentColor: (color) => {
    if (color) localStorage.setItem(ACCENT_KEY, color)
    else localStorage.removeItem(ACCENT_KEY)
    applyAccent(color)
    set({ accentColor: color })
  },
  setBackgroundImage: (image) => {
    try {
      if (image) localStorage.setItem(BG_IMAGE_KEY, image)
      else localStorage.removeItem(BG_IMAGE_KEY)
    } catch {
      return false // QuotaExceededError — ảnh sau khi nén vẫn quá lớn
    }
    applyBackground(image)
    set({ backgroundImage: image })
    return true
  },
  setBackgroundOpacity: (v) => {
    const opacity = Math.min(Math.max(v, 0.05), 1)
    localStorage.setItem(BG_OPACITY_KEY, String(opacity))
    set({ backgroundOpacity: opacity })
  },
  setBackgroundBlur: (v) => {
    const blur = Math.min(Math.max(v, 0), 24)
    localStorage.setItem(BG_BLUR_KEY, String(blur))
    set({ backgroundBlur: blur })
  },
  setBackgroundPosition: (position) => {
    localStorage.setItem(BG_POSITION_KEY, position)
    set({ backgroundPosition: position })
  },
  setBackgroundFit: (fit) => {
    localStorage.setItem(BG_FIT_KEY, fit)
    set({ backgroundFit: fit })
  },
  setTermFontFamily: (family) => {
    const value = family.trim() || TERM_FONT_DEFAULT
    localStorage.setItem(TERM_FONT_KEY, value)
    set({ termFontFamily: value })
  },
  setTermFontSize: (n) => {
    const size = Math.min(Math.max(Math.round(n), 8), 28)
    localStorage.setItem(TERM_SIZE_KEY, String(size))
    set({ termFontSize: size })
  },
  setTermLineHeight: (n) => {
    const lh = Math.min(Math.max(n, 1), 2)
    localStorage.setItem(TERM_LH_KEY, String(lh))
    set({ termLineHeight: lh })
  },
  setTermCursor: (cursor) => {
    localStorage.setItem(TERM_CURSOR_KEY, cursor)
    set({ termCursor: cursor })
  }
}))

/** Đọc giá trị ban đầu mà không cần mount React (cho main.tsx). */
export const initialSettings = {
  theme: readTheme(),
  language: readLang(),
  backgroundImage: readBgImage(),
  accentColor: readAccent()
}
