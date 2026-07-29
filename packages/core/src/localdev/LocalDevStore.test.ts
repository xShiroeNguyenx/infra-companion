// Cần node:sqlite (Node >= 22.5) — Node 20 dev tự skip, chạy đủ qua Node của Electron/CI
// (giống MetricsStore.test.ts / vaultMerge.test.ts).
// Chạy tay: $env:ELECTRON_RUN_AS_NODE=1; node_modules\.bin\electron node_modules\vitest\vitest.mjs run
import { afterAll, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SiteInsert } from './types'

let StoreClass: typeof import('./LocalDevStore').LocalDevStore | null = null
let sitePortPurposeFn: typeof import('./LocalDevStore').sitePortPurpose | null = null
let phpPortPurposeFn: typeof import('./LocalDevStore').phpPortPurpose | null = null
try {
  await import('node:sqlite')
  const mod = await import('./LocalDevStore')
  StoreClass = mod.LocalDevStore
  sitePortPurposeFn = mod.sitePortPurpose
  phpPortPurposeFn = mod.phpPortPurpose
} catch {
  /* node:sqlite không có — skip */
}

const tmpRoots: string[] = []
const stores: Array<{ close(): void }> = []

function newStore(): InstanceType<NonNullable<typeof StoreClass>> {
  const dir = mkdtempSync(join(tmpdir(), 'infra-localdev-'))
  tmpRoots.push(dir)
  const store = new StoreClass!(join(dir, 'localdev.db'))
  stores.push(store)
  return store
}

