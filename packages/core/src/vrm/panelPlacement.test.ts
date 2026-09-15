import { describe, expect, it } from 'vitest'
import {
  characterSlotInSettings,
  placeVrmPanel,
  settingsFrameBox,
  VRM_WIDTH_MARGIN,
  VRM_ZOOM_MAX,
  VRM_ZOOM_MAX_IN_SETTINGS,
  vrmBodyRect,
  vrmLeftBesideDock,
  vrmSideMargin
} from '@infra/shared'

/**
 * Bảng cài đặt nổi cạnh nhân vật phải LUÔN nằm trọn trong màn hình.
 *
 * Lỗi thật đã gặp: nhân vật đứng sát đáy, bảng mở xuống dưới nên nửa dưới lọt ra ngoài và mất hẳn
 * các nút ở đó — user chụp được. Loại lỗi này chỉ lộ ở đúng độ phân giải và đúng vị trí, nên chặn
 * bằng test thay vì nhìn một lần rồi tin.
 */
const fits = (anchorTop: number, h: number): boolean => {
  const p = placeVrmPanel(anchorTop, h)
  return p.top >= 0 && p.top + p.maxHeight <= h
}

describe('chỗ đặt bảng cài đặt nhân vật', () => {
  it('nhân vật sát ĐÁY màn hình — ca user gặp: bảng mở LÊN, không tràn', () => {
    const p = placeVrmPanel(1040, 1080)
    expect(p.openDown).toBe(false)
    expect(p.top).toBeGreaterThanOrEqual(0)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(1080)
  })

  it('nhân vật sát ĐỈNH: mở xuống', () => {
    expect(placeVrmPanel(20, 1080).openDown).toBe(true)
  })

  it('không tràn ở MỌI vị trí trên nhiều cỡ màn hình', () => {
    for (const h of [600, 720, 768, 900, 1080, 1440, 2160]) {
      for (let y = 0; y <= h; y += 20) {
        expect(fits(y, h), `anchorTop=${y} viewport=${h}`).toBe(true)
      }
    }
  })

  it('luôn còn chiều cao dùng được, kể cả màn hình rất thấp', () => {
    // Dưới ngưỡng này thì bảng thành một khe không đọc được gì
    for (const h of [480, 600, 768]) {
      expect(placeVrmPanel(h - 10, h).maxHeight).toBeGreaterThanOrEqual(160)
    }
  })

  it('chọn bên RỘNG hơn khi cả hai đều chật', () => {
    // Nhân vật hơi dưới giữa màn hình thấp → phía trên rộng hơn
    const p = placeVrmPanel(500, 700)
    expect(p.openDown).toBe(false)
  })

  it('giá trị luôn là số hữu hạn, không NaN', () => {
    for (const [y, h] of [
      [0, 0],
      [100, 0],
      [0, 100]
    ]) {
      const p = placeVrmPanel(y!, h!)
      expect(Number.isFinite(p.top) && Number.isFinite(p.maxHeight)).toBe(true)
    }
  })
})

