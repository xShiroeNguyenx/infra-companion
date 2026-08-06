import { posix, win32 } from 'node:path'

/**
 * Thư mục font của từng hệ điều hành + tiện ích cho danh sách font trong CSS.
 *
 * ⚠️ Path Windows ghép bằng **`win32.join`**, KHÔNG phải `join` của nền tảng đang chạy:
 * CI chạy test trên cả 3 OS, mà dùng `join` mặc định thì trên Linux ra
 * `C:\Windows/Fonts` (lẫn hai loại dấu gạch) và test đỏ ở 2 job. Đã dính một lần.
 */

/** Env cần cho việc dựng đường dẫn — nhận vào thay vì đọc `process.env` để test được. */
export interface FontDirEnv {
  WINDIR?: string
  LOCALAPPDATA?: string
}

/**
 * Danh sách thư mục cần quét, theo thứ tự ưu tiên. Có thể chứa đường dẫn không tồn tại —
 * bên gọi tự bỏ qua khi `readdir` lỗi (vd máy Linux không có `~/.fonts`).
 */
export function systemFontDirs(platform: string, env: FontDirEnv, home: string): string[] {
  if (platform === 'win32') {
    const windir = env.WINDIR || 'C:\\Windows'
    const dirs = [win32.join(windir, 'Fonts')]
    // Font cài "chỉ cho tôi" nằm ở đây — Windows 10+ cho cài font không cần quyền admin,
    // nên bỏ qua thư mục này là mất đúng những font user tự tải về.
    if (env.LOCALAPPDATA) dirs.push(win32.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'))
    return dirs
  }
  if (platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/System/Library/Fonts/Supplemental',
      '/Library/Fonts',
      posix.join(home, 'Library', 'Fonts')
    ]
  }
  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    posix.join(home, '.local', 'share', 'fonts'),
    posix.join(home, '.fonts')
  ]
}

/** Giới hạn khi quét: đủ sâu cho cây thư mục font của Linux, đủ chặn vòng lặp symlink. */
export const FONT_SCAN_MAX_DEPTH = 4
/** Trần số file mở ra đọc — máy nhiều font nhất cũng chỉ khoảng 1000. */
export const FONT_SCAN_MAX_FILES = 4000

/**
 * Tên họ font cần bọc nháy kép khi đưa vào CSS `font-family`.
 * Chỉ định danh CSS "an toàn" (chữ/số/gạch nối, không bắt đầu bằng số) mới để trần được.
 */
export function quoteFontFamily(family: string): string {
  return /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(family) ? family : `"${family.replace(/"/g, '')}"`
}

/** Chuỗi `font-family` hoàn chỉnh cho một họ font: luôn có `monospace` làm lưới an toàn. */
export function buildFontStack(family: string): string {
  const f = family.trim()
  if (!f) return 'monospace'
  return `${quoteFontFamily(f)}, monospace`
}

/**
 * Lấy họ font ĐẦU TIÊN trong một chuỗi `font-family` (để dropdown biết đang chọn cái nào).
 * Chuỗi đang lưu của user có thể là cả một stack dài — chỉ mục đầu mới là font thật sự dùng.
 */
export function primaryFontFamily(css: string): string {
  const first = css.split(',')[0]?.trim() ?? ''
  // Bỏ nháy hai đầu nếu có; không dùng regex greedy để tên chứa nháy lẻ không bị cắt sai
  if ((first.startsWith('"') && first.endsWith('"') && first.length > 1) || (first.startsWith("'") && first.endsWith("'") && first.length > 1)) {
    return first.slice(1, -1).trim()
  }
  return first
}
