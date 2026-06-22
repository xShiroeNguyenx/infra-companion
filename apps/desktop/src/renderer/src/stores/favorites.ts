import { create } from 'zustand'

const KEY = 'infra.favorites'

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

interface FavoritesState {
  /** Danh sách hostId được ghim (per-máy, localStorage — không sync). */
  ids: string[]
  toggle: (hostId: string) => void
}

/** Ghim host lên mục "Yêu thích" đầu sidebar. Lưu localStorage `infra.favorites`. */
export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  ids: read(),
  toggle: (hostId) => {
    const ids = get().ids.includes(hostId)
      ? get().ids.filter((x) => x !== hostId)
      : [...get().ids, hostId]
    localStorage.setItem(KEY, JSON.stringify(ids))
    set({ ids })
  }
}))
