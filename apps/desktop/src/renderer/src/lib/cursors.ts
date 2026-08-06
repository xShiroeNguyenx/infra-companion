/**
 * Con trỏ chuột tuỳ chỉnh cho toàn app.
 *
 * Mỗi con trỏ là một **CẶP trạng thái**: ảnh thường + ảnh **hover** (khi trỏ vào thứ bấm
 * được). Bản hover của hình app tự vẽ được sinh ra từ CHÍNH hình đó — phóng nhẹ quanh
 * điểm nhấn + thêm quầng sáng màu nhấn — nên không phải vẽ tay hai lần và hai trạng thái
 * không bao giờ lệch nhau về hình.
 *
 * Hai nguồn:
 * - **Preset**: con trỏ sẵn có của hệ điều hành (từ khoá CSS, hover = bàn tay) + một bộ SVG
 *   app tự vẽ. Cố ý KHÔNG đóng gói bộ con trỏ của bên thứ ba (Bibata, Breeze, Adwaita,
 *   macOS…): chúng là GPL/LGPL hoặc có bản quyền riêng, không mang vào repo MIT được.
 *   Muốn dùng đúng bộ đó thì tải về rồi thêm bằng tay — đó là lý do có phần "con trỏ tự thêm".
 * - **Tự thêm**: user chọn file ảnh, app vẽ lại ra canvas thành PNG (xem `importCursorFile`).
 *   Ảnh hover là TUỲ CHỌN và dùng chung điểm nhấn với ảnh thường.
 *
 * Giới hạn của Chromium cần biết:
 * - Ảnh lớn hơn 128×128 bị **BỎ QUA IM LẶNG** (không lỗi, chỉ là con trỏ không đổi) →
 *   mọi ảnh nhập vào đều bị thu về `CURSOR_MAX_PX`.
 * - **`.ani` (con trỏ động của Windows) không chạy** — không có định dạng con trỏ động nào
 *   dùng được trên web. `.gif` động chỉ lấy khung hình đầu.
 * - Điểm nhấn (hotspot) phải nằm TRONG ảnh, nếu không cả khai báo bị bỏ.
 */

/** Cạnh tối đa của ảnh con trỏ — Chromium bỏ qua ảnh lớn hơn mức này. */
export const CURSOR_MAX_PX = 128
/** Số con trỏ tự thêm tối đa — chặn localStorage phình to (mỗi PNG 128px ~ vài chục KB). */
export const CURSOR_CUSTOM_MAX = 12
/** Đuôi file cho hộp thoại chọn ảnh. `.ani` cố ý KHÔNG có mặt (web không chạy được). */
export const CURSOR_ACCEPT = '.png,.gif,.webp,.svg,.cur,.ico,image/*'

/** Một con trỏ do user tự thêm. */
export interface CustomCursor {
  id: string
  name: string
  /** LUÔN là PNG base64 — mọi file nhập vào đều được vẽ lại ra canvas, xem `importCursorFile`. */
  dataUrl: string
  /** Điểm nhấn: toạ độ pixel trong ảnh ứng với "đầu mũi tên". */
  hotX: number
  hotY: number
  /** Kích thước ảnh sau khi thu nhỏ — để kẹp điểm nhấn trong khoảng hợp lệ. */
  width: number
  height: number
  /**
   * Ảnh khi trỏ vào thứ bấm được (tuỳ chọn). Cố ý **dùng CHUNG điểm nhấn** với ảnh thường:
   * thực tế người ta chọn bản hover cùng cỡ, thêm một cặp X/Y nữa chỉ làm rối hàng.
   */
  hoverDataUrl?: string
  hoverWidth?: number
  hoverHeight?: number
}

/** Id các preset — union để bảng nhãn i18n bên UI không cần ép kiểu. */
export type CursorPresetId =
  | 'system'
  | 'pointer'
  | 'crosshair'
  | 'cell'
  | 'text'
  | 'grab'
  | 'arrowLight'
  | 'arrowDark'
  | 'arrowAccent'
  | 'ring'
  | 'dot'
  | 'retro'
  | 'sword'
  | 'heart'
  | 'pine'
  | 'rocket'
  | 'pencil'
  | 'bolt'
  | 'paw'

