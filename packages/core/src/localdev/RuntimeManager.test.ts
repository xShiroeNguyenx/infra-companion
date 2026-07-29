import { createHash, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { PROVENANCE_FILE, RuntimeManager, type DownloadStream, type RuntimeProgress } from './RuntimeManager'
import { localDevPaths } from './paths'
import { signRuntimeEntry, type RuntimeManifestEntry } from './runtimeCatalog'
import type { PlatformAdapter } from './platform/PlatformAdapter'
import type { LocalDevPaths } from './types'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const roots: string[] = []
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

function newPaths(): LocalDevPaths {
  const dir = mkdtempSync(join(tmpdir(), 'infra-rt-'))
  roots.push(dir)
  return localDevPaths(dir)
}

const PAYLOAD = Buffer.from('fake-archive-content')
const PAYLOAD_SHA = createHash('sha256').update(PAYLOAD).digest('hex')

function entry(over: Partial<RuntimeManifestEntry> = {}): RuntimeManifestEntry {
  const base: RuntimeManifestEntry = {
    id: 'php-8.3',
    kind: 'php',
    version: '8.3.14',
    label: 'PHP 8.3',
    os: 'win32',
    arch: 'x64',
    url: 'https://example.com/php.zip',
    sha256: PAYLOAD_SHA,
    sizeBytes: PAYLOAD.byteLength,
    archive: 'zip',
    stripComponents: 0,
    verifyCmd: ['php.exe', '-v'],
    signature: null
  }
  const merged = { ...base, ...over }
  return { ...merged, signature: over.signature === undefined ? signRuntimeEntry(merged, PRIV) : over.signature }
}

/** Adapter giả: "giải nén" = ghi 1 file marker; runShort trả kết quả cấu hình được. */
function fakeAdapter(over?: {
  extractFails?: boolean
  verifyCode?: number | null
  onExtract?: (dest: string) => Promise<void>
}): PlatformAdapter & { extracted: string[]; killed: number[] } {
  const extracted: string[] = []
  return {
    platform: 'win32',
    extracted,
    killed: [],
    async extractArchive(archivePath, destDir) {
      if (over?.extractFails) throw new Error('giải nén lỗi')
      extracted.push(destDir)
      await mkdir(destDir, { recursive: true })
      await writeFile(join(destDir, 'php.exe'), 'stub', 'utf8')
      await over?.onExtract?.(destDir)
      void archivePath
    },
    killTree: () => Promise.resolve(),
    findStrayProcesses: () => Promise.resolve([]),
    reservedPortRanges: () => Promise.resolve([]),
    runShort: () =>
      Promise.resolve({
        code: over?.verifyCode === undefined ? 0 : over.verifyCode,
        stdout: 'PHP 8.3.14',
        stderr: over?.verifyCode === 0 || over?.verifyCode === undefined ? '' : 'thiếu VCRUNTIME140.dll'
      }),
    runWithStdinFile: () => Promise.resolve({ code: 0, stdout: '', stderr: '' })
  }
}

function streamOf(buf: Buffer, chunkSize = 7): (url: string, signal: AbortSignal) => Promise<DownloadStream> {
  return () =>
    Promise.resolve({
      totalBytes: buf.byteLength,
      stream: (async function* () {
        for (let i = 0; i < buf.byteLength; i += chunkSize) {
          yield new Uint8Array(buf.subarray(i, Math.min(buf.byteLength, i + chunkSize)))
        }
      })()
    })
}

function mgr(
  paths: LocalDevPaths,
  adapter: PlatformAdapter,
  openStream: (url: string, signal: AbortSignal) => Promise<DownloadStream>
): { m: RuntimeManager; events: RuntimeProgress[] } {
  const m = new RuntimeManager({ paths, adapter, openStream, publicKeyPem: PUB })
  const events: RuntimeProgress[] = []
  m.on('progress', (p) => events.push(p))
  return { m, events }
}

describe('RuntimeManager.install — đường thành công', () => {
  test('tải, verify sha256, giải nén, smoke-test, ghi provenance', async () => {
    const paths = newPaths()
    const adapter = fakeAdapter()
    const { m, events } = mgr(paths, adapter, streamOf(PAYLOAD))
    await m.install(entry())

    const dir = join(paths.runtimes, 'php-8.3')
    expect(existsSync(join(dir, 'php.exe'))).toBe(true)

    const prov = JSON.parse(readFileSync(join(dir, PROVENANCE_FILE), 'utf8')) as Record<string, unknown>
    expect(prov.id).toBe('php-8.3')
    expect(prov.sha256).toBe(PAYLOAD_SHA)
    expect(prov.verifiedAt).toBeTypeOf('number') // smoke-test code 0

    expect(events.map((e) => e.phase)).toContain('download')
    expect(events.map((e) => e.phase)).toContain('verify')
    expect(events.at(-1)?.phase).toBe('done')
  })

  test('dọn sạch thư mục tạm sau khi cài (không để .part/staging sót)', async () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    await m.install(entry())
    const left = existsSync(paths.runtimesTmp) ? await readdir(paths.runtimesTmp) : []
    expect(left).toEqual([])
  })

  test('cài lại đè bản cũ, không lẫn file lạ', async () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    await m.install(entry())
    const dir = join(paths.runtimes, 'php-8.3')
    writeFileSync(join(dir, 'rác.txt'), 'x')
    await m.install(entry())
    expect(existsSync(join(dir, 'rác.txt'))).toBe(false)
    expect(existsSync(join(dir, 'php.exe'))).toBe(true)
  })
})

