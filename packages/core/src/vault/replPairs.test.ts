import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { VaultService as VaultServiceType } from './VaultService'

/**
 * F55 — CRUD cặp master↔slave trong vault. Cần `node:sqlite` (Node >= 22.5) nên tự skip
 * trên Node 20; chạy đủ bằng Node của Electron:
 *   $env:ELECTRON_RUN_AS_NODE=1; node_modules\.bin\electron node_modules\vitest\vitest.mjs run
 */
let VaultService: typeof VaultServiceType | null = null
try {
  await import('node:sqlite')
  VaultService = (await import('./VaultService')).VaultService
} catch {
  // node:sqlite không có trên runtime này
}

const tmpRoots: string[] = []
const openVaults: VaultServiceType[] = []
afterAll(() => {
  for (const vault of openVaults) vault.close()
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

let seq = 0
function newVault(): VaultServiceType {
  seq += 1
  const dir = mkdtempSync(join(tmpdir(), `infra-repl-${seq}-`))
  tmpRoots.push(dir)
  const vault = new VaultService!(join(dir, 'vault.db'))
  vault.setup(`master-repl-${seq}-12345678`)
  openVaults.push(vault)
  return vault
}

/** Vault kèm sẵn 2 host để làm master/replica. */
function vaultWithHosts(): { vault: VaultServiceType; masterId: string; replicaId: string } {
  const vault = newVault()
  const master = vault.saveHost({
    label: 'db-master',
    hostname: '10.0.0.11',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'x'
  })
  const replica = vault.saveHost({
    label: 'db-slave',
    hostname: '10.0.0.12',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'x'
  })
  return { vault, masterId: master.id, replicaId: replica.id }
}

describe.skipIf(VaultService === null)('F55 — cụm replication trong vault', () => {
  test('tạo cụm với giá trị mặc định hợp lý', () => {
    const { vault, masterId, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({
      name: 'Prod cluster',
      masterHostId: masterId,
      replicas: [{ hostId: replicaId }]
    })
    expect(pair).toMatchObject({
      name: 'Prod cluster',
      masterHostId: masterId,
      masterTunnelId: null,
      dbPort: 3306,
      dbUser: '',
      hasDbPassword: false,
      cliBinary: 'mysql',
      probeMode: 'auto',
      pollIntervalSec: 15,
      watchEnabled: false
    })
    expect(pair.replicas).toHaveLength(1)
    expect(pair.replicas[0]).toMatchObject({ hostId: replicaId, tunnelId: null, dbPort: 3306, label: '' })
    expect(pair.replicas[0].id).toBeTruthy()
    expect(vault.listReplPairs()).toHaveLength(1)
  })

  test('MỘT master, NHIỀU slave — giữ đúng thứ tự user sắp', () => {
    const { vault, masterId, replicaId } = vaultWithHosts()
    const extra = vault.saveHost({
      label: 'db-slave-2',
      hostname: '10.0.0.13',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'x'
    })
    const pair = vault.saveReplPair({
      name: 'cụm',
      masterHostId: masterId,
      replicas: [
        { hostId: replicaId, label: 'slave-01' },
        { hostId: extra.id, label: 'slave-02', dbPort: 3307 }
      ]
    })
    expect(pair.replicas.map((r) => r.label)).toEqual(['slave-01', 'slave-02'])
    expect(pair.replicas[1].dbPort).toBe(3307)
    // Mỗi slave có id riêng để runtime/cảnh báo tách nhau
    expect(pair.replicas[0].id).not.toBe(pair.replicas[1].id)
  })

  test('sửa cụm: slave giữ nguyên id, slave mới được cấp id, slave bỏ đi thì mất', () => {
    const { vault, replicaId } = vaultWithHosts()
    const extra = vault.saveHost({
      label: 'db-slave-2',
      hostname: '10.0.0.13',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'x'
    })
    const pair = vault.saveReplPair({ name: 'c', replicas: [{ hostId: replicaId, label: 'a' }] })
    const firstId = pair.replicas[0].id

    const updated = vault.saveReplPair({
      id: pair.id,
      name: 'c',
      replicas: [
        { id: firstId, hostId: replicaId, label: 'a đổi tên' },
        { hostId: extra.id, label: 'b' }
      ]
    })
    expect(updated.replicas[0].id).toBe(firstId) // id cũ giữ nguyên → cảnh báo không bị reset
    expect(updated.replicas[0].label).toBe('a đổi tên')
    expect(updated.replicas[1].id).not.toBe(firstId)

    const shrunk = vault.saveReplPair({ id: pair.id, name: 'c', replicas: [{ id: firstId, hostId: replicaId }] })
    expect(shrunk.replicas).toHaveLength(1)
  })

  test('slave thiếu hostId bị loại thay vì lưu bản ghi hỏng', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({
      name: 'c',
      replicas: [{ hostId: replicaId }, { hostId: '' }]
    })
    expect(pair.replicas).toHaveLength(1)
  })

  test('cụm rỗng slave vẫn lưu được (user đang khai dở)', () => {
    const { vault, masterId } = vaultWithHosts()
    expect(vault.saveReplPair({ name: 'c', masterHostId: masterId, replicas: [] }).replicas).toEqual([])
  })

  test('mật khẩu DB được mã hoá — DTO chỉ lộ hasDbPassword', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({
      name: 'p',
      replicas: [{ hostId: replicaId }],
      dbUser: 'monitor',
      dbPassword: 'si€u-bí-mật'
    })
    expect(pair.hasDbPassword).toBe(true)
    expect(JSON.stringify(pair)).not.toContain('si€u-bí-mật')
    expect(vault.getReplCredentials(pair.id).cluster.password).toBe('si€u-bí-mật')
  })

  test('sửa cụm mà KHÔNG truyền dbPassword → giữ nguyên mật khẩu cũ', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({ name: 'p', replicas: [{ hostId: replicaId }], dbPassword: 'giữ-tôi' })
    vault.saveReplPair({ id: pair.id, name: 'p đổi tên', replicas: [{ hostId: replicaId }] })
    expect(vault.getReplCredentials(pair.id).cluster.password).toBe('giữ-tôi')
    expect(vault.getReplPair(pair.id)?.name).toBe('p đổi tên')
  })

  test('truyền dbPassword rỗng hoặc null → xoá mật khẩu (chuyển sang dùng credential trên server)', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({ name: 'p', replicas: [{ hostId: replicaId }], dbPassword: 'cũ' })
    vault.saveReplPair({ id: pair.id, name: 'p', replicas: [{ hostId: replicaId }], dbPassword: '' })
    expect(vault.getReplPair(pair.id)?.hasDbPassword).toBe(false)
    expect(vault.getReplCredentials(pair.id).cluster.password).toBe('')
  })

  test('MỖI SLAVE một tài khoản riêng, master một tài khoản khác — không ai phải dùng chung', () => {
    const { vault, masterId, replicaId } = vaultWithHosts()
    const extra = vault.saveHost({
      label: 'db-slave-2',
      hostname: '10.0.0.13',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'x'
    })
    const pair = vault.saveReplPair({
      name: 'c',
      masterHostId: masterId,
      masterDbUser: 'mon_master',
      masterDbPassword: 'pw-master',
      dbUser: 'mon_cum',
      dbPassword: 'pw-cum',
      replicas: [
        { hostId: replicaId, dbUser: 'mon_s1', dbPassword: 'pw-s1' },
        { hostId: extra.id, dbUser: 'mon_s2', dbPassword: 'pw-s2' }
      ]
    })
    const [s1, s2] = pair.replicas
    // DTO chỉ lộ CÓ/KHÔNG, không lộ mật khẩu
    expect(pair).toMatchObject({ masterDbUser: 'mon_master', masterHasDbPassword: true })
    expect(s1).toMatchObject({ dbUser: 'mon_s1', hasDbPassword: true })
    expect(s2).toMatchObject({ dbUser: 'mon_s2', hasDbPassword: true })
    for (const secret of ['pw-master', 'pw-cum', 'pw-s1', 'pw-s2']) {
      expect(JSON.stringify(pair)).not.toContain(secret)
    }

    const creds = vault.getReplCredentials(pair.id)
    expect(creds.cluster).toEqual({ user: 'mon_cum', password: 'pw-cum' })
    expect(creds.master).toEqual({ user: 'mon_master', password: 'pw-master' })
    expect(creds.replicas[s1.id]).toEqual({ user: 'mon_s1', password: 'pw-s1' })
    expect(creds.replicas[s2.id]).toEqual({ user: 'mon_s2', password: 'pw-s2' })
  })

  test('đầu nào KHÔNG khai riêng thì lấy credential của cụm', () => {
    const { vault, masterId, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({
      name: 'c',
      masterHostId: masterId,
      dbUser: 'mon_cum',
      dbPassword: 'pw-cum',
      replicas: [{ hostId: replicaId }]
    })
    const creds = vault.getReplCredentials(pair.id)
    expect(creds.master).toEqual({ user: 'mon_cum', password: 'pw-cum' })
    expect(creds.replicas[pair.replicas[0].id]).toEqual({ user: 'mon_cum', password: 'pw-cum' })
  })

  test('khai riêng NỬA VỜI: chỉ user riêng thì mật khẩu lấy của cụm, và ngược lại', () => {
    const { vault, masterId, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({
      name: 'c',
      masterHostId: masterId,
      masterDbUser: 'mon_master', // master chỉ khai user
      dbUser: 'mon_cum',
      dbPassword: 'pw-cum',
      replicas: [{ hostId: replicaId, dbPassword: 'pw-s1' }] // slave chỉ khai mật khẩu
    })
    const creds = vault.getReplCredentials(pair.id)
    expect(creds.master).toEqual({ user: 'mon_master', password: 'pw-cum' })
    expect(creds.replicas[pair.replicas[0].id]).toEqual({ user: 'mon_cum', password: 'pw-s1' })
  })

  test('sửa cụm mà không nhập lại mật khẩu riêng của slave → GIỮ nguyên (tra theo id)', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({
      name: 'c',
      replicas: [{ hostId: replicaId, dbUser: 'mon_s1', dbPassword: 'pw-s1' }]
    })
    const rid = pair.replicas[0].id
    // Đổi nhãn, không truyền dbPassword
    const updated = vault.saveReplPair({
      id: pair.id,
      name: 'c',
      replicas: [{ id: rid, hostId: replicaId, label: 'doi ten', dbUser: 'mon_s1' }]
    })
    expect(updated.replicas[0].hasDbPassword).toBe(true)
    expect(vault.getReplCredentials(pair.id).replicas[rid].password).toBe('pw-s1')
  })

  test('xoá mật khẩu riêng của slave (truyền rỗng) → về dùng của cụm', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({
      name: 'c',
      dbUser: 'mon_cum',
      dbPassword: 'pw-cum',
      replicas: [{ hostId: replicaId, dbUser: 'mon_s1', dbPassword: 'pw-s1' }]
    })
    const rid = pair.replicas[0].id
    vault.saveReplPair({
      id: pair.id,
      name: 'c',
      dbUser: 'mon_cum',
      replicas: [{ id: rid, hostId: replicaId, dbUser: '', dbPassword: '' }]
    })
    expect(vault.getReplPair(pair.id)?.replicas[0].hasDbPassword).toBe(false)
    expect(vault.getReplCredentials(pair.id).replicas[rid]).toEqual({ user: 'mon_cum', password: 'pw-cum' })
  })

  test('slave MỚI thêm vào không thừa hưởng mật khẩu riêng của slave cũ', () => {
    const { vault, replicaId } = vaultWithHosts()
    const extra = vault.saveHost({
      label: 'db-slave-2',
      hostname: '10.0.0.13',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'x'
    })
    const pair = vault.saveReplPair({
      name: 'c',
      replicas: [{ hostId: replicaId, dbUser: 'mon_s1', dbPassword: 'pw-s1' }]
    })
    const rid = pair.replicas[0].id
    const updated = vault.saveReplPair({
      id: pair.id,
      name: 'c',
      replicas: [{ id: rid, hostId: replicaId, dbUser: 'mon_s1' }, { hostId: extra.id }]
    })
    expect(updated.replicas[1].hasDbPassword).toBe(false)
  })

  test('mặc định không đi qua tunnel', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({ name: 'p', replicas: [{ hostId: replicaId }] })
    expect(pair.replicas[0].tunnelId).toBeNull()
    expect(pair.masterTunnelId).toBeNull()
  })

  test('mỗi slave chọn tunnel RIÊNG — dùng khi MySQL ở máy khác trong mạng trong', () => {
    const { vault, masterId, replicaId } = vaultWithHosts()
    const tunnel = vault.saveTunnel({
      hostId: replicaId,
      type: 'L',
      label: 'db-tunnel',
      bindPort: 3311,
      destHost: '10.20.30.40',
      destPort: 3306
    })
    const pair = vault.saveReplPair({
      name: 'p',
      masterHostId: masterId,
      replicas: [{ hostId: replicaId, tunnelId: tunnel.id }]
    })
    expect(pair.replicas[0].tunnelId).toBe(tunnel.id)
    expect(pair.masterTunnelId).toBeNull() // master vẫn đi đường host
  })

  test('chuỗi rỗng = không dùng tunnel (không lưu thành id rỗng)', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({ name: 'p', replicas: [{ hostId: replicaId, tunnelId: '' }] })
    expect(pair.replicas[0].tunnelId).toBeNull()
  })

  test('xoá tunnel KHÔNG âm thầm biến slave về chế độ host (cố ý không đặt FK)', () => {
    const { vault, replicaId } = vaultWithHosts()
    const tunnel = vault.saveTunnel({ hostId: replicaId, type: 'L', bindPort: 3311, destHost: '10.0.0.9', destPort: 3306 })
    const pair = vault.saveReplPair({ name: 'p', replicas: [{ hostId: replicaId, tunnelId: tunnel.id }] })
    vault.deleteTunnel(tunnel.id)
    // Giữ id treo để lúc đo báo thẳng "tunnel đã bị xoá" thay vì đo sai đường
    expect(vault.getReplPair(pair.id)?.replicas[0].tunnelId).toBe(tunnel.id)
  })

  test('đổi từ tunnel về host: truyền null là xoá được', () => {
    const { vault, replicaId } = vaultWithHosts()
    const tunnel = vault.saveTunnel({ hostId: replicaId, type: 'L', bindPort: 3311, destHost: '10.0.0.9', destPort: 3306 })
    const pair = vault.saveReplPair({ name: 'p', replicas: [{ hostId: replicaId, tunnelId: tunnel.id }] })
    const rid = pair.replicas[0].id
    vault.saveReplPair({ id: pair.id, name: 'p', replicas: [{ id: rid, hostId: replicaId, tunnelId: null }] })
    expect(vault.getReplPair(pair.id)?.replicas[0].tunnelId).toBeNull()
  })

  test('cụm không có master (chỉ theo dõi slave)', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({ name: 'chỉ slave', masterHostId: null, replicas: [{ hostId: replicaId }] })
    expect(pair.masterHostId).toBeNull()
  })

  test('port và chu kỳ poll bị kẹp về khoảng hợp lệ', () => {
    const { vault, replicaId } = vaultWithHosts()
    const a = vault.saveReplPair({
      name: 'a',
      replicas: [{ hostId: replicaId, dbPort: 999_999 }],
      dbPort: 999_999,
      pollIntervalSec: 1
    })
    expect(a.dbPort).toBe(65535)
    expect(a.replicas[0].dbPort).toBe(65535)
    expect(a.pollIntervalSec).toBe(5)
    const b = vault.saveReplPair({ name: 'b', replicas: [{ hostId: replicaId }], dbPort: 0, pollIntervalSec: 99_999 })
    expect(b.dbPort).toBe(3306)
    expect(b.pollIntervalSec).toBe(300)
  })

  test('slave không khai port → lấy port mặc định của cụm', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({ name: 'p', replicas: [{ hostId: replicaId }], dbPort: 3310 })
    expect(pair.replicas[0].dbPort).toBe(3310)
  })

  test('probeMode lạ → về auto thay vì làm nổ service', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({
      name: 'p',
      replicas: [{ hostId: replicaId }],
      probeMode: 'rác' as unknown as 'auto'
    })
    expect(pair.probeMode).toBe('auto')
  })

  test('tên rỗng vẫn lưu được với nhãn thay thế', () => {
    const { vault, replicaId } = vaultWithHosts()
    expect(vault.saveReplPair({ name: '   ', replicas: [{ hostId: replicaId }] }).name).toBe('Cụm không tên')
  })

  test('xoá host của một slave KHÔNG xoá cả cụm — các slave khác vẫn còn', () => {
    const { vault, masterId, replicaId } = vaultWithHosts()
    const extra = vault.saveHost({
      label: 'db-slave-2',
      hostname: '10.0.0.13',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'x'
    })
    const pair = vault.saveReplPair({
      name: 'c',
      masterHostId: masterId,
      replicas: [{ hostId: replicaId }, { hostId: extra.id }]
    })
    vault.deleteHost(replicaId)
    // Cụm còn nguyên; slave mất host sẽ báo lỗi lúc đo chứ không âm thầm biến mất cùng cả cụm
    expect(vault.getReplPair(pair.id)?.replicas).toHaveLength(2)
  })

  test('xoá host master thì cụm còn lại, chuyển sang chế độ chỉ-slave', () => {
    const { vault, masterId, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({ name: 'p', masterHostId: masterId, replicas: [{ hostId: replicaId }] })
    vault.deleteHost(masterId)
    expect(vault.getReplPair(pair.id)?.masterHostId).toBeNull()
  })

  test('xoá cụm', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({ name: 'p', replicas: [{ hostId: replicaId }] })
    vault.deleteReplPair(pair.id)
    expect(vault.getReplPair(pair.id)).toBeNull()
  })

  test('sửa cụm không tồn tại → ném lỗi rõ ràng', () => {
    const { vault, replicaId } = vaultWithHosts()
    expect(() => vault.saveReplPair({ id: 'không-có', name: 'p', replicas: [{ hostId: replicaId }] })).toThrow(
      /không tồn tại/
    )
  })

  test('mật khẩu đọc lại được sau khi khoá rồi mở lại vault', () => {
    const { vault, replicaId } = vaultWithHosts()
    const pair = vault.saveReplPair({ name: 'p', replicas: [{ hostId: replicaId }], dbPassword: 'qua-đêm' })
    vault.lock()
    expect(() => vault.getReplCredentials(pair.id).cluster.password).toThrow()
    vault.unlock(`master-repl-${seq}-12345678`)
    expect(vault.getReplCredentials(pair.id).cluster.password).toBe('qua-đêm')
  })
})

