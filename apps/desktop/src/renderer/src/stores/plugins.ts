import { create } from 'zustand'
import type { ContributedCommandDto, PluginInfoDto, PluginPanelDto } from '@infra/shared'

interface PluginStoreState {
  plugins: PluginInfoDto[]
  /** Lệnh plugin đóng góp vào Command Palette (cập nhật realtime qua event). */
  contributions: ContributedCommandDto[]
  /** Panel plugin yêu cầu mở (độc lập với modal toàn cục → co-exist được). */
  panel: PluginPanelDto | null
  refresh: () => Promise<void>
  rescan: () => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  reload: (id: string) => Promise<void>
  applyContributions: (list: ContributedCommandDto[]) => void
  setPanel: (panel: PluginPanelDto | null) => void
}

export const usePluginStore = create<PluginStoreState>((set) => ({
  plugins: [],
  contributions: [],
  panel: null,
  refresh: async () => {
    const [plugins, contributions] = await Promise.all([
      window.infra.plugins.list(),
      window.infra.plugins.contributions()
    ])
    set({ plugins, contributions })
  },
  rescan: async () => {
    const plugins = await window.infra.plugins.rescan()
    set({ plugins, contributions: await window.infra.plugins.contributions() })
  },
  setEnabled: async (id, enabled) => {
    const plugins = await window.infra.plugins.setEnabled(id, enabled)
    set({ plugins, contributions: await window.infra.plugins.contributions() })
  },
  reload: async (id) => {
    const plugins = await window.infra.plugins.reload(id)
    set({ plugins, contributions: await window.infra.plugins.contributions() })
  },
  applyContributions: (contributions) => set({ contributions }),
  setPanel: (panel) => set({ panel })
}))
