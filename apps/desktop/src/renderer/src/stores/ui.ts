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
  | 'processes'
  | 'services'
  | null

interface UiState {
  modal: AppModal
  setModal: (m: AppModal) => void
  /**
   * F48 — cửa sổ AI chẩn đoán đang thu nhỏ xuống pill (session vẫn chạy nền trong store
   * aiDiagnose). Tách khỏi `modal` để khi thu nhỏ thì bỏ backdrop (app dùng được) mà
   * vẫn còn pill để bung lại. Mở lại ('ai-diagnose') tự xoá cờ này.
   */
  aiDiagnoseMin: boolean
  /** Thu nhỏ cửa sổ chẩn đoán: ẩn modal (bỏ backdrop) + hiện pill. */
  minimizeAiDiagnose: () => void
  /** Đóng pill (không dừng session — mở lại qua menu/palette vẫn thấy phiên đang chạy). */
  setAiDiagnoseMin: (v: boolean) => void
  /** Thu gọn cột host bên trái để phóng to vùng làm việc (nhớ qua localStorage). */
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  /** Command Palette (Ctrl+Shift+P) — đưa lên store để nút toolbar cũng mở được. */
  paletteOpen: boolean
  setPaletteOpen: (v: boolean) => void
  togglePalette: () => void
}

const SIDEBAR_KEY = 'infra.sidebar.collapsed'

/**
 * Modal toàn cục mount MỘT instance duy nhất (ở App). Sidebar/Command Palette chỉ gọi setModal.
 * Trước đây Sidebar mount bộ modal riêng → mở Monitoring 2 nơi tạo 2 instance dẫm chân nhau
 * (main chỉ có 1 subscriber + STOP_ALL toàn cục).
 */
export const useUiStore = create<UiState>((set) => ({
  modal: null,
  // Mở cửa sổ chẩn đoán (từ menu/palette/pill) luôn xoá cờ thu nhỏ để hiện đầy đủ.
  setModal: (modal) => set(modal === 'ai-diagnose' ? { modal, aiDiagnoseMin: false } : { modal }),
  aiDiagnoseMin: false,
  minimizeAiDiagnose: () => set({ modal: null, aiDiagnoseMin: true }),
  setAiDiagnoseMin: (aiDiagnoseMin) => set({ aiDiagnoseMin }),
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
    }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen }))
}))