describe('RuntimeManager.install — bất biến an toàn', () => {
  test('CHỮ KÝ SAI: dừng TRƯỚC khi tốn 1 byte mạng (openStream không được gọi)', async () => {
    const paths = newPaths()
    let opened = 0
    const openStream = (): Promise<DownloadStream> => {
      opened++
      return streamOf(PAYLOAD)('', new AbortController().signal)
    }
    const { m, events } = mgr(paths, fakeAdapter(), openStream)
    await expect(m.install(entry({ signature: null }))).rejects.toThrow(/Chữ ký/)
    expect(opened).toBe(0)
    expect(events.at(-1)?.phase).toBe('error')
  })

  test('chữ ký của entry khác (đổi sha256) cũng bị loại', async () => {
    const paths = newPaths()
    const good = entry()
    const tampered: RuntimeManifestEntry = { ...good, sha256: 'b'.repeat(64) }
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    await expect(m.install(tampered)).rejects.toThrow(/Chữ ký/)
  })

  test('SAI CHECKSUM: KHÔNG giải nén, không tạo thư mục runtime', async () => {
    const paths = newPaths()
    const adapter = fakeAdapter()
    const wrong = Buffer.from('noi-dung-khac')
    const { m } = mgr(paths, adapter, streamOf(wrong))
    await expect(m.install(entry({ sizeBytes: wrong.byteLength }))).rejects.toThrow(/checksum/i)
    expect(adapter.extracted).toEqual([])
    expect(existsSync(join(paths.runtimes, 'php-8.3'))).toBe(false)
  })

  test('sai checksum vẫn dọn file .part', async () => {
    const paths = newPaths()
    const wrong = Buffer.from('x')
    const { m } = mgr(paths, fakeAdapter(), streamOf(wrong))
    await expect(m.install(entry({ sizeBytes: 1 }))).rejects.toThrow()
    const left = existsSync(paths.runtimesTmp) ? await readdir(paths.runtimesTmp) : []
    expect(left).toEqual([])
  })

  test('BODY KHỔNG LỒ: abort để không làm đầy ổ trước khi kịp kiểm sha256', async () => {
    const paths = newPaths()
    // Trần thấp nhất là 64MB (sàn) → phải vượt mốc đó mới abort
    const huge = Buffer.alloc(70 * 1024 * 1024, 1)
    const { m } = mgr(paths, fakeAdapter(), streamOf(huge, 1024 * 1024))
    await expect(
      m.install(entry({ sizeBytes: 1000, sha256: createHash('sha256').update(huge).digest('hex') }))
    ).rejects.toThrow(/Dừng tải/)
  })

  // HỒI QUY: trần từng là sizeBytes*1.25. nginx khai 2.0MB nhưng thật 2.65MB ⇒ chặn oan, cài
  // fail dù file hoàn toàn đúng. Trần chỉ để chống đầy ổ — chống giả mạo là việc của sha256.
  test('sizeBytes ghi tay LỆCH vài trăm KB vẫn cài được (không biến sai số thành lỗi cứng)', async () => {
    const paths = newPaths()
    const real = Buffer.alloc(2_774_788, 7)
    const sha = createHash('sha256').update(real).digest('hex')
    const { m } = mgr(paths, fakeAdapter(), streamOf(real, 64 * 1024))
    // Khai 2.0MB nhưng file thật 2.65MB — đúng tình huống đã gặp
    await expect(m.install(entry({ sizeBytes: 2_000_000, sha256: sha }))).resolves.toBeUndefined()
  })

  test('file NHỎ HƠN khai báo vẫn cài được (miễn sha256 khớp)', async () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    await expect(m.install(entry({ sizeBytes: 30_000_000 }))).resolves.toBeUndefined()
  })

  test('giải nén lỗi ⇒ KHÔNG tạo thư mục runtime nửa vời', async () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter({ extractFails: true }), streamOf(PAYLOAD))
    await expect(m.install(entry())).rejects.toThrow(/giải nén/)
    expect(existsSync(join(paths.runtimes, 'php-8.3'))).toBe(false)
  })

  test('SMOKE-TEST THẤT BẠI: báo lỗi có nội dung hành động được, provenance verifiedAt=null', async () => {
    const paths = newPaths()
    const { m, events } = mgr(paths, fakeAdapter({ verifyCode: 1 }), streamOf(PAYLOAD))
    await expect(m.install(entry())).rejects.toThrow(/chạy thử thất bại/)
    // Vẫn ghi provenance để UI biết "đã cài nhưng hỏng" thay vì "chưa cài"
    const prov = JSON.parse(
      readFileSync(join(paths.runtimes, 'php-8.3', PROVENANCE_FILE), 'utf8')
    ) as Record<string, unknown>
    expect(prov.verifiedAt).toBeNull()
    expect(events.at(-1)?.error).toMatch(/VCRUNTIME/)
  })
})

