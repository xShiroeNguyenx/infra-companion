import { isAbsolute, join, resolve, sep } from 'node:path'
import type { LocalDevPaths } from './types'

/**
 * Mọi thư mục của module local dev, dẫn xuất từ 1 gốc duy nhất.
 *
 * Chia 2 nhánh có chủ đích:
 * - `runtimes/` = do RuntimeManager sở hữu, coi như READ-ONLY sau khi cài;
 * - `localdev/` = state của USER (config đã sinh, DB, log, cert, site).
 * Nhờ tách vậy, nâng version runtime (nginx 1.28 → 1.30) chỉ cần regenerate config,
 * không mất dữ liệu; và xoá 1 runtime không đụng tới site nào.
 */
export function localDevPaths(root: string): LocalDevPaths {
  const runtimes = join(root, 'runtimes')
  const localdev = join(root, 'localdev')
  const conf = join(localdev, 'conf')
  const confNginx = join(conf, 'nginx')
  return {
    root,
    runtimes,
    runtimesTmp: join(runtimes, '.tmp'),
    localdev,
    db: join(localdev, 'localdev.db'),
    conf,
    confNginx,
    confNginxSites: join(confNginx, 'sites'),
    confNginxExtra: join(confNginx, 'extra'),
    confPhp: join(conf, 'php'),
    confMariadb: join(conf, 'mariadb'),
    dataMariadb: join(localdev, 'data', 'mariadb'),
    logs: join(localdev, 'logs'),
    certs: join(localdev, 'certs'),
    run: join(localdev, 'run'),
    tmp: join(localdev, 'tmp'),
    cache: join(localdev, 'cache'),
    bin: join(localdev, 'bin'),
    sites: join(localdev, 'sites'),
    trash: join(localdev, 'trash')
  }
}

/** id runtime/site: kebab-case, cho phép chữ số và dấu chấm (php-8.3, mariadb-11.4). */
const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

/**
 * Ghép 1 đường dẫn con vào `baseDir` có chặn thoát thư mục (defense-in-depth, cùng tinh
 * thần `pluginScopedPath`). Khác bản plugin ở chỗ CHO PHÉP đường dẫn nhiều cấp
 * (`bin/php.exe`, `wp-content/debug.log`) vì runtime/site vốn có cây thư mục — nên phải
 * kiểm bằng `resolve()` thay vì cấm ký tự phân cách.
 *
 * Trả null khi: relPath tuyệt đối, chứa `..`, hoặc kết quả nằm ngoài baseDir.
 */
export function scopedPath(baseDir: string, relPath: string): string | null {
  if (relPath === '' || isAbsolute(relPath)) return null
  // Chặn cả '..' dạng segment lẫn dạng lẫn trong tên; resolve() bên dưới là chốt cuối,
  // nhưng chặn sớm cho message rõ và không phụ thuộc hành vi resolve của từng OS.
  if (relPath.split(/[\\/]/).includes('..')) return null
  const base = resolve(baseDir)
  const full = resolve(join(base, relPath))
  if (full !== base && !full.startsWith(base + sep)) return null
  return full
}

/**
 * Đường dẫn 1 file trong thư mục của runtime `id` (vd exe của PHP).
 * Trả null nếu id không hợp lệ hoặc relPath thoát ra ngoài.
 */
export function runtimeScopedPath(paths: LocalDevPaths, id: string, relPath: string): string | null {
  if (!ID_RE.test(id)) return null
  const dir = scopedPath(paths.runtimes, id)
  if (!dir) return null
  return scopedPath(dir, relPath)
}

/** Thư mục gốc của 1 runtime đã cài. Trả null nếu id không hợp lệ. */
export function runtimeDir(paths: LocalDevPaths, id: string): string | null {
  if (!ID_RE.test(id)) return null
  return scopedPath(paths.runtimes, id)
}

/** Thư mục gốc của 1 site do app tạo. Trả null nếu slug không hợp lệ. */
export function siteDir(paths: LocalDevPaths, slug: string): string | null {
  if (!ID_RE.test(slug)) return null
  return scopedPath(paths.sites, slug)
}

/**
 * Có được phép xoá đệ quy `target` không? Hàng rào chống thảm hoạ: chỉ cho xoá thứ nằm
 * THỰC SỰ bên trong `allowedRoot`, và không cho xoá chính root hay path quá ngắn
 * (gốc ổ đĩa). Dùng cho xoá site / dọn trash — xem plan §rủi-ro (h).
 */
export function isSafeToDeleteRecursive(target: string, allowedRoot: string): boolean {
  if (!target || !allowedRoot) return false
  const abs = resolve(target)
  const root = resolve(allowedRoot)
  if (abs === root) return false
  if (!abs.startsWith(root + sep)) return false
  // Phải sâu hơn root ít nhất 1 cấp và không phải gốc ổ đĩa (C:\ hay /)
  const rest = abs.slice(root.length + 1)
  if (rest.length === 0) return false
  return true
}
