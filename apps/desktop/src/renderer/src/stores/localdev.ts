import { create } from 'zustand'
import type {
  LdDbStatusDto,
  LdHealthDto,
  LdRuntimeDto,
  LdRuntimeProgressDto,
  LdServiceActionDto,
  LdServiceDto,
  LdSettingsDto,
  LdSiteDto,
  LdSiteEventDto,
  LdSiteInputDto
} from '@infra/shared'
import { errorMessage, useToastsStore } from './toasts'

/**
 * Local dev stack (Laragon/LocalWP-style). Store RIÊNG, không nhập vào `useDataStore`:
 * `data.ts` là inventory SSH nằm trong vault và chỉ refresh sau khi unlock, còn trạng thái
 * local dev do main supervise độc lập vault. Tách store cũng giúp cắt tính năng về sau chỉ
 * là xoá 1 file (xem "exit list" trong plan).
 */

/** Chấm màu tổng của stack — dùng chung cho TabsBar + StatusBar, không tính lại logic 2 nơi. */
export type LdStackDot = 'running' | 'partial' | 'stopped' | 'error'

interface LocaldevState {
  /** Tính năng có bật không (settings.enabled). Mặc định false → ẩn hoàn toàn khỏi UI. */
  enabled: boolean
  settings: LdSettingsDto | null
  health: LdHealthDto | null
  runtimes: LdRuntimeDto[]
  /** Tiến độ tải theo runtime id. */
  downloads: Record<string, LdRuntimeProgressDto>
  services: LdServiceDto[]
  sites: LdSiteDto[]
  /** Trạng thái MariaDB (null = chưa hỏi). */
  dbStatus: LdDbStatusDto | null
  /** Site đang mở panel chi tiết — payload không nhét vào AppModal (union phẳng). */
  detailSiteId: string | null
  loaded: boolean

  /** Đọc cờ enabled (gọi sớm, rẻ) — quyết định có hiện entry point hay không. */
  refreshEnabled: () => Promise<void>
  /** Nạp toàn bộ trạng thái; no-op khi tính năng đang tắt. */
  refreshAll: () => Promise<void>
  setEnabled: (on: boolean) => Promise<void>
  saveSettings: (patch: Partial<LdSettingsDto>) => Promise<void>
  serviceAction: (id: string, action: LdServiceActionDto) => Promise<void>
  /** Chạy cả stack: pool php TRƯỚC rồi nginx (ngược lại thì request đầu tiên 502). */
  startAll: () => Promise<void>
  stopAll: () => Promise<void>
  setDetailSite: (id: string | null) => void
  /** Cài runtime; `fromFile` = chọn file đã tải sẵn thay vì tải qua mạng. */
  installRuntime: (id: string, fromFile?: boolean) => Promise<void>
  removeRuntime: (id: string) => Promise<void>
  /** Thêm site trỏ vào folder có sẵn; trả về site đã tạo (null nếu lỗi/huỷ). */
  addSite: (name: string, rootPath: string) => Promise<LdSiteDto | null>
  /** Sửa site: tên / domain / loại / docroot / bản PHP. Trả null nếu lỗi (toast đã hiện). */
  editSite: (input: LdSiteInputDto) => Promise<LdSiteDto | null>
  /** Mở site bằng browser có DNS override → URL không có :port, không cần hosts entry. */
  openSiteNoPort: (id: string) => Promise<void>
  /** removeFiles=false: chỉ bỏ khỏi danh sách, KHÔNG xoá file của user. */
  deleteSite: (id: string, removeFiles: boolean) => Promise<void>
  /** Cấp (hoặc lấy lại) database cho site. Idempotent — site đã có DB thì trả credential cũ. */
  provisionDb: (siteId: string) => Promise<void>
  /** Xuất DB của site ra file .sql (main mở hộp thoại chọn nơi lưu). */
  dumpDb: (siteId: string) => Promise<void>
  /** Nạp 1 file .sql vào DB của site — đường mang dữ liệu từ XAMPP/Laragon/prod sang. */
  importDb: (siteId: string) => Promise<void>
  /** Ghi credential DB vào wp-config.php của site (backup file cũ trước). */
  writeWpConfig: (siteId: string) => Promise<void>
  /** Mở Adminer trong browser (công cụ DB nhẹ, 1 file). */
  openAdminer: (siteId?: string) => Promise<void>
  /** Mở phpMyAdmin trong browser — cùng vai trò Adminer, cho ai quen giao diện XAMPP. */
  openPhpMyAdmin: (siteId?: string) => Promise<void>

