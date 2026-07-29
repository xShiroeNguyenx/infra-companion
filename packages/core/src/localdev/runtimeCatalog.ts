/**
 * Catalog runtime cho local dev stack: app TỰ TẢI PHP/Nginx/MariaDB portable về userData
 * (không nhúng vào installer → installer không phình, và "tải ≠ phân phối" nên không phát
 * sinh nghĩa vụ redistribute GPL của MariaDB).
 *
 * Thuần (không I/O) → test trực tiếp bằng vitest. Mọi hàm KHÔNG throw: trả danh sách lỗi.
 *
 * VÌ SAO PHẢI KÝ ed25519 (mạnh hơn cả plugin registry): sha256 của nginx và của các bản PHP
 * archive là do CHÍNH TA tính (nginx.org chỉ công bố PGP .asc, php.net rút bản cũ khỏi
 * /releases/ sau vài tháng). Nếu registry (GitHub Pages) bị chiếm, kẻ tấn công sửa được CẢ
 * `url` LẪN `sha256` → sha256 một mình vô nghĩa. Chữ ký (private key nằm ngoài repo) là lớp
 * duy nhất chống được. Và runtime nguy hiểm hơn plugin nhiều: đây là .exe native, không sandbox.
 *
 * Payload canonical (phải khớp từng byte với scripts/build-runtime-catalog.mjs):
 *   infra-runtime-v1 \n id \n version \n os-arch \n sha256
 * Prefix khác 'infra-plugin-v1' để chữ ký plugin không dùng lại được cho runtime (và ngược lại),
 * nhờ đó DÙNG CHUNG được 1 cặp khoá với registry plugin.
 */
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import { OFFICIAL_REGISTRY_PUBLIC_KEY_PEM } from '../plugins/signing'

export type RuntimeArchive = 'zip' | 'tar.gz' | 'raw'
export type RuntimeOs = 'win32' | 'darwin' | 'linux'
export type RuntimeArch = 'x64' | 'arm64'

export interface RuntimeManifestEntry {
  /** 'php-8.3' | 'nginx-1.28' | 'mariadb-11.4' | 'mkcert-1.4'. */
  id: string
  kind: 'php' | 'mariadb' | 'nginx' | 'tool'
  /** Version đầy đủ của artifact, vd '8.3.14'. */
  version: string
  label: string
  os: RuntimeOs
  arch: RuntimeArch
  url: string
  /** SHA-256 hex của artifact — verify TRƯỚC khi giải nén. */
  sha256: string
  /** Để tính % ngay khi bắt đầu tải (server có thể không trả Content-Length). */
  sizeBytes: number
  archive: RuntimeArchive
  /** Số cấp thư mục cần bỏ khi giải nén (php zip phẳng = 0; mariadb-11.4.5-winx64/ = 1). */
  stripComponents: number
  /** Lệnh smoke-test sau khi cài, tương đối với thư mục runtime. Fail ⇒ state 'broken'. */
  verifyCmd?: string[]
  /** URL dự phòng khi link chính chết (link upstream CHẮC CHẮN sẽ rot theo thời gian). */
  mirrors?: string[]
  /** Bản đã hết security support — vẫn cài được nhưng UI cảnh báo. */
  eol?: boolean
  note?: string
  /** Chữ ký ed25519 base64. Thiếu/sai ⇒ app loại entry TRƯỚC khi tốn 1 byte mạng. */
  signature: string | null
}

export interface RuntimeManifest {
  schema: 1
  runtimes: RuntimeManifestEntry[]
}

export type RuntimeManifestResult =
  | { ok: true; manifest: RuntimeManifest }
  | { ok: false; errors: string[] }

const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const VERSION_RE = /^\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z-.]+)?$/
const SHA256_RE = /^[0-9a-f]{64}$/
const SIGNATURE_RE = /^[A-Za-z0-9+/]{80,100}={0,2}$/
const KINDS = new Set(['php', 'mariadb', 'nginx', 'tool'])
const ARCHIVES = new Set(['zip', 'tar.gz', 'raw'])
const OSES = new Set(['win32', 'darwin', 'linux'])
const ARCHES = new Set(['x64', 'arm64'])
const MAX_RUNTIMES = 64
/** Trần 1GB/artifact — chặn manifest ác ý khai size khổng lồ làm đầy ổ. */
const MAX_SIZE_BYTES = 1024 * 1024 * 1024

function safeUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'https:') return true
  // http chỉ cho localhost — phục vụ test manifest local khi dev (giống registry.ts)
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function validateEntry(raw: unknown, where: string, errors: string[]): RuntimeManifestEntry | null {
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`${where} phải là object`)
    return null
  }
  const e = raw as Record<string, unknown>
  const id = str(e.id)
  if (!id || !ID_RE.test(id)) {
    errors.push(`${where}.id không hợp lệ (kebab-case, cho phép dấu chấm): ${String(e.id)}`)
    return null
  }
  const at = `${where}(${id})`
  const kind = str(e.kind)
  const version = str(e.version)
  const label = str(e.label)
  const os = str(e.os)
  const arch = str(e.arch)
  const url = str(e.url)
  const sha256 = str(e.sha256)
  const archive = str(e.archive)

  if (!kind || !KINDS.has(kind)) errors.push(`${at}.kind phải là php|mariadb|nginx|tool`)
  if (!version || !VERSION_RE.test(version)) errors.push(`${at}.version không hợp lệ`)
  if (!label) errors.push(`${at}.label trống`)
  if (!os || !OSES.has(os)) errors.push(`${at}.os phải là win32|darwin|linux`)
  if (!arch || !ARCHES.has(arch)) errors.push(`${at}.arch phải là x64|arm64`)
  if (!url || !safeUrl(url)) errors.push(`${at}.url phải là https (hoặc http://localhost)`)
  if (!sha256 || !SHA256_RE.test(sha256)) errors.push(`${at}.sha256 phải là hex 64 ký tự`)
  if (!archive || !ARCHIVES.has(archive)) errors.push(`${at}.archive phải là zip|tar.gz|raw`)

  const sizeBytes = typeof e.sizeBytes === 'number' && Number.isFinite(e.sizeBytes) ? Math.round(e.sizeBytes) : -1
  if (sizeBytes <= 0 || sizeBytes > MAX_SIZE_BYTES) errors.push(`${at}.sizeBytes phải trong khoảng 1..1GB`)

  const strip =
    typeof e.stripComponents === 'number' && Number.isInteger(e.stripComponents) ? e.stripComponents : -1
  if (strip < 0 || strip > 4) errors.push(`${at}.stripComponents phải là 0..4`)

  let verifyCmd: string[] | undefined
  if (e.verifyCmd !== undefined) {
    if (!Array.isArray(e.verifyCmd) || e.verifyCmd.some((x) => typeof x !== 'string')) {
      errors.push(`${at}.verifyCmd phải là mảng chuỗi`)
    } else {
      verifyCmd = e.verifyCmd as string[]
    }
  }

  let mirrors: string[] | undefined
  if (e.mirrors !== undefined) {
    if (!Array.isArray(e.mirrors) || e.mirrors.some((x) => typeof x !== 'string' || !safeUrl(x))) {
      errors.push(`${at}.mirrors phải là mảng URL https`)
    } else {
      mirrors = e.mirrors as string[]
    }
  }

  const signature = typeof e.signature === 'string' ? e.signature : null
  if (signature !== null && !SIGNATURE_RE.test(signature)) errors.push(`${at}.signature sai định dạng base64`)

  if (errors.length > 0) return null
  return {
    id,
    kind: kind as RuntimeManifestEntry['kind'],
    version: version!,
    label: label!,
    os: os as RuntimeOs,
    arch: arch as RuntimeArch,
    url: url!,
    sha256: sha256!,
    sizeBytes,
    archive: archive as RuntimeArchive,
    stripComponents: strip,
    ...(verifyCmd ? { verifyCmd } : {}),
    ...(mirrors ? { mirrors } : {}),
    ...(e.eol === true ? { eol: true as const } : {}),
    ...(str(e.note) ? { note: str(e.note)! } : {}),
    signature
  }
}

