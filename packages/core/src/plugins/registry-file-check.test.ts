import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseRegistry } from './registry'

describe('registry đã sinh (docs/landing/registry/plugins.json)', () => {
  test('qua được validator của app', () => {
    const file = join(__dirname, '../../../../docs/landing/registry/plugins.json')
    const r = parseRegistry(readFileSync(file, 'utf8'))
    if (!r.ok) console.error(r.errors)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plugins.length).toBeGreaterThanOrEqual(3)
  })
})