describe('RuntimeManager — mirror khi link chết', () => {
  test('URL chính lỗi → tự thử mirror', async () => {
    const paths = newPaths()
    const tried: string[] = []
    const openStream = (url: string): Promise<DownloadStream> => {
      tried.push(url)
      if (url.includes('primary')) return Promise.reject(new Error('HTTP 404'))
      return streamOf(PAYLOAD)(url, new AbortController().signal)
    }
    const { m } = mgr(paths, fakeAdapter(), openStream)
    await m.install(entry({ url: 'https://primary.example/php.zip', mirrors: ['https://mirror.example/php.zip'] }))
    expect(tried).toEqual(['https://primary.example/php.zip', 'https://mirror.example/php.zip'])
    expect(existsSync(join(paths.runtimes, 'php-8.3', 'php.exe'))).toBe(true)
  })

  test('mọi URL đều chết → throw lỗi cuối', async () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter(), () => Promise.reject(new Error('HTTP 404')))
    await expect(m.install(entry({ mirrors: ['https://m2.example/x.zip'] }))).rejects.toThrow(/404/)
  })
})

describe('RuntimeManager.install — từ file local (escape hatch AV/mạng công ty)', () => {
  test('file khớp sha256 ⇒ cài được, KHÔNG gọi mạng', async () => {
    const paths = newPaths()
    const dir = mkdtempSync(join(tmpdir(), 'infra-local-'))
    roots.push(dir)
    const file = join(dir, 'php.zip')
    writeFileSync(file, PAYLOAD)

    let opened = 0
    const { m } = mgr(paths, fakeAdapter(), () => {
      opened++
      return Promise.reject(new Error('không được gọi'))
    })
    await m.install(entry(), file)
    expect(opened).toBe(0)
    expect(existsSync(join(paths.runtimes, 'php-8.3', 'php.exe'))).toBe(true)
    const prov = JSON.parse(
      readFileSync(join(paths.runtimes, 'php-8.3', PROVENANCE_FILE), 'utf8')
    ) as Record<string, unknown>
    expect(String(prov.sourceUrl)).toMatch(/^file:/)
  })

  test('file KHÔNG khớp sha256 ⇒ từ chối (user tự tải cũng không được bỏ qua checksum)', async () => {
    const paths = newPaths()
    const dir = mkdtempSync(join(tmpdir(), 'infra-local-bad-'))
    roots.push(dir)
    const file = join(dir, 'php.zip')
    writeFileSync(file, Buffer.from('file-sai'))
    const { m } = mgr(paths, fakeAdapter(), () => Promise.reject(new Error('x')))
    await expect(m.install(entry(), file)).rejects.toThrow(/checksum/i)
    expect(existsSync(join(paths.runtimes, 'php-8.3'))).toBe(false)
  })
})