/**
 * Một con trỏ dựng sẵn. Có `keyword` = dùng con trỏ hệ điều hành; có `image` = SVG app tự vẽ.
 * `hoverKeyword` / `hoverImage` là trạng thái khi trỏ vào thứ bấm được.
 */
export interface CursorPreset {
  id: CursorPresetId
  /** Từ khoá CSS (`pointer`, `crosshair`…) — chỉ preset hệ thống. */
  keyword?: string
  /** Từ khoá CSS cho trạng thái hover — chỉ preset hệ thống. */
  hoverKeyword?: string
  /** Sinh data URI ảnh SVG. Nhận accent vì vài bản tô theo màu nhấn của theme. */
  image?: (accent: string) => string
  /** Điểm nhấn của ảnh thường. */
  hot?: [number, number]
  /** Sinh data URI ảnh hover. */
  hoverImage?: (accent: string) => string
  /** Điểm nhấn của ảnh hover (khác ảnh thường vì canvas hover có thêm lề). */
  hoverHot?: [number, number]
}

/** Bọc hình SVG thành data URI. Encode toàn chuỗi vì `#` trong mã màu sẽ cắt URI làm đôi. */
function svgDataUri(body: string, w: number, h: number, viewBox = `0 0 ${w} ${h}`): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${body}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Hàm sinh markup một hình: nhận chuỗi thuộc tính fill/stroke để chèn vào MỌI thẻ con. */
type Shape = (attrs: string) => string

const pathShape =
  (d: string): Shape =>
  (a) =>
    `<path d="${d}" ${a}/>`

/**
 * Vẽ hình thành 2 lớp: quầng tối rộng phía dưới, rồi nét trắng mảnh + phần tô phía trên.
 * Một lớp viền đơn luôn tàng hình trên nền cùng màu với nó — mà con trỏ ở app này phải
 * đi qua cả terminal tối và panel sáng, nên cần đủ hai lớp.
 * Không dùng `<use href="#id">` cho gọn: `<use>` trong SVG dùng làm ảnh CSS là chỗ dễ
 * bị engine xử lý khác nhau, mà con trỏ lỗi thì im lặng (không hiện gì, không báo lỗi).
 */
function haloed(shape: Shape, fill: string): string {
  return (
    shape(
      'fill="none" stroke="#000000" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round" opacity=".45"'
    ) + shape(`fill="${fill}" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"`)
  )
}

// ── Trạng thái HOVER ──────────────────────────────────────────────────────────
// Sinh từ chính hình của trạng thái thường: quầng sáng màu nhấn + phóng nhẹ. Hai tín hiệu
// vì mỗi cái một mình đều thiếu: quầng sáng vô hình trên hình đã sáng màu, còn phóng to
// thì hình tròn xoay đối xứng (vòng tròn/chấm) gần như không thấy khác.

/** Lề trong suốt thêm quanh ảnh hover — đủ chứa quầng sáng (6px) + phần phóng ra (~3px). */
const HOVER_PAD = 10
const HOVER_SCALE = 1.1

/**
 * Quầng sáng màu nhấn phía sau — tín hiệu "bấm được".
 * Nét PHẢI rộng hơn hẳn quầng tối 3.4 của `haloed` (vẽ đè lên trên), không thì chỉ còn
 * hở ~1px và trông y như bản thường. Hai lớp để rìa sáng tản dần thay vì cắt cụt.
 */
function glow(shape: Shape, accent: string): string {
  // Bề rộng đã cân bằng mắt: quầng tối 3.4 loe 1.7 mỗi bên, nên lớp trong 7 chỉ hở ~1.8px
  // và lớp ngoài 9.5 hở ~3.1px — đủ thấy là "đang bật" mà không nhấn chìm hình (~20px).
  const attrs = 'fill="none" stroke-linejoin="round" stroke-linecap="round"'
  return (
    shape(`${attrs} stroke="${accent}" stroke-width="9.5" opacity=".26"`) +
    shape(`${attrs} stroke="${accent}" stroke-width="7" opacity=".6"`)
  )
}

/**
 * Ảnh hover: đặt hình vào canvas rộng hơn `HOVER_PAD` mỗi phía rồi phóng quanh ĐÚNG
 * điểm nhấn — nhờ vậy điểm nhấn không xê dịch trong hệ toạ độ hình, chỉ dịch theo lề.
 * viewBox lấy gốc âm để giữ nguyên toạ độ gốc của mọi hình (1 đơn vị = 1 CSS px).
 */
