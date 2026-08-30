/**
 * F27 — quyết định mức cảnh báo cho một lệnh nguy hiểm, DỰA TRÊN NƠI NÓ SẮP CHẠY.
 *
 * Guard cũ chỉ khớp mẫu chuỗi nên hộp thoại xác nhận `rm -rf …` trông y hệt nhau dù lệnh sắp
 * đi tới một máy nháp hay năm con DB production. Mà đường dùng nhiều nhất lại là "mở cả nhóm
 * thành N pane rồi bật Broadcast" — gõ một lần, chạy trên N máy cùng lúc.
 *
 * Hàm thuần: nhận danh sách đích, trả mô tả cảnh báo. Không đụng React, không đụng vault.
 */

/** Một pane sắp nhận lệnh. */
export interface CommandTarget {
  /** Nhãn host để hiện cho người đọc. Local shell thì là tên shell. */
  label: string
  /** Đã kế thừa xong từ chuỗi group — xem `resolveProduction`. */
  production: boolean
}

export type GuardLevel = 'confirm' | 'type-to-confirm'

export interface GuardScope {
  /** 'type-to-confirm' khi có ít nhất một đích production — bấm một nút là quá dễ lỡ tay. */
  level: GuardLevel
  /** Tổng số đích sẽ nhận lệnh (1 = chỉ pane đang gõ). */
  targetCount: number
  /** Nhãn các đích production, đã khử trùng lặp, giữ thứ tự vào. */
  productionLabels: string[]
  /**
   * Chuỗi người dùng phải gõ lại để xác nhận, hoặc null nếu chỉ cần bấm nút.
   * Là nhãn của đích production ĐẦU TIÊN — gõ lại tên máy buộc phải đọc nó.
   */
  typePhrase: string | null
}

/**
 * Nhóm có `production` không phải lúc nào cũng khai ở nhóm trực tiếp chứa host: người ta đặt
 * cờ ở nhóm cha ("Production") rồi chia nhóm con ("Production/DB"). Nên phải đi hết chuỗi
 * group — CHỈ CẦN MỘT nhóm bất kỳ trên đường lên gốc bật cờ là host tính là production.
 *
 * Khác `username`/`keyId` (nhóm gần nhất thắng): ở đây không có chuyện "ghi đè thành không
 * production", vì hạ mức an toàn do đặt cờ ở nhóm cha là điều không ai mong muốn.
 *
 * `parentOf` trả về id nhóm cha; có chặn vòng lặp để dữ liệu hỏng không làm treo lúc bấm Enter.
 */
export function resolveProduction(
  groupId: string | null,
  isProduction: (groupId: string) => boolean,
  parentOf: (groupId: string) => string | null
): boolean {
  const seen = new Set<string>()
  let current = groupId
  while (current && !seen.has(current)) {
    seen.add(current)
    if (isProduction(current)) return true
    current = parentOf(current)
  }
  return false
}

/** Mức cảnh báo cho một lệnh đã khớp mẫu, dựa trên các đích sắp nhận nó. */
export function guardScope(targets: CommandTarget[]): GuardScope {
  const productionLabels: string[] = []
  for (const target of targets) {
    if (target.production && !productionLabels.includes(target.label)) productionLabels.push(target.label)
  }
  return {
    level: productionLabels.length > 0 ? 'type-to-confirm' : 'confirm',
    targetCount: targets.length,
    productionLabels,
    typePhrase: productionLabels[0] ?? null
  }
}

/**
 * So chuỗi người dùng gõ với chuỗi yêu cầu. Bỏ khoảng trắng thừa hai đầu nhưng **phân biệt
 * hoa/thường**: nhãn host hay chỉ khác nhau ở đúng chỗ đó, nới ra là mất tác dụng "đọc kỹ".
 */
export function typePhraseMatches(typed: string, expected: string | null): boolean {
  if (expected === null) return true
  return typed.trim() === expected.trim()
}
