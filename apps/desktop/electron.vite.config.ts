import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'

export default defineConfig({
  main: {
    // Workspace packages là TS source → bundle thẳng vào main; node-pty giữ external (native module)
    plugins: [externalizeDepsPlugin({ exclude: ['@infra/core', '@infra/shared'] })],
    build: {
      rollupOptions: {
        // Entry thứ 2: bootstrap chạy trong worker_thread cho Plugin system → emit out/main/plugin-worker.js
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'plugin-worker': resolve(__dirname, 'src/main/plugins/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@infra/shared'] })]
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  }
})
