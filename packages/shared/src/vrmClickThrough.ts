/**
 * Click xuyên qua trợ lý ảo — bấm, cuộn, kéo trên người nhân vật đều rơi xuống app phía sau.
 *
 * Mượn ý từ `desktop-companion` (Tauri), nhưng làm gọn hơn nhiều: bên đó pet là MỘT CỬA SỔ riêng,
 * bỏ qua chuột là cả cửa sổ mù chuột, nên phải có hook chuột toàn cục của hệ điều hành để biết con
 * trỏ ở đâu và để bắt Ctrl + chuột phải. Ở đây nhân vật nằm TRONG trang của app: chỉ khung nhân
 * vật thôi nhận chuột (`pointer-events: none`), còn `pointermove`/`contextmenu` của cả cửa sổ vẫn
 * tới tay mình — không cần hook nào, cũng không phải tạm tắt click-through khi mở menu (các bảng
 * nổi là phần tử riêng, luôn bấm được).
 *
 * Các hàm dưới đây là phần QUYẾT ĐỊNH, tách ra để test; phần nghe sự kiện ở `VrmPanel`.
 */

/**
 * Rời khỏi người bao lâu mới hiện rõ lại (ms).
 *
 * Vùng "trên người" là hộp quanh xương, có khe giữa tay và thân; không chờ thì lướt chuột ngang
 * qua là nhân vật nháy mờ–rõ liên tục. Cùng con số với `desktop-companion` (`LEAVE_MS`).
 */
export const SEE_THROUGH_LEAVE_MS = 250

/**
 * Click xuyên qua có đang ÁP lên nhân vật lúc này không.
 *
 * - Chỉ ở chế độ không khung: có khung thì panel là một bảng cài đặt có chữ có nút, xuyên qua là
 *   không bấm được gì trong đó.
 * - Không khi đang mở cài đặt: nhân vật đứng trong khe giữa khung cài đặt, phía dưới là chính cái
 *   khung — không có app nào để bấm xuống, mà user mở cài đặt là để xem/chỉnh nhân vật.
 * - Không khi dock AI mở: lúc đó nhân vật ĐÃ không nhận chuột và đã mờ sẵn (`opacity-40`), chồng
 *   thêm lớp mờ-khi-rê là hai luật cùng giành một thuộc tính.
 */
export function clickThroughActive(s: {
  readonly setting: boolean
  readonly chromeless: boolean
  readonly settingsOpen: boolean
  readonly dockOpen: boolean
}): boolean {
  return s.setting && s.chromeless && !s.settingsOpen && !s.dockOpen
}

/**
 * Nhân vật có mờ đi lúc này không.
 *
 * Không mờ khi đang mở menu/bảng của nhân vật (`uiOpen`): menu tròn mở ngay dưới con trỏ — tức
 * ngay trên người — mà mờ còn 15% thì user chọn mục trong khi không thấy mình đang chỉnh ai. Bên
 * `desktop-companion` cũng vậy: mở menu là tạm hết mờ tới khi đóng.
 */
export function seeThroughFaded(s: {
  readonly active: boolean
  readonly over: boolean
  readonly uiOpen: boolean
}): boolean {
  return s.active && s.over && !s.uiOpen
}

/**
 * Cú chuột phải này có dành cho nhân vật không (Ctrl + chuột phải TRÊN NGƯỜI, lúc click xuyên qua
 * đang bật). Mọi cú khác — chuột phải trần, Ctrl + chuột phải chỗ khác — vẫn xuống app phía sau.
 */
export function ctrlMenuWanted(s: {
  readonly active: boolean
  readonly over: boolean
  readonly ctrlKey: boolean
}): boolean {
  return s.active && s.over && s.ctrlKey
}

/**
 * Đổi toạ độ client sang toạ độ chuẩn hoá [-1, 1] của khung (y hướng lên, như camera three.js).
 * `null` = điểm nằm ngoài khung, hoặc khung chưa có kích thước.
 *
 * Kiểm "ngoài khung" Ở ĐÂY chứ không để `hitTest` lo: hộp xương được nới ra theo tỉ lệ, điểm ở
 * xa ngoài khung đổi ra toạ độ > 1 vẫn có thể lọt vào hộp nới — nhân vật sẽ mờ khi con trỏ còn
 * cách người cả trăm pixel.
 */
export function pointInBoxNdc(
  x: number,
  y: number,
  r: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
): { nx: number; ny: number } | null {
  if (!(r.width > 0) || !(r.height > 0)) return null
  if (x < r.left || y < r.top || x > r.left + r.width || y > r.top + r.height) return null
  // `1 − 2t` chứ không `−(2t − 1)`: cùng giá trị, nhưng cách sau cho ra `-0` ở đúng giữa khung
  return { nx: ((x - r.left) / r.width) * 2 - 1, ny: 1 - ((y - r.top) / r.height) * 2 }
}

/** Câu nhân vật nói khi user bật / tắt — bật mà không nói thì user không biết đường mở menu nữa. */
export const CLICK_THROUGH_ON_LINE =
  'Giờ Onii~ bấm xuyên qua em được rồi nha~ Muốn gọi em thì giữ Ctrl rồi click phải lên người em 👻'
export const CLICK_THROUGH_OFF_LINE = 'Em nhận chuột lại rồi nè~ chạm vào em thoải mái nha ✨'
