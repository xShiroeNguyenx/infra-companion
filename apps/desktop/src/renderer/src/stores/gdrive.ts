import { create } from 'zustand'
import type { GdriveStatusDto } from '@infra/shared'

/**
 * Trạng thái kết nối Google Drive — dùng CHUNG giữa SyncModal và StatusBar: đăng nhập/ngắt
 * trong modal là dòng "☁️ email" dưới đáy màn hình đổi ngay, không chờ ai poll lại.
 * Chỉ có cờ + email (token thật không bao giờ sang renderer).
 */
interface GdriveState {
  status: GdriveStatusDto | null
  refresh: () => Promise<void>
}

export const useGdriveStore = create<GdriveState>((set) => ({
  status: null,
  refresh: async () => {
    try {
      set({ status: await window.infra.sync.gdriveStatus() })
    } catch {
      // main chưa sẵn sàng / vault hỏng — giữ trạng thái cũ, đừng làm hỏng render
    }
  }
}))