describe('khung cài đặt hai cột + chỗ đứng nhân vật', () => {
  const VW = 1920
  const VH = 1080

  it('khung nằm giữa màn hình và không tràn', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [1024, 600]
    ]) {
      const b = settingsFrameBox(w!, h!, 264)
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.left + b.width, `${w}×${h} tràn ngang`).toBeLessThanOrEqual(w!)
      expect(b.top + b.height, `${w}×${h} tràn dọc`).toBeLessThanOrEqual(h!)
    }
  })

  it('KHÔNG co theo bề ngang thẻ — thẻ rộng gấp VRM_WIDTH_MARGIN lần người, co theo nó là co người vô cớ', () => {
    // Ca thật: model đo ra tỉ lệ 2,2 → thẻ 677px ở cỡ 65%. Bản cũ co theo khe 352 → người còn
    // 150px, và kéo thanh cỡ KHÔNG đổi gì (chiều cao hiển thị = khe ÷ tỉ lệ, H triệt tiêu).
    // 1161 = thẻ rộng hơn cả khung 880: vẫn không co, phần tràn là lề trong suốt.
    for (const cw of [150, 264, 380, 450, 677, 1161]) {
      const b = settingsFrameBox(VW, VH, cw)
      expect(characterSlotInSettings(b, cw, 440).scale, `thẻ ${cw} bị co theo bề ngang`).toBe(1)
    }
  })

  it('chiều cao hiển thị ĐỔI theo cỡ, kể cả với thẻ rộng bất thường', () => {
    // Đúng triệu chứng user thấy: kéo thanh cỡ mà người vẫn y nguyên
    const at = (zoom: number): number => {
      const h = Math.round(440 * zoom)
      const w = Math.round(h * 2.2)
      return h * characterSlotInSettings(settingsFrameBox(VW, VH, w), w, h).scale
    }
    expect(at(1.2) - at(0.65)).toBeGreaterThan(100)
  })

  it('nhân vật đứng TRỌN trong lòng khung, thân người nằm trong KHE', () => {
    // Lỗi cũ: neo `bottom` theo màn hình nên nửa dưới nhân vật nằm ngoài khung (user chụp được)
    for (const [cw, ch] of [
      [264, 440],
      [380, 620],
      [200, 330],
      [475, 528]
    ]) {
      const b = settingsFrameBox(VW, VH, cw!)
      const s = characterSlotInSettings(b, cw!, ch!)
      /**
       * Hình SAU KHI co, với `transform-origin: bottom center`: đáy đứng yên ở `top + ch`, tâm
       * ngang đứng yên ở `left + cw/2`; đỉnh tụt xuống và hai mép co vào đúng phần mất đi. Tính
       * nhầm chỗ này bằng kích thước ĐÃ co làm nhân vật thò đáy 22px và lệch phải 62px — đo được
       * bằng ảnh render thật; `left`/`top` phải theo kích thước GỐC.
       */
      const bottom = s.top + ch!
      const top = bottom - ch! * s.scale
      const center = s.left + cw! / 2
      // Thân người nhìn thấy = thẻ ÷ VRM_WIDTH_MARGIN, ở giữa thẻ; phần còn lại là lề trong suốt
      const bodyW = (cw! / VRM_WIDTH_MARGIN) * s.scale
      const gapLeft = b.left + b.width / 2 - b.gap / 2
      expect(center - bodyW / 2, `${cw}×${ch} thân tràn khe trái`).toBeGreaterThanOrEqual(gapLeft - 1)
      expect(center + bodyW / 2, `${cw}×${ch} thân tràn khe phải`).toBeLessThanOrEqual(gapLeft + b.gap + 1)
      // Không đè lên hàng tiêu đề (có nút đóng)
      expect(top, `${cw}×${ch} đè tiêu đề`).toBeGreaterThanOrEqual(b.bodyTop)
      expect(bottom, `${cw}×${ch} thò đáy`).toBeLessThanOrEqual(b.top + b.height)
    }
  })

  it('tâm ngang nhân vật TRÙNG tâm khung, kể cả khi bị co', () => {
    // Ca harness ảnh thật: model bề ngang lớn → scale 0,74. Bản lỗi tính `left` theo bề ngang đã
    // co nên tâm lệch phải 62px, cột chữ phải đè lên người
    const b = settingsFrameBox(VW, VH, 475)
    const s = characterSlotInSettings(b, 475, 528)
    expect(s.scale).toBeLessThan(1)
    // transform-origin bottom center → tâm layout của thẻ gốc chính là tâm hình sau co.
    // Dung sai 1px: `left` làm tròn số nguyên (≤0,5) + bề ngang lẻ chia đôi (0,5)
    expect(Math.abs(s.left + 475 / 2 - (b.left + b.width / 2))).toBeLessThanOrEqual(1)
  })

  it('nhân vật cao quá thì THU NHỎ, không bị cắt', () => {
    const b = settingsFrameBox(VW, VH, 380)
    expect(characterSlotInSettings(b, 380, 620).scale).toBeLessThan(1)
    // Vừa khung thì giữ nguyên cỡ, đừng thu nhỏ vô cớ
    expect(characterSlotInSettings(b, 264, 440).scale).toBe(1)
  })

  it('giá trị luôn hữu hạn ở màn hình rất nhỏ', () => {
    const b = settingsFrameBox(400, 300, 264)
    const s = characterSlotInSettings(b, 264, 440)
    expect(Number.isFinite(s.left) && Number.isFinite(s.top) && Number.isFinite(s.scale)).toBe(true)
  })

  it('trần cỡ trong cài đặt THẤP hơn trần chung', () => {
    // Khe giữa hẹp; để trần 300% thì nhân vật phải thu còn 0,37× — thanh trượt nói 300% mà nhìn
    // như 110%, tức con số nói dối
    expect(VRM_ZOOM_MAX_IN_SETTINGS).toBeLessThan(VRM_ZOOM_MAX)
    expect(VRM_ZOOM_MAX_IN_SETTINGS).toBeGreaterThanOrEqual(1)
  })

  it('ở trần cỡ trong cài đặt, nhân vật gần như KHÔNG phải thu nhỏ', () => {
    // Thu nhẹ (≥0,9) thì con số trên thanh trượt còn gần đúng; thu sâu hơn là nói dối
    const h = Math.round(440 * VRM_ZOOM_MAX_IN_SETTINGS)
    const w = Math.round(h * 0.6)
    const s = characterSlotInSettings(settingsFrameBox(1920, 1080, w), w, h)
    expect(s.scale).toBeGreaterThanOrEqual(0.9)
  })
})

