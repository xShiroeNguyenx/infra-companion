import { ipcMain, net } from 'electron'
import { importDroplets, parseDropletsPage } from '@infra/core'
import {
  IPC,
  type DoAccountDto,
  type DoAccountInput,
  type DoConfigDto,
  type DoDropletDto,
  type DoImportOptions,
  type DoImportResult,
  type DoListRequest,
  type DoListResult
} from '@infra/shared'
import { getVault, touchActivity } from './vault'

/**
 * F05 — import host từ DigitalOcean (mảnh đầu của Cloud import).
 *
 * Main chỉ lo phần MẠNG: token + phân trang. Parse trang và ghi vault là hàm thuần ở
 * `@infra/core` (test không cần mạng). Lỗi trả về dạng MÃ (`unauthorized`/`timeout`/…)
 * chứ không phải câu chữ — renderer dịch lúc render, đổi ngôn ngữ là thông báo đổi theo.
 *
 * Token: NHIỀU tài khoản, mỗi token mã hoá DEK trong meta của vault (pattern ai_api_key),
 * không bao giờ qua IPC sang renderer — renderer chỉ thấy danh bạ {id, label}. Chỉ ĐỌC từ
 * API (GET /v2/droplets), không có đường nào tạo/xoá/sửa gì trên DigitalOcean.
 */

const API_URL = 'https://api.digitalocean.com/v2/droplets'
const PER_PAGE = 200
/** Trần phân trang: 25 trang × 200 = 5000 droplet — hơn nữa gần như chắc chắn là vòng lặp lỗi. */
const MAX_PAGES = 25
const FETCH_TIMEOUT_MS = 15_000

async function fetchPage(token: string, page: number): Promise<{ status: number; json: unknown }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await net.fetch(`${API_URL}?page=${page}&per_page=${PER_PAGE}`, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) return { status: res.status, json: null }
    return { status: res.status, json: await res.json() }
  } finally {
    clearTimeout(timer)
  }
}

export function registerDigitalOceanIpc(): void {
  ipcMain.handle(IPC.IMPORT_DO_CONFIG, (): DoConfigDto => {
    touchActivity()
    return { accounts: getVault().listDoAccounts() }
  })

  ipcMain.handle(IPC.IMPORT_DO_SAVE_ACCOUNT, (_e, input: DoAccountInput): DoAccountDto => {
    touchActivity()
    return getVault().saveDoAccount(input)
  })

  ipcMain.handle(IPC.IMPORT_DO_DELETE_ACCOUNT, (_e, id: string): void => {
    touchActivity()
    getVault().deleteDoAccount(id)
  })

  ipcMain.handle(IPC.IMPORT_DO_LIST, async (_e, request: DoListRequest): Promise<DoListResult> => {
    touchActivity()
    const vault = getVault()
    const token =
      request.tokenOverride?.trim() || (request.accountId ? vault.getDoToken(request.accountId) : undefined)
    if (!token) return { ok: false, error: 'noToken' }

    const droplets: DoDropletDto[] = []
    const warnings: string[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      let status: number
      let json: unknown
      try {
        ;({ status, json } = await fetchPage(token, page))
      } catch (error) {
        if ((error as Error).name === 'AbortError') return { ok: false, error: 'timeout' }
        return { ok: false, error: 'network', detail: error instanceof Error ? error.message : String(error) }
      }
      if (status === 401) return { ok: false, error: 'unauthorized' }
      if (status < 200 || status >= 300) return { ok: false, error: 'http', detail: `HTTP ${status}` }

      const parsed = parseDropletsPage(json)
      if (parsed.malformed) return { ok: false, error: 'badResponse' }
      droplets.push(...parsed.droplets)
      warnings.push(...parsed.warnings)
      if (parsed.droplets.length < PER_PAGE) break
      if (page === MAX_PAGES) warnings.push(`Danh sách cắt ở ${MAX_PAGES * PER_PAGE} droplet đầu`)
    }

    // Đánh dấu droplet đã có host trùng địa chỉ — UI khoá chọn, import cũng tự bỏ qua
    // (đánh dấu ở đây vì chỉ main nhìn được vault; renderer nhận DTO đã điền sẵn).
    const existing = new Set(vault.listHosts().map((h) => h.hostname.trim().toLowerCase()))
    for (const droplet of droplets) {
      const address = droplet.publicIp ?? droplet.privateIp
      droplet.exists = address !== null && existing.has(address.trim().toLowerCase())
    }
    return { ok: true, droplets, warnings }
  })

  ipcMain.handle(
    IPC.IMPORT_DO_RUN,
    (_e, droplets: DoDropletDto[], options: DoImportOptions): DoImportResult => {
      touchActivity()
      return importDroplets(getVault(), droplets, options)
    }
  )
}