describe('RuntimeManager.installFromFile — không có manifest (user là trust anchor)', () => {
  const source = {
    id: 'nginx-1.28',
    version: '1.28.0',
    archive: 'zip' as const,
    stripComponents: 1,
    kind: 'nginx' as const,
    verifyCmd: ['php.exe', '-v'] // adapter giả tạo file php.exe
  }

  test('cài được KHÔNG cần chữ ký, và GHI LẠI sha256 đã tính để về sau audit được', async () => {
    const paths = newPaths()
    const dir = mkdtempSync(join(tmpdir(), 'infra-src-'))
    roots.push(dir)
    const file = join(dir, 'nginx.zip')
    writeFileSync(file, PAYLOAD)

    const { m } = mgr(paths, fakeAdapter(), () => Promise.reject(new Error('không được gọi mạng')))
    const res = await m.installFromFile(source, file)
    expect(res.sha256).toBe(PAYLOAD_SHA)

    const prov = JSON.parse(
      readFileSync(join(paths.runtimes, 'nginx-1.28', PROVENANCE_FILE), 'utf8')
    ) as Record<string, unknown>
    expect(prov.sha256).toBe(PAYLOAD_SHA)
    expect(String(prov.sourceUrl)).toMatch(/^file:/)
    expect(prov.verifiedAt).toBeTypeOf('number')
  })

  test('vẫn smoke-test binary: exe không chạy ⇒ báo lỗi rõ', async () => {
    const paths = newPaths()
    const dir = mkdtempSync(join(tmpdir(), 'infra-src-bad-'))
    roots.push(dir)
    const file = join(dir, 'nginx.zip')
    writeFileSync(file, PAYLOAD)
    const { m } = mgr(paths, fakeAdapter({ verifyCode: 1 }), () => Promise.reject(new Error('x')))
    await expect(m.installFromFile(source, file)).rejects.toThrow(/chạy thử thất bại/)
  })

  test('id runtime không hợp lệ ⇒ từ chối', async () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter(), () => Promise.reject(new Error('x')))
    await expect(m.installFromFile({ ...source, id: '../evil' }, 'x.zip')).rejects.toThrow(/không hợp lệ/)
  })
})

describe('RuntimeManager.listInstalled — filesystem là nguồn chân lý', () => {
  test('chưa có thư mục runtimes → rỗng', async () => {
    const { m } = mgr(newPaths(), fakeAdapter(), streamOf(PAYLOAD))
    expect(await m.listInstalled()).toEqual([])
  })

  test('liệt kê runtime đã cài kèm provenance', async () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    await m.install(entry())
    const list = await m.listInstalled()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe('php-8.3')
    expect(list[0]?.broken).toBe(false)
    expect(list[0]?.provenance?.version).toBe('8.3.14')
  })

  test('THƯ MỤC CÓ NHƯNG THIẾU provenance ⇒ broken (user xoá tay/cài dở, không được coi là OK)', async () => {
    const paths = newPaths()
    await mkdir(join(paths.runtimes, 'nginx-1.28'), { recursive: true })
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    const list = await m.listInstalled()
    expect(list).toHaveLength(1)
    expect(list[0]?.broken).toBe(true)
    expect(list[0]?.provenance).toBeNull()
  })

  test('bỏ qua thư mục ẩn (.tmp)', async () => {
    const paths = newPaths()
    await mkdir(paths.runtimesTmp, { recursive: true })
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    expect(await m.listInstalled()).toEqual([])
  })
})

describe('RuntimeManager.remove / exeOf', () => {
  test('remove xoá thư mục runtime', async () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    await m.install(entry())
    await m.remove('php-8.3')
    expect(existsSync(join(paths.runtimes, 'php-8.3'))).toBe(false)
  })

  test('remove id không hợp lệ ⇒ throw, không xoá gì', async () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    await expect(m.remove('../../evil')).rejects.toThrow(/không hợp lệ/)
  })

  test('exeOf trả đường dẫn trong runtime, chặn id xấu', () => {
    const paths = newPaths()
    const { m } = mgr(paths, fakeAdapter(), streamOf(PAYLOAD))
    expect(m.exeOf('php-8.3', 'php-cgi.exe')).toBe(join(paths.runtimes, 'php-8.3', 'php-cgi.exe'))
    expect(m.exeOf('../evil', 'x.exe')).toBeNull()
  })
})
