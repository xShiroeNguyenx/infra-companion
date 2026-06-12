import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Workspace packages là TS source → bundle thẳng vào main; node-pty giữ external (native module)
    plugins: [externalizeDepsPlugin({ exclude: ['@infra/core', '@infra/shared'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@infra/shared'] })]
  },
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
