/**
 * Tính toán cho cột host bên trái — phần "quyết định hiện cái gì", tách khỏi JSX.
 *
 * Sidebar cũ mở HẾT mọi group cùng lúc: bốn group nhân năm-sáu host là đã tràn qua đáy màn
 * hình, và thêm host thì chỉ dài thêm tuyến tính. Hai hàm ở đây là hai nửa của cách chữa:
 * gập group (nhớ được group nào đang gập) và bỏ những dòng đang lặp lại thông tin đã có.
 *
 * Hàm thuần ở `packages/shared` (không phải core) vì renderer không được import `@infra/core`.
 */

/**
 * Các KHỐI xếp được trong sidebar. Mỗi khối là một "mục việc" tự chứa, bật/tắt và kéo sắp
 * thứ tự được — sidebar không còn cố định là "Yêu thích rồi nhóm host rồi gần đây".
 *
 * Chỉ nhận vào đây thứ **hiện được nội dung ngay trong cột** và đọc từ dữ liệu renderer đã có.
 * Công cụ mở modal/tab (Monitoring, Chẩn đoán…) KHÔNG thuộc danh sách này: gắn chúng vào đây
 * chỉ được một hàng nút shortcut, trùng vai với lưới công cụ Dashboard và menu `⋯`.
 */
export type SidebarBlockId = 'favorites' | 'groups' | 'tunnels' | 'snippets' | 'workspaces' | 'recent'

/**
 * Thứ tự MẶC ĐỊNH, cũng là thứ tự bố cục cũ (Yêu thích → nhóm host → gần đây) với ba khối
 * mới xếp sau. Ai chưa đụng gì tới cấu hình thì thấy đúng sidebar họ đang quen.
 */
export const DEFAULT_SIDEBAR_BLOCKS: readonly SidebarBlockId[] = [
  'favorites',
  'groups',
  'tunnels',
  'snippets',
  'workspaces',
  'recent'
]

/** Khối bật sẵn khi chưa cấu hình gì — đúng bằng bố cục cũ, ba khối mới mặc định TẮT. */
export const DEFAULT_SIDEBAR_ENABLED: readonly SidebarBlockId[] = ['favorites', 'groups', 'recent']

/**
 * Danh sách khối để render: theo thứ tự user đặt, chỉ giữ khối đang bật.
 *
 * Hai phép vệ sinh, vì thứ tự đến từ localStorage nên có thể cũ hoặc bị sửa tay:
 *  · id lạ (bản cũ ghi, hoặc khối đã bỏ) bị loại — không thì render ra một khối trống;
 *  · khối MỚI của bản sau chưa có trong thứ tự đã lưu thì được nối vào cuối theo
 *    {@link DEFAULT_SIDEBAR_BLOCKS}, chứ không biến mất khỏi UI cho tới khi user đặt lại.
 */
export function visibleSidebarBlocks(
  order: readonly string[],
  enabled: readonly string[]
): SidebarBlockId[] {
  const known = new Set<string>(DEFAULT_SIDEBAR_BLOCKS)
  const seen = new Set<string>()
  const ordered: SidebarBlockId[] = []
  for (const id of order) {
    if (!known.has(id) || seen.has(id)) continue
    seen.add(id)
    ordered.push(id as SidebarBlockId)
  }
  for (const id of DEFAULT_SIDEBAR_BLOCKS) {
    if (!seen.has(id)) ordered.push(id)
  }
  const on = new Set(enabled)
  return ordered.filter((id) => on.has(id))
}

/**
 * Group nào đang GẬP. Lưu danh sách "đang gập" chứ không phải "đang mở" là có chủ ý: mặc
 * định (chưa lưu gì) thì mọi group đều MỞ như hành vi cũ, và một group mới tạo cũng mở sẵn.
 * Nếu lưu ngược lại, user tạo group mới sẽ thấy nó gập kín không rõ vì sao.
 */
export function isGroupCollapsed(collapsedIds: readonly string[], groupId: string | null): boolean {
  // Mục "Khác"/"Global" (group === null) không gập được: nó không có id để nhớ trạng thái,
  // và nó là chỗ chứa host chưa phân nhóm — gập nó lại thì host mới thêm sẽ biến mất.
  return groupId !== null && collapsedIds.includes(groupId)
}