function hoverUri(inner: string, w: number, h: number, [hx, hy]: [number, number]): string {
  const P = HOVER_PAD
  const t = `translate(${hx} ${hy}) scale(${HOVER_SCALE}) translate(${-hx} ${-hy})`
  return svgDataUri(`<g transform="${t}">${inner}</g>`, w + 2 * P, h + 2 * P, `${-P} ${-P} ${w + 2 * P} ${h + 2 * P}`)
}

const hoverHotOf = ([x, y]: [number, number]): [number, number] => [x + HOVER_PAD, y + HOVER_PAD]

// ── Hình của từng preset ──────────────────────────────────────────────────────

/** Mũi tên cổ điển, đầu nhọn đặt ở (2,2) để chừa chỗ cho nét viền. */
const ARROW_PATH = 'M2 2 L2 24 L7.6 18.6 L11.2 26 L14.8 24.4 L11.3 17.2 L18.4 17.2 Z'
const arrowShape = pathShape(ARROW_PATH)

function arrowBody(fill: string, stroke: string): string {
  return `<path d="${ARROW_PATH}" fill="${fill}" stroke="${stroke}" stroke-width="1.7" stroke-linejoin="round"/>`
}

const ringShape: Shape = (a) => `<circle cx="13" cy="13" r="8.6" ${a}/>`

function ringBody(accent: string): string {
  return (
    ringShape('fill="none" stroke="#000000" stroke-width="3.6" opacity=".5"') +
    ringShape(`fill="none" stroke="${accent}" stroke-width="1.9"`) +
    `<circle cx="13" cy="13" r="1.5" fill="${accent}"/>`
  )
}

const dotShape: Shape = (a) => `<circle cx="9" cy="9" r="5.2" ${a}/>`
const dotBody = (): string => dotShape('fill="#ffffff" stroke="#000000" stroke-width="1.7"')

/**
 * Mũi tên 8-bit: toạ độ chẵn + `crispEdges` (tắt khử răng cưa) cho ra bậc thang.
 * Toạ độ đã nhân 2 sẵn để **1 đơn vị = 1 CSS px** như mọi hình khác — nếu để viewBox
 * nhỏ rồi phóng bằng width/height thì phép dựng ảnh hover phải quy đổi hai hệ toạ độ.
 */
const RETRO_PATH = 'M2 2 L2 28 L8 22 L12 32 L16 30 L12 20 L20 20 Z'
const retroShape = pathShape(RETRO_PATH)
const retroBody = (): string =>
  `<g shape-rendering="crispEdges">${retroShape('fill="#ffffff" stroke="#000000" stroke-width="2"')}</g>`

/** Kiếm chỉ chéo lên trên-trái: lưỡi + chắn tay + cán, mũi kiếm ở (4,4). */
const SWORD_D =
  'M4 4 L2 6 L13 17 L17 13 L6 2 Z ' +
  'M12 19.1 L19.1 12 L21 13.9 L13.9 21 Z ' +
  'M16.6 18.4 L21.6 23.4 L23.4 21.6 L18.4 16.6 Z'

/** Trái tim, điểm nhấn là mũi nhọn dưới cùng (13,22). */
const HEART_D =
  'M13 22 C13 22 3 15.2 3 9.2 C3 5.6 5.7 3 9 3 C11.1 3 12.4 4.1 13 5 ' +
  'C13.6 4.1 14.9 3 17 3 C20.3 3 23 5.6 23 9.2 C23 15.2 13 22 13 22 Z'

/** Cây thông 3 tầng, ngọn ở (12,2). Thân vẽ riêng để tô màu nâu. */
const PINE_D = 'M12 2 L16.5 9 L14.5 9 L18.5 15 L16 15 L20 21 L4 21 L8 15 L5.5 15 L9.5 9 L7.5 9 Z'
const PINE_TRUNK_D = 'M10.5 20 L13.5 20 L13.5 25.5 L10.5 25.5 Z'

/** Tên lửa dựng đứng: thân + 2 cánh, mũi ở (12,3). */
const ROCKET_D =
  'M12 3 C15.5 6.5 17 10.5 17 15 L16 18 L8 18 L7 15 C7 10.5 8.5 6.5 12 3 Z ' +
  'M7 14.5 L3.5 20 L7.5 18 Z ' +
  'M17 14.5 L20.5 20 L16.5 18 Z'

