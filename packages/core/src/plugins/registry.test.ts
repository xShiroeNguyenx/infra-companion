import { describe, expect, test } from 'vitest'
import { parseRegistry, semverGt, validateRegistry } from './registry'

const SHA = 'a'.repeat(64)

const file = (name: string, url = `https://example.com/${name}`) => ({ name, url, sha256: SHA })

const entry = {
  id: 'hello-world',
  name: 'Hello World',
  version: '1.0.0',
  description: 'demo',
  author: 'Khánh',
  files: [file('manifest.json'), file('index.js')]
}

const registry = (plugins: unknown[]) => ({ version: 1, plugins })

describe('validateRegistry', () => {
  test('registry hợp lệ → trả plugins đã chuẩn hoá', () => {
    const r = validateRegistry(registry([entry]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plugins).toHaveLength(1)
    expect(r.plugins[0]!.id).toBe('hello-world')
    expect(r.plugins[0]!.files.map((f) => f.name)).toEqual(['manifest.json', 'index.js'])
  })

  test('description/author thiếu → null', () => {
    const r = validateRegistry(registry([{ ...entry, description: undefined, author: undefined }]))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plugins[0]!.description).toBeNull()
    expect(r.plugins[0]!.author).toBeNull()
  })

  test('version registry khác 1 → lỗi', () => {
    expect(validateRegistry({ version: 2, plugins: [] }).ok).toBe(false)
  })

  test('id không kebab-case → lỗi', () => {
    expect(validateRegistry(registry([{ ...entry, id: 'Hello_World' }])).ok).toBe(false)
  })

  test('id trùng giữa 2 entry → lỗi', () => {
    expect(validateRegistry(registry([entry, entry])).ok).toBe(false)
  })

  test('semver sai → lỗi', () => {
    expect(validateRegistry(registry([{ ...entry, version: '1.0' }])).ok).toBe(false)
  })

  test('thiếu manifest.json trong files → lỗi', () => {
    expect(validateRegistry(registry([{ ...entry, files: [file('index.js')] }])).ok).toBe(false)
  })

  test('thiếu file .js → lỗi', () => {
    expect(validateRegistry(registry([{ ...entry, files: [file('manifest.json')] }])).ok).toBe(false)
  })

  test('tên file traversal/thư mục con → lỗi', () => {
    for (const bad of ['../evil.js', 'a/b.js', 'a\\b.js', '..js', 'evil.exe', 'data.json']) {
      const r = validateRegistry(registry([{ ...entry, files: [file('manifest.json'), file(bad)] }]))
      expect(r.ok, `phải chặn tên file "${bad}"`).toBe(false)
    }
  })

  test('url không https → lỗi (trừ localhost)', () => {
    expect(
      validateRegistry(registry([{ ...entry, files: [file('manifest.json'), file('index.js', 'http://evil.com/x.js')] }])).ok
    ).toBe(false)
    expect(
      validateRegistry(registry([{ ...entry, files: [file('manifest.json'), file('index.js', 'http://localhost:8080/x.js')] }])).ok
    ).toBe(true)
    expect(
      validateRegistry(registry([{ ...entry, files: [file('manifest.json'), file('index.js', 'file:///c:/x.js')] }])).ok
    ).toBe(false)
  })

  test('sha256 sai định dạng → lỗi; hoa → chuẩn hoá về thường', () => {
    expect(
      validateRegistry(registry([{ ...entry, files: [file('manifest.json'), { name: 'index.js', url: 'https://x.com/i.js', sha256: 'xyz' }] }])).ok
    ).toBe(false)
    const r = validateRegistry(
      registry([{ ...entry, files: [file('manifest.json'), { name: 'index.js', url: 'https://x.com/i.js', sha256: 'A'.repeat(64) }] }])
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plugins[0]!.files[1]!.sha256).toBe('a'.repeat(64))
  })

  test('trùng tên file trong 1 entry → lỗi', () => {
    expect(
      validateRegistry(registry([{ ...entry, files: [file('manifest.json'), file('index.js'), file('index.js')] }])).ok
    ).toBe(false)
  })
})

describe('parseRegistry', () => {
  test('JSON hỏng → lỗi, không throw', () => {
    const r = parseRegistry('{oops')
    expect(r.ok).toBe(false)
  })
})

describe('semverGt', () => {
  test('so sánh cơ bản', () => {
    expect(semverGt('1.2.3', '1.2.2')).toBe(true)
    expect(semverGt('1.10.0', '1.9.9')).toBe(true)
    expect(semverGt('2.0.0', '1.99.99')).toBe(true)
    expect(semverGt('1.2.3', '1.2.3')).toBe(false)
    expect(semverGt('1.2.2', '1.2.3')).toBe(false)
    expect(semverGt('1.2.3-beta', '1.2.3')).toBe(false)
  })
})
