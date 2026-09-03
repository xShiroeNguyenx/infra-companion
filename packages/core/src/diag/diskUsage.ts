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
