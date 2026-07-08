import { create } from 'zustand'
import { translate } from '../i18n'
import { useSettingsStore } from './settings'
import { errorMessage, useToastsStore } from './toasts'
import { useUiStore } from './ui'

/**
 * F46 — Bôi chọn output trong terminal → AI giải thích, kết quả hiện ở AiExplainPanel
 * (dock góc phải). Dùng lại nguyên đường IPC ai.ask sẵn có — không code main mới.
 */

/** Trần ký tự gửi AI — giữ phần ĐUÔI vì thông báo lỗi nằm cuối output. */
const MAX_CHARS = 6000

export interface AiExplainRequest {
  text: string
  status: 'loading' | 'done' | 'error'
  answer: string | null
  error: string | null
}

interface AiExplainState {
  request: AiExplainRequest | null
  explain: (raw: string) => Promise<void>
  retry: () => void
  close: () => void
}

export const useAiExplainStore = create<AiExplainState>((set, get) => ({
  request: null,

  explain: async (raw) => {
    let text = raw.trim()
    if (!text) return
    if (text.length > MAX_CHARS) {
      text = '…(đã cắt bớt phần đầu)\n' + text.slice(-MAX_CHARS)
    }

    // AI chưa cấu hình → mở modal AI (tự hiện form settings khi config null)
    const config = await window.infra.ai.getConfig().catch(() => null)
    if (!config) {
      const lang = useSettingsStore.getState().language
      useToastsStore.getState().push(translate(lang, 'ai.notConfigured'), 'info')
      useUiStore.getState().setModal('ai')
      return
    }

    set({ request: { text, status: 'loading', answer: null, error: null } })
    try {
      // 'explain-error': system prompt sẵn có chuyên giải thích output/lỗi terminal + gợi ý fix
      const res = await window.infra.ai.ask('explain-error', text)
      set((s) =>
        s.request?.text === text ? { request: { text, status: 'done', answer: res.text, error: null } } : s
      )
    } catch (error) {
      // errorMessage bóc prefix "Error invoking remote method…" của IPC
      set((s) =>
        s.request?.text === text ? { request: { text, status: 'error', answer: null, error: errorMessage(error) } } : s
      )
    }
  },

  retry: () => {
    const req = get().request
    if (req) void get().explain(req.text)
  },

  close: () => set({ request: null })
}))