/** Bút chì chéo, đầu chì ở dưới-trái (3,22) — đúng chỗ nét vẽ chạm giấy. */
const PENCIL_D = 'M3 22 L5.2 16.2 L18.2 3.2 L21.8 6.8 L8.8 19.8 Z'

/** Tia sét, điểm nhấn ở đỉnh trên-trái (7,3) để ảnh loe xuống dưới-phải như con trỏ thường. */
const BOLT_D = 'M8 3 L17 13 L12.5 13 L14.5 22 L5 10 L10 10 L7 3 Z'

/** Dấu chân mèo: 4 ngón + đệm. Điểm nhấn ở giữa (14,15) như con trỏ vòng/chấm. */
const pawShape: Shape = (a) =>
  `<circle cx="7" cy="10" r="2.7" ${a}/>` +
  `<circle cx="11.6" cy="6.6" r="2.8" ${a}/>` +
  `<circle cx="16.4" cy="6.6" r="2.8" ${a}/>` +
  `<circle cx="21" cy="10" r="2.7" ${a}/>` +
  `<path d="M14 12 C18.4 12 21.5 15.2 21.5 18.6 C21.5 21.8 18.6 23.5 14 23.5 C9.4 23.5 6.5 21.8 6.5 18.6 C6.5 15.2 9.6 12 14 12 Z" ${a}/>`

/**
 * Dựng preset tự vẽ: một hình → CẢ hai trạng thái.
 * `shapes` là các đường cần vẽ quầng sáng ở bản hover (cây thông có 2: thân + tán).
 */
function drawn(
  id: CursorPresetId,
  hot: [number, number],
  w: number,
  h: number,
  body: (accent: string) => string,
  shapes: Shape[]
): CursorPreset {
  return {
    id,
    hot,
    image: (a) => svgDataUri(body(a), w, h),
    hoverHot: hoverHotOf(hot),
    hoverImage: (a) => hoverUri(shapes.map((s) => glow(s, a)).join('') + body(a), w, h, hot)
  }
}

/**
 * Danh sách preset theo thứ tự hiển thị. Nhãn lấy từ i18n khoá `settings.cursor.<id>`.
 * `system` là mục đặc biệt: chọn nó = gỡ hẳn override, trả cả hai trạng thái về mặc định OS.
 */
export const CURSOR_PRESETS: CursorPreset[] = [
  { id: 'system', keyword: 'auto' },
  { id: 'pointer', keyword: 'pointer', hoverKeyword: 'pointer' },
  { id: 'crosshair', keyword: 'crosshair', hoverKeyword: 'pointer' },
  { id: 'cell', keyword: 'cell', hoverKeyword: 'pointer' },
  { id: 'text', keyword: 'text', hoverKeyword: 'pointer' },
  // Nắm → đang nắm: cặp trạng thái có sẵn của hệ điều hành, đúng nghĩa hơn bàn tay trỏ
  { id: 'grab', keyword: 'grab', hoverKeyword: 'grabbing' },
  drawn('arrowLight', [2, 2], 21, 28, () => arrowBody('#ffffff', '#111827'), [arrowShape]),
  drawn('arrowDark', [2, 2], 21, 28, () => arrowBody('#111827', '#ffffff'), [arrowShape]),
  drawn('arrowAccent', [2, 2], 21, 28, (a) => arrowBody(a, '#ffffff'), [arrowShape]),
  drawn('ring', [13, 13], 26, 26, ringBody, [ringShape]),
  drawn('dot', [9, 9], 18, 18, dotBody, [dotShape]),
  drawn('retro', [2, 2], 24, 36, retroBody, [retroShape]),
  drawn('sword', [4, 4], 26, 26, () => haloed(pathShape(SWORD_D), '#cbd5e1'), [pathShape(SWORD_D)]),
  drawn('heart', [13, 22], 26, 25, () => haloed(pathShape(HEART_D), '#ef4444'), [pathShape(HEART_D)]),
  drawn(
    'pine',
    [12, 2],
    24,
    28,
    // Thân vẽ TRƯỚC để quầng tối của tán cây phủ lên chỗ giáp nhau, không thấy đường ghép
    () => haloed(pathShape(PINE_TRUNK_D), '#92400e') + haloed(pathShape(PINE_D), '#22c55e'),
    [pathShape(PINE_TRUNK_D), pathShape(PINE_D)]
  ),
  drawn('rocket', [12, 3], 24, 23, () => haloed(pathShape(ROCKET_D), '#f97316'), [pathShape(ROCKET_D)]),
  drawn('pencil', [3, 22], 25, 25, () => haloed(pathShape(PENCIL_D), '#f59e0b'), [pathShape(PENCIL_D)]),
  drawn('bolt', [7, 3], 20, 25, () => haloed(pathShape(BOLT_D), '#fde047'), [pathShape(BOLT_D)]),
  drawn('paw', [14, 15], 27, 27, () => haloed(pawShape, '#f9a8d4'), [pawShape])
]

