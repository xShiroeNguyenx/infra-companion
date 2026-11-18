import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import {
  nextStrollTarget,
  stepToward,
  STROLL_HOME_CLIP,
  strollWalkClip,
  STROLL_IDLE_AFTER_MS,
  STROLL_DIAGONAL_LEGS,
  STROLL_DIAGONAL_RAD,
  STROLL_MAX_SCALE,
  strollDepthScale,
  strollFacing,
  strollMaxOffset,
  strollPauseMs,
  strollRange,
  strollRestMs,
  strollSpeed
} from '@infra/shared'
import type { VrmMotionApi } from './useVrmMotion'
import type { VrmStage } from './vrmStage'

/**
 * Nhân vật đi dạo lúc user rảnh — "cách A": clip `walk` chạy tại chỗ, khung trượt ngang VÀ phóng
 * to dần (thuộc tính CSS `scale`) để diễn đường đi chéo 45° về phía người xem; chặng về thì ngược
 * lại. Hình học ở `strollDepthScale` / `strollMaxOffset` (`vrmStroll.ts`).
 *
 * Trượt bằng thuộc tính CSS **`translate`** (không phải `transform`): React không bao giờ ghi
 * thuộc tính này, nên ghi thẳng vào DOM mỗi frame không bị lượt render kế tiếp xoá mất, và nó
 * cộng dồn với `transform: scale()` của chế độ cài đặt thay vì đè lên. `getBoundingClientRect()`
 * tính cả `translate`, nên bong bóng thoại, menu và hit-test vẫn bám đúng chỗ người đang đứng.
 *
 * ⚠️ `translate` (như `transform`) biến khung thành **khối chứa của mọi con `position: fixed`**.
 * Lớp nổi nào nằm TRONG khung sẽ bị dời thêm đúng vị trí khung — tính hai lần — và văng ra ngoài
 * màn hình. Độ dời lại ở lại sau khi dừng, nên lỗi kéo dài tới lượt đi kế tiếp: đã dính thật
 * ("đi dạo xong chuột phải không mở menu"). Vì vậy `VrmPanel` render mọi lớp nổi làm ANH EM của
 * khung, đừng đưa chúng vào lại bên trong.
 *
 * Chỉ dời khung, không đụng `left`/`right`: không đổi kích thước → `ResizeObserver` không gọi
 * `stage.resize()`, camera không căn lại, và compositor tự làm mà không tính lại layout.
 */
