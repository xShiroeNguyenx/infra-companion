import { useCallback, useEffect, useRef, useState } from 'react'
import {
  effectiveRole,
  nextMotionForRole,
  VRM_MOTIONS,
  type VrmMotionClip,
  type VrmMotionRole,
  type WalkStyleSpec
} from '@infra/shared'
import type { VrmStage } from './vrmStage'

/**
 * F70 — nối thư viện chuyển động `.vrma` vào nhân vật.
 *
 * Một hook thay vì rải lời gọi khắp `VrmPanel`: có **bốn** chỗ kích hoạt (chạm, mở chat, cảnh báo,
 * hết cảnh báo) và một lịch chạy nền, mà tất cả đều phải đi qua cùng một luật ưu tiên — clip đang
 * chạy thì không cho clip khác chen ngang, trừ khi cái mới quan trọng hơn.
 *
 * Bytes đọc qua main mỗi lần phát: giữ 13 clip trong RAM renderer là vài MB nằm chết suốt phiên,
 * mà một lượt đọc file cục bộ chỉ mất vài ms. Có nhớ đệm clip vừa dùng cho trường hợp bấm liên tục.
 */

/** Vai trò nào được phép cắt ngang vai trò nào — số lớn thắng. */
const PRIORITY: Record<VrmMotionRole, number> = {
  idle: 0,
  manual: 1,
  /**
   * Sáu loại việc đều **trên idle nhưng dưới mọi thứ user vừa chạm vào**.
   *
   * Cùng một mức: mở hai công cụ liên tiếp thì cái sau thắng (không `>=` nên không chen), mà đó
   * đúng là điều mong đợi — user vừa chuyển sang việc khác. Cho chúng khác mức nhau thì mở
   * "xem log" rồi mở "chạy hàng loạt" sẽ ra kết quả khác với thứ tự ngược lại, không có lý do gì.
   */
  inspect: 1,
  bulk: 1,
  transfer: 1,
  logs: 1,
  security: 1,
  monitor: 1,
  chat: 2,
  poke: 2,
  recover: 3,
  alert: 4
}

export interface VrmMotionApi {
  /** Clip đã tải về máy (theo id). */
  installed: string[]
  /** Toàn bộ danh mục — cho menu 🎬. */
  clips: readonly VrmMotionClip[]
  /** Đang tải bộ clip. */
  downloading: boolean
  /** Tải cả bộ; trả về `true` nếu không clip nào lỗi. */
  download: () => Promise<boolean>
  /** Chạy clip của một vai trò (nếu đã tải). Tự bỏ qua khi có clip ưu tiên cao hơn đang chạy. */
  play: (role: VrmMotionRole) => void
  /** Chạy đúng một clip theo id — user chọn trong menu, luôn thắng mọi thứ trừ cảnh báo. */
  playById: (id: string) => void
  /** Dừng clip, trả nhân vật về chuyển động tự sinh. */
  stop: () => void
  /** Clip đang chạy (id), `null` = đang dùng chuyển động tự sinh. */
  playing: string | null
  /**
   * Lượt phát gần nhất: object MỚI mỗi lần một clip bắt đầu, kể cả khi trùng id với lượt trước.
   *
   * `playing` không đủ để canh hiệu ứng theo giây của clip: chạm hai lần liền ra cùng một clip thì
   * `playing` không đổi giá trị, effect không chạy lại, và lượt sau mất hiệu ứng.
   */
  started: { id: string; at: number } | null
  /**
   * Bật/tắt clip `walk` cho đi dạo (`useVrmStroll`): lặp, **neo tại chỗ** (khung trượt thay).
   *
   * Bật trả về tốc độ đi đo từ clip (m/s), `0` nếu không bật được (chưa tải, đang có clip khác).
   * Tắt chỉ có tác dụng khi clip đang chạy CHÍNH LÀ lượt đi bộ này — clip khác đã chen vào thì để yên.
   */
  walk: (on: boolean, pace?: number, clipId?: string, style?: WalkStyleSpec | null) => Promise<number>
  /** Vai trò của clip đang chạy và còn hạn; `null` = không có clip nào. Đọc đồng bộ. */
  currentRole: () => VrmMotionRole | null
  /** Lượt đi bộ còn đang giữ nhân vật không — `false` ngay khi clip khác chen ngang. Đọc đồng bộ. */
  isWalking: () => boolean
}

/**
 * `builtinRoles` — vai trò user GÁN ĐÈ cho clip CC0 (`id` → vai trò). Thiếu khoá = dùng mặc định
 * của danh mục.
 *
 * (Từng có nguồn thứ hai: clip `.vrma` user tự nạp từ thư mục. Đã bỏ — người dùng không đi kiếm
 * clip về để nạp, còn mục đó chiếm chỗ trong bảng cài đặt và làm "Chuyển động" trông như hai hệ
 * thống song song.)
 */
