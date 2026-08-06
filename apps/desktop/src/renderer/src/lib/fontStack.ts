/**
 * Tiện ích cho chuỗi CSS `font-family` + đo font, dùng cho picker font terminal.
 *
 * 3 hàm đầu là **bản sao nhỏ** của `fonts/fontDirs.ts` trong `@infra/core` (bản đó có test):
 * renderer KHÔNG được import `@infra/core` vì kéo `ssh2` vào bundle web là vỡ build. Sửa
 * một bên thì sửa cả hai — chúng ngắn và gần như không đổi.
 */

/** Tên họ font cần bọc nháy kép khi đưa vào CSS. */
export function quoteFontFamily(family: string): string {
  return /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(family) ? family : `"${family.replace(/"/g, '')}"`
}

/** Chuỗi `font-family` hoàn chỉnh: luôn có `monospace` làm lưới an toàn. */
export function buildFontStack(family: string): string {
  const f = family.trim()
  if (!f) return 'monospace'
  return `${quoteFontFamily(f)}, monospace`
}

/** Họ font ĐẦU TIÊN trong một chuỗi `font-family` — để dropdown biết đang chọn cái nào. */
export function primaryFontFamily(css: string): string {
  const first = css.split(',')[0]?.trim() ?? ''
  const quoted =
    (first.startsWith('"') && first.endsWith('"') && first.length > 1) ||
    (first.startsWith("'") && first.endsWith("'") && first.length > 1)
  return quoted ? first.slice(1, -1).trim() : first
}

/** Chuỗi đo đủ dài để chênh lệch tích luỹ vượt sai số làm tròn của canvas. */
const PROBE = 'mmmmmmmmmmlliWWWWWWWWWW'
/** Font tổng quát dùng làm mốc so sánh. Đủ 3 loại để giảm khả năng trùng metric ngẫu nhiên. */
const GENERICS = ['monospace', 'serif', 'sans-serif'] as const

function measure(font: string): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(PROBE).width
}

/**
 * Font này có dùng được trên máy không (đã cài, hoặc đã đăng ký qua `FontFace`).
 *
 * Vì sao đo chiều rộng chứ không dùng `document.fonts.check()`: hàm đó trả **true** cho cả
 * tên font không tồn tại (vì vẫn "vẽ được" nhờ fallback), nên vô dụng để kiểm tra sự tồn tại.
 * Cách đo là: nếu font không có, trình duyệt rơi về generic → chiều rộng TRÙNG KHÍT với
 * mốc generic. Khác mốc ở bất kỳ generic nào = font có thật.
 */
export function isFontAvailable(family: string): boolean {
  const name = family.trim()
  if (!name || GENERICS.includes(name.toLowerCase() as (typeof GENERICS)[number])) return true
  const quoted = quoteFontFamily(name)
  return GENERICS.some((g) => {
    const base = measure(`16px ${g}`)
    return base > 0 && Math.abs(measure(`16px ${quoted}, ${g}`) - base) > 0.5
  })
}

/**
 * Font này có phải monospace không. Terminal cần bề rộng ký tự đều nhau — font tỉ lệ
 * sẽ làm cột lệch, con trỏ lệch, khung vẽ bằng ký tự vỡ hết.
 * Font không có trên máy → rơi về `monospace` nên trả true; kiểm sự tồn tại riêng bằng
 * `isFontAvailable`.
 */
export function isMonospaceFamily(family: string): boolean {
  const name = family.trim()
  if (!name) return true
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return true
  ctx.font = `16px ${quoteFontFamily(name)}, monospace`
  const narrow = ctx.measureText('llllllllll').width
  const wide = ctx.measureText('WWWWWWWWWW').width
  return Math.abs(narrow - wide) < 0.5
}
