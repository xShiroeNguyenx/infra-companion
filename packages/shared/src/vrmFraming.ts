/**
 * F70 — hai quyết định thuần của sân khấu VRM, tách khỏi renderer để có test.
 *
 * Renderer (`vrmStage.ts`) giữ phần đụng three.js/WebGL; phần *tính ra con số* nằm đây theo
 * mục 5 CLAUDE.md. Cả hai đều là loại sai mà **không có lỗi nào được ném ra** — nhân vật chỉ
 * đơn giản đứng sai chỗ hoặc sai tư thế — nên đáng có test chặn tái phát.
 *
 * Đặt ở `shared` chứ không `core`: nơi gọi là **renderer**, mà renderer không import được
 * `@infra/core` (kéo `ssh2` vào bundle web là vỡ build). Test nằm ở
 * `packages/core/src/vrm/framing.test.ts` vì vitest chỉ quét `packages/core`.
 */

export interface FrameDistanceInput {
  /** Chiều cao khung hình cần lọt (đơn vị scene), đã tính cả lề. */
  frameH: number
  /** Bề ngang model theo trục X. */
  bbW: number
  /** FOV **dọc** của camera, độ. */
  fovDeg: number
  /** Tỉ lệ ngang/dọc của khung vẽ. */
  aspect: number
}

/**
 * Khoảng cách camera để model lọt trọn **cả hai chiều**.
 *
 * `fov` của `PerspectiveCamera` là FOV DỌC, nên tính riêng theo nó thì khung ngang hẹp (panel
 * dọc) cắt mất hai bên — váy xoè hoặc tay dang ra là thấy ngay. Lấy khoảng cách lớn hơn giữa
 * hai ràng buộc.
 */
export function frameDistance({ frameH, bbW, fovDeg, aspect }: FrameDistanceInput): number {
  const halfFovY = (fovDeg * Math.PI) / 360
  const tan = Math.tan(halfFovY)
  const distV = frameH / 2 / tan
  const distH = bbW / 2 / (tan * aspect)
  return Math.max(distV, distH)
}

/**
 * Dấu xoay tay theo phiên bản spec VRM.
 *
 * `VRMUtils.rotateVRM0` xoay model 0.x 180° quanh trục Y để nó quay mặt vào camera, kéo theo
 * hệ trục cục bộ của xương. Hệ quả: cùng một `rotation.z` hạ tay xuống ở VRM 1.0 thì ở 0.x
 * **giơ tay lên trời** — không lỗi, không cảnh báo, chỉ là nhân vật đứng giơ hai tay. Đã gặp
 * đúng vậy trên model 0.x thật.
 */
export function armSignFor(metaVersion: string): 1 | -1 {
  return metaVersion === '0' ? -1 : 1
}

/**
 * Khung DOM của nhân vật rộng gấp bao nhiêu lần **thân người đo được** lúc đứng nghỉ.
 *
 * Phần dư là lề trong suốt để clip giang tay không bị cắt (bảng số liệu từng clip ở
 * `vrmStage.ts`). Đặt ở shared để `characterSlotInSettings`, hook kéo và test cùng biết một
 * điều: **bề ngang thẻ ≠ bề ngang người** — mọi phép "vừa khe", "chạm mép" phải chia cho số này,
 * không thì co người / chặn người vì một cái lề vô hình.
 */
export const VRM_WIDTH_MARGIN = 2.2

/**
 * Chỗ đặt bảng cài đặt nổi cạnh nhân vật (`VrmMiniPanel`).
 *
 * Tách khỏi component để **test được**: nhân vật hay đứng sát đáy màn hình, mà bảng mở xuống dưới
 * từ vị trí nhân vật — bản đầu chỉ kẹp chiều ngang nên phần dưới bảng nằm ngoài màn hình và mất
 * hẳn các nút ở đó. Đây là loại lỗi chỉ thấy khi ở đúng độ phân giải và đúng vị trí, nên phải có
 * test chặn thay vì nhìn bằng mắt một lần.
 */
export interface PanelPlacement {
  top: number
  maxHeight: number
  /** Mở xuống dưới (true) hay lên trên (false) — nơi gọi không cần biết, để debug. */
  openDown: boolean
}

