import { useSettingsStore } from '../stores/settings'
import { dictionaries, vi, type I18nKey } from './dict'

export type { I18nKey } from './dict'

type Params = Record<string, string | number>

function interpolate(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`))
}

/** Dịch theo ngôn ngữ cho trước — dùng ngoài React (vd lib không phải component). */
export function translate(lang: keyof typeof dictionaries, key: I18nKey, params?: Params): string {
  const dict = dictionaries[lang] as Partial<Record<I18nKey, string>>
  const template = dict[key] ?? vi[key] ?? key
  return interpolate(template, params)
}

/** Hook trong component: t() tự re-render khi đổi ngôn ngữ. */
export function useT(): (key: I18nKey, params?: Params) => string {
  const lang = useSettingsStore((s) => s.language)
  return (key, params) => translate(lang, key, params)
}