afterAll(() => {
  // close() TRƯỚC khi xoá — SQLite mở (WAL) làm rmSync EPERM trên Windows
  for (const s of stores) s.close()
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

function siteInput(over: Partial<SiteInsert> = {}): SiteInsert {
  return {
    name: 'Demo',
    slug: 'demo',
    domain: 'demo.localhost',
    rootPath: 'D:\\www\\demo',
    docRoot: 'D:\\www\\demo',
    phpVersion: 'php-8.3',
    httpPort: 8081,
    https: false,
    kind: 'php',
    status: 'ready',
    createdByApp: false,
    ...over
  }
}

describe.skipIf(StoreClass === null)('LocalDevStore — site', () => {
  test('insert rồi đọc lại đúng mọi field (kể cả boolean map 0/1)', () => {
    const s = newStore()
    const site = s.insertSite(siteInput({ https: true, createdByApp: true }))
    expect(site.id).toMatch(/[0-9a-f-]{36}/)
    expect(site.name).toBe('Demo')
    expect(site.slug).toBe('demo')
    expect(site.https).toBe(true)
    expect(site.createdByApp).toBe(true)
    expect(site.phpVersion).toBe('php-8.3')
    expect(site.createdAt).toBeGreaterThan(0)

    const again = s.getSite(site.id)
    expect(again).toEqual(site)
  })

  test('createdByApp=false được giữ nguyên — đây là cờ chặn xoá file của user', () => {
    const s = newStore()
    const site = s.insertSite(siteInput({ createdByApp: false }))
    expect(s.getSite(site.id)?.createdByApp).toBe(false)
  })

  test('listSites sắp theo tên, không phân biệt hoa thường', () => {
    const s = newStore()
    s.insertSite(siteInput({ name: 'zeta', slug: 'zeta', domain: 'zeta.localhost', httpPort: 8081 }))
    s.insertSite(siteInput({ name: 'Alpha', slug: 'alpha', domain: 'alpha.localhost', httpPort: 8082 }))
    s.insertSite(siteInput({ name: 'beta', slug: 'beta', domain: 'beta.localhost', httpPort: 8083 }))
    expect(s.listSites().map((x) => x.name)).toEqual(['Alpha', 'beta', 'zeta'])
  })

  test('slug trùng bị DB từ chối (UNIQUE)', () => {
    const s = newStore()
    s.insertSite(siteInput())
    expect(() => s.insertSite(siteInput({ domain: 'other.localhost', httpPort: 8082 }))).toThrow()
  })

  test('domain trùng bị DB từ chối (UNIQUE)', () => {
    const s = newStore()
    s.insertSite(siteInput())
    expect(() => s.insertSite(siteInput({ slug: 'other', httpPort: 8082 }))).toThrow()
  })

  test('takenSlugs / takenDomains phục vụ sinh slug duy nhất', () => {
    const s = newStore()
    s.insertSite(siteInput())
    s.insertSite(siteInput({ slug: 'shop', domain: 'shop.localhost', httpPort: 8082 }))
    expect([...s.takenSlugs()].sort()).toEqual(['demo', 'shop'])
    expect([...s.takenDomains()].sort()).toEqual(['demo.localhost', 'shop.localhost'])
  })

  test('updateSite: undefined = GIỮ NGUYÊN, null = xoá giá trị', () => {
    const s = newStore()
    const site = s.insertSite(siteInput())
    const t1 = s.updateSite(site.id, { name: 'Đổi tên' })
    expect(t1?.name).toBe('Đổi tên')
    expect(t1?.phpVersion).toBe('php-8.3') // không truyền → giữ
    expect(t1?.domain).toBe('demo.localhost')

    const t2 = s.updateSite(site.id, { phpVersion: null })
    expect(t2?.phpVersion).toBeNull()

    const t3 = s.updateSite(site.id, { lastError: 'lỗi X' })
    expect(t3?.lastError).toBe('lỗi X')
    const t4 = s.updateSite(site.id, { status: 'ready' })
    expect(t4?.lastError).toBe('lỗi X') // vẫn giữ vì không truyền
    const t5 = s.updateSite(site.id, { lastError: null })
    expect(t5?.lastError).toBeNull()
  })

  test('updateSite bump updated_at nhưng KHÔNG đổi created_at', () => {
    const s = newStore()
    const site = s.insertSite(siteInput())
    const after = s.updateSite(site.id, { name: 'X' })
    expect(after?.createdAt).toBe(site.createdAt)
    expect(after?.updatedAt).toBeGreaterThanOrEqual(site.updatedAt)
  })

  test('updateSite id không tồn tại → null (không throw)', () => {
    const s = newStore()
    expect(s.updateSite('khong-co', { name: 'x' })).toBeNull()
  })

  test('listStaleCreating chỉ trả site tạo dở (crash giữa luồng)', () => {
    const s = newStore()
    s.insertSite(siteInput({ status: 'ready' }))
    const half = s.insertSite(siteInput({ slug: 'half', domain: 'half.localhost', httpPort: 8082, status: 'creating' }))
    const stale = s.listStaleCreating()
    expect(stale.map((x) => x.id)).toEqual([half.id])
  })

  test('getSiteBySlug', () => {
    const s = newStore()
    const site = s.insertSite(siteInput())
    expect(s.getSiteBySlug('demo')?.id).toBe(site.id)
    expect(s.getSiteBySlug('khong-co')).toBeNull()
  })
})

describe.skipIf(StoreClass === null)('LocalDevStore — cấp phát cổng', () => {
  test('setPort/getPort/takenPorts', () => {
    const s = newStore()
    s.setPort('web', 8080)
    s.setPort(phpPortPurposeFn!('php-8.3', 0), 9000)
    expect(s.getPort('web')).toBe(8080)
    expect(s.getPort('khong-co')).toBeNull()
    expect([...s.takenPorts()].sort((a, b) => a - b)).toEqual([8080, 9000])
  })

  test('setPort cùng purpose = đổi cổng (nhả cổng cũ)', () => {
    const s = newStore()
    s.setPort('web', 8080)
    s.setPort('web', 8081)
    expect(s.getPort('web')).toBe(8081)
    expect([...s.takenPorts()]).toEqual([8081])
  })

  test('cùng 1 cổng cho 2 purpose khác nhau bị DB từ chối — không bao giờ 2 service tưởng cùng giữ 1 cổng', () => {
    const s = newStore()
    s.setPort('web', 8080)
    expect(() => s.setPort('mariadb', 8080)).toThrow()
    // Rollback đúng: purpose 'mariadb' không được ghi nửa vời
    expect(s.getPort('mariadb')).toBeNull()
    expect(s.getPort('web')).toBe(8080)
  })

  test('releasePort nhả cổng', () => {
    const s = newStore()
    s.setPort('web', 8080)
    s.releasePort('web')
    expect(s.getPort('web')).toBeNull()
    expect(s.takenPorts().size).toBe(0)
  })

  test('deleteSite nhả luôn cổng của site đó', () => {
    const s = newStore()
    const site = s.insertSite(siteInput())
    s.setPort(sitePortPurposeFn!(site.id), 8081)
    expect(s.takenPorts().has(8081)).toBe(true)
    s.deleteSite(site.id)
    expect(s.getSite(site.id)).toBeNull()
    expect(s.takenPorts().has(8081)).toBe(false)
  })

  test('cổng của service dùng chung KHÔNG bị nhả khi xoá site', () => {
    const s = newStore()
    const site = s.insertSite(siteInput())
    s.setPort('web', 8080)
    s.setPort(sitePortPurposeFn!(site.id), 8081)
    s.deleteSite(site.id)
    expect(s.getPort('web')).toBe(8080)
  })
})

describe.skipIf(StoreClass === null)('LocalDevStore — bền vững', () => {
  test('đóng rồi mở lại vẫn đọc được dữ liệu (migration chạy 1 lần, idempotent)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'infra-localdev-reopen-'))
    tmpRoots.push(dir)
    const path = join(dir, 'localdev.db')

    const s1 = new StoreClass!(path)
    const site = s1.insertSite(siteInput())
    s1.setPort('web', 8080)
    s1.close()

    const s2 = new StoreClass!(path)
    stores.push(s2)
    expect(s2.getSite(site.id)?.slug).toBe('demo')
    expect(s2.getPort('web')).toBe(8080)
  })

  test('close() gọi 2 lần không lỗi', () => {
    const s = newStore()
    s.insertSite(siteInput())
    s.close()
    expect(() => s.close()).not.toThrow()
  })

  test('dùng lại sau close() thì tự mở lại DB', () => {
    const s = newStore()
    const site = s.insertSite(siteInput())
    s.close()
    expect(s.getSite(site.id)?.slug).toBe('demo')
  })
})
