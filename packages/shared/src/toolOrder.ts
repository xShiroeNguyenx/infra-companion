/**
 * Thứ tự các ô trong lưới công cụ Dashboard — MỘT hàng, tự xếp theo mức dùng thật.
 *
 * Lưới cũ là 2 hàng theo thứ tự khai trong danh mục: ai cũng thấy đúng những ô giống nhau,
 * kể cả những công cụ chưa từng mở. Hàng đơn thì chỗ ít hơn hẳn, nên chỗ đó phải thuộc về
 * công cụ user thật sự dùng.
 *
 * Hàm thuần ở `packages/shared` (không phải core) vì renderer không được import `@infra/core`.
 */

/** Một lượt mở công cụ đã được ghi lại: tổng số lần + lần cuối. */
export interface ToolUsage {
  count: number
  lastAt: number
}

export interface ToolOrderInput<T> {
  /** Danh sách đầy đủ theo thứ tự khai trong danh mục — dùng làm mức tie-break cuối. */
  tools: readonly T[]
  id: (tool: T) => string
  /** Lượt dùng theo id (localStorage). Thiếu id nào = chưa từng mở. */
  usage: Readonly<Record<string, ToolUsage | undefined>>
  /** Id user tự ghim — luôn nằm trước, theo đúng thứ tự trong mảng này. */
  pinned: readonly string[]
  /** Mốc "bây giờ" để tính điểm suy giảm; truyền vào để test không phụ thuộc đồng hồ. */
  now: number
}

/**
 * Chu kỳ bán rã của điểm dùng. Một lượt mở hôm nay đáng 1 điểm, cách đây 30 ngày còn 0.5.
 *
 * Có decay vì tổng số lần dùng thô sẽ ĐÓNG BĂNG lưới: công cụ dùng dồn dập trong một tuần
 * làm việc cách đây nửa năm vẫn giữ ô mãi mãi, còn thứ đang dùng hằng ngày tuần này thì không
 * bao giờ đuổi kịp cái tổng đó. 30 ngày là mức đổi được thứ tự trong vòng một tháng làm việc
 * mà không nhảy loạn theo từng ngày.
 */
export const TOOL_USAGE_HALF_LIFE_MS = 30 * 86_400_000

/**
 * Điểm của một công cụ: số lượt, giảm dần theo tuổi của lượt CUỐI.
 *
 * Chỉ lưu `count` + `lastAt` (không lưu cả nhật ký từng lượt) nên decay áp cho cả cụm theo
 * lần cuối — đủ để phân biệt "đang dùng" với "đã bỏ", và tốn hai số cho mỗi công cụ.
 * Lượt ở tương lai (đồng hồ máy bị đẩy lên rồi chỉnh lại) bị kẹp về 0 tuổi, không thành
 * điểm vô cực.
 */
export function toolScore(usage: ToolUsage | undefined, now: number): number {
  if (!usage || usage.count <= 0) return 0
  const ageMs = Math.max(0, now - usage.lastAt)
  return usage.count * Math.pow(0.5, ageMs / TOOL_USAGE_HALF_LIFE_MS)
}

/**
 * Xếp lại danh sách công cụ: **ghim trước** (đúng thứ tự user đặt), rồi phần còn lại theo
 * điểm dùng giảm dần.
 *
 * Chưa dùng gì thì mọi điểm bằng 0 và hàm trả về ĐÚNG thứ tự danh mục — lưới của user mới
 * vẫn là danh sách được sắp có chủ ý, không phải một mớ ngẫu nhiên.
 *
 * Id ghim không còn trong `tools` (công cụ bị ẩn, ví dụ Local dev đang tắt) bị bỏ qua chứ
 * không tạo ô rỗng.
 */
export function orderTools<T>(input: ToolOrderInput<T>): T[] {
  const { tools, id, usage, pinned, now } = input
  const rank = new Map(tools.map((tool, i) => [id(tool), i]))

  const pinnedTools = pinned
    .map((pinnedId) => tools.find((tool) => id(tool) === pinnedId))
    .filter((tool): tool is T => tool !== undefined)

  const pinnedSet = new Set(pinned)
  const rest = tools
    .filter((tool) => !pinnedSet.has(id(tool)))
    .sort((a, b) => {
      const diff = toolScore(usage[id(b)], now) - toolScore(usage[id(a)], now)
      // Điểm bằng nhau (rất hay xảy ra: cùng chưa dùng) → giữ thứ tự danh mục. `Array.sort`
      // của V8 đã ổn định, nhưng so sánh tường minh thì thứ tự không phụ thuộc chi tiết
      // cài đặt của engine.
      return diff !== 0 ? diff : (rank.get(id(a)) ?? 0) - (rank.get(id(b)) ?? 0)
    })

  return [...pinnedTools, ...rest]
}

/**
 * Chuyển một mục trong danh sách ghim tới vị trí của mục đích (kéo thả).
 *
 * `to` là chỉ số của mục ĐÍCH trong danh sách **hiện tại**, tức trước khi bỏ mục đang kéo ra.
 * Kéo sang phải thì sau khi bỏ ra, mọi mục bên phải đã dịch trái một ô — chèn thẳng vào `to`
 * sẽ đặt nhầm SAU mục đích, lệch đúng một ô. Đây là chỗ dễ sai nên tách ra để có test.
 */
export function moveInList(list: readonly string[], id: string, to: number): string[] {
  const from = list.indexOf(id)
  if (from < 0) return [...list]
  const next = list.filter((x) => x !== id)
  const at = from < to ? to - 1 : to
  next.splice(Math.max(0, Math.min(next.length, at)), 0, id)
  return next
}

/** Ghi thêm một lượt dùng vào bảng đếm (không đụng bảng cũ — trả bảng mới). */
export function recordToolUse(
  usage: Readonly<Record<string, ToolUsage | undefined>>,
  toolId: string,
  now: number
): Record<string, ToolUsage> {
  const next: Record<string, ToolUsage> = {}
  for (const [key, value] of Object.entries(usage)) {
    if (value) next[key] = value
  }
  next[toolId] = { count: (next[toolId]?.count ?? 0) + 1, lastAt: now }
  return next
}