export function placeVrmPanel(anchorTop: number, viewportHeight: number, margin = 8): PanelPlacement {
  const spaceBelow = viewportHeight - (anchorTop + margin) - margin
  const spaceAbove = anchorTop - margin * 2
  // Mở xuống nếu dưới còn đủ chỗ cho một bảng bình thường, ngược lại chọn bên rộng hơn
  const openDown = spaceBelow >= 260 || spaceBelow >= spaceAbove
  const maxHeight = Math.max(160, openDown ? spaceBelow : spaceAbove)
  const top = openDown ? anchorTop + margin : Math.max(margin, anchorTop - margin - maxHeight)
  return { top, maxHeight, openDown }
}

/**
 * Khung CÀI ĐẶT hai cột + chỗ đứng của nhân vật trong khe giữa.
 *
 * Tách ra shared để **hai bên dùng chung một công thức**: `VrmSettingsFrame` vẽ khung, còn
 * `VrmPanel` dời nhân vật vào khe. Tính riêng hai nơi thì lệch nhau vài pixel là nhân vật đứng
 * chệch khe, mà mỗi lần sửa một bên lại quên bên kia.
 */
export interface SettingsFrameBox {
  /** Khung cài đặt. */
  left: number
  top: number
  width: number
  height: number
  /** Bề ngang khe giữa (px). */
  gap: number
  /** Chiều cao phần thân khung (đã trừ hàng tiêu đề) — nhân vật đứng trong vùng này. */
  bodyTop: number
  bodyHeight: number
}

/** Chiều cao hàng tiêu đề khung cài đặt (px) — nhân vật không được đè lên nó. */
export const SETTINGS_HEADER_H = 42

export function settingsFrameBox(
  viewportW: number,
  viewportH: number,
  characterW: number,
  margin = 24
): SettingsFrameBox {
  const width = Math.min(880, viewportW - margin * 2)
  const height = Math.min(560, viewportH - margin * 2)
  const left = Math.round((viewportW - width) / 2)
  const top = Math.round((viewportH - height) / 2)
  /**
   * Khe giữa: rộng hơn thẻ nhân vật một chút, nhưng **trần 40% bề rộng khung**.
   *
   * Không nới trần theo thẻ: thẻ phóng to hết cỡ cần khe 490px, mà khung chỉ 880px nên hai cột
   * còn 179px mỗi bên — chữ xuống dòng liên tục, không đọc nổi. Trần này an toàn vì thẻ rộng gấp
   * `VRM_WIDTH_MARGIN` lần người: thẻ có tràn sang cột thì phần tràn là lề trong suốt, còn thân
   * người (giữa thẻ) vẫn nằm gọn trong khe với mọi model đo bình thường.
   */
  const gap = Math.min(Math.max(characterW + 40, 200), Math.round(width * 0.4))
  return { left, top, width, height, gap, bodyTop: top + SETTINGS_HEADER_H, bodyHeight: height - SETTINGS_HEADER_H }
}

/**
 * Chỗ đặt khung nhân vật khi bảng cài đặt đang mở: **đứng giữa khe, trong lòng khung**.
 *
 * Trả `top` chứ không `bottom`: neo đáy theo màn hình thì nhân vật thò hẳn ra dưới khung (user
 * chụp được). Cao hơn phần thân khung thì thu nhỏ lại cho vừa — thà nhân vật nhỏ hơn còn hơn
 * nửa người nằm ngoài.
 */
