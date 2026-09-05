import { create } from 'zustand'
import { useToolUsageStore } from './toolUsage'

export type AppModal =
  | 'export-hosts'
  | 'do-import'
  | 'known-hosts'
  | 'log-tail'
  | 'cron'
  | 'key-rotate'
  | 'disk-usage'
  | 'pkg-updates'
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
  | 'replication'
  | 'compare'
  | 'hostmap'
  | 'localdev-settings'
  | 'help'
  | null

/**
 * Mục đang chọn trên thanh điều hướng của theme Navigator. Vùng chính (khi không tab nào
 * active) vẽ đúng mục này thay cho Dashboard. Theme Infra không đọc giá trị này.
 */
export type NavSection =
  | 'dashboard'
  | 'hosts'
  | 'sftp'
  | 'tunnels'
  | 'snippets'
  | 'keys'
  | 'workspaces'
  | 'history'
  | 'tools'

const NAV_SECTIONS: readonly NavSection[] = [
  'dashboard',
  'hosts',
  'sftp',
  'tunnels',
  'snippets',
  'keys',
  'workspaces',
  'history',
  'tools'
]

interface UiState {
  modal: AppModal
  /** Theme Navigator: mục đang chọn ở cột trái (nhớ qua localStorage để mở lại đúng chỗ). */
  navSection: NavSection
  setNavSection: (s: NavSection) => void
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
const NAV_KEY = 'infra.nav.section'

function readNavSection(): NavSection {
  const v = localStorage.getItem(NAV_KEY)
  return (NAV_SECTIONS as readonly string[]).includes(v ?? '') ? (v as NavSection) : 'hosts'
}

/**
 * Modal toàn cục mount MỘT instance duy nhất (ở App). Sidebar/Command Palette chỉ gọi setModal.
 * Trước đây Sidebar mount bộ modal riêng → mở Monitoring 2 nơi tạo 2 instance dẫm chân nhau
 * (main chỉ có 1 subscriber + STOP_ALL toàn cục).
 */
export const useUiStore = create<UiState>((set) => ({
  modal: null,
  // Mở cửa sổ chẩn đoán (từ menu/palette/pill) luôn xoá cờ thu nhỏ để hiện đầy đủ.
  setModal: (modal) => {
    // Đếm lượt dùng cho lưới công cụ Dashboard. Đặt ở ĐÂY vì mọi đường mở công cụ (menu `⋯`,
    // Command Palette, lưới, tab "Tất cả tính năng") đều đi qua `setModal` — đếm ở riêng lưới
    // thì công cụ chưa có ô sẽ không bao giờ kiếm được điểm để giành ô.
    // `null` là ĐÓNG modal, không phải mở gì.
    if (modal !== null) useToolUsageStore.getState().record(modal)
    set(modal === 'ai-diagnose' ? { modal, aiDiagnoseMin: false } : { modal })
  },
  navSection: readNavSection(),
  setNavSection: (navSection) => {
    try {
      localStorage.setItem(NAV_KEY, navSection)
    } catch {
      /* localStorage lỗi — chỉ mất persist */
    }
    set({ navSection })
  },
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
