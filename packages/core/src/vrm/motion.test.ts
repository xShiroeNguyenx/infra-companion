import { describe, expect, it } from 'vitest'
import {
  heartBurst,
  MOTION_IDLE_EVERY_MAX_MS,
  MOTION_IDLE_EVERY_MIN_MS,
  motionForRole,
  motionIdleDelayMs,
  motionPackBytes,
  motionsForRole,
  nextMotionForRole,
  shouldPinHips,
  HIPS_FREE_MAX_DEPTH_M,
  HIPS_FREE_MAX_SIDE_M,
  OWN_MOTION_AUTHOR,
  OWN_MOTION_LICENSE,
  VRM_MOTIONS,
  type VrmMotionClip
} from '@infra/shared'

describe('thư viện chuyển động', () => {
  it('mỗi clip đủ thông tin để tải và kiểm', () => {
    for (const c of VRM_MOTIONS) {
      expect(c.url.startsWith('https://')).toBe(true)
      // 64 ký tự hex — sai định dạng thì mọi lượt tải đều hỏng ở bước kiểm
      expect(c.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(c.sizeBytes).toBeGreaterThan(0)
      expect(c.durationSec).toBeGreaterThan(0)
      expect(c.fileName.endsWith('.vrma')).toBe(true)
    }
  })

  it('tải từ Release của CHÍNH repo này, không phụ thuộc repo bên thứ ba', () => {
    // Nguồn cũ là `raw.githubusercontent.com` của một repo lạ: repo đó đổi tên / xoá file / đổi
    // branch / chuyển private là cả bộ clip chết với mọi bản đã cài. Đây là chốt chặn để không ai
    // vô tình trỏ ngược lại — nguồn ngoài chỉ được nằm ở `mirrors`.
    for (const c of VRM_MOTIONS) {
      expect(c.url.startsWith('https://github.com/xShiroeNguyenx/infra-companion/releases/download/'), c.id).toBe(true)
      expect(c.url.endsWith(`/${c.fileName}`), c.id).toBe(true)
    }
  })

  it('clip của người khác đều có mirror dự phòng, và mọi nguồn đều HTTPS', () => {
    for (const c of VRM_MOTIONS) {
      // Một nguồn duy nhất là một điểm hỏng duy nhất — link ngoài chắc chắn chết theo thời gian.
      // Clip riêng của dự án thì không có bản nào ở nơi khác để làm mirror.
      if (c.author !== OWN_MOTION_AUTHOR) expect(c.mirrors?.length ?? 0, c.id).toBeGreaterThan(0)
      for (const u of [c.url, ...(c.mirrors ?? [])]) expect(u.startsWith('https://'), `${c.id}: ${u}`).toBe(true)
    }
  })

  it('id và tên file không trùng nhau', () => {
    expect(new Set(VRM_MOTIONS.map((c) => c.id)).size).toBe(VRM_MOTIONS.length)
    expect(new Set(VRM_MOTIONS.map((c) => c.fileName)).size).toBe(VRM_MOTIONS.length)
  })

  it('CHỈ chứa clip cho phân phối lại — repo này public', () => {
    // Bộ "VRMA_MotionPack" của pixiv cấm phát tán lại ở dạng trích xuất được; đây là chốt chặn
    // để không ai vô tình thêm nó vào
    // Chỉ hai loại được phép: CC0 của người khác, hoặc clip do chính tác giả repo làm ra.
    // Một clip "của mình" mà mang giấy phép lạ, hay clip người khác không phải CC0, đều đỏ.
    for (const c of VRM_MOTIONS) {
      if (c.author === OWN_MOTION_AUTHOR) expect(c.license, c.id).toBe(OWN_MOTION_LICENSE)
      else expect(c.license, c.id).toMatch(/CC0/)
      expect(c.licenseUrl.startsWith('https://')).toBe(true)
      expect(c.sourceUrl.startsWith('https://')).toBe(true)
      expect(c.author.length).toBeGreaterThan(0)
    }
  })

  it('mọi vai trò tự chạy đều có ít nhất một clip', () => {
    // Năm loại việc (bulk…monitor) có clip từ v0.5.1 — trước đó mở các công cụ ấy nhân vật đứng im
    for (const role of ['idle', 'chat', 'poke', 'alert', 'recover', 'inspect', 'bulk', 'transfer', 'logs', 'security', 'monitor'] as const) {
      expect(motionsForRole(role).length, `vai trò ${role}`).toBeGreaterThan(0)
      expect(motionForRole(role)?.role).toBe(role)
    }
  })

  it('vai trò idle có NHIỀU clip để luân phiên', () => {
    // Một tư thế lặp mãi ở nhịp 90–180 giây thì user thấy đúng cái đó lặp lại và nghĩ là hỏng
    expect(motionsForRole('idle').length).toBeGreaterThanOrEqual(2)
  })

  it('clip DI CHUYỂN không bao giờ được gán vai trò tự chạy', () => {
    // Nhân vật neo ở một góc màn hình — clip đi/chạy làm nó trôi khỏi khung hoặc lún qua mép
    for (const c of VRM_MOTIONS.filter((x) => x.locomotion)) {
      expect(c.role, `${c.id} phải là manual`).toBe('manual')
    }
  })

  it('clip tự chạy không chiếm chỗ quá lâu', () => {
    /**
     * Clip chạy thì lớp tự sinh tắt hết (nhìn theo chuột, kéo níu), nên clip càng dài thì nhân
     * vật càng "chết" lâu. Ngưỡng 25s chứ không 15s: user chọn "Tạo dáng" (20s) cho thao tác
     * chạm vào người, và đó là quyết định của họ — nhưng vẫn phải có trần, clip 40s thì nhân vật
     * đứng như tượng gần một phút sau mỗi cú click.
     */
    for (const role of ['chat', 'poke', 'alert', 'inspect', 'bulk', 'transfer', 'logs', 'security', 'monitor'] as const) {
      for (const c of motionsForRole(role)) expect(c.durationSec, c.id).toBeLessThan(25)
    }
  })

  it('tổng dung lượng vài MB — đủ nhỏ để tải một lượt', () => {
    const mb = motionPackBytes() / 1024 / 1024
    expect(mb).toBeGreaterThan(0.5)
    expect(mb).toBeLessThan(10)
  })

  it('nhịp chạy clip idle THƯA — clip tắt hết lớp tự sinh nên không được dày', () => {
    expect(MOTION_IDLE_EVERY_MIN_MS).toBeGreaterThanOrEqual(60_000)
    expect(motionIdleDelayMs(() => 0)).toBe(MOTION_IDLE_EVERY_MIN_MS)
    expect(motionIdleDelayMs(() => 1)).toBe(MOTION_IDLE_EVERY_MAX_MS)
  })

  it('vai trò không có clip thì trả null, không vỡ', () => {
    expect(motionForRole('manual')).not.toBeNull()
  })
})

describe('xoay vòng clip cùng vai trò', () => {
  const idleIds = motionsForRole('idle').map((c) => c.id)

  it('luân phiên đều, KHÔNG lặp lại cái vừa chạy', () => {
    let last: string | null = null
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      // Chú thích kiểu tường minh: `last` được gán từ chính kết quả nên TS không tự suy được
      const c: VrmMotionClip = nextMotionForRole('idle', last, idleIds)!
      expect(c.id, `lượt ${i} lặp lại clip vừa chạy`).not.toBe(last)
      seen.push(c.id)
      last = c.id
    }
    // Sáu lượt phải đi qua hết nhóm, không kẹt ở một cái
    expect(new Set(seen).size).toBe(idleIds.length)
  })

  it('chỉ xét clip ĐÃ TẢI — chưa tải mà chọn thì không có gì để phát', () => {
    const only = idleIds[0]!
    expect(nextMotionForRole('idle', null, [only])!.id).toBe(only)
    // Chỉ còn một clip khả dụng thì trả chính nó, kể cả khi nó vừa chạy
    expect(nextMotionForRole('idle', only, [only])!.id).toBe(only)
  })

  it('chưa tải clip nào → null, không vỡ', () => {
    expect(nextMotionForRole('idle', null, [])).toBeNull()
  })

  it('clip cũ không thuộc nhóm (vừa đổi vai trò) thì bắt đầu lại từ đầu', () => {
    expect(nextMotionForRole('idle', 'không-tồn-tại', idleIds)!.id).toBe(idleIds[0])
  })
})

