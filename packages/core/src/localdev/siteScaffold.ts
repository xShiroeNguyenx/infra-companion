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

/**
 * Dò loại site + docroot từ danh sách file/thư mục ở gốc.
 * Chỉ dùng để GỢI Ý cho user, không tự quyết định thay họ.
 */
export function detectSiteKind(entries: readonly string[]): {
  kind: 'static' | 'php' | 'wordpress'
  /** Thư mục con nên làm docroot (rỗng = chính thư mục gốc). */
  docRootSub: string
} {
  const set = new Set(entries.map((e) => e.toLowerCase()))
  if (set.has('wp-config.php') || set.has('wp-load.php') || set.has('wp-settings.php')) {
    return { kind: 'wordpress', docRootSub: '' }
  }
  // Laravel / Symfony: code nằm ngoài, web root là public/
  if (set.has('artisan') || (set.has('composer.json') && set.has('public'))) {
    return { kind: 'php', docRootSub: 'public' }
  }
  if ([...set].some((e) => e.endsWith('.php'))) return { kind: 'php', docRootSub: '' }
  return { kind: 'static', docRootSub: '' }
}
