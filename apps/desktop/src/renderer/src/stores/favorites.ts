import { create } from 'zustand'

function read(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

interface FavoritesState {
  /** Danh sách id được ghim (per-máy, localStorage — không sync qua vault). */
  ids: string[]
  toggle: (id: string) => void
}

/** Store ghim dùng chung cho host lẫn tunnel — chỉ khác khoá localStorage. */
function createFavoritesStore(key: string) {
  const store = create<FavoritesState>((set, get) => ({
    ids: read(key),
    toggle: (id) => {
      const ids = get().ids.includes(id)
        ? get().ids.filter((x) => x !== id)
        : [...get().ids, id]
      localStorage.setItem(key, JSON.stringify(ids))
      set({ ids })
    }
  }))
  // Cửa sổ tunnel tách rời dùng chung localStorage với cửa sổ chính; sự kiện `storage`
  // chỉ bắn ở cửa sổ KHÁC nơi ghi → nghe để ghim ở cửa sổ này đổi thứ tự ở cửa sổ kia.
  window.addEventListener('storage', (e) => {
    if (e.key === key) store.setState({ ids: read(key) })
  })
  return store
}

/** Ghim host lên mục "Yêu thích" đầu sidebar. Lưu localStorage `infra.favorites`. */
export const useFavoritesStore = createFavoritesStore('infra.favorites')

/** Ghim tunnel lên đầu danh sách (modal/tab, Dashboard, cửa sổ tách rời). */
export const useTunnelFavoritesStore = createFavoritesStore('infra.tunnelFavorites')

/**
 * Đưa các mục được ghim lên đầu, giữ nguyên thứ tự sẵn có trong từng nửa
 * (partition ổn định — tunnels đã được data store sắp A→Z theo tên).
 */
export function pinnedFirst<T extends { id: string }>(list: T[], pinnedIds: string[]): T[] {
  if (pinnedIds.length === 0) return list
  const pinned = new Set(pinnedIds)
  return [...list.filter((x) => pinned.has(x.id)), ...list.filter((x) => !pinned.has(x.id))]
}
