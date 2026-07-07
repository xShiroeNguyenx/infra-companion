import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, net } from 'electron'
import { parseManifest, parseRegistry, pluginScopedPath, type RegistryPluginEntry } from '@infra/core'
import {
  IPC,
  type MarketplaceInstallResultDto,
  type MarketplaceListDto,
  type MarketplacePluginDto
} from '@infra/shared'
import { touchActivity } from './vault'

/**
 * Marketplace plugin (F52) — "0 server": registry là file JSON tĩnh trên GitHub Pages.
 * Main tải registry + file plugin (renderer không fetch ngoài vì CSP), verify sha256
 * TỪNG file trước khi ghi vào userData/plugins/<id>/. Cài xong renderer tự gọi
 * plugins.rescan() (cơ chế sẵn có) để nạp plugin — không cần khởi động lại.
 */

const DEFAULT_REGISTRY_URL = 'https://xshiroenguyenx.github.io/infra-companion/registry/plugins.json'
const REGISTRY_CACHE_MS = 5 * 60_000
const MAX_REGISTRY_BYTES = 1_000_000
const MAX_FILE_BYTES = 5_000_000
const FETCH_TIMEOUT_MS = 15_000

function registryUrl(): string {
  return process.env.INFRA_REGISTRY_URL || DEFAULT_REGISTRY_URL
}

/** Tải 1 URL về Buffer, có timeout + trần dung lượng. Throw Error message tiếng Việt. */
async function fetchBytes(url: string, maxBytes: number): Promise<Buffer> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await net.fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${url}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) throw new Error(`File quá lớn (> ${Math.round(maxBytes / 1e6)}MB): ${url}`)
    return buf
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`Hết thời gian chờ khi tải ${url}`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export function registerMarketplaceIpc(): void {
  const pluginsDir = join(app.getPath('userData'), 'plugins')

  let cache: { at: number; entries: RegistryPluginEntry[] } | null = null

  const loadRegistry = async (): Promise<RegistryPluginEntry[]> => {
    if (cache && Date.now() - cache.at < REGISTRY_CACHE_MS) return cache.entries
    const raw = await fetchBytes(registryUrl(), MAX_REGISTRY_BYTES)
    const parsed = parseRegistry(raw.toString('utf8'))
    if (!parsed.ok) throw new Error(`Registry không hợp lệ: ${parsed.errors[0] ?? ''}`)
    cache = { at: Date.now(), entries: parsed.plugins }
    return parsed.plugins
  }

  ipcMain.handle(IPC.MARKETPLACE_LIST, async (): Promise<MarketplaceListDto> => {
    touchActivity()
    try {
      const entries = await loadRegistry()
      const plugins: MarketplacePluginDto[] = entries.map((e) => ({
        id: e.id,
        name: e.name,
        version: e.version,
        description: e.description,
        author: e.author
      }))
      return { ok: true, plugins, error: null }
    } catch (e) {
      return { ok: false, plugins: [], error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.MARKETPLACE_INSTALL, async (_e, id: string): Promise<MarketplaceInstallResultDto> => {
    touchActivity()
    try {
      const entries = await loadRegistry()
      const entry = entries.find((p) => p.id === id)
      if (!entry) throw new Error(`Không thấy plugin "${id}" trong registry`)

      // Tải + verify TOÀN BỘ file vào RAM trước, đạt hết mới ghi — không để lại plugin nửa vời
      const downloads: { path: string; data: Buffer }[] = []
      for (const file of entry.files) {
        const target = pluginScopedPath(pluginsDir, entry.id, file.name)
        if (!target) throw new Error(`Tên file không an toàn: ${file.name}`)
        const data = await fetchBytes(file.url, MAX_FILE_BYTES)
        const digest = createHash('sha256').update(data).digest('hex')
        if (digest !== file.sha256) {
          throw new Error(`Sai checksum ${file.name} — file trên mạng không khớp registry, DỪNG cài`)
        }
        if (file.name === 'manifest.json') {
          const manifest = parseManifest(data.toString('utf8'), entry.id)
          if (!manifest.ok) throw new Error(`manifest.json lỗi: ${manifest.errors[0] ?? ''}`)
          if (manifest.manifest.version !== entry.version) {
            throw new Error(
              `Version lệch: registry ${entry.version} ≠ manifest ${manifest.manifest.version}`
            )
          }
        }
        downloads.push({ path: target, data })
      }

      mkdirSync(join(pluginsDir, entry.id), { recursive: true })
      for (const d of downloads) writeFileSync(d.path, d.data)
      return { ok: true, error: null }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}
