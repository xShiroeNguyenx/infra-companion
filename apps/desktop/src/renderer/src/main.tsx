import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/main.css'
import '@xterm/xterm/css/xterm.css'

// Không dùng StrictMode: double-mount trong dev làm xterm/PTY khởi tạo 2 lần
createRoot(document.getElementById('root')!).render(<App />)
