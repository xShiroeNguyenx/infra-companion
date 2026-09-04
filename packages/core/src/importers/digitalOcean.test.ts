import { describe, expect, test } from 'vitest'
import type { DoDropletDto } from '@infra/shared'
import { DO_DEFAULT_GROUP_NAME, importDroplets, parseDropletsPage, type DropletImportVault } from './digitalOcean'

// ---------------------------------------------------------------------------
// parseDropletsPage
// ---------------------------------------------------------------------------

/** Một trang /v2/droplets thu gọn — chỉ những field parser đọc, đúng cấu trúc API v2. */
const PAGE = {
  droplets: [
    {
      id: 101,
      name: 'web-01',
      status: 'active',
      size_slug: 's-1vcpu-1gb',
      region: { slug: 'sgp1', name: 'Singapore 1' },
      image: { distribution: 'Ubuntu', name: '22.04 (LTS) x64' },
      tags: ['web', 'production'],
      networks: {
        v4: [
          { ip_address: '10.20.30.11', type: 'private' },
          { ip_address: '203.0.113.11', type: 'public' }
        ],
        v6: []
      }
    },
    {
      id: 102,
      name: 'db-01',
      status: 'off',
      size_slug: 's-2vcpu-4gb',
      region: { slug: 'fra1', name: 'Frankfurt 1' },
      image: { distribution: 'Debian', name: '12 x64' },
      tags: [],
      networks: { v4: [{ ip_address: '10.20.30.12', type: 'private' }], v6: [] }
    }
  ],
  links: { pages: {} },
  meta: { total: 2 }
}

