import type { DiskEntryDto, DiskUsageDto, FilesystemDto } from './types'

/**
 * F36 — biến kết quả `du`/`df` thành một câu kết luận và một việc nên làm.
 *
 * Màn hình cũ trả lời được *"cái gì chiếm chỗ"* nhưng không trả lời *"giờ làm gì"*: người đứng
 * trước một danh sách có `log` 95.5% vẫn phải tự biết là nên đi tiếp vào đó, hay là đang đào
 * nhầm nhánh vì chỗ đầy nằm ở phân vùng khác.
 *
 * Ở `packages/shared` vì renderer là nơi vẽ (renderer KHÔNG import được `@infra/core` — §5).
 * Test nằm ở `packages/core` vì vitest chỉ quét ở đó.
 */

/** Việc nên làm tiếp theo, suy ra CHỈ từ mấy con số đã có trên màn hình. */
export type DiskAdvice =
  | 'drillDown' /** Một thư mục con áp đảo → đi tiếp vào đó. */
  | 'filesHere' /** Dung lượng nằm ở file rời ngay trong thư mục này, `du -d 1` không đi sâu hơn được. */
  | 'spread' /** Không mục nào áp đảo — dung lượng rải rác. */
  | 'wrongBranch' /** Nhánh này quá nhỏ so với phần đã dùng của phân vùng → chỗ đầy ở nơi khác. */
  | 'leaf' /** Không còn thư mục con nào. */
  | 'otherMount' /** Phân vùng đang xem ổn, nhưng một phân vùng GẮN BÊN DƯỚI thư mục này sắp đầy. */
  | 'hiddenUsage' /** Ở gốc phân vùng mà `df` báo dùng nhiều hơn hẳn tổng `du` → có thứ `du` không thấy. */
  | 'inodesFull' /** Hết inode chứ không hết dung lượng — `du` (đo byte) không bao giờ chỉ ra. */

/** Mức khẩn theo độ đầy của phân vùng chứa thư mục đang xem. */
export type DiskLevel = 'critical' | 'warn' | 'ok'

export interface DiskVerdict {
  /** Phân vùng chứa thư mục đang xem. null khi `df` không đọc được. */
  filesystem: FilesystemDto | null
  level: DiskLevel
  /** Thư mục con lớn nhất, để câu gợi ý gọi tên được nó. */
  top: DiskEntryDto | null
  /** Thư mục này chiếm bao nhiêu % phần ĐÃ DÙNG của phân vùng. null khi không có `df`. */
  shareOfUsedPercent: number | null
  /** Phần nằm trực tiếp trong thư mục này (file rời), KB = tổng trừ đi các thư mục con. */
  looseKb: number
  loosePercent: number
  /** Phân vùng gắn bên dưới thư mục này đang ≥ 90% (đầy nhất), để câu gợi ý trỏ thẳng tới nó. */
  fullMountBelow: FilesystemDto | null
  /** Ở gốc phân vùng: phần `df` báo đã dùng mà `du` không đếm ra, KB. 0 khi không ở gốc. */
  hiddenKb: number
  advice: DiskAdvice
  /**
   * Lệnh CHỈ ĐỌC để user tự copy chạy tiếp, khi bước tiếp theo nằm ngoài những gì màn này đo
   * được. App không tự chạy (cần sudo, và là quyết định của người đang trực).
   */
  command: string | null
}

/** Một mục con áp đảo từ mức này trở lên thì đi tiếp vào đó là việc hiển nhiên. */
const DOMINANT_PERCENT = 60
/** File rời chiếm từ mức này trở lên thì vấn đề nằm ngay đây, không phải ở thư mục con. */
const LOOSE_PERCENT = 40
/** Dưới mức này so với phần đã dùng của phân vùng thì nhánh này không phải chỗ đáng đào. */
const WRONG_BRANCH_PERCENT = 10
/** Ngưỡng "đầy" — cùng mốc với `level: 'critical'`. */
const CRITICAL_PERCENT = 90
/**
 * Phần `du` không thấy phải vượt CẢ HAI mốc mới đáng nói: journal/metadata của ext4/XFS tự nó
 * đã chiếm vài trăm MB tới ~1 GB, báo động vì khoảng đó là báo động giả.
 */
const HIDDEN_MIN_KB = 1024 * 1024
const HIDDEN_PERCENT = 10

