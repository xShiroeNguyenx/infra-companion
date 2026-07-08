import { create } from 'zustand'
import type {
  GroupDto,
  GroupInput,
  HistoryEntry,
  HostDto,
  HostInput,
  KeyImportInput,
  SnippetDto,
  SnippetInput,
  SshKeyDto,
  TunnelRuleDto,
  TunnelRuleInput,
  TunnelStatus
} from '@infra/shared'
import { errorMessage, useToastsStore } from './toasts'

interface DataState {
  hosts: HostDto[]
  groups: GroupDto[]
  keys: SshKeyDto[]
  history: HistoryEntry[]
  snippets: SnippetDto[]
  tunnels: TunnelRuleDto[]
  tunnelStates: Record<string, { status: TunnelStatus; detail?: string }>
  loaded: boolean
  refreshAll: () => Promise<void>
  refreshHistory: () => Promise<void>
  saveHost: (input: HostInput) => Promise<boolean>
  /** Trả về false nếu xoá thất bại — caller chỉ đóng modal khi true. */
  deleteHost: (id: string) => Promise<boolean>
  saveGroup: (input: GroupInput) => Promise<GroupDto | null>
  deleteGroup: (id: string) => Promise<boolean>
  generateKey: (label: string) => Promise<boolean>
  importKey: (input: KeyImportInput) => Promise<boolean>
  deleteKey: (id: string) => Promise<void>
  saveSnippet: (input: SnippetInput) => Promise<boolean>
  deleteSnippet: (id: string) => Promise<void>
  saveTunnel: (input: TunnelRuleInput) => Promise<boolean>
  deleteTunnel: (id: string) => Promise<void>
  startTunnel: (id: string) => Promise<void>
  stopTunnel: (id: string) => Promise<void>
  applyTunnelState: (ruleId: string, status: TunnelStatus, detail?: string) => void
}

const toast = (error: unknown): void => useToastsStore.getState().push(errorMessage(error))

export const useDataStore = create<DataState>((set, get) => ({
  hosts: [],
  groups: [],
  keys: [],
  history: [],
  snippets: [],
  tunnels: [],
  tunnelStates: {},
  loaded: false,

  refreshAll: async () => {
    try {
      const [hosts, groups, keys, history, snippets, tunnels, states] = await Promise.all([
        window.infra.data.listHosts(),
        window.infra.data.listGroups(),
        window.infra.data.listKeys(),
        // Lấy tối đa (vault cap 50) để Dashboard tính "kết nối hôm nay/7 ngày";
        // sidebar chỉ hiển thị 8 mục đầu (tự slice). Lưu ý: vault dedup theo target
        // nên số đếm thực chất là "số target khác nhau" — chấp nhận được.
        window.infra.data.listHistory(50),
        window.infra.data.listSnippets(),
        window.infra.tunnels.list(),
        window.infra.tunnels.states()
      ])
      const tunnelStates: DataState['tunnelStates'] = {}
      for (const state of states) tunnelStates[state.ruleId] = { status: state.status, detail: state.detail }
      set({ hosts, groups, keys, history, snippets, tunnels, tunnelStates, loaded: true })
    } catch (error) {
      toast(error)
    }
  },

  refreshHistory: async () => {
    try {
      set({ history: await window.infra.data.listHistory(50) })
    } catch {
      // vault có thể vừa khoá — bỏ qua
    }
  },

  saveHost: async (input) => {
    try {
      await window.infra.data.saveHost(input)
      set({ hosts: await window.infra.data.listHosts() })
      return true
    } catch (error) {
      toast(error)
      return false
    }
  },

  deleteHost: async (id) => {
    try {
      await window.infra.data.deleteHost(id)
      set({ hosts: get().hosts.filter((h) => h.id !== id) })
      return true
    } catch (error) {
      toast(error)
      return false
    }
  },

  saveGroup: async (input) => {
    try {
      const group = await window.infra.data.saveGroup(input)
      set({ groups: await window.infra.data.listGroups() })
      return group
    } catch (error) {
      toast(error)
      return null
    }
  },

  deleteGroup: async (id) => {
    try {
      await window.infra.data.deleteGroup(id)
      const [groups, hosts] = await Promise.all([window.infra.data.listGroups(), window.infra.data.listHosts()])
      set({ groups, hosts })
      return true
    } catch (error) {
      toast(error)
      return false
    }
  },

  generateKey: async (label) => {
    try {
      await window.infra.data.generateKey(label)
      set({ keys: await window.infra.data.listKeys() })
      return true
    } catch (error) {
      toast(error)
      return false
    }
  },

  importKey: async (input) => {
    try {
      await window.infra.data.importKey(input)
      set({ keys: await window.infra.data.listKeys() })
      return true
    } catch (error) {
      toast(error)
      return false
    }
  },

  deleteKey: async (id) => {
    try {
      await window.infra.data.deleteKey(id)
      set({ keys: get().keys.filter((k) => k.id !== id) })
    } catch (error) {
      toast(error)
    }
  },

  saveSnippet: async (input) => {
    try {
      await window.infra.data.saveSnippet(input)
      set({ snippets: await window.infra.data.listSnippets() })
      return true
    } catch (error) {
      toast(error)
      return false
    }
  },

  deleteSnippet: async (id) => {
    try {
      await window.infra.data.deleteSnippet(id)
      set({ snippets: get().snippets.filter((s) => s.id !== id) })
    } catch (error) {
      toast(error)
    }
  },

  saveTunnel: async (input) => {
    try {
      await window.infra.tunnels.save(input)
      set({ tunnels: await window.infra.tunnels.list() })
      return true
    } catch (error) {
      toast(error)
      return false
    }
  },

  deleteTunnel: async (id) => {
    try {
      await window.infra.tunnels.delete(id)
      set({ tunnels: get().tunnels.filter((t) => t.id !== id) })
    } catch (error) {
      toast(error)
    }
  },

  startTunnel: async (id) => {
    try {
      await window.infra.tunnels.start(id)
    } catch (error) {
      toast(error)
    }
  },

  stopTunnel: async (id) => {
    try {
      await window.infra.tunnels.stop(id)
    } catch (error) {
      toast(error)
    }
  },

  applyTunnelState: (ruleId, status, detail) =>
    set((state) => ({ tunnelStates: { ...state.tunnelStates, [ruleId]: { status, detail } } }))
}))
