import { createRoot } from 'react-dom/client'
import App from './App'
import { DetachedMonitorApp } from './components/DetachedMonitorApp'
import { DetachedTunnelsApp } from './components/DetachedTunnelsApp'
import {
  applyAccent,
  applyBackground,
  applyCustomTheme,
  applyLang,
  applyMouseCursor,
  applyTheme,
  initialSettings
} from './stores/settings'
import './styles/main.css'
import '@xterm/xterm/css/xterm.css'

/**
 * Cửa sổ TÁCH RỜI (main mở index.html với hash) → chỉ render đúng 1 panel, KHÔNG cả app:
 * `#monitor` = dock monitor, `#tunnels` = bảng tunnel.
 */
const detachedRoute = window.location.hash.replace(/^#/, '')
const isDetached = detachedRoute === 'monitor' || detachedRoute === 'tunnels'

// Áp theme + ngôn ngữ + accent + bảng màu + ảnh nền TRƯỚC khi React render để tránh nháy màu (CSP chặn inline script trong index.html)
applyTheme(initialSettings.theme)
applyLang(initialSettings.language)
applyAccent(initialSettings.accentColor)
applyCustomTheme(initialSettings.theme, initialSettings.customColors)
// Cửa sổ tách rời KHÔNG có lớp ảnh nền phía sau → bỏ ảnh nền để panel không bị bán trong suốt
applyBackground(isDetached ? null : initialSettings.backgroundImage)
// Con trỏ áp cho CẢ cửa sổ tách rời — nhảy giữa 2 cửa sổ mà con trỏ đổi hình sẽ rất khó chịu
applyMouseCursor(initialSettings.mouseCursor, initialSettings.customCursors)

function Root() {
  if (detachedRoute === 'monitor') return <DetachedMonitorApp />
  if (detachedRoute === 'tunnels') return <DetachedTunnelsApp />
  return <App />
}

// Không dùng StrictMode: double-mount trong dev làm xterm/PTY khởi tạo 2 lần
createRoot(document.getElementById('root')!).render(<Root />)