/** Bọc nháy đơn cho shell — bản nhỏ ở shared vì renderer không import được core (§5). */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/**
 * File đã xoá mà tiến trình còn giữ mở trên phân vùng `mount` — lớn trước. `+L1` = số liên kết
 * < 1, tức đã `rm`. Cần sudo để thấy tiến trình của user khác (mysqld, java…).
 */
export function deletedOpenCommand(mount: string): string {
  return `sudo lsof -nP +L1 ${shq(mount)} 2>/dev/null | sort -k7 -rn | head -20`
}

/** Thư mục con nào chứa nhiều FILE nhất (đếm inode thay vì byte). GNU coreutils ≥ 8.22. */
export function inodeCountCommand(path: string): string {
  return `du --inodes -x -d 1 ${shq(path)} 2>/dev/null | sort -rn | head -15`
}

/** Bỏ dấu `/` thừa ở cuối; gốc vẫn là `/`. */
function trimSlash(path: string): string {
  return path.replace(/\/+$/, '') || '/'
}

/** `child` là chính `parent` hoặc nằm dưới nó — so theo BIÊN đường dẫn (xem `findFilesystem`). */
function isAtOrBelow(child: string, parent: string): boolean {
  const c = trimSlash(child)
  const p = trimSlash(parent)
  return p === '/' || c === p || c.startsWith(`${p}/`)
}

/** Filesystem ảo không phải chỗ chứa dữ liệu — liệt kê chúng là nhiễu. */
const PSEUDO_FS = new Set(['tmpfs', 'devtmpfs', 'overlay', 'udev', 'shm', 'none', 'efivarfs'])

/**
 * Filesystem có dữ liệu thật đáng đưa vào câu "phân vùng nào đầy".
 *
 * Bỏ `overlay` (mỗi container Docker là một dòng, cùng ổ với `/`), `tmpfs` (RAM), và
 * `/dev/loopN` — snap của Ubuntu gắn squashfs qua loop và **luôn 100%**, để lại thì lúc nào
 * cũng có báo động giả.
 */
export function isRealFilesystem(fs: FilesystemDto): boolean {
  return !PSEUDO_FS.has(fs.filesystem) && !/^\/dev\/loop\d+$/.test(fs.filesystem)
}

/**
 * Các phân vùng thật gắn **bên dưới** `path` (không tính chính phân vùng chứa `path`), đầy
 * trước.
 *
 * Vì sao cần: `du -x` cố ý không đi sang phân vùng khác (§`duCommand`), nên một ổ 500 GB gắn ở
 * `/mnt/data` hiện ra là `/mnt` **4 KB** — hoặc biến mất hẳn khỏi danh sách nếu chính nó là
 * thư mục con trực tiếp. Người đang đi tìm "đĩa đầy ở đâu" sẽ không bao giờ thấy nó. Hàm này
 * nối lại phần `du` không thấy bằng dữ liệu `df` đã có sẵn.
 *
 * Bỏ các mount cùng thiết bị với phân vùng đang xem: đó là bind mount, dữ liệu đã được `du`
 * tính rồi.
 */
export function mountsBelow(path: string, filesystems: readonly FilesystemDto[]): FilesystemDto[] {
  const self = trimSlash(path)
  const own = findFilesystem(self, filesystems)
  return filesystems
    .filter(
      (fs) =>
        isRealFilesystem(fs) &&
        trimSlash(fs.mountedOn) !== self &&
        isAtOrBelow(fs.mountedOn, self) &&
        fs.filesystem !== own?.filesystem
    )
    .sort((a, b) => b.usePercent - a.usePercent || b.usedKb - a.usedKb)
}

/** Lọc từ kết quả `mountsBelow` những mount nằm tại hoặc dưới một mục con. */
export function mountsAtOrBelow(entryPath: string, mounts: readonly FilesystemDto[]): FilesystemDto[] {
  return mounts.filter((fs) => isAtOrBelow(fs.mountedOn, entryPath))
}

/**
 * Phân vùng chứa `path` = mount point khớp dài nhất.
 *
 * ⚠️ Phải khớp theo **biên đường dẫn**: so bằng `startsWith` trần thì `/var` sẽ nhận nhầm
 * `/variable-data` là nằm trong nó, và câu kết luận sẽ nói về sai phân vùng.
 */
