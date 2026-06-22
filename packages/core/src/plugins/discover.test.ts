import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { discoverPlugins } from './discover'
import { pluginScopedPath } from './paths'

const roots: string[] = []
function newPluginsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'infra-plugins-'))
  roots.push(dir)
  return dir
}
function writePlugin(pluginsDir: string, id: string, manifest: unknown, opts?: { withIndex?: boolean }): void {
  const dir = join(pluginsDir, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
  if (opts?.withIndex !== false) writeFileSync(join(dir, 'index.js'), 'module.exports.activate = () => {}')
}

afterAll(() => {
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('discoverPlugins', () => {
  test('thư mục plugins không tồn tại → rỗng, không throw', () => {
    const r = discoverPlugins(join(tmpdir(), 'khong-ton-tai-' + Math.round(performance.now())))
    expect(r.valid).toEqual([])
    expect(r.invalid).toEqual([])
  })

  test('phân loại valid / invalid', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'good', { id: 'good', name: 'Good', version: '1.0.0' })
    writePlugin(dir, 'broken', '{ bad json')
    writePlugin(dir, 'mismatch', { id: 'other', name: 'X', version: '1.0.0' })
    // thư mục thiếu manifest
    mkdirSync(join(dir, 'no-manifest'), { recursive: true })

    const r = discoverPlugins(dir)
    expect(r.valid.map((p) => p.id)).toEqual(['good'])
    const invalidIds = r.invalid.map((p) => p.id).sort()
    expect(invalidIds).toEqual(['broken', 'mismatch', 'no-manifest'])
    const mismatch = r.invalid.find((p) => p.id === 'mismatch')
    expect(mismatch?.errors.join(' ')).toContain('trùng tên thư mục')
  })

  test('entry resolve nằm trong thư mục plugin', () => {
    const dir = newPluginsDir()
    writePlugin(dir, 'p1', { id: 'p1', name: 'P1', version: '1.0.0', main: 'index.js' })
    const r = discoverPlugins(dir)
    expect(r.valid).toHaveLength(1)
    expect(r.valid[0]!.entry).toBe(join(dir, 'p1', 'index.js'))
  })

  test('file (không phải thư mục) ở cấp 1 bị bỏ qua', () => {
    const dir = newPluginsDir()
    writeFileSync(join(dir, 'README.txt'), 'hi')
    writePlugin(dir, 'ok', { id: 'ok', name: 'Ok', version: '1.0.0' })
    const r = discoverPlugins(dir)
    expect(r.valid.map((p) => p.id)).toEqual(['ok'])
  })
})

describe('pluginScopedPath', () => {
  test('đường dẫn hợp lệ', () => {
    const p = pluginScopedPath('/root/plugins', 'my-plugin', 'data.json')
    expect(p).toBe(resolve('/root/plugins', 'my-plugin', 'data.json'))
  })

  test('chặn traversal + id xấu', () => {
    expect(pluginScopedPath('/root/plugins', 'my-plugin', '../x')).toBeNull()
    expect(pluginScopedPath('/root/plugins', 'my-plugin', 'a/b')).toBeNull()
    expect(pluginScopedPath('/root/plugins', '../evil', 'data.json')).toBeNull()
    expect(pluginScopedPath('/root/plugins', 'bad id', 'data.json')).toBeNull()
  })
})
