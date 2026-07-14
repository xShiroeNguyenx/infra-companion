/**
 * Guard lệnh nhạy cảm: đối chiếu dòng lệnh đang gõ với whitelist người dùng cấu hình.
 * Dùng ở TerminalPane khi bấm Enter — nếu khớp thì hiện popup xác nhận trước khi gửi.
 *
 * Vì sao đọc từ buffer xterm chứ không từ phím gõ: khi user bấm ↑ để gọi lại lệnh cũ,
 * client chỉ gửi `\x1b[A`, nội dung lệnh do server echo về (là output) — không dựng lại
 * được từ chuỗi phím. Việc trích dòng lệnh từ buffer nằm ở TerminalPane; ở đây chỉ lo KHỚP.
 */

/**
 * Danh sách mặc định — các lệnh dễ gây mất mát khi lỡ tay (nhất là gọi lại bằng ↑ rồi Enter).
 * Mẫu literal: khớp khi lệnh BẮT ĐẦU bằng mẫu (theo ranh giới từ). Mẫu bọc trong /…/ là regex.
 */
export const DEFAULT_GUARD_PATTERNS: string[] = [
  'rm -rf',
  'rm -fr',
  'rm -r',
  'sudo rm',
  'mkfs',
  'dd if=',
  'dd of=',
  'shutdown',
  'reboot',
  'poweroff',
  'halt',
  '/>\\s*\\/dev\\/(sd|nvme|vd|hd|mmcblk)/', // ghi đè thẳng vào ổ đĩa: … > /dev/sda
  '/:\\s*\\(\\s*\\)\\s*\\{/' // fork bomb :(){ :|:& };:
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Mẫu dạng /body/flags → RegExp; ngược lại null. */
function asRegex(pattern: string): RegExp | null {
  const m = pattern.match(/^\/(.+)\/([a-z]*)$/i)
  if (!m) return null
  try {
    return new RegExp(m[1], m[2])
  } catch {
    return null // regex hỏng do user gõ sai → coi như không có mẫu này
  }
}

/**
 * Dòng lệnh có khớp mẫu nào trong whitelist không.
 * @returns mẫu đầu tiên khớp (để hiển thị lý do), hoặc null nếu không khớp.
 *
 * Ngữ nghĩa mẫu literal: khớp khi mẫu xuất hiện ở VỊ TRÍ LỆNH — đầu dòng hoặc ngay sau một
 * ranh giới (khoảng trắng, prompt, `;` `&&` `||` `|` `(`). Khoảng trắng trong mẫu co giãn
 * (một hay nhiều dấu cách đều khớp). Ràng buộc cuối chỉ áp khi mẫu kết thúc bằng ký tự chữ:
 * chặn `rm -rf` dính `rm -rfoo`, nhưng vẫn để `dd if=` khớp `dd if=/dev/sda` (sau `=` là `/`).
 * Nhờ vậy: `user@host:~$ rm -rf x` và `cd /tmp && rm -rf x` đều dính, còn `warm -rf`,
 * `confirm-rm` thì không. Ưu tiên bắt nhầm hơn bỏ sót (đây là lưới an toàn).
 */
export function matchGuard(commandLine: string, patterns: string[]): string | null {
  const line = commandLine.trim()
  if (!line) return null
  for (const raw of patterns) {
    const pattern = raw.trim()
    if (!pattern) continue

    const rx = asRegex(pattern)
    if (rx) {
      if (rx.test(commandLine)) return pattern
      continue
    }

    // Literal: co giãn khoảng trắng giữa các token, buộc ở vị trí lệnh
    const body = pattern.split(/\s+/).map(escapeRegExp).join('\\s+')
    // Mẫu kết thúc bằng chữ (rm -rf) cần ranh giới cuối; kết thúc bằng ký hiệu (dd if=) thì không
    const end = /\w$/.test(pattern) ? '(?![\\w-])' : ''
    const re = new RegExp('(?:^|[\\s;&|(])' + body + end)
    if (re.test(line)) return pattern
  }
  return null
}
