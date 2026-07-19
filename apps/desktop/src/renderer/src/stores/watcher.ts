import { create } from 'zustand'
import type { WatcherStatusDto } from '@infra/shared'

const KEY = 'infra.watcher.on'

/**
 * F39 — Uptime watcher nền: chấm xanh/đỏ cạnh host ở sidebar, check TCP mỗi 60s ở main
 * (không mở session). Bật/tắt qua menu ⋯; nhớ qua localStorage. App.tsx đồng bộ danh sách
 * host sang main mỗi khi enabled/hosts đổi.
 */
interface WatcherState {
  enabled: boolean
  /** hostId → kết quả check gần nhất. Rỗng khi tắt. */
  statuses: Record<string, WatcherStatusDto>
  setEnabled: (on: boolean) => void
  applyStatuses: (list: WatcherStatusDto[]) => void
}

export const useWatcherStore = create<WatcherState>((set) => ({
  enabled: localStorage.getItem(KEY) === '1',
  statuses: {},
  setEnabled: (on) => {
    try {
      localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      /* mất persist thì thôi — vẫn toggle được trong phiên */
    }
    if (!on) window.infra.watcher.stop()
    set(on ? { enabled: true } : { enabled: false, statuses: {} })
  },
  applyStatuses: (list) =>
    set((prev) => {
      const statuses = { ...prev.statuses }
      for (const s of list) statuses[s.hostId] = s
      return { statuses }
    })
}))
