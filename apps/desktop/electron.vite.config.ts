import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'
import { extractChangelogSection } from '../../packages/core/src/help/changelog'

/** Commit ngắn để màn hình Trợ giúp nói được bản này build từ đâu. Build từ tarball (không có
 *  .git) hay máy không có git thì bỏ trống — thiếu commit không đáng làm hỏng build. */
function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return ''
  }
}

/** Ghi chú phát hành của ĐÚNG version đang build, nhúng sẵn để thẻ "Có gì mới" chạy offline. */
function releaseNotes(): string {
  try {
    const md = readFileSync(resolve(__dirname, '../../CHANGELOG.md'), 'utf8')
    return extractChangelogSection(md, pkg.version)
  } catch {
    return ''
  }
}

export default defineConfig({
  main: {
    // Workspace packages là TS source → bundle thẳng vào main; node-pty giữ external (native module)
    plugins: [externalizeDepsPlugin({ exclude: ['@infra/core', '@infra/shared'] })],
    define: {
      // OAuth client Google (Desktop app) — nhúng LÚC BUILD từ env; CI đặt env từ GitHub
      // Variables nên client_id/secret KHÔNG nằm trong source. Với installed app cặp này
      // không phải bí mật (trích được từ binary), giữ ngoài repo chỉ để khỏi hardcode.
      // Build local không đặt env → chuỗi rỗng → tính năng Google Drive báo "chưa cấu hình",
      // các phần còn lại của app không ảnh hưởng. Dev dùng .google-oauth.json ở gốc repo.
      __GOOGLE_CLIENT_ID__: JSON.stringify(process.env.INFRA_GOOGLE_CLIENT_ID ?? ''),
      __GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.INFRA_GOOGLE_CLIENT_SECRET ?? '')
    },
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
      __APP_VERSION__: JSON.stringify(pkg.version),
      // Cùng một nguồn với `author` mà electron-builder ghi làm CompanyName của bản cài —
      // hiện trên màn hình Trợ giúp thì không lệch với thứ Windows hiện ở "Apps & features"
      __PUBLISHER__: JSON.stringify(pkg.author),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
      __GIT_COMMIT__: JSON.stringify(gitCommit()),
      __RELEASE_NOTES__: JSON.stringify(releaseNotes())
    }
  }
})
