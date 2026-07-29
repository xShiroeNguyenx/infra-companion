import type { ServiceStatus } from './types'

/**
 * Seam cho "CÁCH chạy stack". v1 chỉ có `ManagedStackProvider` (app tự tải & tự supervise
 * runtime). Sau này thêm `DockerStackProvider` (sinh docker-compose) hoặc `AdoptStackProvider`
 * (điều khiển Laragon/XAMPP đã cài) chỉ cần implement interface này — KHÔNG đụng tầng IPC/UI.
 */
export interface StackCapabilities {
  canInstallRuntime: boolean
  canReload: boolean
  canIssueCert: boolean
  canEditHosts: boolean
}

export interface StackProvider {
  readonly id: 'managed' | 'docker' | 'adopt'
  readonly capabilities: StackCapabilities

  /** Gọi 1 lần lúc app khởi động: dọn tmp + diệt orphan lần chạy trước. */
  init(): Promise<{ reaped: number }>

  services(): ServiceStatus[]
  start(serviceId: string): Promise<void>
  stop(serviceId: string): Promise<void>
  restart(serviceId: string): Promise<void>

  /** Bật toàn bộ stack (nginx + mọi pool php đang cần). */
  startAll(): Promise<void>
  stopAll(): Promise<void>

  /** Sinh lại config từ danh sách site rồi reload — nguồn sự thật là DB, không phải file conf. */
  applySites(): Promise<{ ok: boolean; error?: string }>

  tailLog(serviceId: string, lines: number): string[]
  dispose(graceMs: number): Promise<void>
}
