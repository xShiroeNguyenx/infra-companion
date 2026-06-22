import { createRoot } from 'react-dom/client'
import App from './App'
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

// Áp theme + ngôn ngữ + accent + bảng màu + ảnh nền TRƯỚC khi React render để tránh nháy màu (CSP chặn inline script trong index.html)
applyTheme(initialSettings.theme)
applyLang(initialSettings.language)
applyAccent(initialSettings.accentColor)
applyCustomTheme(initialSettings.theme, initialSettings.customColors)
applyBackground(initialSettings.backgroundImage)

// Không dùng StrictMode: double-mount trong dev làm xterm/PTY khởi tạo 2 lần
createRoot(document.getElementById('root')!).render(<App />)
