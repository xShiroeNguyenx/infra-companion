import { create } from 'zustand'

const KEY = 'infra.tray.closeToTray'

interface TrayState {
  /**
   * F53 — bấm ✕ cửa sổ chính thì ẨN vào khay hệ thống thay vì thoát (tunnel, theo dõi, uptime
   * watcher vẫn chạy). Mặc định BẬT: đó là lý do tính năng tồn tại; ai muốn ✕ = thoát thì tắt ở
   * Settings → Ứng dụng. Per-máy, localStorage; main nhận giá trị qua `app.setTrayPrefs`.
   */
  closeToTray: boolean
  setCloseToTray: (v: boolean) => void
}

export const useTrayStore = create<TrayState>((set) => ({
  closeToTray: localStorage.getItem(KEY) !== '0',
  setCloseToTray: (closeToTray) => {
    try {
      localStorage.setItem(KEY, closeToTray ? '1' : '0')
    } catch {
      /* localStorage lỗi — chỉ mất persist */
    }
    set({ closeToTray })
  }
}))