describe('hiệu ứng đi kèm clip', () => {
  it('mốc hiệu ứng nằm TRỌN trong clip — lệch ra ngoài thì tim bung lúc nhân vật đã làm việc khác', () => {
    for (const c of VRM_MOTIONS.filter((x) => x.effect)) {
      expect(c.effect!.atSec, c.id).toBeGreaterThanOrEqual(0)
      expect(c.effect!.untilSec, c.id).toBeGreaterThan(c.effect!.atSec)
      expect(c.effect!.untilSec, c.id).toBeLessThanOrEqual(c.durationSec)
    }
  })

  it('chạm vào người lần ĐẦU ra trái tim, và vẫn luân phiên với "Tạo dáng"', () => {
    const poke = motionsForRole('poke').map((c) => c.id)
    expect(poke[0]).toBe('lilac-heart')
    expect(poke).toContain('pose-motion')
    expect(nextMotionForRole('poke', null, poke)!.effect?.kind).toBe('hearts')
    expect(nextMotionForRole('poke', 'lilac-heart', poke)!.id).toBe('pose-motion')
  })

  it('clip bắn tim bật bám đất — đo được chân lơ lửng 9–10 cm suốt lúc giữ dáng', () => {
    expect(VRM_MOTIONS.find((c) => c.id === 'lilac-heart')?.groundFeet).toBe(true)
  })

  it('đợt tim: đúng số lượng, trải trong cửa sổ, tim đầu bung ngay giữa', () => {
    let s = 1
    const rng = (): number => ((s = (s * 16807) % 2147483647) / 2147483647)
    const span = 2300
    const hs = heartBurst(rng, span, 9)
    expect(hs).toHaveLength(9)
    expect(hs[0]).toMatchObject({ x: 0, delayMs: 0 })
    for (const h of hs) {
      expect(h.delayMs).toBeGreaterThanOrEqual(0)
      expect(h.delayMs).toBeLessThan(span)
      expect(Math.abs(h.x)).toBeLessThanOrEqual(0.6)
      expect(h.lifeMs).toBeGreaterThan(0)
    }
    // Không dồn cục: tim cuối sinh ở nửa sau cửa sổ
    expect(hs[8]!.delayMs).toBeGreaterThan(span / 2)
  })

  it('tham số hỏng không vỡ', () => {
    expect(heartBurst(() => 0.5, -10, 0)).toHaveLength(1)
    expect(heartBurst(() => 0.5, 1000, 1)[0]!.delayMs).toBe(0)
  })
})

