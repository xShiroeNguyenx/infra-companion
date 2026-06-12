/// <reference types="vite/client" />
import type { InfraApi } from '@infra/shared'

declare global {
  interface Window {
    infra: InfraApi
  }
}

export {}