/**
 * Lọc "Kết nối gần đây" — bỏ những mục đã nhìn thấy ở danh sách host phía trên.
 *
 * Trong thực tế mục này lặp lại gần hết danh sách host: mỗi lần mở một host đã lưu là một
 * dòng history trỏ đúng về host đó, nên tám dòng cuối sidebar chỉ nhắc lại tám dòng ở trên
 * và đẩy danh sách thật ra khỏi màn hình. Giá trị THẬT của mục này là **quick-connect chưa
 * lưu thành host** (`hostId === null`) — thứ duy nhất không có đường vào nào khác.
 *
 * `hostIds` là những host ĐANG hiện. Cố ý dùng danh sách đang hiện chứ không phải toàn bộ
 * host: khi đang tìm kiếm, host bị ô tìm loại khỏi danh sách thì mục history của nó lại
 * đáng hiện, vì lúc đó nó không còn ở trên nữa.
 */
export function unseenHistory<T extends { hostId: string | null; target: string }>(
  history: readonly T[],
  hostIds: readonly string[],
  limit: number
): T[] {
  const known = new Set(hostIds)
  const seenTargets = new Set<string>()
  const out: T[] = []
  for (const entry of history) {
    if (entry.hostId !== null && known.has(entry.hostId)) continue
    // Cùng một target quick-connect được ghi lại mỗi lần kết nối; chỉ giữ lần gần nhất
    // (history đã sắp mới→cũ) để mục này không thành tám dòng y hệt nhau.
    if (seenTargets.has(entry.target)) continue
    seenTargets.add(entry.target)
    out.push(entry)
    if (out.length >= limit) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Lọc + gom host theo nhóm — dùng chung cho cột host (theme Infra) và trang Hosts (theme Navigator)
// ---------------------------------------------------------------------------

/** Phần của một host mà việc lọc/gom cần tới — generic để không kéo cả `HostDto` vào đây. */
export interface HostLike {
  label: string
  hostname: string
  username: string | null
  groupId: string | null
}

/**
 * Host khớp ô tìm không? So trên nhãn, hostname và username (không phân biệt hoa/thường).
 * Chuỗi rỗng/toàn khoảng trắng khớp MỌI host — nơi gọi không phải tự kiểm "đang tìm hay không".
 */
export function hostMatchesQuery(host: HostLike, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    host.label.toLowerCase().includes(q) ||
    host.hostname.toLowerCase().includes(q) ||
    (host.username ?? '').toLowerCase().includes(q)
  )
}

/** Lọc danh sách host theo ô tìm — giữ nguyên thứ tự, không sửa mảng vào. */
export function filterHosts<T extends HostLike>(hosts: readonly T[], query: string): T[] {
  return hosts.filter((h) => hostMatchesQuery(h, query))
}

/** Một mục "nhóm + host của nó"; `group === null` là mục host chưa phân nhóm. */
export interface HostSection<G, H> {
  group: G | null
  hosts: H[]
}

/**
 * Gom host theo nhóm, giữ thứ tự nhóm như danh sách `groups` và host chưa phân nhóm xếp CUỐI.
 *
 *  · `includeEmptyGroups` — khi KHÔNG tìm kiếm phải hiện cả nhóm rỗng (để đổi tên/xoá được;
 *    trước đây nhóm không host bị ẩn hẳn nên kẹt luôn). Khi đang tìm thì bỏ cho gọn.
 *  · Host trỏ tới một `groupId` KHÔNG còn tồn tại được đưa về mục chưa phân nhóm chứ không
 *    biến mất: một host mà không hiện ở đâu cả là lỗi im lặng khó truy hơn nhiều so với việc
 *    nó nằm nhầm chỗ.
 *  · Mục chưa phân nhóm chỉ xuất hiện khi thật có host — không có gì để làm với một mục trống.
 */
export function groupHostSections<G extends { id: string }, H extends HostLike>(
  groups: readonly G[],
  hosts: readonly H[],
  includeEmptyGroups: boolean
): HostSection<G, H>[] {
  const known = new Set(groups.map((g) => g.id))
  const byGroup = new Map<string | null, H[]>()
  for (const host of hosts) {
    const key = host.groupId !== null && known.has(host.groupId) ? host.groupId : null
    const list = byGroup.get(key) ?? []
    list.push(host)
    byGroup.set(key, list)
  }
  const out: HostSection<G, H>[] = []
  for (const group of groups) {
    const list = byGroup.get(group.id) ?? []
    if (list.length > 0 || includeEmptyGroups) out.push({ group, hosts: list })
  }
  const ungrouped = byGroup.get(null)
  if (ungrouped && ungrouped.length > 0) out.push({ group: null, hosts: ungrouped })
  return out
}
