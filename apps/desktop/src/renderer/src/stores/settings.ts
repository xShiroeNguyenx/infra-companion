import { create } from 'zustand'

export type ThemeMode = 'dark' | 'light'
export type Language = 'vi' | 'en' | 'ja'
/** Vị trí ảnh nền (background-position keyword). */
export type BgPosition = 'center' | 'left' | 'right' | 'top' | 'bottom'
/** Kiểu lấp khung: cover = phủ kín (cắt bớt), contain = vừa khung (không cắt). */
export type BgFit = 'cover' | 'contain'

const THEME_KEY = 'infra.theme'
const LANG_KEY = 'infra.lang'
const BG_IMAGE_KEY = 'infra.bg.image'
const BG_OPACITY_KEY = 'infra.bg.opacity'
const BG_BLUR_KEY = 'infra.bg.blur'
const BG_POSITION_KEY = 'infra.bg.position'
const BG_FIT_KEY = 'infra.bg.fit'

const BG_OPACITY_DEFAULT = 0.25
const BG_BLUR_DEFAULT = 0
const BG_POSITIONS: BgPosition[] = ['center', 'left', 'right', 'top', 'bottom']

function readTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' ? 'light' : 'dark'
}

function readLang(): Language {
  const v = localStorage.getItem(LANG_KEY)
  return v === 'en' || v === 'ja' ? v : 'vi'
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

interface SettingsState {
  theme: ThemeMode
  language: Language
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
  setTheme: (t: ThemeMode) => void
  setLanguage: (l: Language) => void
  /** Lưu/xoá ảnh nền. Trả về false nếu localStorage đầy (ảnh quá lớn). */
  setBackgroundImage: (image: string | null) => boolean
  setBackgroundOpacity: (v: number) => void
  setBackgroundBlur: (v: number) => void
  setBackgroundPosition: (p: BgPosition) => void
  setBackgroundFit: (f: BgFit) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: readTheme(),
  language: readLang(),
  backgroundImage: readBgImage(),
  backgroundOpacity: readBgOpacity(),
  backgroundBlur: readBgBlur(),
  backgroundPosition: readBgPosition(),
  backgroundFit: readBgFit(),
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
  }
}))

/** Đọc giá trị ban đầu mà không cần mount React (cho main.tsx). */
export const initialSettings = { theme: readTheme(), language: readLang(), backgroundImage: readBgImage() }
