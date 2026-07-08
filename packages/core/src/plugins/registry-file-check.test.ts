import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseRegistry } from './registry'
import { verifyPluginEntry } from './signing'

/** Chốt chặn CI: file registry ĐÃ SINH phải (1) qua validator của app và (2) mọi entry
 *  có chữ ký ed25519 hợp lệ với public key nhúng — bắt được cả lệch format payload
 *  giữa scripts/build-registry.mjs (JS, duplicate) và signing.ts (TS, nguồn chân lý). */
describe('registry đã sinh (docs/landing/registry/plugins.json)', () => {
  const file = join(__dirname, '../../../../docs/landing/registry/plugins.json')
  const r = parseRegistry(readFileSync(file, 'utf8'))

  test('qua được validator của app', () => {
    if (!r.ok) console.error(r.errors)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plugins.length).toBeGreaterThanOrEqual(3)
  })

  test('mọi entry có chữ ký hợp lệ với public key chính chủ', () => {
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const entry of r.plugins) {
      expect(verifyPluginEntry(entry), `chữ ký sai/thiếu ở "${entry.id}" — chạy lại node scripts/build-registry.mjs`).toBe(true)
    }
  })
})
