import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  RUNTIME_SOURCES,
  cliShimSources,
  newestPhpRuntime,
  pickPhpForWebApp,
  resolveCatalog,
  runtimeSigningPayload,
  signRuntimeEntry,
  validateRuntimeManifest,
  verifyRuntimeEntry,
  webAppSources,
  type RuntimeManifestEntry
} from './runtimeCatalog'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const SHA = 'a'.repeat(64)

function entry(over: Partial<RuntimeManifestEntry> = {}): RuntimeManifestEntry {
  const base: RuntimeManifestEntry = {
    id: 'php-8.3',
    kind: 'php',
    version: '8.3.14',
    label: 'PHP 8.3 (NTS)',
    os: 'win32',
    arch: 'x64',
    url: 'https://windows.php.net/downloads/releases/archives/php-8.3.14-nts-Win32-vs16-x64.zip',
    sha256: SHA,
    sizeBytes: 30_000_000,
    archive: 'zip',
    stripComponents: 0,
    signature: null
  }
  const merged = { ...base, ...over }
  return { ...merged, signature: over.signature ?? signRuntimeEntry(merged, PRIV) }
}

function manifestJson(entries: RuntimeManifestEntry[]): string {
  return JSON.stringify({ schema: 1, runtimes: entries })
}

describe('validateRuntimeManifest', () => {
  test('manifest hợp lệ', () => {
    const res = validateRuntimeManifest(manifestJson([entry()]))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.manifest.runtimes[0]?.id).toBe('php-8.3')
  })

  test('JSON hỏng → lỗi, KHÔNG throw', () => {
    const res = validateRuntimeManifest('{nope')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors[0]).toMatch(/JSON/)
  })

  test('sai schema version', () => {
    expect(validateRuntimeManifest(JSON.stringify({ schema: 2, runtimes: [] })).ok).toBe(false)
  })

  test('sha256 sai định dạng bị loại', () => {
    for (const bad of ['xyz', 'A'.repeat(64), 'a'.repeat(63)]) {
      const res = validateRuntimeManifest(manifestJson([entry({ sha256: bad })]))
      expect(res.ok, bad).toBe(false)
    }
  })

  test('URL không https bị loại (trừ localhost cho dev)', () => {
    expect(validateRuntimeManifest(manifestJson([entry({ url: 'http://evil.com/x.zip' })])).ok).toBe(false)
    expect(validateRuntimeManifest(manifestJson([entry({ url: 'ftp://x/y.zip' })])).ok).toBe(false)
    expect(validateRuntimeManifest(manifestJson([entry({ url: 'http://localhost:8080/x.zip' })])).ok).toBe(true)
  })

  test('id sai định dạng bị loại', () => {
    for (const bad of ['PHP-8.3', 'php 8.3', '../evil', 'php/8.3']) {
      expect(validateRuntimeManifest(manifestJson([entry({ id: bad })])).ok, bad).toBe(false)
    }
  })

  test('sizeBytes phải dương và ≤ 1GB', () => {
    expect(validateRuntimeManifest(manifestJson([entry({ sizeBytes: 0 })])).ok).toBe(false)
    expect(validateRuntimeManifest(manifestJson([entry({ sizeBytes: 2 * 1024 * 1024 * 1024 })])).ok).toBe(false)
  })

  test('stripComponents ngoài 0..4 bị loại', () => {
    expect(validateRuntimeManifest(manifestJson([entry({ stripComponents: -1 })])).ok).toBe(false)
    expect(validateRuntimeManifest(manifestJson([entry({ stripComponents: 9 })])).ok).toBe(false)
  })

  test('trùng (id, os, arch) bị loại, nhưng cùng id khác os thì hợp lệ', () => {
    expect(validateRuntimeManifest(manifestJson([entry(), entry()])).ok).toBe(false)
    const res = validateRuntimeManifest(manifestJson([entry(), entry({ os: 'linux' })]))
    expect(res.ok).toBe(true)
  })

  test('mirrors phải là URL https', () => {
    expect(validateRuntimeManifest(manifestJson([entry({ mirrors: ['http://evil/x'] })])).ok).toBe(false)
    expect(validateRuntimeManifest(manifestJson([entry({ mirrors: ['https://ok/x'] })])).ok).toBe(true)
  })
})

