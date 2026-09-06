import { create } from 'zustand'
import {
  DEFAULT_NAV_ENABLED,
  DEFAULT_NAV_MENU,
  NAV_MENU_LOCKED,
  moveInList,
  orderedNavMenu,
  type NavMenuId
} from '@infra/shared'

/**
 * Bố cục MENU cột trái của theme Navigator: mục nào hiện, theo thứ tự nào. Cùng khuôn với phần
 * "khối" của `sidebarGroups.ts` (theme Infra) — hai theme, hai store, vì user chuyển theme thì
 * không muốn cấu hình cột này ghi đè cột kia. Per-máy, localStorage — không sync qua vault.
 */

const ORDER_KEY = 'infra.nav.order'
const ENABLED_KEY = 'infra.nav.enabled'

function readIds(key: string, fallback: readonly string[]): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return [...fallback]
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [...fallback]
  } catch {
    return [...fallback]
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* localStorage lỗi — chỉ mất phần nhớ, đổi trong phiên vẫn chạy */
  }
}

interface NavMenuState {
  /** Thứ tự user đặt. Rỗng ⇒ mặc định (xem `visibleNavMenu`). */
  order: NavMenuId[]
  /** Mục đang BẬT. Mặc định = tất cả TRỪ Dashboard; mục khoá (Hosts) luôn hiện dù có trong đây hay không. */
  enabled: NavMenuId[]
  toggle: (id: NavMenuId) => void
  /** Kéo thả: `to` là chỉ số ĐÍCH trong thứ tự đầy đủ đang hiện ở hộp cấu hình. */
  move: (id: NavMenuId, to: number) => void
  reset: () => void
}

export const useNavMenuStore = create<NavMenuState>((set, get) => ({
  // Khoá CHƯA TỒN TẠI (lần đầu) khác mảng rỗng đã lưu: không phân biệt thì "tắt hết" bị hiểu
  // là "chưa cấu hình" và app tự bật lại mọi mục.
  order: readIds(ORDER_KEY, []) as NavMenuId[],
  enabled: readIds(ENABLED_KEY, DEFAULT_NAV_ENABLED) as NavMenuId[],

  toggle: (id) => {
    if (NAV_MENU_LOCKED.includes(id)) return
    const cur = get().enabled
    const enabled = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    save(ENABLED_KEY, enabled)
    set({ enabled })
  },
  move: (id, to) => {
    // Hợp nhất với mặc định TRƯỚC khi chuyển để phép kéo không âm thầm làm rơi mục chưa có
    // trong danh sách lưu (thứ tự rỗng lần đầu, hoặc thiếu mục mới của bản sau).
    const order = moveInList(orderedNavMenu(get().order), id, to) as NavMenuId[]
    save(ORDER_KEY, order)
    set({ order })
  },
  reset: () => {
    const order = [...DEFAULT_NAV_MENU]
    const enabled = [...DEFAULT_NAV_ENABLED]
    save(ORDER_KEY, order)
    save(ENABLED_KEY, enabled)
    set({ order, enabled })
  }
}))
