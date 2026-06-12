/// <reference types="vite/client" />
import type { InfraApi } from '@infra/shared'

declare global {
  interface Window {
    infra: InfraApi
  }
  /** Version app, inject lúc build từ package.json (electron.vite.config.ts). */
  const __APP_VERSION__: string
}

export {}
