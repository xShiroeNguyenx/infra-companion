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
  advice: DiskAdvice
}

/** Một mục con áp đảo từ mức này trở lên thì đi tiếp vào đó là việc hiển nhiên. */
const DOMINANT_PERCENT = 60
/** File rời chiếm từ mức này trở lên thì vấn đề nằm ngay đây, không phải ở thư mục con. */
const LOOSE_PERCENT = 40
/** Dưới mức này so với phần đã dùng của phân vùng thì nhánh này không phải chỗ đáng đào. */
const WRONG_BRANCH_PERCENT = 10

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
  const level: DiskLevel =
    filesystem === null ? 'ok' : filesystem.usePercent >= 90 ? 'critical' : filesystem.usePercent >= 75 ? 'warn' : 'ok'

  const top = usage.entries[0] ?? null
  const childrenKb = usage.entries.reduce((n, e) => n + e.sizeKb, 0)
  // Kẹp ở 0: thư mục con không đủ quyền đọc bị `du` bỏ qua nên tổng con có thể vượt tổng cha
  const looseKb = Math.max(0, usage.totalKb - childrenKb)
  const loosePercent = usage.totalKb > 0 ? Math.round((looseKb / usage.totalKb) * 1000) / 10 : 0

  const shareOfUsedPercent =
    filesystem && filesystem.usedKb > 0 ? Math.round((usage.totalKb / filesystem.usedKb) * 1000) / 10 : null

  const advice: DiskAdvice =
    usage.entries.length === 0
      ? 'leaf'
      : shareOfUsedPercent !== null && shareOfUsedPercent < WRONG_BRANCH_PERCENT
        ? 'wrongBranch'
        : loosePercent >= LOOSE_PERCENT
          ? 'filesHere'
          : top !== null && top.percent >= DOMINANT_PERCENT
            ? 'drillDown'
            : 'spread'

  return { filesystem, level, top, shareOfUsedPercent, looseKb, loosePercent, advice }
}