export function characterSlotInSettings(
  box: SettingsFrameBox,
  characterW: number,
  characterH: number
): { left: number; top: number; scale: number } {
  const pad = 12
  const maxH = box.bodyHeight - pad * 2
  /**
   * Thu theo **chiều cao thôi**, KHÔNG theo bề ngang.
   *
   * `characterW` là bề ngang THẺ, rộng gấp `VRM_WIDTH_MARGIN` lần thân người nhìn thấy — phần dư
   * là lề trong suốt chừa cho clip giang tay. Co theo `khe ÷ characterW` là co người thật cho vừa
   * một cái lề vô hình. Đã dính thật: model đo ra tỉ lệ 2,2 → thẻ 677px ở cỡ 65%, người còn
   * 150px, và kéo thanh cỡ **không đổi gì** — vì chiều cao hiển thị = H × khe ÷ (H × tỉ lệ) =
   * khe ÷ tỉ lệ, H triệt tiêu. User đã chọn: người to quá thì chữ đè lên, đừng co.
   */
  const scale = Math.min(1, maxH / characterH)
  /**
   * ⚠️ `left`/`top` là vị trí của thẻ **TRƯỚC KHI co** — cả hai chiều — vì `transform` không đổi
   * vị trí layout.
   *
   * Với `transform-origin: bottom center`: **đáy** thẻ đứng yên và **tâm ngang** đứng yên khi co.
   * Nên đặt đáy thẻ gốc (cao `characterH`) vào sàn khung và tâm thẻ gốc (rộng `characterW`) vào
   * tâm khung — không dùng kích thước đã co. Dùng kích thước đã co thì lệch đúng nửa phần chênh:
   * đo được **thò đáy 22px** và **lệch phải 62px** khỏi khe ở ca scale 0,74 (harness ảnh thật).
   */
  return {
    left: Math.round(box.left + box.width / 2 - characterW / 2),
    // Đặt sát ĐÁY vùng thân: nhân vật đứng trên "sàn" của khung, không lơ lửng giữa
    top: Math.round(box.bodyTop + box.bodyHeight - pad - characterH),
    scale
  }
}

/**
 * Quy vùng **THẺ** nhân vật về vùng **THÂN NGƯỜI NHÌN THẤY** — dùng cho mọi thứ bám cạnh người.
 *
 * Thẻ rộng gấp `VRM_WIDTH_MARGIN` (2,2×) lần người; phần dư là **lề trong suốt** chừa cho clip
 * giang tay. Thân người nằm **giữa** thẻ, nên bám theo mép thẻ là bám theo một cái lề vô hình.
 *
 * Đã dính thật: hai cột của `VrmSidePanel` đặt tại `anchor.left` và `anchor.left + anchor.width`
 * — tức hai mép THẺ — nên khoảng cách giữa chúng bằng bề ngang thẻ. Ở cỡ mặc định (người ~150px)
 * thẻ rộng ~330px, hai cột **cách nhau 330px** trong khi người chỉ chiếm 150px ở giữa: nhìn ra
 * đúng "hai cột cách rất xa nhau", và càng rõ sau khi kéo nhân vật vì lúc đó mắt có mốc so sánh.
 *
 * Chiều cao KHÔNG chia: lề chỉ chừa hai bên, `H` đã là chiều cao người.
 *
 * Kết quả trả về **bằng đúng `measureDrawn`** — bề ngang đo từ pixel đã vẽ lúc đứng nghỉ, vì
 * `vrmStage` đặt `aspect = measureDrawn × VRM_WIDTH_MARGIN ÷ frameH`. Nên đây là bề ngang
 * **mắt nhìn thấy**, không phải một ước lượng: đo trên model thật `aspect` 1,32 → thẻ 581px,
 * thân 264px. Ai cần chờm lên người (hai cột của `VrmSidePanel`) thì tính phần trăm trên số
 * này là ra đúng phần thân bị che.
 */
export function vrmBodyRect(card: { left: number; top: number; width: number; height: number }): {
  left: number
  top: number
  width: number
  height: number
} {
  const width = card.width / VRM_WIDTH_MARGIN
  return {
    left: card.left + (card.width - width) / 2,
    top: card.top,
    width,
    height: card.height
  }
}

/**
 * Lề trong suốt **một bên** của thẻ nhân vật (px) — phần thẻ thò ra ngoài thân người mỗi bên.
 *
 * Mọi phép "đứng sát mép" / "né một cột" phải bù số này, nếu không nhân vật dừng lại khi người
 * còn cách đích nguyên một cái lề vô hình. Đo trên model thật (`aspect` 1,32): thẻ 581px, thân
 * 264px → lề **158px** mỗi bên — đúng bằng khoảng trống user chụp được giữa nhân vật và cột chat
 * khi dock AI mở.
 */
export function vrmSideMargin(cardWidth: number): number {
  return Math.round((cardWidth - cardWidth / VRM_WIDTH_MARGIN) / 2)
}