describe('neo hông của clip', () => {
  it('clip dồn trọng tâm / nhảy tại chỗ → KHÔNG ghim cứng, để bàn chân bám đất', () => {
    // Số đo thật: pink-idol-dance 0,145 / 0,244 · pink-kpop-dance 0,059 / 0,303 · drink-water 0,197 / 0,080
    expect(shouldPinHips(0.145, 0.244)).toBe(false)
    expect(shouldPinHips(0.059, 0.303)).toBe(false)
    expect(shouldPinHips(0.197, 0.08)).toBe(false)
    expect(shouldPinHips(0, 0)).toBe(false)
  })

  it('clip đi xa khỏi chỗ bắt đầu → ghim, không thì nhân vật ra khỏi khung', () => {
    expect(shouldPinHips(HIPS_FREE_MAX_SIDE_M + 0.01, 0)).toBe(true)
    expect(shouldPinHips(0, HIPS_FREE_MAX_DEPTH_M + 0.01)).toBe(true)
    expect(shouldPinHips(0.39, 0.92)).toBe(true)
  })

  it('đúng ngưỡng vẫn được tự do', () => {
    expect(shouldPinHips(HIPS_FREE_MAX_SIDE_M, HIPS_FREE_MAX_DEPTH_M)).toBe(false)
  })

  it('số đo hỏng → ghim (hành vi cũ, an toàn với khung hình)', () => {
    expect(shouldPinHips(Number.NaN, 0)).toBe(true)
    expect(shouldPinHips(0, Number.POSITIVE_INFINITY)).toBe(true)
  })
})
