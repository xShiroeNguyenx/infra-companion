import { create } from 'zustand'
import type { VaultState } from '@infra/shared'
import { errorMessage } from './toasts'

interface VaultStoreState {
  state: 'loading' | VaultState
  remembered: boolean
  busy: boolean
  error: string | null
  refresh: () => Promise<void>
  setup: (masterPassword: string, remember: boolean) => Promise<void>
  unlock: (masterPassword: string, remember: boolean) => Promise<void>
  lock: () => Promise<void>
  markLocked: () => void
}

export const useVaultStore = create<VaultStoreState>((set) => ({
  state: 'loading',
  remembered: false,
  busy: false,
  error: null,

  refresh: async () => {
    const status = await window.infra.vault.status()
    set({ state: status.state, remembered: status.remembered })
  },

  setup: async (masterPassword, remember) => {
    set({ busy: true, error: null })
    try {
      const status = await window.infra.vault.setup(masterPassword, remember)
      set({ state: status.state, remembered: status.remembered, busy: false })
    } catch (error) {
      set({ busy: false, error: errorMessage(error) })
    }
  },

  unlock: async (masterPassword, remember) => {
    set({ busy: true, error: null })
    try {
      const status = await window.infra.vault.unlock(masterPassword, remember)
      set({ state: status.state, remembered: status.remembered, busy: false })
    } catch (error) {
      set({ busy: false, error: errorMessage(error) })
    }
  },

  lock: async () => {
    const status = await window.infra.vault.lock()
    set({ state: status.state, remembered: status.remembered })
  },

  markLocked: () => set({ state: 'locked' })
}))
