/**
 * F36 — "thư mục nào đang ăn dung lượng", kiểu ncdu nhưng đi qua kênh exec sẵn có.
 *
 * "Đĩa đầy" là sự cố hay gặp nhất, mà trả lời nó vẫn phải mở terminal gõ `du` tay rồi tự đọc
 * cột số. Phần parse + xếp hạng để ở đây dưới dạng hàm thuần (có test); phần chạy lệnh ở main.
 */

/** Một mục con trực tiếp của thư mục đang xem. */
export interface DiskEntry {
  /** Đường dẫn tuyệt đối như `du` in ra. */
  path: string
  /** Tên hiển thị (phần cuối của path). */
  name: string
  sizeKb: number
  /** Phần trăm so với tổng của cấp đang xem — để vẽ thanh. 0–100. */
  percent: number
}

export interface DiskUsage {
  /** Thư mục đang xem. */
  path: string
  /** Tổng của chính thư mục đó (dòng `du` cuối cùng), KB. */
  totalKb: number
  /** Các mục con, lớn trước. */
  entries: DiskEntry[]
}

/** Bọc chuỗi trong nháy đơn cho shell. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/**
 * Lệnh liệt kê MỘT cấp dưới `path`.
 *
 * `-x` không vượt sang filesystem khác — thiếu nó thì `du /` sẽ bò vào `/proc`, `/sys` và các
 * mount mạng, chạy rất lâu rồi trả về số vô nghĩa cho câu hỏi "phân vùng nào đầy".
 * `-k` ép đơn vị KB, không phụ thuộc `du` mặc định của distro (`-h` thì phải parse "1.4G").
 * `-d 1` chỉ một cấp: drill-down từng bước, không quét cả cây trong một lần.
 * `2>/dev/null` nuốt "Permission denied" — thiếu quyền một thư mục con không được làm hỏng
 * cả kết quả; phần thiếu vẫn thấy được vì tổng của cấp cha không khớp.
 */
export function duCommand(path: string): string {
  return `du -x -k -d 1 ${shq(path)} 2>/dev/null`
}

/** Lệnh xem dung lượng còn trống của các phân vùng (`df`), để biết cần đào chỗ nào. */
export function dfCommand(): string {
  return 'df -k -P 2>/dev/null'
}

/** Một dòng của `df -k -P`. */
export interface Filesystem {
  filesystem: string
  sizeKb: number
  usedKb: number
  availKb: number
  usePercent: number
  mountedOn: string
  /** % inode đã dùng (`df -i`). null = filesystem không có khái niệm inode cố định (btrfs, vfat). */
  inodeUsePercent?: number | null
  inodesFree?: number
}

/** Ranh giới giữa phần `df -k` và phần `df -i` trong output của `dfWithInodesCommand`. */
const INODE_MARKER = '@@INFRA_DF_INODES@@'

/**
 * `df -k` và `df -i` trong MỘT lệnh, ngăn bằng marker.
 *
 * Gộp chứ không chạy song song: mỗi lệnh riêng là một kết nối SSH riêng (kể cả qua jump host
 * + login script). Thiếu inode là ca "No space left on device" mà `df -h` vẫn còn trống —
 * hàng triệu file session/cache nhỏ — và `du` (đo dung lượng) không bao giờ chỉ ra được.
 */
export function dfWithInodesCommand(): string {
  return `${dfCommand()}; echo ${INODE_MARKER}; df -P -i 2>/dev/null`
}

/**
 * Parse output của `dfWithInodesCommand`. Phần inode hỏng/thiếu (BusyBox cũ…) thì vẫn trả
 * dung lượng như thường, chỉ là không có cột inode.
 */
export function parseDfWithInodes(stdout: string): Filesystem[] {
  const [blocks = '', inodes = ''] = stdout.split(INODE_MARKER)
  const rows = parseDf(blocks)
  const byMount = new Map<string, { percent: number | null; free: number }>()
  for (const line of inodes.trim().split('\n').slice(1)) {
    // IUse% là "-" với filesystem không có inode cố định
    const m = line.trim().match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+%|-)\s+(.+)$/)
    if (!m) continue
    const total = Number(m[2])
    byMount.set(m[6]!.trim(), {
      percent: total > 0 && m[5] !== '-' ? Number(m[5]!.slice(0, -1)) : null,
      free: Number(m[4])
    })
  }
  return rows.map((r) => {
    const i = byMount.get(r.mountedOn)
    return i ? { ...r, inodeUsePercent: i.percent, inodesFree: i.free } : r
  })
}

/** Ngưỡng "file lớn" khi liệt kê — dưới mức này thì không phải thứ làm đầy đĩa. */
export const BIG_FILE_MIN_KB = 50 * 1024