export function findFilesystem(path: string, filesystems: readonly FilesystemDto[]): FilesystemDto | null {
  const clean = path.replace(/\/+$/, '') || '/'
  let best: FilesystemDto | null = null
  for (const fs of filesystems) {
    const mount = fs.mountedOn.replace(/\/+$/, '') || '/'
    const inside = mount === '/' ? true : clean === mount || clean.startsWith(`${mount}/`)
    if (inside && (best === null || mount.length > (best.mountedOn.replace(/\/+$/, '') || '/').length)) best = fs
  }
  return best
}

export function diskVerdict(usage: DiskUsageDto, filesystems: readonly FilesystemDto[]): DiskVerdict {
  const filesystem = findFilesystem(usage.path, filesystems)
  // Hết inode cũng là "đầy" thật: ghi file mới báo No space left y như hết byte
  const fullness = filesystem === null ? 0 : Math.max(filesystem.usePercent, filesystem.inodeUsePercent ?? 0)
  const level: DiskLevel =
    filesystem === null ? 'ok' : fullness >= CRITICAL_PERCENT ? 'critical' : fullness >= 75 ? 'warn' : 'ok'
  const inodesFull = (filesystem?.inodeUsePercent ?? 0) >= CRITICAL_PERCENT
  const fullMountBelow = mountsBelow(usage.path, filesystems).find((fs) => fs.usePercent >= CRITICAL_PERCENT) ?? null

  const top = usage.entries[0] ?? null
  const childrenKb = usage.entries.reduce((n, e) => n + e.sizeKb, 0)
  // Kẹp ở 0: thư mục con không đủ quyền đọc bị `du` bỏ qua nên tổng con có thể vượt tổng cha
  const looseKb = Math.max(0, usage.totalKb - childrenKb)
  const loosePercent = usage.totalKb > 0 ? Math.round((looseKb / usage.totalKb) * 1000) / 10 : 0

  const shareOfUsedPercent =
    filesystem && filesystem.usedKb > 0 ? Math.round((usage.totalKb / filesystem.usedKb) * 1000) / 10 : null

  /**
   * Chỉ so được ở GỐC phân vùng: `du -x <mount>` và `df` khi đó đo cùng một thứ. Ở thư mục
   * con thì chênh lệch là phần nằm ở các nhánh khác, hoàn toàn bình thường.
   *
   * Phần chênh có 3 nguồn hay gặp, UI nói cả ba: file đã `rm` mà tiến trình còn giữ mở (log
   * xoá tay khi mysqld/java đang ghi — dung lượng chỉ trả lại khi tiến trình đóng file hoặc
   * restart), dữ liệu bị một mount point che, và user SSH không đủ quyền đọc hết.
   */
  const atMountRoot = filesystem !== null && trimSlash(filesystem.mountedOn) === trimSlash(usage.path)
  const hiddenKb = atMountRoot ? Math.max(0, filesystem.usedKb - usage.totalKb) : 0
  const hidden =
    filesystem !== null && hiddenKb >= HIDDEN_MIN_KB && hiddenKb >= (filesystem.usedKb * HIDDEN_PERCENT) / 100

  // Thứ tự là thứ tự "câu trả lời nào làm các câu sau thành sai":
  // - hết inode: mọi con số byte bên dưới đều đúng nhưng không giải thích được sự cố;
  // - phân vùng bên dưới đầy: đứng trước cả 'leaf' (`/mnt` chỉ chứa mount point thì `du -x` thấy rỗng);
  // - phần du không thấy: đứng trước 'wrongBranch', vì ở gốc thì "lên cấp trên" là vô nghĩa.
  const advice: DiskAdvice = inodesFull
    ? 'inodesFull'
    : fullMountBelow !== null && level !== 'critical'
      ? 'otherMount'
      : hidden
        ? 'hiddenUsage'
        : usage.entries.length === 0
          ? 'leaf'
          : shareOfUsedPercent !== null && shareOfUsedPercent < WRONG_BRANCH_PERCENT
            ? 'wrongBranch'
            : loosePercent >= LOOSE_PERCENT
              ? 'filesHere'
              : top !== null && top.percent >= DOMINANT_PERCENT
                ? 'drillDown'
                : 'spread'

  const command =
    advice === 'inodesFull'
      ? inodeCountCommand(usage.path)
      : advice === 'hiddenUsage' && filesystem
        ? deletedOpenCommand(filesystem.mountedOn)
        : null

  return {
    filesystem,
    level,
    top,
    shareOfUsedPercent,
    looseKb,
    loosePercent,
    fullMountBelow,
    hiddenKb,
    advice,
    command
  }
}