describe('chữ ký ed25519', () => {
  test('ký rồi verify được', () => {
    expect(verifyRuntimeEntry(entry(), PUB)).toBe(true)
  })

  test('thiếu chữ ký → false (không throw)', () => {
    expect(verifyRuntimeEntry({ ...entry(), signature: null }, PUB)).toBe(false)
  })

  test('chữ ký rác → false (không throw)', () => {
    expect(verifyRuntimeEntry({ ...entry(), signature: 'not-base64!!' }, PUB)).toBe(false)
  })

  test('ĐỔI sha256 làm chữ ký vô hiệu — đây là điểm chống registry bị chiếm', () => {
    const e = entry()
    expect(verifyRuntimeEntry({ ...e, sha256: 'b'.repeat(64) }, PUB)).toBe(false)
  })

  test('đổi version/os/arch/id cũng làm chữ ký vô hiệu', () => {
    const e = entry()
    expect(verifyRuntimeEntry({ ...e, version: '8.3.15' }, PUB)).toBe(false)
    expect(verifyRuntimeEntry({ ...e, os: 'linux' }, PUB)).toBe(false)
    expect(verifyRuntimeEntry({ ...e, arch: 'arm64' }, PUB)).toBe(false)
    expect(verifyRuntimeEntry({ ...e, id: 'php-8.4' }, PUB)).toBe(false)
  })

  test('đổi URL/mirror KHÔNG làm hỏng chữ ký (sha256 mới là danh tính artifact)', () => {
    const e = entry()
    expect(verifyRuntimeEntry({ ...e, url: 'https://mirror.example.com/php.zip' }, PUB)).toBe(true)
  })

  test('key khác không verify được', () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(verifyRuntimeEntry(entry(), other)).toBe(false)
  })

  test('payload có prefix riêng để chữ ký plugin không dùng lại được cho runtime', () => {
    const payload = runtimeSigningPayload(entry()).toString('utf8')
    expect(payload.startsWith('infra-runtime-v1\n')).toBe(true)
    expect(payload).not.toContain('infra-plugin-v1')
  })
})

describe('resolveCatalog', () => {
  test('lọc theo os/arch và loại entry chữ ký sai KÈM lý do', () => {
    const good = entry()
    const badSig = { ...entry({ id: 'nginx-1.28', kind: 'nginx' as const }), signature: null }
    const otherOs = entry({ id: 'php-8.2', os: 'linux' })
    const res = resolveCatalog({ schema: 1, runtimes: [good, badSig, otherOs] }, 'win32', 'x64', PUB)
    expect(res.entries.map((e) => e.id)).toEqual(['php-8.3'])
    expect(res.rejected).toEqual([{ id: 'nginx-1.28', reason: 'chữ ký thiếu hoặc không hợp lệ' }])
  })

  test('không có entry cho nền tảng → rỗng, không lỗi', () => {
    const res = resolveCatalog({ schema: 1, runtimes: [entry()] }, 'darwin', 'arm64', PUB)
    expect(res.entries).toEqual([])
    expect(res.rejected).toEqual([])
  })
})

