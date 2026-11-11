import { create } from 'zustand'
import {
  DEFAULT_HIGHLIGHT_RULES,
  cleanHighlightRules,
  compileHighlightRules,
  type CompiledRule,
  type HighlightRule
} from '@infra/shared'

/**
 * F25 — mẫu tô màu + báo động của terminal. Lưu localStorage (theo máy), giống phím tắt và từ
 * tắt auto-complete: đây là cách user muốn terminal của MÌNH trông thế nào, không phải dữ liệu
 * hạ tầng cần mã hoá hay đồng bộ.
 *
 * `compiled` được dựng lại MỖI LẦN danh sách đổi, không phải trên từng dòng output — mỗi pane
 * đọc nó qua `getState()` lúc quét.
 */

const ENABLED_KEY = 'infra.term.highlight.on'
const RULES_KEY = 'infra.term.highlight.rules'

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0'
  } catch {
    return true
  }
}

/** Chưa lưu lần nào → mẫu mặc định; đã lưu (kể cả danh sách rỗng) → đúng thứ đã lưu. */
function readRules(): HighlightRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY)
    if (raw === null) return DEFAULT_HIGHLIGHT_RULES.map((r) => ({ ...r }))
    return cleanHighlightRules(JSON.parse(raw))
  } catch {
    return DEFAULT_HIGHLIGHT_RULES.map((r) => ({ ...r }))
  }
}

function persist(rules: HighlightRule[]): void {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules))
  } catch {
    /* localStorage đầy/bị chặn — giữ trong bộ nhớ cho phiên này */
  }
}

interface TermHighlightState {
  enabled: boolean
  rules: HighlightRule[]
  compiled: CompiledRule[]
  setEnabled: (on: boolean) => void
  setRules: (rules: HighlightRule[]) => void
  resetRules: () => void
}

const initialRules = readRules()

export const useTermHighlightStore = create<TermHighlightState>((set) => ({
  enabled: readEnabled(),
  rules: initialRules,
  compiled: compileHighlightRules(initialRules),
  setEnabled: (on) => {
    try {
      localStorage.setItem(ENABLED_KEY, on ? '1' : '0')
    } catch {
      /* như trên */
    }
    set({ enabled: on })
  },
  setRules: (rules) => {
    persist(rules)
    set({ rules, compiled: compileHighlightRules(rules) })
  },
  resetRules: () => {
    const rules = DEFAULT_HIGHLIGHT_RULES.map((r) => ({ ...r }))
    persist(rules)
    set({ rules, compiled: compileHighlightRules(rules) })
  }
}))

/** Id cho mẫu mới. */
export function newRuleId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}
