import { create } from 'zustand'

export type AppModal =
  | 'snippets'
  | 'tunnels'
  | 'keys'
  | 'bulk'
  | 'net'
  | 'monitor'
  | 'sync'
  | 'ai'
  | 'ai-diagnose'
  | 'recordings'
  | 'settings'
  | 'workspaces'
  | 'plugins'
  | null

interface UiState {
  modal: AppModal
  setModal: (m: AppModal) => void
  /** Thu gọn cột host bên trái để phóng to vùng làm việc (nhớ qua localStorage). */
  sidebarCollapsed: boolean
  toggleSidebar: () => void
}

const SIDEBAR_KEY = 'infra.sidebar.collapsed'

/**
 * Modal toàn cục mount MỘT instance duy nhất (ở App). Sidebar/Command Palette chỉ gọi setModal.
 * Trước đây Sidebar mount bộ modal riêng → mở Monitoring 2 nơi tạo 2 instance dẫm chân nhau
 * (main chỉ có 1 subscriber + STOP_ALL toàn cục).
 */
export const useUiStore = create<UiState>((set) => ({
  modal: null,
  setModal: (modal) => set({ modal }),
  sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === '1',
  toggleSidebar: () =>
    set((s) => {
      const collapsed = !s.sidebarCollapsed
      try {
        localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
      } catch {
        /* localStorage lỗi — chỉ mất persist, vẫn toggle được */
      }
      return { sidebarCollapsed: collapsed }
    })
}))
