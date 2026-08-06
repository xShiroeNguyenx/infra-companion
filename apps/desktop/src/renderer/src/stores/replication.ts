import { create } from 'zustand'
import type { ReplPairDto, ReplPairInput, ReplSnapshotDto } from '@infra/shared'

/** Số điểm lag giữ lại để vẽ sparkline trong panel. */
const LAG_HISTORY = 60

/** Kết quả đo mới nhất của MỘT slave. */
export interface ReplicaRuntime {
  snapshot: ReplSnapshotDto
  /** Lịch sử trễ (giây) — null cho điểm không đo được, để đường gãy chứ không nối bừa. */
  lagHistory: (number | null)[]
}

export interface PairRuntime {
  /** key = replicaId. Một cụm phát N sample mỗi chu kỳ, mỗi slave giữ kết quả riêng. */
  replicas: Record<string, ReplicaRuntime>
  /** Đang đo (nút Làm mới quay). */
  busy: boolean
  /** Đang theo dõi định kỳ ở main. */
  watching: boolean
}

interface ReplicationState {
  pairs: ReplPairDto[]
  runtime: Record<string, PairRuntime>
  loaded: boolean
  error: string | null
  loadPairs: () => Promise<void>
  savePair: (input: ReplPairInput) => Promise<ReplPairDto>
  deletePair: (id: string) => Promise<void>
  watch: (pairId: string) => Promise<void>
  unwatch: (pairId: string) => void
  pollNow: (pairId: string) => Promise<void>
  applySnapshot: (snapshot: ReplSnapshotDto) => void
  setError: (error: string | null) => void
}

const emptyRuntime = (): PairRuntime => ({ replicas: {}, busy: false, watching: false })

const errText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const useReplicationStore = create<ReplicationState>((set, get) => {
  /** Cập nhật runtime của một cụm, tự tạo nếu chưa có. */
  const patchRuntime = (pairId: string, change: Partial<PairRuntime>): void =>
    set((prev) => ({
      runtime: { ...prev.runtime, [pairId]: { ...(prev.runtime[pairId] ?? emptyRuntime()), ...change } }
    }))

  return {
    pairs: [],
    runtime: {},
    loaded: false,
    error: null,

    loadPairs: async () => {
      try {
        const pairs = await window.infra.replication.listPairs()
        set((prev) => {
          // Giữ runtime của cụm còn tồn tại, bỏ runtime của cụm đã xoá ở nơi khác
          const runtime: Record<string, PairRuntime> = {}
          for (const pair of pairs) runtime[pair.id] = prev.runtime[pair.id] ?? emptyRuntime()
          return { pairs, runtime, loaded: true, error: null }
        })
      } catch (error) {
        set({ error: errText(error), loaded: true })
      }
    },

    savePair: async (input) => {
      const saved = await window.infra.replication.savePair(input)
      // Main dừng theo dõi khi cấu hình đổi → runtime cũ không còn đúng (slave có thể đã thêm/bớt)
      set((prev) => ({ runtime: { ...prev.runtime, [saved.id]: emptyRuntime() } }))
      await get().loadPairs()
      return saved
    },

    deletePair: async (id) => {
      await window.infra.replication.deletePair(id)
      set((prev) => {
        const runtime = { ...prev.runtime }
        delete runtime[id]
        return { pairs: prev.pairs.filter((p) => p.id !== id), runtime }
      })
    },

    watch: async (pairId) => {
      patchRuntime(pairId, { busy: true })
      try {
        await window.infra.replication.watch(pairId)
        patchRuntime(pairId, { watching: true, busy: false })
      } catch (error) {
        set({ error: errText(error) })
        patchRuntime(pairId, { busy: false })
      }
    },

    unwatch: (pairId) => {
      window.infra.replication.unwatch(pairId)
      patchRuntime(pairId, { watching: false })
    },

    pollNow: async (pairId) => {
      patchRuntime(pairId, { busy: true })
      try {
        await window.infra.replication.pollNow(pairId)
        patchRuntime(pairId, { watching: true, busy: false })
      } catch (error) {
        set({ error: errText(error) })
        patchRuntime(pairId, { busy: false })
      }
    },

    applySnapshot: (snapshot) =>
      set((prev) => {
        const { pairId, replicaId } = snapshot.sample
        const pair = prev.runtime[pairId] ?? emptyRuntime()
        const cur = pair.replicas[replicaId]
        const lag = snapshot.sample.drift?.effectiveLagSec ?? null
        return {
          runtime: {
            ...prev.runtime,
            [pairId]: {
              ...pair,
              busy: false,
              replicas: {
                ...pair.replicas,
                [replicaId]: { snapshot, lagHistory: [...(cur?.lagHistory ?? []), lag].slice(-LAG_HISTORY) }
              }
            }
          }
        }
      }),

    setError: (error) => set({ error })
  }
})