/** Parse + validate manifest JSON. KHÔNG throw. */
export function validateRuntimeManifest(json: string): RuntimeManifestResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    return { ok: false, errors: [`JSON không parse được: ${(e as Error).message}`] }
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['Manifest phải là object'] }
  const m = raw as Record<string, unknown>
  if (m.schema !== 1) return { ok: false, errors: [`schema phải là 1 (nhận ${String(m.schema)})`] }
  if (!Array.isArray(m.runtimes)) return { ok: false, errors: ['runtimes phải là mảng'] }
  if (m.runtimes.length > MAX_RUNTIMES) return { ok: false, errors: [`Quá nhiều runtime (> ${MAX_RUNTIMES})`] }

  const errors: string[] = []
  const out: RuntimeManifestEntry[] = []
  const seen = new Set<string>()
  for (const [i, raw2] of m.runtimes.entries()) {
    const entry = validateEntry(raw2, `runtimes[${i}]`, errors)
    if (!entry) continue
    // Khoá là (id, os, arch): cùng id cho nhiều nền tảng là hợp lệ và cần thiết.
    const key = `${entry.id}|${entry.os}|${entry.arch}`
    if (seen.has(key)) {
      errors.push(`Trùng runtime: ${key}`)
      continue
    }
    seen.add(key)
    out.push(entry)
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, manifest: { schema: 1, runtimes: out } }
}

type SignableRuntime = Pick<RuntimeManifestEntry, 'id' | 'version' | 'os' | 'arch' | 'sha256'>

/** Payload canonical đem ký/verify. KHÔNG gồm url → đổi/thêm mirror không làm hỏng chữ ký
 *  (sha256 mới là danh tính của artifact). */
export function runtimeSigningPayload(e: SignableRuntime): Buffer {
  const lines = ['infra-runtime-v1', e.id, e.version, `${e.os}-${e.arch}`, e.sha256]
  return Buffer.from(lines.join('\n'), 'utf8')
}

/** Ký 1 entry → base64. Chỉ dùng phía maintainer (scripts/) và test. */
export function signRuntimeEntry(e: SignableRuntime, privateKeyPem: string): string {
  return cryptoSign(null, runtimeSigningPayload(e), createPrivateKey(privateKeyPem)).toString('base64')
}

/** Verify chữ ký. KHÔNG throw: thiếu/hỏng → false. */
export function verifyRuntimeEntry(
  e: RuntimeManifestEntry,
  publicKeyPem: string = OFFICIAL_REGISTRY_PUBLIC_KEY_PEM
): boolean {
  if (!e.signature) return false
  try {
    return cryptoVerify(
      null,
      runtimeSigningPayload(e),
      createPublicKey(publicKeyPem),
      Buffer.from(e.signature, 'base64')
    )
  } catch {
    return false
  }
}

/**
 * Lọc catalog theo nền tảng đang chạy + loại entry chữ ký sai.
 * Trả kèm `rejected` để UI/log nói được LÝ DO thay vì im lặng bỏ qua.
 */
export function resolveCatalog(
  manifest: RuntimeManifest,
  os: string,
  arch: string,
  publicKeyPem?: string
): { entries: RuntimeManifestEntry[]; rejected: Array<{ id: string; reason: string }> } {
  const entries: RuntimeManifestEntry[] = []
  const rejected: Array<{ id: string; reason: string }> = []
  for (const e of manifest.runtimes) {
    if (e.os !== os || e.arch !== arch) continue
    if (!verifyRuntimeEntry(e, publicKeyPem)) {
      rejected.push({ id: e.id, reason: 'chữ ký thiếu hoặc không hợp lệ' })
      continue
    }
    entries.push(e)
  }
  return { entries, rejected }
}

