import { create } from 'zustand'

export type ThemeMode = 'dark' | 'light'
export type Language = 'vi' | 'en' | 'ja'

const THEME_KEY = 'infra.theme'
const LANG_KEY = 'infra.lang'

function readTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' ? 'light' : 'dark'
}

function readLang(): Language {
  const v = localStorage.getItem(LANG_KEY)
  return v === 'en' || v === 'ja' ? v : 'vi'
}

/** Áp theme + lang lên <html>. Gọi sớm (main.tsx) để tránh nháy màu khi load. */
export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme
}
export function applyLang(lang: Language): void {
  document.documentElement.lang = lang
}

interface SettingsState {
  theme: ThemeMode
  language: Language
  setTheme: (t: ThemeMode) => void
  setLanguage: (l: Language) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: readTheme(),
  language: readLang(),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },
  setLanguage: (language) => {
    localStorage.setItem(LANG_KEY, language)
    applyLang(language)
    set({ language })
  }
}))

/** Đọc giá trị ban đầu mà không cần mount React (cho main.tsx). */
export const initialSettings = { theme: readTheme(), language: readLang() }
