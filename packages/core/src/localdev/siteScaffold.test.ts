import { describe, expect, test } from 'vitest'
import {
  deriveDomain,
  detectSiteKind,
  detectSiteKindDetailed,
  isSafeSiteDomain,
  resolvesWithoutHostsFile,
  siteUrl,
  slugify,
  uniqueDomain,
  uniqueSlug
} from './siteScaffold'

describe('slugify', () => {
  test('tên thường', () => {
    expect(slugify('My Shop')).toBe('my-shop')
    expect(slugify('demo')).toBe('demo')
  })

  test('BỎ DẤU tiếng Việt (tên site tiếng Việt rất phổ biến với user này)', () => {
    expect(slugify('Cửa hàng của tôi')).toBe('cua-hang-cua-toi')
    expect(slugify('Tài liệu')).toBe('tai-lieu')
    expect(slugify('Đặt hàng')).toBe('dat-hang')
    expect(slugify('ĐƠN HÀNG')).toBe('don-hang')
  })

  test('gộp ký tự lạ thành 1 gạch, không để gạch ở đầu/cuối', () => {
    expect(slugify('a  b')).toBe('a-b')
    expect(slugify('--a--b--')).toBe('a-b')
    expect(slugify('a/b\\c')).toBe('a-b-c')
    expect(slugify('shop!!!')).toBe('shop')
  })

  test('cắt độ dài và không để lại gạch cuối sau khi cắt', () => {
    const s = slugify('a'.repeat(60))
    expect(s).toHaveLength(40)
    const s2 = slugify(`${'a'.repeat(39)} bbb`)
    expect(s2.endsWith('-')).toBe(false)
  })

  test('tên toàn ký tự lạ → rỗng (uniqueSlug sẽ lo fallback)', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('')).toBe('')
  })
})

describe('uniqueSlug', () => {
  test('chưa trùng thì giữ nguyên', () => {
    expect(uniqueSlug('My Shop', new Set())).toBe('my-shop')
  })

  test('trùng thì thêm số', () => {
    expect(uniqueSlug('demo', new Set(['demo']))).toBe('demo-2')
    expect(uniqueSlug('demo', new Set(['demo', 'demo-2', 'demo-3']))).toBe('demo-4')
  })

  test('tên rỗng → fallback "site"', () => {
    expect(uniqueSlug('!!!', new Set())).toBe('site')
    expect(uniqueSlug('', new Set(['site']))).toBe('site-2')
  })

  test('slug dài + trùng vẫn không vượt 40 ký tự', () => {
    const long = 'a'.repeat(40)
    const out = uniqueSlug(long, new Set([long]))
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('-2')).toBe(true)
  })
})

describe('deriveDomain / uniqueDomain', () => {
  test('mặc định .localhost (không cần sửa hosts, không cần admin)', () => {
    expect(deriveDomain('my-shop')).toBe('my-shop.localhost')
  })

  test('.test khi user muốn giống prod hơn (cần hosts entry — M1.5)', () => {
    expect(deriveDomain('my-shop', 'test')).toBe('my-shop.test')
  })

  test('CHẶN slug tạo domain không hợp lệ (hàng rào chống injection từ tên site)', () => {
    expect(() => deriveDomain('a b')).toThrow()
    expect(() => deriveDomain('a.test\n127.0.0.1 evil')).toThrow()
    expect(() => deriveDomain('-bad')).toThrow()
  })

  test('uniqueDomain thêm số khi trùng', () => {
    expect(uniqueDomain('demo', new Set(['demo.localhost']))).toBe('demo-2.localhost')
    expect(uniqueDomain('demo', new Set())).toBe('demo.localhost')
  })
})

describe('detectSiteKind', () => {
  test('WordPress qua wp-config.php', () => {
    expect(detectSiteKind(['wp-config.php', 'wp-content', 'index.php'])).toEqual({
      kind: 'wordpress',
      docRootSub: ''
    })
  })

  test('WordPress chưa cài (chỉ có wp-load.php)', () => {
    expect(detectSiteKind(['wp-load.php']).kind).toBe('wordpress')
  })

  test('Laravel: docroot là public/', () => {
    expect(detectSiteKind(['artisan', 'composer.json', 'app', 'public'])).toEqual({
      kind: 'php',
      docRootSub: 'public'
    })
  })

  test('project composer có public/ cũng gợi ý public', () => {
    expect(detectSiteKind(['composer.json', 'public', 'src']).docRootSub).toBe('public')
  })

  test('PHP thường', () => {
    expect(detectSiteKind(['index.php', 'style.css'])).toEqual({ kind: 'php', docRootSub: '' })
  })

  test('site tĩnh', () => {
    expect(detectSiteKind(['index.html', 'app.js'])).toEqual({ kind: 'static', docRootSub: '' })
  })

  test('thư mục rỗng → tĩnh (không đoán bừa)', () => {
    expect(detectSiteKind([])).toEqual({ kind: 'static', docRootSub: '' })
  })

  test('không phân biệt hoa thường (WP-CONFIG.PHP)', () => {
    expect(detectSiteKind(['WP-CONFIG.PHP']).kind).toBe('wordpress')
  })
})

