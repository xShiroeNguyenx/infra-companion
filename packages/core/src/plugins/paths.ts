import { join, resolve, sep } from 'node:path'

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Đường dẫn 1 file thuộc thư mục plugin, có chặn thoát thư mục (defense-in-depth):
 * - pluginId phải kebab-case (không "/", "\\", "..");
 * - kết quả phải nằm trong pluginsDir/pluginId.
 * Trả về null nếu không an toàn.
 */
export function pluginScopedPath(pluginsDir: string, pluginId: string, file: string): string | null {
  if (!ID_RE.test(pluginId)) return null
  if (file.includes('..') || file.includes('/') || file.includes('\\')) return null
  const base = resolve(join(pluginsDir, pluginId))
  const full = resolve(join(base, file))
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}