/**
 * Liệt kê các file lớn nhất dưới `path` (cả cây, không chỉ một cấp) — trả lời câu "dung lượng
 * nằm ở FILE ngay trong thư mục này" mà `du -d 1` để lại cho người dùng tự đi tìm.
 *
 * `-xdev` cùng lý do với `du -x`. `-size +Nk` lọc ngay ở `find` để `sort` không phải xếp hàng
 * triệu dòng. `%T@` (mtime) để thấy file nào còn đang lớn lên. `-printf` là của GNU find —
 * BusyBox không có, khi đó output rỗng và UI nói rõ khả năng đó.
 */
export function bigFilesCommand(path: string, limit = 20): string {
  return `find ${shq(path)} -xdev -type f -size +${BIG_FILE_MIN_KB}k -printf '%k %T@ %p\\n' 2>/dev/null | sort -rn | head -n ${limit}`
}

export interface BigFile {
  path: string
  /** Đường dẫn tính từ thư mục đang xem, để đọc nhanh. */
  name: string
  sizeKb: number
  mtimeMs: number
}

/** Parse `bigFilesCommand`. Path có khoảng trắng vẫn giữ nguyên (lấy hết phần còn lại). */
export function parseBigFiles(stdout: string, path: string): BigFile[] {
  const self = path.replace(/\/+$/, '') || '/'
  const out: BigFile[] = []
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(\d+)\s+(\d+(?:\.\d+)?)\s+(.+)$/)
    if (!m) continue
    const p = m[3]!
    const name = self === '/' ? p.slice(1) : p.startsWith(`${self}/`) ? p.slice(self.length + 1) : p
    out.push({ path: p, name, sizeKb: Number(m[1]), mtimeMs: Math.round(Number(m[2]) * 1000) })
  }
  return out.sort((a, b) => b.sizeKb - a.sizeKb)
}

/**
 * Parse `df -k -P`. Định dạng POSIX (`-P`) đảm bảo mỗi filesystem đúng MỘT dòng — không có
 * `-P` thì tên thiết bị dài bị xuống dòng và cột lệch hết.
 */
export function parseDf(stdout: string): Filesystem[] {
  const out: Filesystem[] = []
  for (const line of stdout.split('\n').slice(1)) {
    // mountedOn có thể chứa khoảng trắng → lấy 5 cột đầu, phần còn lại là điểm gắn
    const m = line.trim().match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/)
    if (!m) continue
    out.push({
      filesystem: m[1]!,
      sizeKb: Number(m[2]),
      usedKb: Number(m[3]),
      availKb: Number(m[4]),
      usePercent: Number(m[5]),
      mountedOn: m[6]!.trim()
    })
  }
  return out
}

/**
 * Parse `du -x -k -d 1 <path>`.
 *
 * `du` in các thư mục con TRƯỚC rồi mới tới chính `path` ở dòng cuối, nên tổng lấy từ dòng có
 * path khớp đúng chứ không phải cộng các con (cộng lại sẽ thiếu phần file nằm ngay trong thư
 * mục đó, và đó thường chính là thứ đang chiếm chỗ).
 */
export function parseDu(stdout: string, path: string): DiskUsage {
  const rows: Array<{ sizeKb: number; path: string }> = []
  for (const line of stdout.split('\n')) {
    // Path có thể chứa khoảng trắng → tách đúng một lần ở khoảng trắng đầu tiên
    const m = line.match(/^(\d+)\s+(.+)$/)
    if (!m) continue
    rows.push({ sizeKb: Number(m[1]), path: m[2]!.replace(/\/+$/, '') || '/' })
  }

  const self = path.replace(/\/+$/, '') || '/'
  const totalKb = rows.find((r) => r.path === self)?.sizeKb ?? 0
  const children = rows.filter((r) => r.path !== self).sort((a, b) => b.sizeKb - a.sizeKb)

  return {
    path: self,
    totalKb,
    entries: children.map((r) => ({
      path: r.path,
      name: r.path.slice(self === '/' ? 1 : self.length + 1) || r.path,
      sizeKb: r.sizeKb,
      // Chia cho tổng của CẤP NÀY, không phải cho tổng đĩa: câu hỏi là "trong đây cái nào to"
      percent: totalKb > 0 ? Math.round((r.sizeKb / totalKb) * 1000) / 10 : 0
    }))
  }
}

/** Thư mục cha, để nút "lên một cấp". null khi đã ở gốc. */
export function parentPath(path: string): string | null {
  const clean = path.replace(/\/+$/, '')
  if (clean === '' || clean === '/') return null
  const idx = clean.lastIndexOf('/')
  if (idx < 0) return null
  return idx === 0 ? '/' : clean.slice(0, idx)
}

/** KB → chuỗi người đọc được. Dùng 1024 vì `du -k`/`df -k` đếm theo KiB. */
export function formatKb(sizeKb: number): string {
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = sizeKb
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