  // Nhận event push từ main (đăng ký 1 lần ở App.tsx)
  applyServiceEvent: (s: LdServiceDto) => void
  applyRuntimeProgress: (p: LdRuntimeProgressDto) => void
  applySiteEvent: (e: LdSiteEventDto) => void
}

const toastError = (error: unknown): void => useToastsStore.getState().push(errorMessage(error))

export const useLocaldevStore = create<LocaldevState>((set, get) => ({
  enabled: false,
  settings: null,
  health: null,
  runtimes: [],
  downloads: {},
  services: [],
  sites: [],
  dbStatus: null,
  detailSiteId: null,
  loaded: false,

  refreshEnabled: async () => {
    try {
      set({ enabled: await window.infra.localdev.enabled() })
    } catch {
      // Tính năng phụ — lỗi ở đây không được làm ồn khi app khởi động
      set({ enabled: false })
    }
  },

  refreshAll: async () => {
    if (!get().enabled) {
      set({ loaded: true })
      return
    }
    try {
      const [settings, health, runtimes, services, sites, dbStatus] = await Promise.all([
        window.infra.localdev.settingsGet(),
        window.infra.localdev.health(),
        window.infra.localdev.runtimeCatalog(),
        window.infra.localdev.services(),
        window.infra.localdev.sites(),
        window.infra.localdev.dbStatus()
      ])
      set({ settings, health, runtimes, services, sites, dbStatus, loaded: true })
    } catch (error) {
      toastError(error)
      set({ loaded: true })
    }
  },

  setEnabled: async (on) => {
    try {
      const settings = await window.infra.localdev.settingsSet({ enabled: on })
      set({ settings, enabled: settings.enabled })
      if (settings.enabled) await get().refreshAll()
      else set({ runtimes: [], services: [], sites: [], health: null, dbStatus: null, detailSiteId: null })
    } catch (error) {
      toastError(error)
    }
  },

  saveSettings: async (patch) => {
    try {
      const settings = await window.infra.localdev.settingsSet(patch)
      set({ settings, enabled: settings.enabled })
      // Đổi root/port → health đổi theo (cảnh báo path có dấu cách…)
      set({ health: await window.infra.localdev.health() })
    } catch (error) {
      toastError(error)
    }
  },

  serviceAction: async (id, action) => {
    try {
      const res = await window.infra.localdev.serviceAction(id, action)
      if (!res.ok) useToastsStore.getState().push(res.error ?? 'Không thực hiện được', 'error')
      // refreshAll (không chỉ services): cảnh báo ở health phụ thuộc trạng thái service
      await get().refreshAll()
    } catch (error) {
      toastError(error)
    }
  },

  startAll: async () => {
    try {
      // Thứ tự QUAN TRỌNG: MariaDB → php → nginx.
      // nginx upstream trỏ vào cổng php (start trước thì request đầu 502), và WordPress cần DB
      // sẵn sàng ngay ở request đầu, nếu không sẽ hiện "Error establishing a database connection".
      const groups = [...new Set(get().services.map((s) => s.groupId))]
      const order = (g: string): number => {
        if (g.startsWith('mariadb')) return 0
        if (g.startsWith('php-')) return 1
        return 2
      }
      for (const g of [...groups].sort((a, b) => order(a) - order(b))) {
        const res = await window.infra.localdev.serviceAction(g, 'start')
        if (!res.ok) useToastsStore.getState().push(res.error ?? `Không chạy được ${g}`, 'error')
      }
      await get().refreshAll()
    } catch (error) {
      toastError(error)
    }
  },

  stopAll: async () => {
    try {
      const res = await window.infra.localdev.stopAll()
      if (!res.ok) useToastsStore.getState().push(res.error ?? 'Không dừng được', 'error')
      await get().refreshAll()
    } catch (error) {
      toastError(error)
    }
  },

  setDetailSite: (detailSiteId) => set({ detailSiteId }),

  installRuntime: async (id, fromFile) => {
    try {
      const res = await window.infra.localdev.runtimeInstall(id, fromFile)
      // 'Đã huỷ' = user bấm Cancel ở hộp thoại chọn file → không phải lỗi, đừng làm ồn
      if (!res.ok && res.error && res.error !== 'Đã huỷ') {
        useToastsStore.getState().push(res.error, 'error')
      }
      await get().refreshAll()
    } catch (error) {
      toastError(error)
    }
  },

  removeRuntime: async (id) => {
    try {
      const res = await window.infra.localdev.runtimeRemove(id)
      if (!res.ok) useToastsStore.getState().push(res.error ?? 'Không gỡ được', 'error')
      await get().refreshAll()
    } catch (error) {
      toastError(error)
    }
  },

  addSite: async (name, rootPath) => {
    try {
      const site = await window.infra.localdev.siteSave({ name, rootPath })
      await get().refreshAll()
      return site
    } catch (error) {
      toastError(error)
      return null
    }
  },

  editSite: async (input) => {
    try {
      const site = await window.infra.localdev.siteSave(input)
      await get().refreshAll()
      return site
    } catch (error) {
      toastError(error)
      return null
    }
  },

  openSiteNoPort: async (id) => {
    try {
      const res = await window.infra.localdev.siteOpenNoPort(id)
      if (!res.ok) useToastsStore.getState().push(res.error ?? 'Không mở được browser', 'error')
    } catch (error) {
      toastError(error)
    }
  },

  deleteSite: async (id, removeFiles) => {
    try {
      const res = await window.infra.localdev.siteDelete(id, removeFiles)
      if (!res.ok) useToastsStore.getState().push(res.error ?? 'Không xoá được', 'error')
      await get().refreshAll()
    } catch (error) {
      toastError(error)
    }
  },

  provisionDb: async (siteId) => {
    try {
      const res = await window.infra.localdev.dbProvision(siteId)
      if (!res.ok) {
        useToastsStore.getState().push(res.error ?? 'Không cấp được database', 'error')
      } else {
        useToastsStore.getState().push(`Đã cấp database ${res.dbName ?? ''}`, 'info')
      }
      await get().refreshAll()
    } catch (error) {
      toastError(error)
    }
  },

  dumpDb: async (siteId) => {
    try {
      const res = await window.infra.localdev.dbDump(siteId)
      // 'Đã huỷ' = user bấm Cancel ở hộp thoại lưu file → không phải lỗi
      if (!res.ok && res.error && res.error !== 'Đã huỷ') {
        useToastsStore.getState().push(res.error, 'error')
      } else if (res.ok) {
        useToastsStore.getState().push('Đã xuất database', 'info')
      }
    } catch (error) {
      toastError(error)
    }
  },

  importDb: async (siteId) => {
    try {
      const res = await window.infra.localdev.dbImport(siteId)
      if (!res.ok && res.error && res.error !== 'Đã huỷ') {
        useToastsStore.getState().push(res.error, 'error')
      } else if (res.ok) {
        useToastsStore.getState().push('Đã nạp dump vào database', 'info')
      }
      await get().refreshAll()
    } catch (error) {
      toastError(error)
    }
  },

  writeWpConfig: async (siteId) => {
    try {
      const res = await window.infra.localdev.siteWpConfigWrite(siteId)
      if (!res.ok) useToastsStore.getState().push(res.error ?? 'Không ghi được wp-config.php', 'error')
      else useToastsStore.getState().push('Đã cập nhật wp-config.php (bản cũ nằm trong trash/)', 'info')
      await get().refreshAll()
    } catch (error) {
      toastError(error)
    }
  },

  openAdminer: async (siteId) => {
    try {
      const res = await window.infra.localdev.dbAdminer(siteId)
      if (!res.ok) useToastsStore.getState().push(res.error ?? 'Không mở được Adminer', 'error')
    } catch (error) {
      toastError(error)
    }
  },

  openPhpMyAdmin: async (siteId) => {
    try {
      const res = await window.infra.localdev.dbPhpMyAdmin(siteId)
      if (!res.ok) useToastsStore.getState().push(res.error ?? 'Không mở được phpMyAdmin', 'error')
    } catch (error) {
      toastError(error)
    }
  },

  applyServiceEvent: (s) =>
    set((prev) => {
      const i = prev.services.findIndex((x) => x.id === s.id)
      if (i < 0) return { services: [...prev.services, s] }
      const services = [...prev.services]
      services[i] = s
      return { services }
    }),

  applyRuntimeProgress: (p) =>
    set((prev) => ({ downloads: { ...prev.downloads, [p.id]: p } })),

  applySiteEvent: (e) =>
    set((prev) => ({
      sites: prev.sites.map((s) =>
        s.id === e.siteId
          ? { ...s, status: e.phase === 'error' ? 'error' : e.phase === 'done' ? 'ready' : 'creating' }
          : s
      )
    }))
}))

/** Chấm màu tổng: có service lỗi → error; chạy hết → running; một phần → partial. */
export function stackDot(s: LocaldevState): LdStackDot {
  const list = s.services
  if (list.length === 0) return 'stopped'
  if (list.some((x) => x.state === 'crashed' || x.state === 'unhealthy' || x.state === 'missing-runtime')) {
    return 'error'
  }
  const running = list.filter((x) => x.state === 'running').length
  if (running === 0) return 'stopped'
  return running === list.length ? 'running' : 'partial'
}