/** true = preset dùng con trỏ của hệ điều hành (không có ảnh app tự vẽ). */
export function isNativePreset(p: CursorPreset): boolean {
  return p.keyword !== undefined
}

/**
 * Màu accent ĐANG áp — kể cả accent mặc định của theme, không chỉ màu user tự chọn.
 * Đọc từ CSS var nên không cần biết theme/override nào đang thắng.
 */
export function currentAccent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#3b82f6'
}

/** Giá trị đặt cho thuộc tính CSS `cursor` — trạng thái thường của một preset. */
export function presetCss(p: CursorPreset, accent: string): string {
  if (p.keyword) return p.keyword
  const [x, y] = p.hot ?? [0, 0]
  // `, default` là bắt buộc: thiếu con trỏ dự phòng thì cả khai báo bị coi là sai cú pháp
  return `url("${p.image!(accent)}") ${x} ${y}, default`
}

/** Trạng thái hover của một preset; null = preset này không đổi gì khi hover. */
export function presetHoverCss(p: CursorPreset, accent: string): string | null {
  if (p.hoverKeyword) return p.hoverKeyword
  if (!p.hoverImage) return null
  const [x, y] = p.hoverHot ?? [0, 0]
  return `url("${p.hoverImage(accent)}") ${x} ${y}, pointer`
}

/**
 * Chỉ chấp nhận PNG base64 — đúng thứ `importCursorFile` sinh ra.
 * Chuỗi này được ghép thẳng vào CSS nên không được để lọt data URI hình dạng khác
 * (SVG có thể chứa nội dung tuỳ ý) hay ký tự phá vỡ `url("…")`.
 */
const PNG_DATA_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.min(Math.max(Math.round(v), lo), hi)
}

/** Ghép data URI + điểm nhấn thành giá trị CSS, kẹp điểm nhấn vào trong ảnh. */
function imageCss(dataUrl: string, hotX: number, hotY: number, w: number, h: number, fallback: string): string | null {
  if (!PNG_DATA_RE.test(dataUrl)) return null
  // Điểm nhấn ra ngoài ảnh làm Chromium bỏ cả khai báo → kẹp về trong khoảng
  const x = clampInt(hotX, 0, Math.max(0, w - 1))
  const y = clampInt(hotY, 0, Math.max(0, h - 1))
  return `url("${dataUrl}") ${x} ${y}, ${fallback}`
}

/** Giá trị CSS `cursor` của một con trỏ tự thêm; null nếu dữ liệu không hợp lệ. */
export function customCursorCss(c: CustomCursor): string | null {
  return imageCss(c.dataUrl, c.hotX, c.hotY, c.width, c.height, 'default')
}

/** Trạng thái hover của con trỏ tự thêm; null = chưa thêm ảnh hover. */
export function customCursorHoverCss(c: CustomCursor): string | null {
  if (!c.hoverDataUrl) return null
  return imageCss(c.hoverDataUrl, c.hotX, c.hotY, c.hoverWidth ?? 0, c.hoverHeight ?? 0, 'pointer')
}

/** Cặp trạng thái đã giải quyết. null = không override (dùng con trỏ mặc định). */
export interface ResolvedCursor {
  normal: string | null
  hover: string | null
}

/**
 * Tra cặp giá trị CSS cho lựa chọn hiện tại. `selection` là id preset hoặc `custom:<id>`.
 * `normal` null = không override (mục `system`, hoặc con trỏ tự thêm đã bị xoá).
 * `hover` null = giữ con trỏ ngữ cảnh của trình duyệt (bàn tay) khi trỏ vào thứ bấm được.
 */