/**
 * `left` của thẻ nhân vật khi cột dock AI mở — **hút sát mép trái cột chat**.
 *
 * Không phải phép "né cho khỏi đè" mà là phép **dời tới**: mở dock là nhân vật đi sang đứng cạnh
 * cột chat, bỏ qua chỗ user đã kéo; đóng dock thì `dockW = 0` và chỗ cũ trở lại nguyên vẹn (vị
 * trí đã lưu không bị ghi đè — xem `pointer-events-none` lúc dock mở, không có gì ghi lại được).
 *
 * User yêu cầu rõ điều này sau khi thử bản chỉ-chặn: ở đó nhân vật đứng giữa màn hình vẫn giữ
 * nguyên chỗ, vì `Math.min` chỉ kẹp khi nó lấn vào dock — mà "đứng xa" thì không lấn gì cả.
 *
 * Mép phải tính theo **THÂN NGƯỜI** (`+ sideMargin`), không phải mép thẻ: thẻ rộng gấp
 * `VRM_WIDTH_MARGIN` lần người nên trừ nguyên bề ngang thẻ thì người dừng cách cột đúng một lề
 * trong suốt — đo trên model thật (`aspect` 1,79 ở zoom 0,55): thẻ 433px, lề **118px** mỗi bên,
 * đúng bằng khoảng hở user chụp được.
 *
 * `gap = 0` là user chọn: thân người chạm hẳn mép cột chat. An toàn vì phần thẻ chờm sang dock
 * là lề TRONG SUỐT, và thẻ đã `pointer-events-none` khi dock mở nên không che hay chặn chuột
 * của cột chat.
 */
export function vrmLeftBesideDock(
  posX: number,
  cardWidth: number,
  dockW: number,
  viewportW: number,
  gap = 0
): number {
  if (dockW <= 0) return posX
  const snapped = viewportW - dockW - cardWidth + vrmSideMargin(cardWidth) - gap
  // Kẹp ≥ 0: cửa sổ hẹp + dock rộng có thể cho ra số âm, khi đó nhân vật chui ra ngoài mép trái
  return Math.max(0, snapped)
}

/** Trần phóng to/thu nhỏ (Ctrl + lăn chuột). */
export const VRM_ZOOM_MIN = 0.5
export const VRM_ZOOM_MAX = 3
/**
 * Trần phóng to **khi bảng cài đặt đang mở** — thấp hơn trần chung nhiều.
 *
 * Khe giữa hai cột chỉ rộng 40% khung (~350px), nên nhân vật to hơn mức này sẽ tràn sang hai cột
 * chữ. `characterSlotInSettings` có thu nhỏ để cứu, nhưng thu quá nhiều thì thanh trượt nói 300%
 * mà nhìn vẫn y như 120% — số hiển thị nói dối. Chặn ngay ở thanh trượt thì trung thực hơn.
 */
export const VRM_ZOOM_MAX_IN_SETTINGS = 1.2

/**
 * Mức phóng mới sau một nấc lăn chuột.
 *
 * Nhân/chia theo **hệ số** chứ không cộng/trừ một lượng cố định: ở mức 0.5 thì cộng 0.1 là
 * nhảy 20%, còn ở mức 3 chỉ là 3% — cùng một cú lăn mà cảm giác khác hẳn. Nhân thì mỗi nấc
 * đổi đúng một tỉ lệ như nhau.
 *
 * `deltaY` âm = lăn lên = phóng to (theo quy ước của mọi trình duyệt).
 */
export function zoomStep(current: number, deltaY: number): number {
  const next = deltaY < 0 ? current * 1.1 : current / 1.1
  return Math.min(VRM_ZOOM_MAX, Math.max(VRM_ZOOM_MIN, next))
}

/**
 * Biểu cảm nên hiện khi app có sự kiện mới.
 *
 * Trả về **tên ưu tiên theo thứ tự**, không phải một tên duy nhất: model VRM chỉ khai những
 * biểu cảm tác giả muốn có, và `expressionManager.setValue('angry', …)` trên model không có
 * `angry` là **no-op im lặng** (mục 8 CLAUDE.md). Nơi gọi phải dò xuống danh sách này và lấy
 * cái đầu tiên model thật sự có.
 *
 * `neutral` luôn đứng cuối vì mọi model đều khai nó — nó là lưới an toàn.
 */
export function expressionForEvent(kind: string, severity: string): readonly string[] {
  if (kind === 'recover') return ['relaxed', 'happy', 'neutral']
  if (kind === 'alert') {
    return severity === 'critical' ? ['surprised', 'sad', 'angry', 'neutral'] : ['sad', 'surprised', 'neutral']
  }
  return ['neutral']
}
