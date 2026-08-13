/// <reference types="vite/client" />
import type { InfraApi } from '@infra/shared'

declare global {
  interface Window {
    infra: InfraApi
  }
  /** Version app, inject lúc build từ package.json (electron.vite.config.ts). */
  const __APP_VERSION__: string
  /** Thời điểm build, ISO 8601 — màn hình Trợ giúp hiện "bản này build ngày nào". */
  const __BUILD_DATE__: string
  /** Tên người phát hành, lấy từ `author` trong package.json (= CompanyName của bản cài). */
  const __PUBLISHER__: string
  /** Commit ngắn lúc build; rỗng khi build ngoài git checkout. */
  const __GIT_COMMIT__: string
  /** Mục CHANGELOG của đúng version này (markdown); rỗng khi chưa viết mục cho version đó. */
  const __RELEASE_NOTES__: string
}

export {}
