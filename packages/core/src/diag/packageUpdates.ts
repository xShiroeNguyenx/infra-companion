/**
 * F37 — "máy nào cần vá gì", quét cả fleet.
 *
 * Câu hỏi này hiện phải SSH vào từng máy gõ tay, nên với vài chục host thì thực tế là không
 * ai hỏi. Phần dò distro + parse để ở đây dưới dạng hàm thuần (có test); phần chạy ở main.
 *
 * ⚠️ Chỉ ĐỌC. Không có đường nào ở đây chạy `apt upgrade` — vá là việc phải có mặt mà xem,
 * và một nút "vá cả fleet" là thứ chỉ cần bấm nhầm một lần.
 */

export type PackageManager = 'apt' | 'dnf' | 'yum' | 'apk' | 'unknown'

export interface PackageUpdate {
  name: string
  /** Bản đang cài. null khi công cụ không nói (một số bản `dnf` chỉ in bản mới). */
  current: string | null
  candidate: string
  /** Bản vá bảo mật — chỉ `apt`/`dnf` nói được, và cũng chỉ khi repo có khai. */
  security: boolean
}

export interface HostUpdates {
  manager: PackageManager
  updates: PackageUpdate[]
  /** Không dò được package manager, hoặc lệnh lỗi. */
  error?: string
}

/**
 * Lệnh dò xem máy dùng gì. Thử theo thứ tự và in ra tên đầu tiên tìm thấy.
 *
 * Dùng `command -v` chứ không phải `which`: `which` không phải lệnh POSIX và trên một số
 * image tối giản thì không có. Chuỗi `||` thuần, không `$(...)` — lệnh còn phải đi qua host
 * có login script, mà mỗi hop bọc thêm một lớp quote rồi bóc mất (CLAUDE.md §4).
 */
export function detectManagerCommand(): string {
  return [
    'command -v apt-get >/dev/null 2>&1 && echo apt',
    'command -v dnf >/dev/null 2>&1 && echo dnf',
    'command -v yum >/dev/null 2>&1 && echo yum',
    'command -v apk >/dev/null 2>&1 && echo apk',
    'echo unknown'
  ].join(' || ')
}

/** Đọc kết quả của {@link detectManagerCommand}. */
export function parseManager(stdout: string): PackageManager {
  const first = stdout.trim().split('\n')[0]?.trim()
  return first === 'apt' || first === 'dnf' || first === 'yum' || first === 'apk' ? first : 'unknown'
}

/**
 * Lệnh liệt kê bản cập nhật, KHÔNG cài gì.
 *
 * `apt list --upgradable` đọc cache có sẵn — cố ý KHÔNG chạy `apt update` trước: nó cần root
 * và ghi vào máy, tức là biến một lệnh chẩn đoán thành một lệnh sửa. Đổi lại, kết quả cũ đúng
 * bằng lần `apt update` gần nhất của máy đó — đã ghi rõ trên UI.
 */
export function updatesCommand(manager: PackageManager): string | null {
  switch (manager) {
    case 'apt':
      return 'apt list --upgradable 2>/dev/null'
    case 'dnf':
      return 'dnf --quiet check-update 2>/dev/null; true'
    case 'yum':
      return 'yum --quiet check-update 2>/dev/null; true'
    case 'apk':
      return 'apk version -l "<" 2>/dev/null'
    default:
      return null
  }
}

/** `nginx/jammy-updates 1.18.0-6ubuntu14.4 amd64 [upgradable from: 1.18.0-6ubuntu14.3]` */
function parseAptLine(line: string): PackageUpdate | null {
  const m = line.match(/^([^/\s]+)\/(\S+)\s+(\S+)\s+\S+(?:\s+\[upgradable from:\s*([^\]]+)\])?/)
  if (!m) return null
  return {
    name: m[1]!,
    candidate: m[3]!,
    current: m[4]?.trim() ?? null,
    // Repo bảo mật của Debian/Ubuntu đặt tên có `-security`
    security: /-security/i.test(m[2]!)
  }
}

/** `nginx.x86_64    1:1.20.1-14.el9_2    appstream` */
function parseDnfLine(line: string): PackageUpdate | null {
  const m = line.trim().match(/^(\S+?)\.(?:x86_64|noarch|i686|aarch64|armv7hl|s390x|ppc64le)\s+(\S+)\s+(\S+)$/)
  if (!m) return null
  return { name: m[1]!, candidate: m[2]!, current: null, security: /security/i.test(m[3]!) }
}

/** `nginx-1.24.0-r6 < 1.24.0-r7` */
function parseApkLine(line: string): PackageUpdate | null {
  const m = line.trim().match(/^(\S+)-(\d\S*)\s+<\s+(\S+)$/)
  if (!m) return null
  return { name: m[1]!, current: m[2]!, candidate: m[3]!, security: false }
}

/**
 * Parse output theo đúng công cụ. Dòng không khớp bị bỏ IM LẶNG — mỗi distro chèn thêm dòng
 * tiêu đề/cảnh báo riêng, và cố parse hết sẽ tạo ra gói ma tên "Listing..." hay "Obsoleting".
 */
export function parseUpdates(manager: PackageManager, stdout: string): PackageUpdate[] {
  const parse =
    manager === 'apt'
      ? parseAptLine
      : manager === 'dnf' || manager === 'yum'
        ? parseDnfLine
        : manager === 'apk'
          ? parseApkLine
          : null
  if (!parse) return []

  const seen = new Set<string>()
  const out: PackageUpdate[] = []
  for (const line of stdout.split('\n')) {
    const entry = parse(line)
    // Cùng một gói có thể hiện ở nhiều repo → chỉ giữ lần đầu
    if (entry && !seen.has(entry.name)) {
      seen.add(entry.name)
      out.push(entry)
    }
  }
  return out.sort((a, b) => Number(b.security) - Number(a.security) || a.name.localeCompare(b.name))
}

/** Số bản vá bảo mật trong một kết quả — con số đáng nhìn trước tiên. */
export function securityCount(updates: PackageUpdate[]): number {
  return updates.filter((u) => u.security).length
}
