import { create } from 'zustand'
import {
  moveInList,
  DEFAULT_SIDEBAR_BLOCKS,
  DEFAULT_SIDEBAR_ENABLED,
  type SidebarBlockId
} from '@infra/shared'

const KEY = 'infra.sidebar.collapsedGroups'
const BLOCK_COLLAPSED_KEY = 'infra.sidebar.collapsedBlocks'
const BLOCK_ORDER_KEY = 'infra.sidebar.blockOrder'
const BLOCK_ENABLED_KEY = 'infra.sidebar.blockEnabled'

function readIds(key: string, fallback: readonly string[] = []): string[] {
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
    /* localStorage lỗi — chỉ mất phần nhớ, gập/mở trong phiên vẫn chạy */
  }
}

interface SidebarGroupsState {
  /**
   * Group ĐANG GẬP. Lưu "đang gập" chứ không phải "đang mở": mặc định (chưa lưu gì) mọi
   * group đều mở như hành vi cũ, và group mới tạo cũng mở sẵn thay vì gập kín không rõ vì sao.
   */
  collapsedIds: string[]
  toggle: (groupId: string) => void
  /** Gập/mở TẤT CẢ — nút ở header khi có nhiều group. */
  setAll: (groupIds: readonly string[], collapsed: boolean) => void

  // --- Bố cục khối (Yêu thích / nhóm host / tunnels / snippets / workspaces / gần đây) ---

  /** Thứ tự khối user đặt. Rỗng ⇒ dùng thứ tự mặc định (xem `visibleSidebarBlocks`). */
  blockOrder: SidebarBlockId[]
  /** Khối đang BẬT. Mặc định = đúng bố cục cũ; ba khối mới mặc định tắt. */
  blockEnabled: SidebarBlockId[]
  /** Khối đang GẬP (cùng lệ với group: lưu "đang gập" nên mặc định mọi khối mở). */
  blockCollapsed: SidebarBlockId[]
  toggleBlock: (id: SidebarBlockId) => void
  toggleBlockCollapsed: (id: SidebarBlockId) => void
  /** Kéo thả: `to` là chỉ số khối ĐÍCH trong thứ tự đang hiện. */
  moveBlock: (id: SidebarBlockId, to: number) => void
  /** Trả bố cục về mặc định — nút trong hộp cấu hình. */
  resetBlocks: () => void
}

/** Trạng thái gập + bố cục sidebar. Per-máy, localStorage — không sync qua vault. */
export const useSidebarGroupsStore = create<SidebarGroupsState>((set, get) => ({
  collapsedIds: readIds(KEY),
  toggle: (groupId) => {
    const cur = get().collapsedIds
    const collapsedIds = cur.includes(groupId) ? cur.filter((x) => x !== groupId) : [...cur, groupId]
    save(KEY, collapsedIds)
    set({ collapsedIds })
  },
  setAll: (groupIds, collapsed) => {
    // Gập tất cả = ghi đúng danh sách group hiện có, KHÔNG cộng dồn id cũ: group đã xoá mà
    // còn nằm lại trong localStorage thì danh sách chỉ phình ra mãi.
    const collapsedIds = collapsed ? [...groupIds] : []
    save(KEY, collapsedIds)
    set({ collapsedIds })
  },

  // `readIds` với fallback: khoá CHƯA TỒN TẠI (lần đầu) khác hẳn mảng rỗng đã lưu (user tự
  // tắt hết khối). Không phân biệt hai ca đó thì "tắt hết" sẽ bị hiểu là "chưa cấu hình" và
  // app tự bật lại mọi khối.
  blockOrder: readIds(BLOCK_ORDER_KEY) as SidebarBlockId[],
  blockEnabled: readIds(BLOCK_ENABLED_KEY, DEFAULT_SIDEBAR_ENABLED) as SidebarBlockId[],
  blockCollapsed: readIds(BLOCK_COLLAPSED_KEY) as SidebarBlockId[],

  toggleBlock: (id) => {
    const cur = get().blockEnabled
    const blockEnabled = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    save(BLOCK_ENABLED_KEY, blockEnabled)
    set({ blockEnabled })
  },
  toggleBlockCollapsed: (id) => {
    const cur = get().blockCollapsed
    const blockCollapsed = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    save(BLOCK_COLLAPSED_KEY, blockCollapsed)
    set({ blockCollapsed })
  },
  moveBlock: (id, to) => {
    // Thứ tự lưu có thể rỗng (chưa đặt gì) hoặc thiếu khối mới → hợp nhất với mặc định TRƯỚC
    // khi chuyển, để phép kéo không âm thầm làm rơi những khối chưa có trong danh sách lưu.
    const cur = get().blockOrder
    const merged: SidebarBlockId[] = [...cur, ...DEFAULT_SIDEBAR_BLOCKS.filter((b) => !cur.includes(b))]
    const blockOrder = moveInList(merged, id, to) as SidebarBlockId[]
    save(BLOCK_ORDER_KEY, blockOrder)
    set({ blockOrder })
  },
  resetBlocks: () => {
    const blockOrder = [...DEFAULT_SIDEBAR_BLOCKS]
    const blockEnabled = [...DEFAULT_SIDEBAR_ENABLED]
    save(BLOCK_ORDER_KEY, blockOrder)
    save(BLOCK_ENABLED_KEY, blockEnabled)
    save(BLOCK_COLLAPSED_KEY, [])
    set({ blockOrder, blockEnabled, blockCollapsed: [] })
  }
}))
