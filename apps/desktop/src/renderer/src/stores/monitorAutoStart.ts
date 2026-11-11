import { create } from 'zustand'
import { cleanMonitorAutoStart, resolveMonitorAutoStart } from '@infra/shared'
import { useDataStore } from './data'
import { useMonitorStore } from './monitor'

/**
 * Tập host monitoring tự bật khi mở app (⚡) — xem `packages/shared/src/monitorAutoStart.ts`.
 *
 * localStorage, cùng khuôn với ghim host/tunnel (`favorites.ts`): theo máy, không qua vault.
 */
const KEY = 'infra.monitorAutoStart'

function read(): string[] {
  try {
    return cleanMonitorAutoStart(JSON.parse(localStorage.getItem(KEY) || '[]'))
  } catch {
    return []
  }
}

interface MonitorAutoStartState {
  /** Id host sẽ tự theo dõi khi mở app; rỗng = tắt. */
  ids: string[]
  /** Lưu đè bằng tập mới; mảng rỗng = tắt. */
  save: (ids: string[]) => void
}

export const useMonitorAutoStartStore = create<MonitorAutoStartState>((set) => ({
  ids: read(),
  save: (ids) => {
    const clean = cleanMonitorAutoStart(ids)
    try {
      if (clean.length === 0) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, JSON.stringify(clean))
    } catch (e) {
      // Ghi hỏng (đầy/khoá) thì vẫn cập nhật state để nút phản ánh ý user trong phiên này, nhưng
      // phải để lại dấu vết: lần sau mở app mà không tự bật thì đây là chỗ đầu tiên cần nhìn
      console.error('[monitor] cannot save auto-start hosts:', e)
    }
    set({ ids: clean })
  }
}))

// Cửa sổ monitor tách rời dùng chung localStorage: đổi ở cửa sổ kia thì nút ở đây cập nhật theo
window.addEventListener('storage', (e) => {
  if (e.key === KEY) useMonitorAutoStartStore.setState({ ids: read() })
})

/**
 * Bắt đầu theo dõi tập đã lưu — App gọi MỘT lần sau khi vault mở và danh bạ đã nạp.
 *
 * Trả `null` khi không làm gì (chưa lưu, danh bạ chưa nạp được, hoặc user đã tự bật monitoring
 * trước đó — không đè lên lựa chọn vừa rồi của họ). Ngược lại trả số host đã bật và số host đã
 * lưu mà không còn theo dõi được, để nơi gọi NÓI RA cho user.
 *
 * ⚠️ Chỉ chạy khi danh bạ đã nạp THÀNH CÔNG (`loaded`). Nạp hỏng thì danh sách host rỗng, mọi id
 * đều thành "không còn" — dọn theo đó là xoá sạch lựa chọn của user chỉ vì một lần đọc vault lỗi.
 */
export async function startMonitorAutoStart(): Promise<{ started: number; missing: number } | null> {
  const ids = useMonitorAutoStartStore.getState().ids
  if (ids.length === 0) return null
  const data = useDataStore.getState()
  if (!data.loaded) return null
  if (useMonitorStore.getState().active) return null
  const { start, missing } = resolveMonitorAutoStart(ids, data.hosts)
  // Dọn host đã xoá / không còn là SSH: giữ lại thì lần nào mở app cũng báo thiếu cùng một host
  if (missing > 0) useMonitorAutoStartStore.getState().save(start.map((h) => h.id))
  if (start.length > 0) await useMonitorStore.getState().start(start)
  return { started: start.length, missing }
}