export function useVrmStroll(opts: {
  stage: VrmStage | null
  motion: VrmMotionApi
  panelRef: RefObject<HTMLDivElement | null>
  /** Bật đi dạo lúc này. Tắt (mở cài đặt, mở dock, đổi model…) là nhân vật về ngay chỗ gốc. */
  enabled: boolean
  /** Có bảng/menu/bong bóng nào đang mở — đọc mỗi frame, nên là ref. */
  busyRef: MutableRefObject<boolean>
  /** Góc xoay user đã chọn (Shift+kéo) — đi xong thì quay mặt về góc này. */
  restRotationRef: MutableRefObject<number>
  /** Lề trong suốt mỗi bên thẻ (`vrmSideMargin`) — giới hạn đi theo thân người, không theo thẻ. */
  sideMargin: number
  /** Vị trí kéo tay — đổi là bỏ offset (xem effect cuối). */
  pos: { x: number; y: number } | null
}): MutableRefObject<boolean> {
  const { stage, panelRef, enabled, busyRef, restRotationRef, pos } = opts
  /** Đang trong một chặng đi — cho nơi khác (lịch clip idle) biết mà nhường. */
  const strolling = useRef(false)
  /** Độ dời hiện tại (px). Sống ngoài effect: zoom đổi `sideMargin` không được kéo người về gốc. */
  const offset = useRef(0)
  const motionRef = useRef(opts.motion)
  motionRef.current = opts.motion
  const marginRef = useRef(opts.sideMargin)
  marginRef.current = opts.sideMargin
  const hasWalk = strollWalkClip(opts.motion.installed) !== null

  useEffect(() => {
    const panel = panelRef.current
    if (!enabled || !stage || !hasWalk || !panel) return

    let alive = true
    let timer = 0
    let raf = 0
    let legsLeft = 0
    let lastInput = performance.now()
    /** Góc đang hiển thị — để quay mượt từ đó sang góc mới thay vì giật. */
    let rot = restRotationRef.current

    /** Độ phóng đang áp lên thẻ — `getBoundingClientRect()` đã gồm nó, nên phải nhớ để chia ra. */
    let scale = 1
    /**
     * Trần độ phóng của LƯỢT này: không quá `STROLL_MAX_SCALE`, và không để đỉnh đầu vượt mép trên
     * cửa sổ (thẻ neo ở bàn chân nên to ra là cao lên).
     */
    let maxScale = STROLL_MAX_SCALE
    const apply = (): void => {
      scale = offset.current === 0 ? 1 : strollDepthScale(offset.current, stage.pxPerMeter(), maxScale)
      panel.style.translate = offset.current === 0 ? '' : `${offset.current}px 0`
      // `scale` (như `translate`) là thuộc tính React không bao giờ ghi → ghi thẳng mỗi frame an toàn
      panel.style.scale = scale === 1 ? '' : String(scale)
      panel.style.transformOrigin = scale === 1 ? '' : 'bottom center'
    }
    /** Hộp của thẻ lúc ở chỗ gốc, cỡ 1 — bóc cả độ dời lẫn độ phóng (neo đáy-giữa) ra khỏi rect. */
    const homeRect = (): { left: number; width: number; top: number; bottom: number; height: number } => {
      const r = panel.getBoundingClientRect()
      const width = r.width / scale
      const height = r.height / scale
      return { left: r.left - offset.current + (r.width - width) / 2, width, top: r.bottom - height, bottom: r.bottom, height }
    }
    const range = (): { min: number; max: number } => {
      const h = homeRect()
      // Lề rộng hơn (16 → 60px): ở cuối chặng thân người đã to ra, mép ngoài lấn thêm vài chục px
      const edge = strollRange({ left: h.left, width: h.width }, window.innerWidth, marginRef.current, 60)
      // Và không trượt quá chỗ độ phóng chạm trần — xem `strollMaxOffset`
      const far = strollMaxOffset(stage.pxPerMeter(), maxScale)
      return { min: Math.max(edge.min, -far), max: Math.min(edge.max, far) }
    }
    const clampToRange = (): void => {
      const { min, max } = range()
      offset.current = Math.min(max, Math.max(min, offset.current))
      apply()
    }
    const schedule = (ms: number): void => {
      clearTimeout(timer)
      timer = window.setTimeout(tryStart, ms)
    }

    /** Quay mượt sang góc `to` trong `ms`, gọi `done` khi xong. Dùng chung rAF với chặng đi. */
    let turn: { from: number; to: number; t0: number; ms: number } | null = null
    const ease = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)

    /** `home` = chặng chạy về sau cảnh báo — không dừng vì user thao tác, xem `onInput`. */
    let leg: { target: number; speedM: number; home: boolean } | null = null
    /** Có cảnh báo lúc đang lệch chỗ gốc → chờ diễn xong thì chạy về. */
    let pendingHome = false
    let lastT = 0

    const endLeg = (arrived: boolean): void => {
      const wasHome = leg?.home === true
      leg = null
      if (wasHome && arrived) pendingHome = false
      strolling.current = false
      // Chỉ dừng clip nếu nó còn là lượt đi bộ của mình — cảnh báo đã chen vào thì để nó diễn
      if (motionRef.current.isWalking()) void motionRef.current.walk(false)
      // Đứng lại thì quay mặt ra như cũ
      turn = { from: rot, to: restRotationRef.current, t0: performance.now(), ms: 450 }
      cancelAnimationFrame(raf)
      lastT = 0
      raf = requestAnimationFrame(frame)
      if (arrived) legsLeft = offset.current === 0 || wasHome ? 0 : legsLeft - 1
      else legsLeft = 0
      schedule(legsLeft > 0 ? strollPauseMs(Math.random) : arrived ? strollRestMs(Math.random) : STROLL_IDLE_AFTER_MS)
    }

    const frame = (t: number): void => {
      if (!alive) return
      const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0
      lastT = t
      if (leg && (!motionRef.current.isWalking() || busyRef.current)) {
        // Có ai chen ngang (chạm, cảnh báo, mở chat) → đứng lại ngay tại chỗ
        endLeg(false)
        return
      }
      if (turn) {
        const k = Math.min(1, (t - turn.t0) / turn.ms)
        rot = turn.from + (turn.to - turn.from) * ease(k)
        stage.setRotationY(rot)
        if (k >= 1) turn = null
      } else if (leg) {
        // Đi chéo: chỉ thành phần NGANG của bước chân thành độ trượt; và 1 mét trên màn hình dài
        // hơn đúng bằng độ phóng hiện tại
        const px = leg.speedM * Math.cos(STROLL_DIAGONAL_RAD) * stage.pxPerMeter() * scale
        const r = stepToward(offset.current, leg.target, px, dt)
        offset.current = r.offset
        apply()
        if (r.arrived) {
          endLeg(true)
          return
        }
      }
      if (turn || leg) raf = requestAnimationFrame(frame)
    }

    const startLeg = async (home = false): Promise<void> => {
      if (offset.current === 0) {
        // Đầu lượt: chốt trần độ phóng theo chỗ trống phía trên đầu (chừa 8px)
        const h = homeRect()
        maxScale = Math.max(1, Math.min(STROLL_MAX_SCALE, (h.bottom - 8) / Math.max(1, h.height)))
      }
      clampToRange()
      const r0 = range()
      // Khoảng đi ngắn (zoom nhỏ) thì hạ ngưỡng "đủ xa để đáng đi" theo, không thì không bao giờ đi
      const minDist = Math.min(160, 0.6 * Math.max(-r0.min, r0.max))
      const target = home ? 0 : nextStrollTarget(Math.random, offset.current, r0, legsLeft, minDist)
      if (target === null) {
        legsLeft = 0
        schedule(strollRestMs(Math.random))
        return
      }
      strolling.current = true
      // Chạy về bằng clip chạy; máy chưa có clip chạy thì đi về bằng clip đi
      const run = home && motionRef.current.installed.includes(STROLL_HOME_CLIP)
      const walkClip = strollWalkClip(motionRef.current.installed) ?? 'walk'
      // Luôn tốc độ GỐC của clip (tham số thứ hai = 1) — không còn cài đặt nhịp đi
      // Không truyền dáng đi: clip phát nguyên bản, không chỉnh gì lên động tác
      const measured = await motionRef.current.walk(true, 1, run ? STROLL_HOME_CLIP : walkClip)
      if (!alive) return
      if (!motionRef.current.isWalking()) {
        // Không bật được (clip khác đang chạy, file lỗi) — thử lại sau, đừng trượt khung khi chân đứng im
        strolling.current = false
        schedule(10_000)
        return
      }
      const dir = target > offset.current ? 1 : -1
      // Rời chỗ gốc = tiến lại gần người xem (mặt hướng ra); về gốc = quay lưng đi vào trong
      const approaching = Math.abs(target) > Math.abs(offset.current)
      // Trượt đúng tốc độ bước chân đo từ clip
      leg = { target, speedM: strollSpeed(measured), home }
      // Bước tại chỗ trong lúc quay người, rồi mới tiến — giống người thật đổi hướng
      turn = { from: rot, to: strollFacing(dir, approaching), t0: performance.now(), ms: approaching ? 350 : 600 }
      cancelAnimationFrame(raf)
      lastT = 0
      raf = requestAnimationFrame(frame)
    }

    function tryStart(): void {
      if (!alive) return
      const quiet = performance.now() - lastInput
      if (quiet < STROLL_IDLE_AFTER_MS) {
        schedule(STROLL_IDLE_AFTER_MS - quiet + 50)
        return
      }
      // Cửa sổ ẩn/ở khay: rAF đứng nên khung không trượt được — đừng bật clip đi vô ích
      if (document.hidden || busyRef.current || motionRef.current.playing !== null) {
        schedule(5_000)
        return
      }
      if (legsLeft <= 0) legsLeft = STROLL_DIAGONAL_LEGS
      void startLeg()
    }

    /** User thao tác = hết rảnh: đang đi thì đứng lại tại chỗ (không chạy về gốc giữa lúc họ làm việc). */
    const onInput = (): void => {
      lastInput = performance.now()
      // Chạy về sau cảnh báo thì để chạy nốt — vài giây, và là lúc user đang nhìn sang
      if (leg && !leg.home) endLeg(false)
    }
    /**
     * Canh cảnh báo. Thăm dò 2 lần/giây thay vì nối sự kiện: `useVrmMotion` đã giữ sẵn vai trò
     * đang chạy, đọc nó rẻ hơn dựng thêm một kênh báo riêng chỉ cho chỗ này.
     */
    const watch = window.setInterval(() => {
      if (!alive) return
      if (motionRef.current.currentRole() === 'alert' && offset.current !== 0) pendingHome = true
      if (offset.current === 0) pendingHome = false
      if (!pendingHome || leg || strolling.current) return
      // Đợi diễn xong (hết clip) và không còn gì mở (bong bóng cảnh báo tự tắt sau vài giây)
      if (document.hidden || busyRef.current || motionRef.current.playing !== null) return
      clearTimeout(timer)
      legsLeft = 0
      void startLeg(true)
    }, 500)
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const
    for (const e of events) window.addEventListener(e, onInput, { capture: true, passive: true })
    window.addEventListener('resize', clampToRange)
    clampToRange()
    schedule(STROLL_IDLE_AFTER_MS)

    return () => {
      alive = false
      clearTimeout(timer)
      clearInterval(watch)
      cancelAnimationFrame(raf)
      for (const e of events) window.removeEventListener(e, onInput, { capture: true })
      window.removeEventListener('resize', clampToRange)
      if (motionRef.current.isWalking()) void motionRef.current.walk(false)
      strolling.current = false
      // Tắt (mở cài đặt, mở dock…) → về ngay chỗ gốc và quay mặt như cũ
      offset.current = 0
      apply()
      stage.setRotationY(restRotationRef.current)
    }
  }, [enabled, stage, hasWalk, panelRef, busyRef, restRotationRef])

  /**
   * Kéo tay (Ctrl+kéo) đo vị trí từ `getBoundingClientRect()` — tức ĐÃ gồm độ dời. Giữ độ dời thì
   * nó bị cộng hai lần và nhân vật nhảy đi. Bỏ ngay trước khi vẽ (`useLayoutEffect`).
   */
  useLayoutEffect(() => {
    if (offset.current === 0) return
    offset.current = 0
    if (panelRef.current) {
      panelRef.current.style.translate = ''
      panelRef.current.style.scale = ''
      panelRef.current.style.transformOrigin = ''
    }
  }, [pos, panelRef])

  return strolling
}