describe('parseDropletsPage', () => {
  test('trang hợp lệ: đọc đủ IP public/private, region slug, tags, image', () => {
    const page = parseDropletsPage(PAGE)
    expect(page.malformed).toBe(false)
    expect(page.warnings).toEqual([])
    expect(page.droplets).toHaveLength(2)

    const web = page.droplets[0]!
    expect(web).toMatchObject({
      id: '101',
      name: 'web-01',
      publicIp: '203.0.113.11',
      privateIp: '10.20.30.11',
      region: 'sgp1',
      status: 'active',
      tags: ['web', 'production'],
      image: 'Ubuntu 22.04 (LTS) x64',
      sizeSlug: 's-1vcpu-1gb',
      exists: false
    })

    // Chỉ có IP private → publicIp null chứ không lấy nhầm private làm public
    expect(page.droplets[1]).toMatchObject({ publicIp: null, privateIp: '10.20.30.12' })
  })

  test('droplet không có networks.v4 vẫn vào danh sách với cả hai IP null', () => {
    const page = parseDropletsPage({ droplets: [{ id: 1, name: 'ghost-01' }] })
    expect(page.droplets).toHaveLength(1)
    expect(page.droplets[0]).toMatchObject({ publicIp: null, privateIp: null, tags: [], region: '' })
  })

  test('entry thiếu id/name bị bỏ qua kèm cảnh báo, các entry còn lại vẫn đọc được', () => {
    const page = parseDropletsPage({ droplets: [{ name: 'no-id' }, { id: 2, name: 'ok-01' }, null] })
    expect(page.droplets.map((d) => d.name)).toEqual(['ok-01'])
    expect(page.warnings).toHaveLength(2)
    expect(page.malformed).toBe(false)
  })

  test('JSON không có mảng droplets → malformed (phản hồi không phải API này)', () => {
    for (const bad of [null, 'text', 42, {}, { droplets: 'x' }, { message: 'unauthorized' }]) {
      expect(parseDropletsPage(bad).malformed).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// importDroplets — vault giả trong RAM, không cần mở vault thật
// ---------------------------------------------------------------------------

interface SavedHost {
  groupId: string | null
  label: string
  hostname: string
  port: number
  username: string | null
  authType: 'key' | null
  keyId: string | null
  notes?: string
}

function fakeVault(seed?: { hostnames?: string[]; groups?: Array<{ id: string; name: string }> }): {
  vault: DropletImportVault
  saved: SavedHost[]
  groupsCreated: string[]
} {
  const hosts = (seed?.hostnames ?? []).map((hostname) => ({ hostname }))
  const groups = [...(seed?.groups ?? [])]
  const saved: SavedHost[] = []
  const groupsCreated: string[] = []
  let nextId = 1
  const vault: DropletImportVault = {
    listHosts: () => hosts,
    listGroups: () => groups,
    saveGroup: (input) => {
      const group = { id: `g${nextId++}`, name: input.name }
      groups.push(group)
      groupsCreated.push(group.name)
      return group
    },
    saveHost: (input) => {
      saved.push(input)
      hosts.push({ hostname: input.hostname })
      return { id: `h${nextId++}` }
    }
  }
  return { vault, saved, groupsCreated }
}

function droplet(over: Partial<DoDropletDto>): DoDropletDto {
  return {
    id: '100',
    name: 'web-01',
    publicIp: '203.0.113.10',
    privateIp: null,
    region: 'sgp1',
    status: 'active',
    tags: [],
    image: 'Ubuntu 22.04 x64',
    sizeSlug: 's-1vcpu-1gb',
    exists: false,
    ...over
  }
}

describe('importDroplets', () => {
  test('tạo host vào group mới với tên mặc định, hostname = IP public, port 22', () => {
    const { vault, saved, groupsCreated } = fakeVault()
    const result = importDroplets(vault, [droplet({})], {})
    expect(result).toMatchObject({ imported: 1, skipped: 0, noIp: 0, groupName: DO_DEFAULT_GROUP_NAME })
    expect(groupsCreated).toEqual([DO_DEFAULT_GROUP_NAME])
    expect(saved[0]).toMatchObject({
      label: 'web-01',
      hostname: '203.0.113.10',
      port: 22,
      username: null,
      authType: null,
      keyId: null
    })
    // Gốc gác nằm trong notes để về sau còn biết host này từ đâu ra
    expect(saved[0]!.notes).toContain('DigitalOcean droplet #100')
    expect(saved[0]!.notes).toContain('region sgp1')
  })

  test('group cùng tên đã có thì TÁI DÙNG — import lần hai không đẻ group thứ hai', () => {
    const { vault, saved, groupsCreated } = fakeVault({ groups: [{ id: 'g-old', name: DO_DEFAULT_GROUP_NAME }] })
    importDroplets(vault, [droplet({})], {})
    expect(groupsCreated).toEqual([])
    expect(saved[0]!.groupId).toBe('g-old')
  })

  test('groupId có sẵn → dùng thẳng; groupId đã bị xoá → cảnh báo và rơi về tạo theo tên', () => {
    const existing = fakeVault({ groups: [{ id: 'g1', name: 'Prod cluster' }] })
    const ok = importDroplets(existing.vault, [droplet({})], { groupId: 'g1' })
    expect(ok.groupName).toBe('Prod cluster')
    expect(existing.saved[0]!.groupId).toBe('g1')

    const gone = fakeVault()
    const fallback = importDroplets(gone.vault, [droplet({})], { groupId: 'g-deleted', newGroupName: 'DO nhập' })
    expect(fallback.warnings).toHaveLength(1)
    expect(fallback.groupName).toBe('DO nhập')
  })

  test('vault đã có host trùng địa chỉ → bỏ qua và đếm vào skipped', () => {
    const { vault, saved } = fakeVault({ hostnames: ['203.0.113.10'] })
    const result = importDroplets(vault, [droplet({}), droplet({ id: '101', name: 'web-02', publicIp: '203.0.113.11' })], {})
    expect(result).toMatchObject({ imported: 1, skipped: 1 })
    expect(saved.map((h) => h.hostname)).toEqual(['203.0.113.11'])
  })

  test('hai droplet trùng địa chỉ trong CÙNG lượt import cũng chỉ tạo một host', () => {
    const { vault } = fakeVault()
    const result = importDroplets(
      vault,
      [droplet({}), droplet({ id: '101', name: 'web-01-clone', publicIp: '203.0.113.10' })],
      {}
    )
    expect(result).toMatchObject({ imported: 1, skipped: 1 })
  })

  test('không có IP public thì rơi về IP private; không có cả hai thì đếm vào noIp', () => {
    const { vault, saved } = fakeVault()
    const result = importDroplets(
      vault,
      [
        droplet({ publicIp: null, privateIp: '10.20.30.11' }),
        droplet({ id: '101', name: 'ghost-01', publicIp: null, privateIp: null })
      ],
      {}
    )
    expect(result).toMatchObject({ imported: 1, noIp: 1 })
    expect(saved[0]!.hostname).toBe('10.20.30.11')
  })

  test('username/keyId truyền vào áp cho host tạo mới; có key thì authType = key', () => {
    const { vault, saved } = fakeVault()
    importDroplets(vault, [droplet({})], { username: '  deploy  ', keyId: 'k1' })
    expect(saved[0]).toMatchObject({ username: 'deploy', authType: 'key', keyId: 'k1' })
  })

  test('droplet không tên vẫn import được — label rơi về địa chỉ', () => {
    const { vault, saved } = fakeVault()
    importDroplets(vault, [droplet({ name: '' })], {})
    expect(saved[0]!.label).toBe('203.0.113.10')
  })
})