describe('vrmBodyRect — quy vùng thẻ về vùng thân người', () => {
  it('bề ngang chia cho VRM_WIDTH_MARGIN, thân nằm GIỮA thẻ', () => {
    const body = vrmBodyRect({ left: 100, top: 50, width: 330, height: 440 })
    expect(body.width).toBeCloseTo(330 / VRM_WIDTH_MARGIN, 6)
    // Lề chia đều hai bên: tâm thẻ và tâm thân trùng nhau
    expect(body.left + body.width / 2).toBeCloseTo(100 + 330 / 2, 6)
  })

  it('KHÔNG đụng tới chiều cao — lề chỉ chừa hai bên', () => {
    const body = vrmBodyRect({ left: 0, top: 77, width: 330, height: 440 })
    expect(body.top).toBe(77)
    expect(body.height).toBe(440)
  })

  it('giữ nguyên tâm dù thẻ đứng ở đâu — kéo nhân vật đi không làm lệch', () => {
    // Đúng ca user gặp: kéo nhân vật một đoạn rồi mở bảng. Tâm thân phải đi theo tâm thẻ,
    // không được lệch thêm một khoảng cố định nào.
    for (const left of [0, 250, 900, 1600]) {
      const body = vrmBodyRect({ left, top: 0, width: 330, height: 440 })
      expect(body.left + body.width / 2, `left=${left}`).toBeCloseTo(left + 165, 6)
    }
  })

  it('hai cột bám thân KHÔNG hở khoảng trống vô hình', () => {
    // Đây là chốt chặn cho lỗi thật: hai cột của VrmSidePanel đặt tại hai mép vùng trả về.
    // Dùng thẳng vùng THẺ thì chúng cách nhau 330px trong khi người chỉ 150px — hở 180px.
    const card = { left: 500, top: 60, width: 330, height: 440 }
    const body = vrmBodyRect(card)
    const hoTruoc = card.width - body.width
    expect(hoTruoc).toBeGreaterThan(150) // bug cũ: hở hơn 150px
    expect(body.width).toBeCloseTo(150, 0) // sau khi sửa: bám đúng 150px thân người
  })
})

describe('vrmSideMargin / vrmLeftBesideDock — nhân vật đứng sát cột dock AI', () => {
  // Model user đang dùng, đã đo thật: aspect 1,7875 ở zoom 0,55 → H=242, thẻ 433px
  const CARD = 433
  const BODY = CARD / VRM_WIDTH_MARGIN

  it('lề mỗi bên = nửa phần thẻ dôi ra ngoài thân người', () => {
    expect(vrmSideMargin(CARD)).toBe(118)
    // Cộng lại ra đúng bề ngang thẻ (sai lệch < 1px vì `vrmSideMargin` làm tròn)
    expect(Math.abs(vrmSideMargin(CARD) * 2 + BODY - CARD)).toBeLessThan(1)
  })

  it('dock đóng thì giữ NGUYÊN chỗ user đã kéo', () => {
    expect(vrmLeftBesideDock(700, CARD, 0, 1903)).toBe(700)
  })

  it('mở dock → HÚT SÁT cột chat, thân người chạm hẳn mép', () => {
    // Đúng ca user chụp: cửa sổ 1903px, dock AI ~383px
    const left = vrmLeftBesideDock(1528, CARD, 383, 1903)
    const bodyRight = left + vrmSideMargin(CARD) + BODY
    expect(Math.abs(bodyRight - (1903 - 383))).toBeLessThan(1) // chạm hẳn, gap = 0
  })

  it('HÚT SÁT kể cả khi user để nhân vật ở xa — đây là dời tới, không phải chỉ chặn', () => {
    /**
     * Bản trước dùng `Math.min` nên chỉ kẹp khi nhân vật lấn vào dock; user để nó ở giữa màn
     * hình thì không lấn gì cả và nó đứng nguyên đó, cách cột chat rất xa — user chụp được và
     * nói "vẫn chưa sát". Nay mọi vị trí đều bị hút về cạnh cột.
     */
    const xa = vrmLeftBesideDock(50, CARD, 383, 1903)
    const gan = vrmLeftBesideDock(1528, CARD, 383, 1903)
    expect(xa).toBe(gan)
    expect(xa).toBeGreaterThan(50)
  })

  it('không phụ thuộc bề ngang một model cụ thể', () => {
    for (const card of [240, 433, 581, 800]) {
      const left = vrmLeftBesideDock(5000, card, 300, 1600)
      const bodyRight = left + vrmSideMargin(card) + card / VRM_WIDTH_MARGIN
      expect(Math.abs(bodyRight - (1600 - 300)), `thẻ=${card}`).toBeLessThan(1)
    }
  })

  it('cửa sổ hẹp + dock rộng: không đẩy nhân vật ra ngoài mép trái', () => {
    expect(vrmLeftBesideDock(200, 800, 700, 900)).toBeGreaterThanOrEqual(0)
  })
})

