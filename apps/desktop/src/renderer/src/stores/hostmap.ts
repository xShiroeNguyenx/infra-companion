import { create } from 'zustand'
import type { HostMapBrowserDto, HostMapGroupDto, HostMapGroupInput } from '@infra/shared'
import { errorMessage, useToastsStore } from './toasts'

/**
 * HostMap — trỏ domain sang IP chỉ định để test 1 server trong cụm load balance, KHÔNG sửa
 * file hosts, KHÔNG cần admin (app mở browser Chromium với --host-resolver-rules).
 *
 * Store RIÊNG chứ không nhập vào `useDataStore`: dữ liệu này nằm ở `hostmap.json` trong
 * userData, không thuộc vault nên không phụ thuộc trạng thái unlock.
 */

interface HostMapState {
  groups: HostMapGroupDto[]
  browsers: HostMapBrowserDto[]
  profilesBytes: number
  loaded: boolean
  /** Đang mở browser cho group nào (khoá nút, tránh bấm 2 lần ra 2 cửa sổ). */
  busyGroupId: string | null

  refresh: () => Promise<void>
  saveGroup: (input: HostMapGroupInput) => Promise<boolean>
  deleteGroup: (id: string) => Promise<void>
  setActive: (groupId: string, targetId: string) => Promise<void>
  open: (groupId: string, opts?: { targetId?: string; browserId?: string }) => Promise<void>
  openAll: (groupId: string) => Promise<void>
  copyCurl: (groupId: string, targetId?: string) => Promise<void>
  clearProfiles: (groupId?: string) => Promise<void>
}

const toast = (msg: string, kind: 'info' | 'error' = 'info'): void => useToastsStore.getState().push(msg, kind)
const toastError = (error: unknown): void => useToastsStore.getState().push(errorMessage(error), 'error')

export const useHostmapStore = create<HostMapState>((set, get) => ({
  groups: [],
  browsers: [],
  profilesBytes: 0,
  loaded: false,
  busyGroupId: null,

  refresh: async () => {
    try {
      const st = await window.infra.hostmap.state()
      set({ ...st, loaded: true })
    } catch (error) {
      toastError(error)
      set({ loaded: true })
    }
  },

  saveGroup: async (input) => {
    try {
      const st = await window.infra.hostmap.saveGroup(input)
      set({ ...st, loaded: true })
      return true
    } catch (error) {
      toastError(error)
      return false
    }
  },

  deleteGroup: async (id) => {
    try {
      set({ ...(await window.infra.hostmap.deleteGroup(id)), loaded: true })
    } catch (error) {
      toastError(error)
    }
  },

  setActive: async (groupId, targetId) => {
    // Cập nhật lạc quan: đổi server là thao tác bấm nhiều nhất, chờ IPC mới đổi radio thấy trễ
    set((prev) => ({
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, activeTargetId: targetId } : g))
    }))
    try {
      set({ ...(await window.infra.hostmap.setActive(groupId, targetId)), loaded: true })
    } catch (error) {
      toastError(error)
      await get().refresh()
    }
  },

  open: async (groupId, opts) => {
    set({ busyGroupId: groupId })
    try {
      const res = await window.infra.hostmap.open(groupId, opts)
      if (!res.ok) toast(res.error ?? 'Không mở được browser', 'error')
    } catch (error) {
      toastError(error)
    } finally {
      set({ busyGroupId: null })
    }
  },

  openAll: async (groupId) => {
    set({ busyGroupId: groupId })
    try {
      const res = await window.infra.hostmap.openAll(groupId)
      if (!res.ok) toast(res.error ?? 'Không mở được browser', 'error')
      else if (res.error !== undefined) toast(res.error, 'error')
    } catch (error) {
      toastError(error)
    } finally {
      set({ busyGroupId: null })
    }
  },

  copyCurl: async (groupId, targetId) => {
    try {
      const res = await window.infra.hostmap.curlCommand(groupId, targetId)
      if (!res.ok || res.command === undefined) return toast(res.error ?? 'Không dựng được lệnh curl', 'error')
      await navigator.clipboard.writeText(res.command)
      toast('Đã copy lệnh curl')
    } catch (error) {
      toastError(error)
    }
  },

  clearProfiles: async (groupId) => {
    try {
      const res = await window.infra.hostmap.clearProfiles(groupId)
      if (!res.ok) toast(res.error ?? 'Không xoá được profile', 'error')
      else toast('Đã xoá profile browser')
      await get().refresh()
    } catch (error) {
      toastError(error)
    }
  }
}))