export function useVrmMotion(
  stage: VrmStage | null,
  enabled: boolean,
  builtinRoles?: Record<string, VrmMotionRole>
): VrmMotionApi {
  const [installed, setInstalled] = useState<string[]>([])
  const [downloading, setDownloading] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)
  const [started, setStarted] = useState<{ id: string; at: number } | null>(null)

  /** Vai trò của clip đang chạy + lúc nào nó kết thúc — để quyết cho chen ngang hay không. */
  const current = useRef<{ role: VrmMotionRole; until: number } | null>(null)
  const cache = useRef(new Map<string, Uint8Array>())
  /** Clip vừa chạy của TỪNG vai trò — để xoay vòng, xem `nextMotionForRole`. */
  const lastByRole = useRef(new Map<VrmMotionRole, string>())
  const stopTimer = useRef<number | null>(null)
  /**
   * Clip đang chạy là lượt đi bộ của `walk()`. Ref chứ không state: vòng rAF của đi dạo đọc nó
   * MỖI FRAME để biết có ai chen ngang chưa, mà state thì trễ một lượt render — đủ để khung trượt
   * thêm vài frame trong lúc nhân vật đã đứng lại cúi đầu xin lỗi.
   */
  const walking = useRef(false)
  /**
   * Bảng gán đè, giữ trong ref để `run()` đọc được mà không phải nằm trong deps của nó.
   *
   * `run` đã `useCallback([stage])`; thêm `builtinRoles` vào deps là hàm mới mỗi lần user gán
   * một vai trò, kéo theo `play` dựng lại và mọi effect phụ thuộc nó chạy lại.
   */
  const overridesRef = useRef<Record<string, VrmMotionRole> | undefined>(undefined)
  overridesRef.current = builtinRoles

  useEffect(() => {
    void window.infra.vrm.listMotions().then((r) => {
      setInstalled(r.installed)
      /**
       * Người đã tải bộ clip mà danh mục nay có thêm clip mới → tự tải phần thiếu, MỘT lần mỗi
       * lượt mở app.
       *
       * Vì sao không chờ họ bấm: bản mới gỡ ba clip cũ khỏi danh mục và giao vai của chúng cho clip
       * riêng của dự án. Không tự tải thì sau khi cập nhật app, mở chat và có cảnh báo sẽ không
       * còn chuyển động nào — mà họ không làm gì sai và không có gì báo cho biết. Họ đã đồng ý tải
       * bộ clip từ trước; đây là phần bổ sung của chính bộ đó (vài trăm KB), không phải lượt tải mới.
       *
       * Người CHƯA tải gì (`installed` rỗng) thì không đụng: lần đầu vẫn phải do họ bấm.
       * Hỏng (mất mạng) thì im lặng — nút "tải clip còn thiếu" trong menu 🎬 vẫn ở đó.
       */
      const missing = r.clips.some((c) => !r.installed.includes(c.id))
      if (r.installed.length > 0 && missing) {
        void window.infra.vrm
          .downloadMotions()
          .then((d) => setInstalled(d.installed))
          .catch(() => {})
      }
    })
  }, [])

  const stop = useCallback(() => {
    if (stopTimer.current !== null) {
      clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
    current.current = null
    walking.current = false
    setPlaying(null)
    void stage?.playAnimation(null)
  }, [stage])

  /** Nạp bytes (ưu tiên nhớ đệm) rồi phát. `loop` chỉ dùng cho clip user tự chọn. */
  const run = useCallback(
    (clip: VrmMotionClip, loop: boolean) => {
      const go = (bytes: Uint8Array): void => {
        /**
         * **Neo tại chỗ trừ clip di chuyển do user tự chọn.**
         *
         * Đa số clip dời cả người đi (đo được `reaction-startle` 39 cm, `pose-motion` 36 cm), mà
         * khung hình ôm sát thân nên nhân vật đi thẳng ra ngoài. Clip `walk`/`run` thì ngược lại:
         * user chọn chúng CHÍNH VÌ muốn thấy nhân vật đi, neo lại là làm hỏng điều họ muốn xem.
         */
        void stage?.playAnimation(bytes, {
          once: !loop,
          anchor: !(loop && clip.locomotion),
          groundFeet: clip.groundFeet === true
        })
        walking.current = false
        setPlaying(clip.id)
        setStarted({ id: clip.id, at: performance.now() })
        // Vai trò HIỆU LỰC, không phải `clip.role`: user gán đè thì luật ưu tiên phải theo cái họ
        // gán — gán "Khi có cảnh báo" cho một clip vốn là `idle` mà `PRIORITY` vẫn tính là idle
        // thì nó bị mọi thứ khác cắt ngang ngay.
        const role = effectiveRole(clip, overridesRef.current)
        current.current = { role, until: performance.now() + clip.durationSec * 1000 }
        if (stopTimer.current !== null) clearTimeout(stopTimer.current)
        /**
         * Hẹn giờ dọn state **dài hơn clip một chút**: stage tự gỡ mixer khi clip hết (`once`),
         * nhưng React vẫn nghĩ đang chạy nên nút trong menu kẹt ở trạng thái sáng.
         */
        stopTimer.current = loop
          ? null
          : window.setTimeout(() => {
              stopTimer.current = null
              current.current = null
              setPlaying(null)
            }, clip.durationSec * 1000 + 120)
      }
      const hit = cache.current.get(clip.id)
      if (hit) {
        go(hit)
        return
      }
      void window.infra.vrm.readMotion(clip.id).then((r) => {
        if (!r.ok) return
        cache.current.set(clip.id, r.bytes)
        go(r.bytes)
      })
    },
    [stage]
  )

  const play = useCallback(
    (role: VrmMotionRole) => {
      if (!enabled || !stage) return
      // Clip đang chạy còn hạn và ưu tiên cao hơn (hoặc bằng) → để yên, đừng cắt ngang.
      const cur = current.current
      if (cur && performance.now() < cur.until && PRIORITY[cur.role] >= PRIORITY[role]) return

      // Xoay vòng trong nhóm clip của vai trò đó — `idle` có hai clip luân phiên
      const clip = nextMotionForRole(role, lastByRole.current.get(role) ?? null, installed, builtinRoles)
      if (!clip) return
      lastByRole.current.set(role, clip.id)
      run(clip, false)
    },
    [enabled, stage, installed, run, builtinRoles]
  )

  const playById = useCallback(
    (id: string) => {
      if (!stage) return
      const clip = VRM_MOTIONS.find((c) => c.id === id)
      if (!clip || !installed.includes(id)) return
      // User chọn tay → lặp, và chỉ dừng khi họ bảo dừng
      run(clip, true)
    },
    [stage, installed, run]
  )

  const walk = useCallback(
    async (on: boolean, pace = 1, clipId = 'walk', style: WalkStyleSpec | null = null): Promise<number> => {
      if (!stage) return 0
      if (!on) {
        if (walking.current) stop()
        return 0
      }
      const free = (): boolean => {
        const cur = current.current
        return walking.current || !cur || performance.now() >= cur.until
      }
      if (!enabled || !installed.includes(clipId) || !free()) return 0
      let bytes = cache.current.get(clipId)
      if (!bytes) {
        const r = await window.infra.vrm.readMotion(clipId)
        if (!r.ok) return 0
        bytes = r.bytes
        cache.current.set(clipId, bytes)
      }
      // Kiểm lại SAU lượt đọc file: trong lúc chờ, một cảnh báo có thể đã chiếm nhân vật
      if (!free()) return 0
      if (stopTimer.current !== null) {
        clearTimeout(stopTimer.current)
        stopTimer.current = null
      }
      walking.current = true
      /**
       * Vai `idle`, hạn VÔ CÙNG: mọi phản ứng (chạm, chat, cảnh báo) đều ưu tiên hơn idle nên vẫn
       * chen ngang được; còn lịch clip idle định kỳ thì gặp `idle >= idle` và tự nhường — không
       * thay dáng đi bằng dáng uống nước giữa đường.
       */
      current.current = { role: 'idle', until: Infinity }
      setPlaying(clipId)
      await stage.playAnimation(bytes, { anchor: true, measureGait: true, timeScale: pace, style })
      return walking.current ? stage.gaitSpeed() : 0
    },
    [stage, enabled, installed, stop]
  )
  const isWalking = useCallback(() => walking.current, [])
  const currentRole = useCallback((): VrmMotionRole | null => {
    const cur = current.current
    return cur && performance.now() < cur.until ? cur.role : null
  }, [])

  const download = useCallback(async () => {
    setDownloading(true)
    try {
      const r = await window.infra.vrm.downloadMotions()
      setInstalled(r.installed)
      return r.ok
    } finally {
      setDownloading(false)
    }
  }, [])

  // Panel đóng giữa lúc đang chạy clip → dọn hẹn giờ, không để nó nổ vào một stage đã biến mất
  useEffect(
    () => () => {
      if (stopTimer.current !== null) clearTimeout(stopTimer.current)
    },
    []
  )

  return { installed, clips: VRM_MOTIONS, downloading, download, play, playById, stop, playing, started, walk, isWalking, currentRole }
}
