import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { ReplRunSaveInput, VaultService as VaultServiceType } from './VaultService'

/**
 * F59 — lịch sử so lệch trong vault. Cần `node:sqlite` (Node >= 22.5) nên tự skip trên Node 20;
 * chạy đủ bằng Node của Electron:
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
  const dir = mkdtempSync(join(tmpdir(), `infra-runs-${seq}-`))
  tmpRoots.push(dir)
  const vault = new VaultService!(join(dir, 'vault.db'))
  vault.setup(`master-runs-${seq}-12345678`)
  openVaults.push(vault)
  return vault
}

function run(over: Partial<ReplRunSaveInput> = {}): ReplRunSaveInput {
  return {
    pairId: 'pair-1',
    pairName: 'Prod cluster',
    replicaId: 'rep-1',
    replicaLabel: 'app-01',
    masterLabel: 'db-master',
    kind: 'scan',
    counts: { tableDiffs: 2, columnDiffs: 1, indexDiffs: 0, varDiffs: 0, checked: 0, mismatches: 0 },
    payload: {
      tables: [
        {
          schema: 'shop',
          name: 'orders',
          status: 'rows-differ',
          master: null,
          replica: null,
          rowDelta: -12,
          filtered: false
        }
      ],
      columns: [],
      indexes: [],
      variables: [],
      rows: [],
      hasFilters: false,
      truncated: false
    },
    createdAt: 1_000,
    ...over
  }
}

describe.skipIf(VaultService === null)('F59 — lịch sử so lệch trong vault', () => {
  test('lưu rồi liệt kê: mới nhất lên đầu, tóm tắt đọc được mà không cần giải mã', () => {
    const vault = newVault()
    vault.saveReplRun(run({ createdAt: 1_000 }))
    vault.saveReplRun(run({ createdAt: 2_000, kind: 'checksum', counts: { tableDiffs: 0, columnDiffs: 0, indexDiffs: 0, varDiffs: 0, checked: 5, mismatches: 1 } }))

    const list = vault.listReplRuns()
    expect(list.map((r) => r.createdAt)).toEqual([2_000, 1_000])
    expect(list[0]).toMatchObject({ kind: 'checksum', checked: 5, mismatches: 1, pairName: 'Prod cluster' })
    expect(list[1]).toMatchObject({ kind: 'scan', tableDiffs: 2, columnDiffs: 1, replicaLabel: 'app-01' })
  })

  test('lọc theo cụm', () => {
    const vault = newVault()
    vault.saveReplRun(run({ pairId: 'pair-1' }))
    vault.saveReplRun(run({ pairId: 'pair-2', pairName: 'Staging' }))
    expect(vault.listReplRuns('pair-1')).toHaveLength(1)
    expect(vault.listReplRuns()).toHaveLength(2)
  })

  test('chi tiết giải mã đúng nội dung đã lưu', () => {
    const vault = newVault()
    const id = vault.saveReplRun(run())
    const detail = vault.getReplRun(id)
    expect(detail?.tables).toHaveLength(1)
    expect(detail?.tables[0]).toMatchObject({ schema: 'shop', name: 'orders', rowDelta: -12 })
    expect(detail?.truncated).toBe(false)
    expect(vault.getReplRun('không-tồn-tại')).toBeNull()
  })

  test('vault khoá: vẫn liệt kê được, chi tiết báo locked thay vì ném lỗi', () => {
    const vault = newVault()
    const id = vault.saveReplRun(run())
    vault.lock()
    expect(vault.listReplRuns()).toHaveLength(1)
    const detail = vault.getReplRun(id)
    expect(detail?.locked).toBe(true)
    expect(detail?.tables).toEqual([])
    // Metadata vẫn đúng — panel nói được đây là bản ghi nào
    expect(detail?.replicaLabel).toBe('app-01')
  })

  test('xoá 1 bản ghi và xoá theo cụm', () => {
    const vault = newVault()
    const id = vault.saveReplRun(run({ pairId: 'pair-1' }))
    vault.saveReplRun(run({ pairId: 'pair-2' }))
    vault.deleteReplRun(id)
    expect(vault.listReplRuns()).toHaveLength(1)

    vault.saveReplRun(run({ pairId: 'pair-1' }))
    expect(vault.clearReplRuns('pair-1')).toBe(1)
    expect(vault.listReplRuns().map((r) => r.pairId)).toEqual(['pair-2'])
    expect(vault.clearReplRuns()).toBe(1)
    expect(vault.listReplRuns()).toEqual([])
  })

  test('XOÁ CỤM KHÔNG xoá lịch sử của nó — đó là thứ dùng để kiểm lại việc vá dữ liệu', () => {
    const vault = newVault()
    const host = vault.saveHost({
      label: 'db-slave',
      hostname: '10.20.30.40',
      port: 22,
      username: 'deploy',
      authType: 'password',
      password: 'x'
    })
    const pair = vault.saveReplPair({ name: 'Prod cluster', replicas: [{ hostId: host.id }] })
    vault.saveReplRun(run({ pairId: pair.id }))
    vault.deleteReplPair(pair.id)
    expect(vault.listReplRuns(pair.id)).toHaveLength(1)
  })

  test('chỉ giữ 200 bản mới nhất', () => {
    const vault = newVault()
    for (let i = 0; i < 205; i += 1) vault.saveReplRun(run({ createdAt: 1_000 + i }))
    const list = vault.listReplRuns(undefined, 1_000)
    expect(list).toHaveLength(200)
    // Rơi phải là bản CŨ NHẤT, không phải bản vừa ghi
    expect(list[0].createdAt).toBe(1_204)
    expect(list[list.length - 1].createdAt).toBe(1_005)
  })
})
