import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parseManifest, type PluginManifest } from './manifest'

export interface DiscoveredPlugin {
  id: string
  /** Đường dẫn tuyệt đối thư mục plugin. */
  dir: string
  /** Đường dẫn tuyệt đối entry CJS, đã đảm bảo nằm trong `dir`. */
  entry: string
  manifest: PluginManifest
}

export interface InvalidPlugin {
  /** Tên thư mục (id dự kiến). */
  id: string
  dir: string
  errors: string[]
}

export interface DiscoverResult {
  valid: DiscoveredPlugin[]
  invalid: InvalidPlugin[]
}

/**
 * Quét thư mục plugins — mỗi thư mục con cấp 1 = 1 plugin. Đọc + validate manifest.json,
 * kiểm tra entry không thoát ra ngoài thư mục plugin. KHÔNG throw:
 * thiếu thư mục plugins → trả về rỗng; plugin lỗi → vào danh sách `invalid`.
 */
export function discoverPlugins(pluginsDir: string): DiscoverResult {
  const valid: DiscoveredPlugin[] = []
  const invalid: InvalidPlugin[] = []

  let names: string[]
  try {
    names = readdirSync(pluginsDir)
  } catch {
    return { valid, invalid }
  }

  for (const name of names) {
    const dir = join(pluginsDir, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }

    let text: string
    try {
      text = readFileSync(join(dir, 'manifest.json'), 'utf8')
    } catch {
      invalid.push({ id: name, dir, errors: ['thiếu manifest.json'] })
      continue
    }

    const result = parseManifest(text, name)
    if (!result.ok) {
      invalid.push({ id: name, dir, errors: result.errors })
      continue
    }

    const dirResolved = resolve(dir)
    const entry = resolve(dir, result.manifest.main)
    if (entry !== dirResolved && !entry.startsWith(dirResolved + sep)) {
      invalid.push({ id: name, dir: dirResolved, errors: ['main thoát ra ngoài thư mục plugin'] })
      continue
    }

    valid.push({ id: result.manifest.id, dir: dirResolved, entry, manifest: result.manifest })
  }

  return { valid, invalid }
}
