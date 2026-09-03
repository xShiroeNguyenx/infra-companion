/**
 * F35 — dò định dạng crontab (5 hay 6 trường).
 *
 * Ở `packages/shared` chứ không phải `core` vì **renderer cần dùng để hiện bảng job** mà
 * renderer KHÔNG import được `@infra/core` (CLAUDE.md §5). Test vẫn nằm ở `packages/core`
 * vì vitest chỉ quét ở đó.
 */

/** Token trông giống tên user Unix (không chứa `/`, không phải đường dẫn hay tham số). */
function looksLikeUsername(token: string): boolean {
  return /^[a-z_][a-z0-9_-]{0,31}$/i.test(token)
}

/**
 * Nội dung này có cột USER (6 trường) hay không.
 *
 * Cần dò chứ không suy từ scope: crontab của **root** trên máy thật hay được viết theo định
 * dạng hệ thống (`0 5 * * * someuser /path/x.sh`), dù `crontab -l` vốn là 5 trường. Đoán sai
 * thì lệnh hiện ra kèm luôn tên user — sai kiểu khó thấy vì phần lịch vẫn đúng.
 *
 * Không thể quyết trên MỘT dòng: `0 5 * * * sh /x.sh` thì `sh` là lệnh, `0 5 * * * deploy /x.sh`
 * thì `deploy` là user — hai dòng giống hệt nhau về hình dạng. Nên xét cả file, và **bắt buộc
 * phải thấy `root`**: một crontab 5 trường mà token đầu của lệnh đúng bằng chữ "root" thì gần
 * như không tồn tại, còn crontab hệ thống thì hầu như luôn có.
 */
export function detectUserColumn(content: string): boolean {
  const rests: string[] = []
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#') || /^==>\s.+\s<==$/.test(trimmed)) continue
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) continue
    const special = trimmed.match(/^@\w+\s+(.+)$/)
    const five = trimmed.match(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/)
    const rest = special?.[1] ?? five?.[1]
    if (rest) rests.push(rest)
  }
  if (rests.length === 0) return false

  let userish = 0
  let sawRoot = false
  for (const rest of rests) {
    const split = rest.match(/^(\S+)\s+(.+)$/)
    if (!split) continue
    const token = split[1]!
    if (!looksLikeUsername(token)) continue
    userish += 1
    if (token === 'root') sawRoot = true
  }
  return sawRoot && userish >= Math.ceil(rests.length / 2)
}
