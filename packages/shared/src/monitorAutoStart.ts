/**
 * Monitoring tự bật khi mở app — cùng khái niệm với ⚡ của tunnel (`pickAutoStartRules`).
 *
 * User bấm ⚡ trên khung đang theo dõi → lưu TẬP HOST đang theo dõi. Lần sau mở app, ngay khi vault
 * mở (kể cả tự mở bằng "ghi nhớ trên máy này"), app bắt đầu theo dõi đúng tập đó.
 *
 * Lưu ở localStorage của renderer (`infra.monitorAutoStart`), cùng chỗ với ghim host/tunnel: chỉ
 * là danh sách id host, không có bí mật nào, và là lựa chọn THEO MÁY (máy ở nhà không nhất thiết
 * phải theo dõi cùng tập với máy ở công ty). Các hàm dưới đây là phần quyết định, tách ra để test.
 */

/** Trần số host lưu được — chặn giá trị rác trong localStorage (ai cũng sửa tay được). */
export const MONITOR_AUTOSTART_MAX = 200

/** Đọc danh sách đã lưu: mảng chuỗi khác rỗng, bỏ trùng, giữ thứ tự; mọi thứ khác → rỗng. */
export function cleanMonitorAutoStart(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string' || x.length === 0 || out.includes(x)) continue
    out.push(x)
    if (out.length >= MONITOR_AUTOSTART_MAX) break
  }
  return out
}

/**
 * Đổi danh sách id đã lưu thành tập host bắt đầu theo dõi được.
 *
 * Giữ THỨ TỰ đã lưu (thứ tự card user quen nhìn). Host đã bị xoá, hoặc nay không còn là SSH, thì
 * không theo dõi được — đếm vào `missing` để nơi gọi NÓI RA và dọn khỏi danh sách, thay vì lặng lẽ
 * bỏ qua rồi mỗi lần mở app lại thiếu một card mà không ai biết vì sao.
 */
export function resolveMonitorAutoStart(
  ids: readonly string[],
  hosts: readonly { readonly id: string; readonly label: string; readonly protocol: string }[]
): { start: { id: string; label: string }[]; missing: number } {
  const byId = new Map(hosts.map((h) => [h.id, h]))
  const start: { id: string; label: string }[] = []
  let missing = 0
  for (const id of ids) {
    const h = byId.get(id)
    if (h && h.protocol === 'ssh') start.push({ id: h.id, label: h.label })
    else missing++
  }
  return { start, missing }
}

/**
 * Trạng thái nút ⚡ so với tập ĐANG theo dõi.
 *
 * - `off` — chưa lưu gì.
 * - `same` — đúng tập đang theo dõi sẽ tự bật (so như TẬP HỢP: thứ tự không quan trọng).
 * - `different` — có lưu, nhưng là một tập khác (user đã bắt đầu lại với host khác). Tách riêng
 *   trạng thái này vì nếu chỉ có bật/tắt thì nút trông "đang bật" mà lần sau mở app lại ra tập cũ.
 */
export function monitorAutoStartState(
  saved: readonly string[],
  current: readonly string[]
): 'off' | 'same' | 'different' {
  if (saved.length === 0) return 'off'
  const a = new Set(saved)
  const b = new Set(current)
  if (a.size !== b.size) return 'different'
  for (const id of a) if (!b.has(id)) return 'different'
  return 'same'
}