/**
 * Toạ độ artifact chính thức cho Windows x64 — GHIM TRONG SOURCE CODE APP.
 *
 * Vì sao ghim sha256 ở đây là ĐÚNG (khác với sha256 trong manifest tải từ mạng): giá trị này
 * đi cùng binary của app, nên nó đáng tin ngang chính app. Manifest tải qua mạng thì khác —
 * kẻ chiếm được registry sửa được cả url lẫn sha256, nên ở đó BẮT BUỘC phải có chữ ký ed25519.
 * Hệ quả thực dụng: cài qua mạng chạy được NGAY, không cần hạ tầng manifest.
 *
 * `sha256` là TUỲ CHỌN vì không phải upstream nào cũng công bố:
 * - PHP: có, trong `https://windows.php.net/downloads/releases/releases.json` (chính chủ).
 * - nginx: KHÔNG (nginx.org chỉ công bố chữ ký PGP `.asc`) → app tự tính rồi GHI LẠI vào
 *   provenance, và UI phải nói rõ "checksum không ghim". Trust vẫn dựa vào HTTPS + nginx.org.
 *
 * ⚠️ LINK ROT là chuyện chắc chắn xảy ra: php.net chuyển bản patch cũ từ `/releases/` sang
 * `/releases/archives/` khi có bản mới. Vì vậy mỗi entry PHP đều kèm `mirrors` trỏ vào
 * `archives/` — hết bản này thì URL kia còn sống. Khi bump version phải cập nhật CẢ sha256.
 *
 * Ghi chú kỹ thuật:
 * - PHP dùng bản **NTS** (non-thread-safe): kiến trúc là nginx + FastCGI, mỗi php-cgi.exe xử lý
 *   1 request tuần tự nên không cần thread-safe; NTS còn nhanh hơn (không ZTS overhead).
 *   Bản TS chỉ dành cho Apache mod_php.
 * - Quy ước tên đổi theo toolchain (vs16 cho 8.1–8.3, vs17 từ 8.4) → URL phải là DỮ LIỆU,
 *   không phải logic sinh trong code.
 */
/**
 * Domain của các công cụ web do app host (vhost RIÊNG, không nằm trong docroot site nào —
 * xem `RuntimeWebApp`). Khai ở ĐÂY chứ không ở ManagedStackProvider để dữ liệu vhost và entry
 * catalog không thể lệch nhau.
 */
export const ADMINER_DOMAIN = 'db.localhost'
export const PMA_DOMAIN = 'pma.localhost'

/**
 * Tool là WEB APP viết bằng PHP (Adminer, phpMyAdmin) — không có binary nào để smoke-test, và
 * phải có vhost RIÊNG chứ không nằm trong docroot của site nào: chúng quản trị được MỌI
 * database, nên đặt trong folder site sẽ (a) bị deploy lên server thật cùng code, (b) cho bất
 * kỳ ai vào được site cũng vào được nó.
 */
export interface RuntimeWebApp {
  /** server_name của vhost. */
  domain: string
  /** Tên file .conf + thư mục log. Prefix `00-` để xếp trước vhost của site. */
  slug: string
  /** index file — Adminer là `adminer.php`, phpMyAdmin là `index.php`. */
  index: string
  /**
   * PHP CAO NHẤT mà app này chạy được, dạng 'major.minor'. Có giá trị ⇒ stack chọn PHP ≤ mức
   * này cho vhost thay vì lấy PHP đầu tiên đang cài.
   * (phpMyAdmin 5.2.3 khai `php_versions: ">=7.2,<8.4"` → chạy trên 8.4 sẽ đầy deprecation.)
   */
  maxPhp?: string
}

/**
 * Tool là `.phar` chạy bằng PHP (Composer, WP-CLI) → app sinh shim `<name>.cmd` trong `bin/`,
 * và `bin/` đã nằm trong PATH của terminal mở tại site (xem LOCALDEV_SITE_SHELL_ENV).
 * Không có shim thì user phải tự gõ `php C:\...\composer.phar` — coi như không dùng được.
 */
export interface RuntimeCliShim {
  /** Tên lệnh user gõ (không có .cmd). */
  name: string
  /** Tên file .phar trong thư mục runtime — phải khớp `rawFileName`. */
  phar: string
}

export interface RuntimeSource {
  id: string
  kind: RuntimeManifestEntry['kind']
  version: string
  label: string
  os: RuntimeOs
  arch: RuntimeArch
  url: string
  archive: RuntimeArchive
  stripComponents: number
  /**
   * Tên file khi `archive: 'raw'` (tải 1 file, không giải nén). Bỏ trống ⇒ `<id>.exe`.
   * Cần cho Adminer: nó là 1 file `.php`, không phải `.exe`.
   */
  rawFileName?: string
  /** Web app PHP (Adminer/phpMyAdmin) → stack sinh vhost riêng cho nó. */
  webApp?: RuntimeWebApp
  /** `.phar` chạy bằng PHP → stack sinh shim `.cmd` trong `bin/`. */
  cliShim?: RuntimeCliShim
  /**
   * Thư mục runtime được nối vào PATH của terminal mở tại site (Node → `node`/`npm`/`npx`,
   * mkcert → `mkcert`). Chỉ đặt cho tool có exe chạy trực tiếp, không cần shim.
   */
  addToPath?: boolean
  /** Ghim trong source khi upstream công bố chính chủ; thiếu ⇒ app tự tính + cảnh báo UI. */
  sha256?: string
  /** Để hiện dung lượng trước khi tải + làm trần chống body khổng lồ. */
  sizeBytes?: number
  verifyCmd?: string[]
  mirrors?: string[]
  eol?: boolean
  note?: string
}

