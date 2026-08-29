import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { deriveSyncKey, newSyncSalt } from '../vault/crypto'
import { BLOB_NAME, FolderBackend, findNearMissBlobs, type SyncBackend } from './backends'
import { SyncService, isEmptySnapshot } from './SyncService'
import type { SyncSnapshot, VaultService as VaultServiceType } from '../vault/VaultService'

/**
 * Test guard chống ghi đè + đóng gói blob. Phần đụng vault cần `node:sqlite` (Node >= 22.5);
 * Node 20 không có → tự skip, chạy đủ bằng Node của Electron:
 *   $env:ELECTRON_RUN_AS_NODE=1; node_modules\.bin\electron node_modules\vitest\vitest.mjs run
 */
let VaultService: typeof VaultServiceType | null = null
try {
  await import('node:sqlite')
  VaultService = (await import('../vault/VaultService')).VaultService
} catch {
  // node:sqlite không có trên runtime này
}

const tmpRoots: string[] = []
const openVaults: VaultServiceType[] = []
afterAll(() => {
  for (const vault of openVaults) vault.close() // SQLite còn mở thì rmSync dính EPERM trên Windows
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

function newTmpDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `infra-sync-${label}-`))
  tmpRoots.push(dir)
  return dir
}

function newVault(label: string): VaultServiceType {
  const vault = new VaultService!(join(newTmpDir(label), 'vault.db'))
  vault.setup(`master-${label}-12345678`)
  openVaults.push(vault)
  return vault
}

function emptySnapshot(): SyncSnapshot {
  return { version: 1, groups: [], keys: [], hosts: [], snippets: [], tunnels: [], knownHosts: [], tombstones: [] }
}

/** Backend giả để dựng đúng tình huống muốn test mà không phụ thuộc fs. */
class FakeBackend implements SyncBackend {
  writes: string[] = []
  constructor(
    private blob: string | null,
    private readonly nearMisses: string[] = []
  ) {}
  read(): Promise<string | null> {
    return Promise.resolve(this.blob)
  }
  write(blob: string): Promise<void> {
    this.writes.push(blob)
    this.blob = blob
    return Promise.resolve()
  }
  listNearMisses(): Promise<string[]> {
    return Promise.resolve(this.nearMisses)
  }
  describe(): string {
    return 'fake'
  }
}

describe('findNearMissBlobs', () => {
  test('bỏ qua tên đúng, bắt bản sao của trình duyệt', () => {
    expect(findNearMissBlobs([BLOB_NAME])).toEqual([])
    expect(findNearMissBlobs(['infra-companion-vault (1).blob'])).toEqual(['infra-companion-vault (1).blob'])
  })

  test('bắt file tải dở, file conflict và tmp còn sót', () => {
    const names = [
      'infra-companion-vault.blob.crdownload',
      'infra-companion-vault.sync-conflict-20260101-120000.blob',
      'infra-companion-vault.blob.tmp',
      'Infra-Companion-Vault.blob' // hoa/thường khác nhau vẫn là dấu hiệu
    ]
    expect(findNearMissBlobs(names)).toEqual(names)
  })

  test('không báo nhầm file không liên quan', () => {
    expect(findNearMissBlobs(['notes.txt', 'backup.zip', '.DS_Store'])).toEqual([])
  })

  test('thư mục có cả file đúng lẫn bản sao → chỉ bản sao là near-miss', () => {
    expect(findNearMissBlobs([BLOB_NAME, 'infra-companion-vault (2).blob', 'readme.md'])).toEqual([
      'infra-companion-vault (2).blob'
    ])
  })
})

describe('FolderBackend.listNearMisses', () => {
  test('đọc thư mục thật', async () => {
    const dir = newTmpDir('nearmiss')
    writeFileSync(join(dir, 'infra-companion-vault (1).blob'), 'x')
    writeFileSync(join(dir, 'khac.txt'), 'x')
    expect(await new FolderBackend(dir).listNearMisses()).toEqual(['infra-companion-vault (1).blob'])
  })

  test('thư mục không tồn tại → rỗng, không ném', async () => {
    expect(await new FolderBackend(join(newTmpDir('missing'), 'khong-co')).listNearMisses()).toEqual([])
  })
})

describe('isEmptySnapshot', () => {
  test('snapshot rỗng', () => {
    expect(isEmptySnapshot(emptySnapshot())).toBe(true)
  })

  test('chỉ có tombstone cũng KHÔNG rỗng — đó là lệnh xoá cần đẩy đi', () => {
    expect(isEmptySnapshot({ ...emptySnapshot(), tombstones: [{ recordId: 'a', table: 'hosts', deletedAt: 1 }] })).toBe(
      false
    )
  })

  test('có host thì không rỗng', () => {
    expect(isEmptySnapshot({ ...emptySnapshot(), hosts: [{ id: 'h1' }] })).toBe(false)
  })
})

/**
 * Dẫn xuất key MỘT lần cho cả file.
 *
 * `deriveSyncKey` là argon2id 19 MiB chạy pure-JS — mỗi lần gọi tốn cỡ giây. Gọi lại trong
 * từng test thì suite này ăn hết CPU và làm `crypto.test.ts` (cũng argon2id) **timeout ở
 * 5000ms** khi 58 file chạy song song — đỏ vì tranh CPU chứ không phải vì sai. Cùng
 * passphrase + cùng salt luôn ra cùng key (đúng cái `crypto.test.ts` đang khẳng định), nên
 * dùng lại là tương đương hoàn toàn.
 */
const SALT = newSyncSalt()
const KEY = deriveSyncKey('sync-passphrase-12345678', SALT)
const WRONG_KEY = deriveSyncKey('sai-passphrase-12345678', SALT)