export function resolveCursor(selection: string, customs: CustomCursor[], accent: string): ResolvedCursor {
  if (selection.startsWith('custom:')) {
    const c = customs.find((x) => x.id === selection.slice('custom:'.length))
    if (!c) return { normal: null, hover: null }
    return { normal: customCursorCss(c), hover: customCursorHoverCss(c) }
  }
  const p = CURSOR_PRESETS.find((x) => x.id === selection)
  if (!p || p.id === 'system') return { normal: null, hover: null }
  return { normal: presetCss(p, accent), hover: presetHoverCss(p, accent) }
}

/** Lọc dữ liệu đọc từ localStorage — bỏ mục thiếu trường hoặc data URI không đúng dạng. */
export function isCustomCursor(x: unknown): x is CustomCursor {
  if (!x || typeof x !== 'object') return false
  const c = x as Record<string, unknown>
  const base =
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.dataUrl === 'string' &&
    PNG_DATA_RE.test(c.dataUrl) &&
    typeof c.hotX === 'number' &&
    typeof c.hotY === 'number' &&
    typeof c.width === 'number' &&
    typeof c.height === 'number'
  if (!base) return false
  // Ảnh hover là tuỳ chọn: có thì phải đủ bộ và đúng dạng, không thì bỏ qua
  if (c.hoverDataUrl === undefined) return true
  return (
    typeof c.hoverDataUrl === 'string' &&
    PNG_DATA_RE.test(c.hoverDataUrl) &&
    typeof c.hoverWidth === 'number' &&
    typeof c.hoverHeight === 'number'
  )
}

/** Lý do nhập file thất bại — dùng làm hậu tố khoá i18n `settings.cursorErr<Reason>`. */
export type CursorImportError = 'Animated' | 'Decode'

export interface ImportedCursor {
  dataUrl: string
  width: number
  height: number
  /** true = ảnh gốc lớn hơn 128px và đã bị thu nhỏ (cần báo cho user biết). */
  resized: boolean
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Decode'))
    img.src = src
  })
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Decode'))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

/**
 * Đọc file ảnh của user thành con trỏ dùng được: vẽ lại ra canvas rồi xuất PNG.
 *
 * Vẽ lại chứ không giữ nguyên file vì ba lý do: ép được trần 128px, chuẩn hoá mọi định dạng
 * (kể cả `.cur`/`.ico` mà Chromium giải mã được) về một dạng duy nhất, và loại bỏ hoàn toàn
 * nội dung lạ trong file SVG. PNG chứ không JPEG vì con trỏ bắt buộc phải có nền trong suốt.
 *
 * Ném `Error` với `message` là một `CursorImportError`.
 */
export async function importCursorFile(file: File): Promise<ImportedCursor> {
  if (/\.ani$/i.test(file.name)) throw new Error('Animated')

  const img = await decodeImage(await readAsDataUrl(file))
  // SVG không khai báo kích thước nội tại → naturalWidth = 0; chọn giùm cỡ con trỏ thường gặp
  const natW = img.naturalWidth || 32
  const natH = img.naturalHeight || 32
  const scale = Math.min(1, CURSOR_MAX_PX / Math.max(natW, natH))
  const width = Math.max(1, Math.round(natW * scale))
  const height = Math.max(1, Math.round(natH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Decode')
  ctx.drawImage(img, 0, 0, width, height)

  const dataUrl = canvas.toDataURL('image/png')
  if (!PNG_DATA_RE.test(dataUrl)) throw new Error('Decode')
  return { dataUrl, width, height, resized: scale < 1 }
}

/**
 * Id cho con trỏ mới. Dùng `Math.random` như `uid()` ở HostMapModal chứ không
 * `crypto.randomUUID` — hàm đó chỉ tồn tại trong secure context, mà bản đóng gói
 * nạp renderer từ `file://`; lỗi kiểu đó chỉ lộ ở app đã cài, không thấy khi `pnpm dev`.
 * Có thành phần thời gian vì id được lưu lâu dài trong localStorage.
 */
export function newCursorId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Tên gợi ý cho con trỏ mới: tên file bỏ phần đuôi, cắt cho gọn. */
export function cursorNameFromFile(name: string): string {
  return name.replace(/\.[^.]+$/, '').slice(0, 40) || 'cursor'
}
