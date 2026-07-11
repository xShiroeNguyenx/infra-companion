import { create } from 'zustand'
import type { RdpSessionDto } from '@infra/shared'
import { translate } from '../i18n'
import { useSettingsStore } from './settings'
import { errorMessage, useToastsStore } from './toasts'

/**
 * F13 — RDP qua tunnel: mở RDP KHÔNG tạo tab (client OS chạy ngoài). Store này chỉ theo dõi
 * các tunnel RDP đang mở (nguồn sự thật ở main) để hiện dock quản lý + nút Dừng.
 */
interface RdpState {
  sessions: RdpSessionDto[]
  open: (hostId: string) => Promise<void>
  close: (sessionId: string) => void
  refresh: () => Promise<void>
  subscribe: () => () => void
}

export const useRdpStore = create<RdpState>((set, get) => ({
  sessions: [],

  open: async (hostId) => {
    const lang = useSettingsStore.getState().language
    try {
      const res = await window.infra.rdp.open(hostId)
      if (res.launched) {
        useToastsStore.getState().push(translate(lang, 'rdp.launched', { label: res.label }), 'info')
      } else {
        useToastsStore.getState().push(res.hint ?? translate(lang, 'rdp.manual', { port: res.localPort }), 'info')
      }
      await get().refresh()
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  },

  close: (sessionId) => {
    window.infra.rdp.close(sessionId)
    void get().refresh()
  },

  refresh: async () => {
    set({ sessions: await window.infra.rdp.list().catch(() => []) })
  },

  subscribe: () => {
    void get().refresh()
    return window.infra.rdp.onChange(() => void get().refresh())
  }
}))
