import { describe, expect, it } from 'vitest'
import { pickVrmaNames, VRMA_DIR_MAX_FILES } from '@infra/shared'

/**
 * Nạp CẢ THƯ MỤC `.vrma` — user tự tải bộ chuyển động về rồi app đọc từ máy họ.
 *
 * Đường này tồn tại vì bộ chính thức của pixiv **cấm phân phối lại** ở dạng trích xuất được
 * (`packages/shared/src/vrmMotion.ts` ghi nguyên văn điều khoản), nên app không được đóng kèm
 * hay tải hộ — chỉ được nạp từ thư mục user chỉ vào.
 */
describe('pickVrmaNames — lọc file .vrma trong thư mục', () => {
  it('chỉ lấy .vrma, bỏ mọi thứ khác', () => {
    const got = pickVrmaNames(['a.vrma', 'readme.txt', 'b.vrm', 'c.vrma', 'model.glb', 'notes.md'])
    expect(got).toEqual(['a.vrma', 'c.vrma'])
  })

  it('KHÔNG phân biệt hoa thường — Windows hay cho ra đuôi .VRMA', () => {
    // So đuôi trần thì mấy file này biến mất lặng lẽ, user nhìn vào thư mục thấy rõ ràng là có
    // mà app báo "không có file .vrma nào"
    expect(pickVrmaNames(['A.VRMA', 'b.Vrma', 'c.vrma'])).toEqual(['A.VRMA', 'b.Vrma', 'c.vrma'])
  })

  it('xếp theo tên để bộ đánh số ra đúng thứ tự người đọc mong đợi', () => {
    const got = pickVrmaNames(['VRMA_03.vrma', 'VRMA_01.vrma', 'VRMA_02.vrma'])
    expect(got).toEqual(['VRMA_01.vrma', 'VRMA_02.vrma', 'VRMA_03.vrma'])
  })

  it('thư mục không có clip nào → mảng rỗng, không ném lỗi', () => {
    expect(pickVrmaNames(['readme.txt', 'thumb.png'])).toEqual([])
    expect(pickVrmaNames([])).toEqual([])
  })

  it('tên chứa ".vrma" ở GIỮA không tính — phải là đuôi', () => {
    expect(pickVrmaNames(['my.vrma.backup', 'real.vrma'])).toEqual(['real.vrma'])
  })

  it('đúng bộ 7 file của VRoid Project ra đủ 7, đúng thứ tự', () => {
    const pack = Array.from({ length: 7 }, (_, i) => `VRMA_0${i + 1}.vrma`)
    // Đảo lộn đầu vào: thư mục trả về theo thứ tự nào là chuyện của hệ điều hành
    const got = pickVrmaNames([...pack].reverse())
    expect(got).toEqual(pack)
  })

  it('trần số file đủ rộng cho bộ thật nhưng vẫn chặn được thư mục nhầm', () => {
    // Bộ chính thức 7 file; bộ sưu tầm vài chục. Trần chỉ để chặn ca trỏ nhầm vào ổ đĩa.
    expect(VRMA_DIR_MAX_FILES).toBeGreaterThanOrEqual(20)
    expect(VRMA_DIR_MAX_FILES).toBeLessThanOrEqual(200)
  })
})