export const RUNTIME_SOURCES: RuntimeSource[] = [
  {
    id: 'php-8.3',
    kind: 'php',
    version: '8.3.32',
    label: 'PHP 8.3 (NTS)',
    os: 'win32',
    arch: 'x64',
    url: 'https://downloads.php.net/~windows/releases/php-8.3.32-nts-Win32-vs16-x64.zip',
    mirrors: ['https://downloads.php.net/~windows/releases/archives/php-8.3.32-nts-Win32-vs16-x64.zip'],
    archive: 'zip',
    // Zip của PHP phẳng (php.exe ở ngay gốc) → không bỏ cấp nào
    stripComponents: 0,
    sha256: '67c724e7b675b50d8f0476d816c3e2a3064ce3a53d572575d63c321cc0a3a6cf',
    sizeBytes: 33_633_994,
    verifyCmd: ['php.exe', '-n', '-v'],
    note: 'Cần Visual C++ Redistributable 2015-2022 (x64) trên máy.'
  },
  {
    id: 'php-8.4',
    kind: 'php',
    version: '8.4.23',
    label: 'PHP 8.4 (NTS)',
    os: 'win32',
    arch: 'x64',
    url: 'https://downloads.php.net/~windows/releases/php-8.4.23-nts-Win32-vs17-x64.zip',
    mirrors: ['https://downloads.php.net/~windows/releases/archives/php-8.4.23-nts-Win32-vs17-x64.zip'],
    archive: 'zip',
    stripComponents: 0,
    sha256: '826efa189b21f46314ad497ff31467de9f0953292f42b235542be4feea182b48',
    sizeBytes: 34_680_647,
    verifyCmd: ['php.exe', '-n', '-v'],
    note: 'Cần Visual C++ Redistributable 2015-2022 (x64) trên máy.'
  },
  {
    id: 'mariadb-11.4',
    kind: 'mariadb',
    version: '11.4.12',
    label: 'MariaDB 11.4 (LTS)',
    os: 'win32',
    arch: 'x64',
    url: 'https://archive.mariadb.org/mariadb-11.4.12/winx64-packages/mariadb-11.4.12-winx64.zip',
    archive: 'zip',
    // Zip bọc trong thư mục mariadb-11.4.12-winx64/ → bỏ 1 cấp
    stripComponents: 1,
    // archive.mariadb.org công bố sha256sums.txt chính chủ
    sha256: '4db7f8003d4a64ac8042b771c6d34ed04c7ffae8cf52775275b72f2bd4dd17a9',
    sizeBytes: 94_906_278,
    verifyCmd: ['bin/mariadbd.exe', '--version'],
    note: 'Chỉ dùng 1 bản LTS — nhảy major (11.4 → 12.x) có thể phải nâng cấp datadir.'
  },
  {
    id: 'nginx-1.30',
    kind: 'nginx',
    version: '1.30.4',
    label: 'Nginx 1.30 (stable)',
    os: 'win32',
    arch: 'x64',
    url: 'https://nginx.org/download/nginx-1.30.4.zip',
    archive: 'zip',
    // Zip của nginx bọc trong thư mục nginx-1.30.4/ → bỏ 1 cấp
    stripComponents: 1,
    // nginx.org KHÔNG công bố sha256 (chỉ PGP .asc) → app tự tính + ghi provenance
    sizeBytes: 2_774_788,
    verifyCmd: ['nginx.exe', '-v']
  },
  {
    id: 'adminer-5.5',
    kind: 'tool',
    version: '5.5.1',
    label: 'Adminer (xem/sửa database)',
    os: 'win32',
    arch: 'x64',
    // Bản 'mysql-en': chỉ driver MySQL/MariaDB + tiếng Anh → nhỏ hơn bản full ~4 lần
    url: 'https://github.com/vrana/adminer/releases/download/v5.5.1/adminer-5.5.1-mysql-en.php',
    archive: 'raw',
    rawFileName: 'adminer.php',
    stripComponents: 0,
    sha256: '6973ffdd5fa89d7ae1cece1480a5954bccab051e4cb6b378c7b572fc7f010b8f',
    sizeBytes: 243_793,
    // Là file PHP, không phải exe → không có lệnh nào để smoke-test
    webApp: { domain: ADMINER_DOMAIN, slug: '00-adminer', index: 'adminer.php' },
    note: `Nhẹ (1 file), chạy được cả PHP 8.4. Mở tại http://${ADMINER_DOMAIN}:<cổng>/`
  },
  {
    id: 'phpmyadmin-5.2',
    kind: 'tool',
    version: '5.2.3',
    label: 'phpMyAdmin (quản trị database)',
    os: 'win32',
    arch: 'x64',
    // Bản 'all-languages' (không phải 'english'): app có UI tiếng Việt/Nhật nên user cũng
    // muốn pma cùng ngôn ngữ; chênh lệch ~10MB là đáng.
    url: 'https://files.phpmyadmin.net/phpMyAdmin/5.2.3/phpMyAdmin-5.2.3-all-languages.zip',
    archive: 'zip',
    // Zip bọc trong phpMyAdmin-5.2.3-all-languages/ → bỏ 1 cấp
    stripComponents: 1,
    // phpmyadmin.net công bố .zip.sha256 chính chủ cạnh file tải
    sha256: '2d2e13c735366d318425c78e4ee2cc8fc648d77faba3ddea2cd516e43885733f',
    sizeBytes: 16_431_330,
    // Là code PHP, không phải exe → không có lệnh nào để smoke-test
    webApp: { domain: PMA_DOMAIN, slug: '00-phpmyadmin', index: 'index.php', maxPhp: '8.3' },
    note:
      `Mở tại http://${PMA_DOMAIN}:<cổng>/ (tự đăng nhập root). ` +
      'Bản 5.2 chưa hỗ trợ PHP 8.4 — hãy cài cả PHP 8.3, app sẽ tự dùng bản đó cho phpMyAdmin.'
  },
  {
    id: 'composer-2.10',
    kind: 'tool',
    version: '2.10.2',
    label: 'Composer (quản lý package PHP)',
    os: 'win32',
    arch: 'x64',
    url: 'https://getcomposer.org/download/2.10.2/composer.phar',
    archive: 'raw',
    rawFileName: 'composer.phar',
    stripComponents: 0,
    // getcomposer.org công bố composer.phar.sha256sum cạnh mỗi bản
    sha256: '5ee7125f8a30a34d246cefdc0bc85b8a783b28f2aec968994118512350d28027',
    sizeBytes: 3_639_279,
    cliShim: { name: 'composer', phar: 'composer.phar' },
    note: 'Cần cài PHP. Gõ `composer` trong terminal mở tại site (nút Terminal ở tab Site).'
  },
  {
    id: 'wpcli-2.12',
    kind: 'tool',
    version: '2.12.0',
    label: 'WP-CLI (dòng lệnh WordPress)',
    os: 'win32',
    arch: 'x64',
    url: 'https://github.com/wp-cli/wp-cli/releases/download/v2.12.0/wp-cli-2.12.0.phar',
    archive: 'raw',
    rawFileName: 'wp-cli.phar',
    stripComponents: 0,
    // wp-cli công bố .phar.sha256 trong release asset
    sha256: 'ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c',
    sizeBytes: 7_142_777,
    cliShim: { name: 'wp', phar: 'wp-cli.phar' },
    note: 'Cần cài PHP. Gõ `wp plugin list`, `wp search-replace`… trong terminal mở tại site.'
  },
  {
    id: 'node-24',
    kind: 'tool',
    version: '24.18.0',
    label: 'Node.js 24 (LTS) + npm',
    os: 'win32',
    arch: 'x64',
    url: 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip',
    archive: 'zip',
    // Zip bọc trong node-v24.18.0-win-x64/ → bỏ 1 cấp
    stripComponents: 1,
    // nodejs.org công bố SHASUMS256.txt chính chủ
    sha256: '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821',
    sizeBytes: 37_176_245,
    verifyCmd: ['node.exe', '-v'],
    addToPath: true,
    note: 'Bản portable — không ghi vào PATH toàn máy. Terminal mở tại site tự thấy node/npm/npx.'
  },
  {
    id: 'mkcert-1.4',
    kind: 'tool',
    version: '1.4.4',
    label: 'mkcert (cert HTTPS local)',
    os: 'win32',
    arch: 'x64',
    url: 'https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-windows-amd64.exe',
    archive: 'raw',
    rawFileName: 'mkcert.exe',
    stripComponents: 0,
    // GitHub KHÔNG công bố checksum cho asset này → giá trị dưới đây do maintainer tính từ
    // đúng URL chính chủ rồi ghim vào source app (đáng tin ngang chính app, và bảo vệ được
    // mọi lần cài sau này). Bump version PHẢI tính lại.
    sha256: 'd2660b50a9ed59eada480750561c96abc2ed4c9a38c6a24d93e30e0977631398',
    sizeBytes: 4_896_256,
    verifyCmd: ['mkcert.exe', '-version'],
    addToPath: true,
    note: 'Gõ `mkcert -install` một lần, rồi `mkcert ten-site.localhost` trong terminal của site.'
  }
]

