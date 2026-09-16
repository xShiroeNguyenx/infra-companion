import { useCallback, useEffect, useRef, useState } from 'react'
import {
  effectiveRole,
  nextFolderClipForRole,
  nextMotionForRole,
  VRM_MOTIONS,
  type VrmMotionClip,
  type VrmMotionRole,
  type VrmMotionRoleName
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
}

/**
 * Clip user tự nạp từ thư mục, kèm vai trò họ gán — nguồn thứ hai bên cạnh danh mục CC0.
 *
 * Để `useVrmMotion` biết cả hai nguồn thay vì dựng một cơ chế tự chạy song song: thứ phải dùng
 * chung là **luật ưu tiên** (`PRIORITY`) và mốc `until`. Hai cơ chế riêng thì clip cảnh báo của
 * nguồn này sẽ cắt ngang clip cảnh báo của nguồn kia, và không bên nào biết bên nào đang chạy.
 */
export interface FolderMotionInput {
  files: readonly { name: string; bytes: Uint8Array }[]
  roles: Record<string, VrmMotionRoleName>
  /**
   * Vai trò user GÁN ĐÈ cho clip CC0 (`id` → vai trò). Thiếu khoá = dùng mặc định của danh mục.
   *
   * Để chung `FolderMotionInput` dù không liên quan tới thư mục: cả hai cùng đọc từ một file
   * (`vrm-folder-motions.json`) và cùng chảy vào một phép chọn clip. Tách thành prop thứ hai chỉ
   * làm nơi gọi phải nhớ truyền đủ hai thứ luôn đi cùng nhau.
   */
  builtinRoles?: Record<string, VrmMotionRole>
}

export function useVrmMotion(
  stage: VrmStage | null,
  enabled: boolean,
  folder?: FolderMotionInput | null
): VrmMotionApi {
  const [installed, setInstalled] = useState<string[]>([])
  const [downloading, setDownloading] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)

  /** Vai trò của clip đang chạy + lúc nào nó kết thúc — để quyết cho chen ngang hay không. */
  const current = useRef<{ role: VrmMotionRole; until: number } | null>(null)
  const cache = useRef(new Map<string, Uint8Array>())
  /** Clip vừa chạy của TỪNG vai trò — để xoay vòng, xem `nextMotionForRole`. */
  const lastByRole = useRef(new Map<VrmMotionRole, string>())
  /** Như trên nhưng cho clip THƯ MỤC — khoá là tên file, nên phải là bản đồ riêng. */
  const lastFolderByRole = useRef(new Map<VrmMotionRoleName, string>())
  const stopTimer = useRef<number | null>(null)
  /**
   * Bảng gán đè, giữ trong ref để `run()` đọc được mà không phải nằm trong deps của nó.
   *
   * `run` đã `useCallback([stage])`; thêm `folder` vào deps là hàm mới mỗi lần user gõ một ký tự
   * ở chỗ khác trong panel, kéo theo `play` dựng lại và mọi effect phụ thuộc nó chạy lại.
   */
  const overridesRef = useRef<Record<string, VrmMotionRole> | undefined>(undefined)
  overridesRef.current = folder?.builtinRoles

  useEffect(() => {
    void window.infra.vrm.listMotions().then((r) => setInstalled(r.installed))
  }, [])

  const stop = useCallback(() => {
    if (stopTimer.current !== null) {
      clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
    current.current = null
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
        void stage?.playAnimation(bytes, { once: !loop, anchor: !(loop && clip.locomotion) })
        setPlaying(clip.id)
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

  /**
   * Phát một clip THƯ MỤC cho vai trò `role`; trả `true` nếu có clip để phát.
   *
   * Thời lượng đọc từ chính file (`playAnimation` trả về) chứ không có sẵn như clip trong danh
   * mục — đó là lý do `playAnimation` được đổi sang trả `number`. Không có con số đó thì không
   * hẹn được giờ trả quyền về lớp tự sinh, và nhân vật đứng nguyên tư thế cuối clip mãi mãi.
   */
  const runFolder = useCallback(
    (role: VrmMotionRoleName): boolean => {
      if (!stage || !folder || folder.files.length === 0) return false
      const names = folder.files.map((f) => f.name)
      const name = nextFolderClipForRole(folder.roles, names, role, lastFolderByRole.current.get(role) ?? null)
      if (!name) return false
      const file = folder.files.find((f) => f.name === name)
      if (!file) return false
      lastFolderByRole.current.set(role, name)
      // `anchor: true` như mọi clip TỰ CHẠY: nhiều clip dời cả người đi, mà khung ôm sát thân nên
      // nhân vật đi thẳng ra ngoài rồi vài giây sau mới quay lại
      void stage.playAnimation(file.bytes, { once: true, anchor: true }).then((durationSec) => {
        setPlaying(name)
        const secs = durationSec > 0 ? durationSec : 3
        current.current = { role, until: performance.now() + secs * 1000 }
        if (stopTimer.current !== null) clearTimeout(stopTimer.current)
        stopTimer.current = window.setTimeout(() => {
          stopTimer.current = null
          current.current = null
          setPlaying(null)
        }, secs * 1000 + 120)
      })
      return true
    },
    [stage, folder]
  )

  const play = useCallback(
    (role: VrmMotionRole) => {
      if (!enabled || !stage) return
      // Clip đang chạy còn hạn và ưu tiên cao hơn (hoặc bằng) → để yên, đừng cắt ngang.
      // Xét TRƯỚC khi chọn clip: hai nguồn dùng chung luật này, nếu không thì clip của nguồn
      // này sẽ cắt ngang clip cùng vai trò của nguồn kia.
      const cur = current.current
      if (cur && performance.now() < cur.until && PRIORITY[cur.role] >= PRIORITY[role]) return

      /**
       * **Clip user tự gán THẮNG clip mặc định** ở cùng vai trò.
       *
       * Gán tay là một lựa chọn tường minh — gán "Khi chạm vào" cho `VRMA_06` mà app vẫn chạy
       * clip CC0 thì việc gán chẳng có nghĩa gì. Vai trò nào user không gán thì vẫn rơi về danh
       * mục CC0 như cũ, nên bật tính năng này không làm mất chuyển động nào đang có.
       *
       * `manual` không nằm trong `VrmMotionRoleName` (không gán được) nên bỏ qua nhánh này.
       */
      if (role !== 'manual' && runFolder(role)) return

      // Xoay vòng trong nhóm clip của vai trò đó — `idle` có hai clip luân phiên
      const clip = nextMotionForRole(role, lastByRole.current.get(role) ?? null, installed, folder?.builtinRoles)
      if (!clip) return
      lastByRole.current.set(role, clip.id)
      run(clip, false)
    },
    [enabled, stage, installed, run, runFolder, folder?.builtinRoles]
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

  return { installed, clips: VRM_MOTIONS, downloading, download, play, playById, stop, playing }
}
