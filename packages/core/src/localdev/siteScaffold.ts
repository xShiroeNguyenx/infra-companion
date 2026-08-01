import { isSafeDomain } from './templates/escape'

/**
 * Suy ra slug / domain cho site từ tên user nhập. Thuần → test trực tiếp.
 *
 * Domain mặc định là `<slug>.localhost` vì Chromium/Firefox≥84/Safari≥14 tự phân giải MỌI
 * `*.localhost` về loopback theo RFC 6761 ⇒ KHÔNG cần sửa hosts file, KHÔNG cần quyền admin.
 * (Đánh đổi: resolver của Windows KHÔNG phân giải `*.localhost` nên `curl`/wp-cron loopback sẽ
 * fail cho tới khi thêm hosts entry — đó là việc của M1.5.)
 */

const MAX_SLUG = 40

/** Bỏ dấu tiếng Việt → ascii, chỉ giữ [a-z0-9-]. */
export function slugify(name: string): string {
  const ascii = name
    .normalize('NFD')
    // Bỏ dấu thanh (U+0300–U+036F) — 'Tài liệu' → 'Tai lieu'
    .replace(/[̀-ͯ]/g, '')
    // đ/Đ không phân rã được bằng NFD nên xử lý riêng
    .replace(/[đĐ]/g, 'd')
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
}

/** Slug chưa bị dùng: base, base-2, base-3… Trả 'site' nếu tên rỗng hoàn toàn. */
export function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name) || 'site'
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    // Cắt bớt base để chỗ cho hậu tố, không vượt MAX_SLUG
    const suffix = `-${String(i)}`
    const candidate = `${base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/g, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error('Không sinh được slug duy nhất')
}

export type SiteTld = 'localhost' | 'test'

/** Domain từ slug + TLD. Ném lỗi nếu ra domain không hợp lệ (chống injection từ tên site). */
export function deriveDomain(slug: string, tld: SiteTld = 'localhost'): string {
  const domain = `${slug}.${tld}`
  if (!isSafeDomain(domain)) throw new Error(`Không suy ra được domain hợp lệ từ "${slug}"`)
  return domain
}

/** Domain chưa bị dùng, ưu tiên `<slug>.<tld>`; trùng thì thêm số. */
export function uniqueDomain(slug: string, taken: ReadonlySet<string>, tld: SiteTld = 'localhost'): string {
  const base = deriveDomain(slug, tld)
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = deriveDomain(`${slug}-${String(i)}`, tld)
    if (!taken.has(candidate)) return candidate
  }
  throw new Error('Không sinh được domain duy nhất')
}

export type SiteKind = 'static' | 'php' | 'wordpress'

export interface SiteKindGuess {
  kind: SiteKind
  /** Thư mục con nên làm docroot (rỗng = chính thư mục gốc). */
  docRootSub: string
  /**
   * File/dấu hiệu đã khiến hàm đoán như vậy — UI PHẢI hiện cái này ra.
   *
   * Vì sao cần: đoán sai là chuyện bình thường (user trỏ vào thư mục cha, project chưa
   * `composer install`, hoặc trong repo có sẵn 1 bản WordPress cũ). Không nói lý do thì user
   * chỉ thấy nhãn "WORDPRESS" trên một project Laravel và không biết vì sao — như đúng ca đã
   * gặp. Nói ra thì họ đối chiếu được ngay và sửa bằng ô "Loại site" trong form.
   */
  reason: string
}

/** Dấu hiệu WordPress: 3 file này chỉ có trong WP core. */
const WP_MARKERS = ['wp-config.php', 'wp-load.php', 'wp-settings.php', 'wp-config-sample.php'] as const

/**
 * Dò loại site + docroot từ danh sách file/thư mục ở gốc, KÈM lý do.
 * Chỉ để GỢI Ý — user luôn ghi đè được (xem `SiteUpdate.kind`).
 */
export function detectSiteKindDetailed(entries: readonly string[]): SiteKindGuess {
  const set = new Set(entries.map((e) => e.toLowerCase()))

  // Laravel/Symfony XÉT TRƯỚC WordPress: `artisan` là dấu hiệu CHẮC CHẮN hơn (chỉ Laravel có),
  // còn file wp-* có thể lọt vào một project khác (thư mục con `public/` chứa bản WP cũ, hay
  // user trỏ vào thư mục cha có cả hai). Đảo thứ tự này là cách một site Laravel bị dán nhãn
  // WordPress mà không cách nào sửa.
  if (set.has('artisan')) {
    return { kind: 'php', docRootSub: set.has('public') ? 'public' : '', reason: 'artisan (Laravel)' }
  }
  const wpMarker = WP_MARKERS.find((m) => set.has(m))
  if (wpMarker !== undefined) return { kind: 'wordpress', docRootSub: '', reason: wpMarker }
  if (set.has('composer.json') && set.has('public')) {
    return { kind: 'php', docRootSub: 'public', reason: 'composer.json + public/' }
  }
  if (set.has('bin') && set.has('config') && set.has('public') && set.has('src')) {
    return { kind: 'php', docRootSub: 'public', reason: 'bin/ + config/ + public/ + src/ (Symfony)' }
  }
  if ([...set].some((e) => e.endsWith('.php'))) return { kind: 'php', docRootSub: '', reason: 'có file .php ở gốc' }
  return { kind: 'static', docRootSub: '', reason: 'không thấy file .php nào ở gốc' }
}

/** Bản gọn (giữ chữ ký cũ) — dùng ở chỗ không cần lý do. */
export function detectSiteKind(entries: readonly string[]): { kind: SiteKind; docRootSub: string } {
  const { kind, docRootSub } = detectSiteKindDetailed(entries)
  return { kind, docRootSub }
}

/**
 * Domain user tự nhập cho site có dùng được không.
 *
 * Ngoài `isSafeDomain` (chống injection vào config nginx / hosts), còn bắt buộc CÓ DẤU CHẤM:
 * `server_name mysite;` là hợp lệ với nginx nhưng browser sẽ coi "mysite" là từ khoá tìm kiếm
 * chứ không phải host → user tưởng app hỏng.
 */
export function isSafeSiteDomain(domain: string): boolean {
  return isSafeDomain(domain) && domain.includes('.') && !/^\d+(\.\d+)*$/.test(domain)
}

/**
 * Domain này có tự phân giải về loopback không?
 *
 * CHỈ `*.localhost` là có (RFC 6761, browser tự làm). Mọi TLD khác (`.test`, `.local`, hay
 * domain thật) cần hosts file HOẶC mở bằng browser có DNS override (xem hostmap) — UI phải
 * cảnh báo chỗ này, nếu không user đổi domain xong bấm Mở và nhận trang lỗi không hiểu vì sao.
 */
export function resolvesWithoutHostsFile(domain: string): boolean {
  return domain === 'localhost' || domain.toLowerCase().endsWith('.localhost')
}

/**
 * URL của site. BỎ cổng khi là cổng mặc định của scheme (80/443) → URL sạch `http://site.localhost/`
 * thay vì `http://site.localhost:80/`.
 */
export function siteUrl(domain: string, port: number, https = false): string {
  const scheme = https ? 'https' : 'http'
  const isDefault = (https && port === 443) || (!https && port === 80)
  return isDefault ? `${scheme}://${domain}/` : `${scheme}://${domain}:${String(port)}/`
}