/** Nguồn khai `webApp` — tool là web app PHP cần vhost riêng (Adminer, phpMyAdmin). */
export function webAppSources(): Array<RuntimeSource & { webApp: RuntimeWebApp }> {
  return RUNTIME_SOURCES.filter((s): s is RuntimeSource & { webApp: RuntimeWebApp } => s.webApp !== undefined)
}

/** Nguồn khai `cliShim` — `.phar` cần shim `.cmd` trong bin/ (Composer, WP-CLI). */
export function cliShimSources(): Array<RuntimeSource & { cliShim: RuntimeCliShim }> {
  return RUNTIME_SOURCES.filter((s): s is RuntimeSource & { cliShim: RuntimeCliShim } => s.cliShim !== undefined)
}

/**
 * Xếp hạng SỐ của id runtime PHP ('php-8.10' > 'php-8.9' — so chuỗi sẽ ra ngược).
 * Id lạ (không khớp mẫu) xếp cao nhất để không bị chọn oan làm "bản cũ nhất".
 */
function phpRank(id: string): number {
  const m = /^php-(\d+)\.(\d+)$/.exec(id)
  return m ? Number(m[1]) * 1000 + Number(m[2]) : Number.MAX_SAFE_INTEGER
}

/** Bản PHP MỚI NHẤT trong danh sách đang cài (null nếu chưa cài bản nào). */
export function newestPhpRuntime(phpRuntimeIds: readonly string[]): string | null {
  return [...phpRuntimeIds].sort((a, b) => phpRank(b) - phpRank(a))[0] ?? null
}

/**
 * Chọn runtime PHP cho 1 web app trong số các bản ĐANG CÀI, tôn trọng `maxPhp`.
 *
 * Vì sao cần: vhost mặc định lấy `phpRuntimeIds[0]`, mà thứ tự đó có thể là PHP 8.4 —
 * phpMyAdmin 5.2 chạy trên 8.4 sẽ đầy deprecation. Thà chọn 8.3 nếu máy có.
 * Không bản nào thoả ⇒ vẫn trả bản đầu tiên (chạy có cảnh báo còn hơn 404 im lặng).
 */
export function pickPhpForWebApp(webApp: RuntimeWebApp, phpRuntimeIds: readonly string[]): string | null {
  if (phpRuntimeIds.length === 0) return null
  const max = webApp.maxPhp
  if (max === undefined) return phpRuntimeIds[0]!
  const cap = phpRank(`php-${max}`)
  // Trong các bản thoả trần thì lấy bản MỚI NHẤT (gần trần nhất)
  return newestPhpRuntime(phpRuntimeIds.filter((id) => phpRank(id) <= cap)) ?? phpRuntimeIds[0]!
}