describe.skipIf(VaultService === null)('SyncService — guard chống ghi đè', () => {
  const salt = SALT
  const key = KEY

  test('không thấy blob nhưng thư mục có file gần giống → CHẶN, không ghi', async () => {
    const vault = newVault('nearmiss')
    vault.saveHost({ label: 'app-01', hostname: 'app-01', port: 22, username: 'deploy', authType: 'agent' })
    const backend = new FakeBackend(null, ['infra-companion-vault (1).blob'])

    const result = await new SyncService().sync(vault, backend, key, salt)

    expect(result.ok).toBe(false)
    expect(result.needsConfirm).toBe(true)
    expect(result.wrote).toBe(false)
    expect(backend.writes).toHaveLength(0)
    expect(result.error).toContain('infra-companion-vault (1).blob')
  })

  test('từng đồng bộ được rồi mà blob biến mất → CHẶN (Drive chưa tải xong)', async () => {
    const vault = newVault('vanished')
    vault.saveHost({ label: 'app-02', hostname: 'app-02', port: 22, username: 'deploy', authType: 'agent' })
    const backend = new FakeBackend(null)

    const result = await new SyncService().sync(vault, backend, key, salt, { syncedBefore: true })

    expect(result.ok).toBe(false)
    expect(result.needsConfirm).toBe(true)
    expect(backend.writes).toHaveLength(0)
  })

  test('force ghi đè được sau khi user xác nhận', async () => {
    const vault = newVault('forced')
    vault.saveHost({ label: 'app-03', hostname: 'app-03', port: 22, username: 'deploy', authType: 'agent' })
    const backend = new FakeBackend(null, ['infra-companion-vault (1).blob'])

    const result = await new SyncService().sync(vault, backend, key, salt, { syncedBefore: true, force: true })

    expect(result.ok).toBe(true)
    expect(result.wrote).toBe(true)
    expect(backend.writes).toHaveLength(1)
  })

  test('vault trống + backend trống → ok nhưng KHÔNG tạo blob rỗng', async () => {
    const vault = newVault('empty')
    const backend = new FakeBackend(null)

    const result = await new SyncService().sync(vault, backend, key, salt)

    expect(result.ok).toBe(true)
    expect(result.wrote).toBe(false)
    expect(backend.writes).toHaveLength(0)
  })

  test('lần đầu thật sự (có dữ liệu, thư mục sạch) vẫn ghi bình thường', async () => {
    const vault = newVault('first')
    vault.saveHost({ label: 'app-04', hostname: 'app-04', port: 22, username: 'deploy', authType: 'agent' })
    const backend = new FakeBackend(null)

    const result = await new SyncService().sync(vault, backend, key, salt)

    expect(result.ok).toBe(true)
    expect(result.wrote).toBe(true)
    expect(result.hadRemote).toBe(false)
  })

  test('có blob remote thì guard không đụng tới — vẫn merge và ghi lại', async () => {
    const source = newVault('src')
    source.saveHost({ label: 'app-05', hostname: 'app-05', port: 22, username: 'deploy', authType: 'agent' })
    const service = new SyncService()
    const backend = new FakeBackend(service.buildBlob(source, key, salt), ['infra-companion-vault (1).blob'])

    const target = newVault('dst')
    const result = await service.sync(target, backend, key, salt)

    expect(result.ok).toBe(true)
    expect(result.hadRemote).toBe(true)
    expect(result.pulled).toBeGreaterThan(0)
    expect(target.listHosts().some((h) => h.label === 'app-05')).toBe(true)
  })
})

describe.skipIf(VaultService === null)('SyncService — blob dạng file', () => {
  test('xuất rồi nhập lại trên máy khác (master password khác nhau)', () => {
    const service = new SyncService()

    const source = newVault('export')
    source.saveHost({ label: 'gate-01', hostname: 'gate.example.com', port: 22, username: 'admin', authType: 'agent' })
    const blob = service.buildBlob(source, KEY, SALT)

    // Vault đích có master password KHÁC hẳn (newVault đặt theo label) — secret trong blob
    // được mã hoá lại bằng DEK của máy đích, nên không cần trùng master password
    const target = newVault('import')
    expect(service.applyBlob(target, blob, KEY)).toBeGreaterThan(0)
    expect(target.listHosts().some((h) => h.label === 'gate-01')).toBe(true)
  })

  test('salt đọc được từ header để máy khác dẫn xuất đúng key', () => {
    const blob = new SyncService().buildBlob(newVault('salt'), KEY, SALT)
    expect(SyncService.saltOf(blob)).toBe(SALT)
  })

  test('sai passphrase → wrong-pass, không phải ném hay merge bừa', () => {
    const service = new SyncService()
    const source = newVault('wrongpass-src')
    source.saveHost({ label: 'web-01', hostname: 'web-01', port: 22, username: 'deploy', authType: 'agent' })
    const blob = service.buildBlob(source, KEY, SALT)

    const target = newVault('wrongpass-dst')
    expect(service.applyBlob(target, blob, WRONG_KEY)).toBe('wrong-pass')
    expect(target.listHosts()).toHaveLength(0)
  })

  test('file không phải blob → corrupt', () => {
    expect(new SyncService().applyBlob(newVault('corrupt'), 'khong-co-dau-gach-dung', KEY)).toBe('corrupt')
  })

  test('saltOf trả null với chuỗi không có header', () => {
    expect(SyncService.saltOf('khong-co-gi')).toBeNull()
    expect(SyncService.saltOf('|payload-nhung-salt-rong')).toBeNull()
  })
})
