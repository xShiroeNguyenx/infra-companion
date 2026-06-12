/** Helper đường dẫn chạy trong renderer (không có node:path) — hỗ trợ cả Windows lẫn POSIX. */

export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:/.test(p) || p.includes('\\')
}

export function joinPath(dir: string, name: string): string {
  const sep = isWindowsPath(dir) ? '\\' : '/'
  if (dir.endsWith('\\') || dir.endsWith('/')) return dir + name
  return dir + sep + name
}

export function parentPath(p: string): string {
  if (isWindowsPath(p)) {
    const trimmed = p.replace(/[\\/]+$/, '')
    if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + '\\'
    const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
    if (idx <= 2) return trimmed.slice(0, 2) + '\\'
    return trimmed.slice(0, idx)
  }
  const trimmed = p.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return '/'
  return trimmed.slice(0, idx)
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatTime(ms: number): string {
  if (!ms) return ''
  const date = new Date(ms)
  return `${date.toLocaleDateString('vi-VN')} ${date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
}
