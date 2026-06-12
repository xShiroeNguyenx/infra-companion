/** Chuyển đổi giữa textarea "KEY=VALUE mỗi dòng" và object env. */

export function envToText(env: Record<string, string> | null): string {
  if (!env) return ''
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

export function textToEnv(text: string): Record<string, string> | null {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    env[key] = trimmed.slice(idx + 1)
  }
  return Object.keys(env).length > 0 ? env : null
}
