import { describe, expect, test } from 'vitest'
import { parseManifest, validateManifest } from './manifest'

const base = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.2.3'
}

describe('validateManifest', () => {
  test('manifest đầy đủ hợp lệ + áp default (main, engines, permissions, commands)', () => {
    const r = validateManifest(base, 'my-plugin')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.manifest.main).toBe('index.js')
    expect(r.manifest.engines).toEqual({})
    expect(r.manifest.permissions).toEqual([])
    expect(r.manifest.contributes.commands).toEqual([])
    expect(r.manifest.description).toBeNull()
  })

  test('parse contributes.commands + permissions + description', () => {
    const r = validateManifest(
      {
        ...base,
        description: 'demo',
        permissions: ['terminal.observe'],
        contributes: { commands: [{ id: 'my.hello', title: 'Hi' }] }
      },
      'my-plugin'
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.manifest.description).toBe('demo')
    expect(r.manifest.permissions).toEqual(['terminal.observe'])
    expect(r.manifest.contributes.commands).toEqual([{ id: 'my.hello', title: 'Hi' }])
  })

  test('id sai định dạng → lỗi', () => {
    expect(validateManifest({ ...base, id: 'My_Plugin' }, 'My_Plugin').ok).toBe(false)
    expect(validateManifest({ ...base, id: '-bad' }, '-bad').ok).toBe(false)
    expect(validateManifest({ ...base, id: 'UPPER' }, 'UPPER').ok).toBe(false)
  })

  test('id phải trùng tên thư mục', () => {
    const r = validateManifest(base, 'other-dir')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join(' ')).toContain('trùng tên thư mục')
  })

  test('version sai semver → lỗi', () => {
    expect(validateManifest({ ...base, version: '1.0' }, 'my-plugin').ok).toBe(false)
    expect(validateManifest({ ...base, version: 'v1.0.0' }, 'my-plugin').ok).toBe(false)
  })

  test('name rỗng → lỗi', () => {
    expect(validateManifest({ ...base, name: '   ' }, 'my-plugin').ok).toBe(false)
  })

  test('main traversal / tuyệt đối / không .js → lỗi', () => {
    expect(validateManifest({ ...base, main: '../evil.js' }, 'my-plugin').ok).toBe(false)
    expect(validateManifest({ ...base, main: '/etc/x.js' }, 'my-plugin').ok).toBe(false)
    expect(validateManifest({ ...base, main: 'C:\\x.js' }, 'my-plugin').ok).toBe(false)
    expect(validateManifest({ ...base, main: 'index.ts' }, 'my-plugin').ok).toBe(false)
  })

  test('main hợp lệ trong thư mục con', () => {
    const r = validateManifest({ ...base, main: 'src/index.js' }, 'my-plugin')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.manifest.main).toBe('src/index.js')
  })

  test('command id không namespaced (thiếu dấu chấm) → lỗi', () => {
    const r = validateManifest(
      { ...base, contributes: { commands: [{ id: 'hello', title: 'Hi' }] } },
      'my-plugin'
    )
    expect(r.ok).toBe(false)
  })

  test('command id trùng trong cùng plugin → lỗi', () => {
    const r = validateManifest(
      {
        ...base,
        contributes: {
          commands: [
            { id: 'a.b', title: 'X' },
            { id: 'a.b', title: 'Y' }
          ]
        }
      },
      'my-plugin'
    )
    expect(r.ok).toBe(false)
  })

  test('key lạ ở top-level bị bỏ qua (forward-compat)', () => {
    const r = validateManifest({ ...base, futureField: { x: 1 } }, 'my-plugin')
    expect(r.ok).toBe(true)
  })

  test('không phải object → lỗi, không throw', () => {
    expect(validateManifest(null, 'x').ok).toBe(false)
    expect(validateManifest(42, 'x').ok).toBe(false)
  })
})

describe('parseManifest', () => {
  test('JSON hỏng → ok:false, không throw', () => {
    const r = parseManifest('{ not json', 'my-plugin')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0]).toContain('JSON')
  })

  test('JSON hợp lệ → validate', () => {
    const r = parseManifest(JSON.stringify(base), 'my-plugin')
    expect(r.ok).toBe(true)
  })
})
