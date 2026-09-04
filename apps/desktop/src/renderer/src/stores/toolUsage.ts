import { create } from 'zustand'
import { moveInList, recordToolUse, type ToolUsage } from '@infra/shared'

/**
 * Mức dùng từng công cụ + danh sách công cụ user tự ghim — nguồn cho thứ tự lưới một hàng
 * trên Dashboard ({@link ../features/dashboard/ToolGrid}).
 *
 * Per-máy, localStorage, KHÔNG sync qua vault: đây là thói quen dùng app trên chính máy này,
 * và đưa vào vault thì mỗi lượt bấm nút là một lần ghi blob đồng bộ.
 *
 * Đếm ở `ui.setModal` + `tabs.openToolTab` (chỗ đi qua của MỌI đường mở công cụ: menu `⋯`,
 * Command Palette, lưới, tab "Tất cả tính năng") chứ không đếm lượt bấm trên lưới — nếu chỉ
 * đếm trên lưới thì công cụ nào chưa có ô sẽ không bao giờ có điểm để giành được ô.
 */

const USAGE_KEY = 'infra.toolUsage'
const PINNED_KEY = 'infra.toolPinned'

/** Số ô công cụ trong lưới, KHÔNG tính ô "Tất cả" ở cuối. */
export const TOOL_GRID_SLOTS = 10

function readUsage(): Record<string, ToolUsage> {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, ToolUsage> = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      // Dữ liệu localStorage có thể do bản cũ/bản sau ghi — bỏ mục nào không đúng hình dạng
      // thay vì để `NaN` trôi vào phép tính điểm và làm sort trả về thứ tự vô nghĩa.
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as ToolUsage).count === 'number' &&
        typeof (value as ToolUsage).lastAt === 'number' &&
        Number.isFinite((value as ToolUsage).count) &&
        Number.isFinite((value as ToolUsage).lastAt)
      ) {
        out[key] = { count: (value as ToolUsage).count, lastAt: (value as ToolUsage).lastAt }
      }
    }
    return out
  } catch {
    return {}
  }
}

function readPinned(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PINNED_KEY) || '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* localStorage lỗi (quota/chế độ riêng tư) — chỉ mất phần nhớ, lưới vẫn dùng được */
  }
}

interface ToolUsageState {
  usage: Record<string, ToolUsage>
  /** Id công cụ được ghim, THEO THỨ TỰ user đặt (không sắp lại). */
  pinned: string[]
  /** Ghi một lượt mở công cụ. */
  record: (toolId: string) => void
  togglePin: (toolId: string) => void
  /**
   * Đổi vị trí một mục đã ghim (kéo thả trong hộp cấu hình). `to` là chỉ số của mục ĐÍCH
   * trong danh sách hiện tại — mục được kéo sẽ nằm đúng chỗ đó.
   */
  movePin: (toolId: string, to: number) => void
  /** Bỏ hết ghim + số đếm — nút "đặt lại" trong hộp cấu hình. */
  reset: () => void
}

export const useToolUsageStore = create<ToolUsageState>((set, get) => ({
  usage: readUsage(),
  pinned: readPinned(),
  record: (toolId) => {
    const usage = recordToolUse(get().usage, toolId, Date.now())
    save(USAGE_KEY, usage)
    set({ usage })
  },
  togglePin: (toolId) => {
    const cur = get().pinned
    // Ghim mới xuống CUỐI danh sách ghim: chèn lên đầu thì mỗi lần ghim thêm một cái là toàn
    // bộ thứ tự user đã sắp bị đẩy đi một ô.
    const pinned = cur.includes(toolId) ? cur.filter((x) => x !== toolId) : [...cur, toolId]
    save(PINNED_KEY, pinned)
    set({ pinned })
  },
  movePin: (toolId, to) => {
    const pinned = moveInList(get().pinned, toolId, to)
    save(PINNED_KEY, pinned)
    set({ pinned })
  },
  reset: () => {
    save(USAGE_KEY, {})
    save(PINNED_KEY, [])
    set({ usage: {}, pinned: [] })
  }
}))