describe('detectSiteKindDetailed', () => {
  test('Laravel THẮNG WordPress khi thư mục có cả hai dấu hiệu', () => {
    // Ca đã gặp thật: project Laravel bị dán nhãn WORDPRESS. Nguyên nhân có thể là trong repo
    // lẫn 1 bản WP cũ (hoặc user trỏ vào thư mục cha) — `artisan` phải thắng vì nó chắc chắn hơn.
    const guess = detectSiteKindDetailed(['artisan', 'composer.json', 'public', 'wp-config.php'])
    expect(guess.kind).toBe('php')
    expect(guess.docRootSub).toBe('public')
    expect(guess.reason).toContain('artisan')
  })

  test('Laravel chưa có public/ (mới clone, chưa build) vẫn là php, docroot gốc', () => {
    expect(detectSiteKindDetailed(['artisan', 'composer.json', 'app'])).toEqual({
      kind: 'php',
      docRootSub: '',
      reason: 'artisan (Laravel)'
    })
  })

  test('lý do nêu ĐÚNG file đã khiến đoán WordPress (để user đối chiếu được)', () => {
    expect(detectSiteKindDetailed(['wp-load.php', 'index.php']).reason).toBe('wp-load.php')
    expect(detectSiteKindDetailed(['wp-config-sample.php']).reason).toBe('wp-config-sample.php')
  })

  test('Symfony (bin/config/public/src) → php + public/', () => {
    const guess = detectSiteKindDetailed(['bin', 'config', 'public', 'src', 'var'])
    expect(guess.kind).toBe('php')
    expect(guess.docRootSub).toBe('public')
  })

  test('tĩnh: lý do nói rõ là "không thấy file .php"', () => {
    expect(detectSiteKindDetailed(['index.html']).reason).toContain('không thấy file .php')
  })

  test('detectSiteKind (bản gọn) vẫn khớp bản chi tiết', () => {
    for (const entries of [['artisan'], ['wp-config.php'], ['index.php'], ['index.html'], []]) {
      const d = detectSiteKindDetailed(entries)
      expect(detectSiteKind(entries)).toEqual({ kind: d.kind, docRootSub: d.docRootSub })
    }
  })
})

describe('isSafeSiteDomain', () => {
  test('nhận domain thường + custom TLD', () => {
    expect(isSafeSiteDomain('theblogsnew.localhost')).toBe(true)
    expect(isSafeSiteDomain('blog.dev.test')).toBe(true)
    expect(isSafeSiteDomain('my-site.local')).toBe(true)
  })

  test('BẮT BUỘC có dấu chấm — "mysite" browser coi là từ khoá tìm kiếm, không phải host', () => {
    expect(isSafeSiteDomain('mysite')).toBe(false)
    expect(isSafeSiteDomain('localhost')).toBe(false)
  })

  test('chặn IP, khoảng trắng, newline (đường vào config nginx / hosts)', () => {
    expect(isSafeSiteDomain('127.0.0.1')).toBe(false)
    expect(isSafeSiteDomain('a b.test')).toBe(false)
    expect(isSafeSiteDomain('a.test\nevil.test')).toBe(false)
    expect(isSafeSiteDomain('a.test:8080')).toBe(false)
  })
})

describe('resolvesWithoutHostsFile', () => {
  test('chỉ *.localhost là tự phân giải (RFC 6761)', () => {
    expect(resolvesWithoutHostsFile('site.localhost')).toBe(true)
    expect(resolvesWithoutHostsFile('a.b.localhost')).toBe(true)
    expect(resolvesWithoutHostsFile('site.test')).toBe(false)
    expect(resolvesWithoutHostsFile('site.local')).toBe(false)
    // Không nhận nhầm domain chỉ CHỨA chữ localhost
    expect(resolvesWithoutHostsFile('localhost.evil.com')).toBe(false)
  })
})

describe('siteUrl', () => {
  test('bỏ :80 với http và :443 với https (URL sạch)', () => {
    expect(siteUrl('site.localhost', 80)).toBe('http://site.localhost/')
    expect(siteUrl('site.localhost', 443, true)).toBe('https://site.localhost/')
  })

  test('giữ cổng khi không phải cổng mặc định', () => {
    expect(siteUrl('site.localhost', 8080)).toBe('http://site.localhost:8080/')
    expect(siteUrl('site.localhost', 80, true)).toBe('https://site.localhost:80/')
  })
})
