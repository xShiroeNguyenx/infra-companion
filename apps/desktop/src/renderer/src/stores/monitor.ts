import { create } from 'zustand'
import type { MetricSampleDto } from '@infra/shared'

const HISTORY = 30

export interface HostMonitor {
  hostId: string
  label: string
  sample: MetricSampleDto | null
  loadHistory: number[]
}

interface MonitorStoreState {
  /** Dashboard đang chạy — dock góc phải hiện khi true; CHỈ tắt khi user bấm Dừng
   *  (độc lập với modal toàn cục → mở modal khác không giết monitoring). */
  active: boolean
  data: Record<string, HostMonitor>
  start: (hosts: { id: string; label: string }[]) => Promise<void>
  stop: () => void
  applySample: (sample: MetricSampleDto) => void
}

export const useMonitorStore = create<MonitorStoreState>((set) => ({
  active: false,
  data: {},
  start: async (hosts) => {
    // stopAll trước: start backend dedupe theo hostId nên gọi lại = THAY tập host
    // đang theo dõi, không cộng dồn với tập cũ
    window.infra.monitor.stopAll()
    const data: Record<string, HostMonitor> = {}
    for (const h of hosts) data[h.id] = { hostId: h.id, label: h.label, sample: null, loadHistory: [] }
    set({ data, active: true })
    await window.infra.monitor.start(hosts.map((h) => h.id))
  },
  stop: () => {
    window.infra.monitor.stopAll()
    set({ active: false, data: {} })
  },
  applySample: (sample) =>
    set((prev) => {
      const cur = prev.data[sample.hostId]
      if (!cur) return prev
      const loadHistory =
        sample.load1 !== null ? [...cur.loadHistory, sample.load1].slice(-HISTORY) : cur.loadHistory
      return { data: { ...prev.data, [sample.hostId]: { ...cur, sample, loadHistory } } }
    })
}))