describe('RUNTIME_SOURCES', () => {
  // Ghim sha256 TRONG SOURCE APP là hợp lệ (đáng tin ngang chính app). Khác hoàn toàn với
  // sha256 trong manifest tải qua mạng — chỗ đó bắt buộc phải có chữ ký ed25519.
  test('KHÔNG entry nào mang chữ ký (chữ ký chỉ dành cho manifest tải qua mạng)', () => {
    for (const s of RUNTIME_SOURCES) {
      expect(Object.prototype.hasOwnProperty.call(s, 'signature'), s.id).toBe(false)
    }
  })

  test('PHP có sha256 ghim (php.net công bố chính chủ trong releases.json)', () => {
    for (const s of RUNTIME_SOURCES.filter((x) => x.kind === 'php')) {
      expect(s.sha256, s.id).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test('nginx KHÔNG có sha256 (nginx.org chỉ công bố PGP) → app tự tính + cảnh báo UI', () => {
    for (const s of RUNTIME_SOURCES.filter((x) => x.kind === 'nginx')) {
      expect(s.sha256, s.id).toBeUndefined()
    }
  })

  test('có đủ PHP + nginx + MariaDB + tool (Adminer)', () => {
    expect([...new Set(RUNTIME_SOURCES.map((s) => s.kind))].sort()).toEqual(['mariadb', 'nginx', 'php', 'tool'])
  })

  test('Adminer: 1 file .php (archive raw + rawFileName), KHÔNG phải .exe', () => {
    const a = RUNTIME_SOURCES.find((s) => s.id.startsWith('adminer-'))
    expect(a?.archive).toBe('raw')
    // Mặc định của RuntimeManager cho tool là `<id>.exe` — Adminer phải ghi đè, nếu không
    // nginx sẽ trỏ vào file không tồn tại
    expect(a?.rawFileName).toBe('adminer.php')
    expect(a?.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  test('MariaDB có sha256 ghim (archive.mariadb.org công bố sha256sums.txt)', () => {
    const db = RUNTIME_SOURCES.find((s) => s.kind === 'mariadb')
    expect(db?.sha256).toMatch(/^[0-9a-f]{64}$/)
    // Zip bọc 1 thư mục → phải strip
    expect(db?.stripComponents).toBe(1)
    // Binary nằm trong bin/ nên smoke-test phải trỏ đúng đó
    expect(db?.verifyCmd?.[0]).toBe('bin/mariadbd.exe')
  })

  test('mọi nguồn là https', () => {
    for (const s of RUNTIME_SOURCES) expect(s.url.startsWith('https://'), s.id).toBe(true)
  })

  test('mọi BINARY có verifyCmd để smoke-test sau khi cài', () => {
    // Miễn: (a) file script tải trần — Adminer .php, Composer/WP-CLI .phar; (b) web app PHP —
    // phpMyAdmin là 5000 file PHP, không có exe nào để chạy thử.
    for (const s of RUNTIME_SOURCES.filter((x) => x.archive !== 'raw' && x.webApp === undefined)) {
      expect(s.verifyCmd && s.verifyCmd.length > 0, s.id).toBe(true)
    }
  })

  test('nginx zip bọc 1 thư mục nên strip 1 cấp; PHP zip phẳng nên strip 0', () => {
    for (const s of RUNTIME_SOURCES.filter((x) => x.kind === 'nginx')) {
      expect(s.stripComponents, s.id).toBe(1)
    }
    for (const s of RUNTIME_SOURCES.filter((x) => x.kind === 'php')) {
      expect(s.stripComponents, s.id).toBe(0)
    }
  })

  test('PHP phải là bản NTS (nginx + FastCGI không cần thread-safe)', () => {
    for (const s of RUNTIME_SOURCES.filter((x) => x.kind === 'php')) {
      expect(s.url, s.id).toContain('-nts-')
    }
  })

  test('URL chứa ĐÚNG version khai báo — chống lệch khi bump (bug đã gặp: version tự bịa)', () => {
    for (const s of RUNTIME_SOURCES) {
      expect(s.url, s.id).toContain(s.version)
      for (const m of s.mirrors ?? []) expect(m, `${s.id} mirror`).toContain(s.version)
    }
  })

  test('PHP có mirror trỏ archives/ — php.net chuyển bản patch cũ sang đó khi ra bản mới', () => {
    for (const s of RUNTIME_SOURCES.filter((x) => x.kind === 'php')) {
      expect(s.mirrors?.some((m) => m.includes('/archives/')), s.id).toBe(true)
    }
  })

  test('id runtime KHÔNG chứa patch version (đổi patch không được làm mất site đang trỏ vào)', () => {
    // site.phpVersion lưu 'php-8.3' → bump 8.3.32 lên 8.3.33 không phá site nào.
    // Bất biến: phần version trong id phải là TIỀN TỐ THỰC SỰ của version đầy đủ
    // ('php-8.3' ⊂ '8.3.32', 'node-24' ⊂ '24.18.0') — id chứa nguyên version là sai.
    for (const s of RUNTIME_SOURCES) {
      const idVer = s.id.slice(s.id.lastIndexOf('-') + 1)
      expect(s.version.startsWith(`${idVer}.`), `${s.id} vs ${s.version}`).toBe(true)
    }
  })

  test('phpMyAdmin: zip bọc 1 thư mục, có sha256 ghim, và là web app cần vhost riêng', () => {
    const pma = RUNTIME_SOURCES.find((s) => s.id.startsWith('phpmyadmin-'))
    expect(pma?.archive).toBe('zip')
    expect(pma?.stripComponents).toBe(1)
    expect(pma?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(pma?.webApp?.domain).toBe('pma.localhost')
    expect(pma?.webApp?.index).toBe('index.php')
    // pma 5.2 khai php_versions ">=7.2,<8.4" → phải chặn trần, nếu không vhost lấy PHP 8.4
    expect(pma?.webApp?.maxPhp).toBe('8.3')
  })

  test('web app PHP dùng domain RIÊNG (không ai chồng lên ai, không chồng lên site)', () => {
    const domains = webAppSources().map((s) => s.webApp.domain)
    expect(domains.length).toBeGreaterThanOrEqual(2)
    expect(new Set(domains).size, domains.join(',')).toBe(domains.length)
    // Slug là tên file .conf trong conf/nginx/sites → cũng phải duy nhất
    const slugs = webAppSources().map((s) => s.webApp.slug)
    expect(new Set(slugs).size, slugs.join(',')).toBe(slugs.length)
    // Prefix 00- để nginx nạp trước vhost của site (default_server rơi vào site, không vào tool)
    for (const s of webAppSources()) expect(s.webApp.slug.startsWith('00-'), s.id).toBe(true)
  })

  test('tool .phar khai cliShim, và tên phar khớp rawFileName (nếu lệch thì shim trỏ vào file không có)', () => {
    const shims = cliShimSources()
    expect(shims.map((s) => s.cliShim.name).sort()).toEqual(['composer', 'wp'])
    for (const s of shims) {
      expect(s.archive, s.id).toBe('raw')
      expect(s.cliShim.phar, s.id).toBe(s.rawFileName)
      expect(s.cliShim.phar.endsWith('.phar'), s.id).toBe(true)
    }
  })

  test('tool addToPath phải là exe chạy trực tiếp (không phải .phar/.php)', () => {
    for (const s of RUNTIME_SOURCES.filter((x) => x.addToPath === true)) {
      const raw = s.rawFileName
      if (raw !== undefined) expect(raw.endsWith('.exe'), s.id).toBe(true)
      // Web app không bao giờ vào PATH (nó là code chạy qua nginx)
      expect(s.webApp, s.id).toBeUndefined()
      expect(s.cliShim, s.id).toBeUndefined()
    }
  })
})

describe('newestPhpRuntime', () => {
  test('so theo SỐ, không theo chuỗi (php-8.10 mới hơn php-8.9)', () => {
    expect(newestPhpRuntime(['php-8.9', 'php-8.10'])).toBe('php-8.10')
    expect(newestPhpRuntime(['php-8.3', 'php-8.4'])).toBe('php-8.4')
    expect(newestPhpRuntime(['php-9.0', 'php-8.4'])).toBe('php-9.0')
  })

  test('rỗng ⇒ null', () => {
    expect(newestPhpRuntime([])).toBeNull()
  })
})

describe('pickPhpForWebApp', () => {
  const noCap = { domain: 'db.localhost', slug: '00-adminer', index: 'adminer.php' }
  const capped = { domain: 'pma.localhost', slug: '00-phpmyadmin', index: 'index.php', maxPhp: '8.3' }

  test('không có PHP nào ⇒ null (không sinh vhost trả về mã nguồn PHP dạng text)', () => {
    expect(pickPhpForWebApp(noCap, [])).toBeNull()
    expect(pickPhpForWebApp(capped, [])).toBeNull()
  })

  test('không khai trần ⇒ lấy bản đầu tiên', () => {
    expect(pickPhpForWebApp(noCap, ['php-8.4', 'php-8.3'])).toBe('php-8.4')
  })

  test('có trần ⇒ lấy bản MỚI NHẤT còn thoả trần, dù thứ tự đầu vào là 8.4', () => {
    expect(pickPhpForWebApp(capped, ['php-8.4', 'php-8.3'])).toBe('php-8.3')
    expect(pickPhpForWebApp(capped, ['php-8.4', 'php-8.1', 'php-8.3'])).toBe('php-8.3')
  })

  test('chỉ có bản VƯỢT trần ⇒ vẫn trả về nó (chạy có deprecation còn hơn 404 im lặng)', () => {
    expect(pickPhpForWebApp(capped, ['php-8.4'])).toBe('php-8.4')
  })
})
