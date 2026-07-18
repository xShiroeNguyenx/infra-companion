import { createRoot } from 'react-dom/client'
import App from './App'
import { DetachedMonitorApp } from './components/DetachedMonitorApp'
import {
  applyAccent,
  applyBackground,
  applyCustomTheme,
  applyLang,
  applyTheme,
  initialSettings
} from './stores/settings'
import './styles/main.css'
import '@xterm/xterm/css/xterm.css'

// Cửa sổ monitor tách rời (main mở với hash #monitor) → chỉ render dock monitor, KHÔNG cả app.
const isDetachedMonitor = window.location.hash.replace(/^#/, '') === 'monitor'

// Áp theme + ngôn ngữ + accent + bảng màu + ảnh nền TRƯỚC khi React render để tránh nháy màu (CSP chặn inline script trong index.html)
applyTheme(initialSettings.theme)
applyLang(initialSettings.language)
applyAccent(initialSettings.accentColor)
applyCustomTheme(initialSettings.theme, initialSettings.customColors)
// Cửa sổ tách rời KHÔNG có lớp ảnh nền phía sau → bỏ ảnh nền để panel không bị bán trong suốt
applyBackground(isDetachedMonitor ? null : initialSettings.backgroundImage)

// Không dùng StrictMode: double-mount trong dev làm xterm/PTY khởi tạo 2 lần
createRoot(document.getElementById('root')!).render(isDetachedMonitor ? <DetachedMonitorApp /> : <App />)
