import { useEffect, useState } from 'react'
import { heartBurst, VRM_MOTIONS, type HeartParticle } from '@infra/shared'
import type { VrmStage } from '../lib/vrmStage'

/**
 * Hiệu ứng tim bay lên khi clip có `effect.kind === 'hearts'` đang chạy (v0.5.3: `lilac-heart`).
 *
 * Canh theo **giây của clip** (`effect.atSec`), tính từ mốc `started` của `useVrmMotion`, không
 * theo cú click: tim mà bung lúc tay còn buông thõng thì trông như hai thứ chẳng liên quan.
 *
 * Gốc toạ độ lấy từ **chính hai bàn tay** (`projectBones`) ngay lúc bung, không đoán theo tỉ lệ khung:
 * zoom, xoay, kéo níu hay model tay dài/ngắn đều làm lệch một con số đoán sẵn.
 *
 * Vẽ bằng DOM + Web Animations API, không vẽ vào WebGL: vài ký tự ♥ bay lên không đáng thêm một
 * lớp particle vào scene, và DOM thì tự tắt khi component gỡ — không có tài nguyên GPU nào phải dọn.
 */

const COLORS = ['#ff4f9a', '#ff7fb8', '#ffa6cf', '#ff6fa8'] as const

interface Burst {
  key: number
  /** Gốc, % theo khung (0 = trái/trên). */
  left: number
  top: number
  /** Bao nhiêu px ứng với 1 đơn vị `x`/`drift` của hạt — theo bề rộng vai thật trên màn hình. */
  unitPx: number
  particles: HeartParticle[]
}

export function VrmHeartBurst({
  stage,
  started
}: {
  readonly stage: VrmStage | null
  readonly started: { id: string; at: number } | null
}) {
  const [burst, setBurst] = useState<Burst | null>(null)

  useEffect(() => {
    // Lượt phát mới (clip khác chen ngang, kể cả cảnh báo) → tắt đợt tim đang bay
    setBurst(null)
    if (!stage || !started) return
    const effect = VRM_MOTIONS.find((c) => c.id === started.id)?.effect
    if (effect?.kind !== 'hearts') return

    const spanMs = Math.max(0, (effect.untilSec - effect.atSec) * 1000)
    const wait = Math.max(0, effect.atSec * 1000 - (performance.now() - started.at))
    let clearTimer: number | null = null
    const fireTimer = window.setTimeout(() => {
      const p = stage.projectBones(['leftHand', 'rightHand']) ?? stage.projectBones(['upperChest', 'chest'])
      if (!p) return
      const particles = heartBurst(Math.random, spanMs)
      setBurst({
        key: started.at,
        left: ((p.nx + 1) / 2) * 100,
        top: ((1 - p.ny) / 2) * 100,
        // ~0,35 m là bề rộng vai; `pxPerMeter` đã tính theo zoom và cỡ khung hiện tại
        unitPx: Math.max(20, stage.pxPerMeter() * 0.35),
        particles
      })
      // Tay vừa thành hình thì mặt cũng cười — model thiếu `happy` thì thử `relaxed`, thiếu cả hai thì thôi
      stage.playExpression(['happy', 'relaxed'])
      const lastEnd = Math.max(...particles.map((x) => x.delayMs + x.lifeMs))
      clearTimer = window.setTimeout(() => setBurst(null), lastEnd + 100)
    }, wait)

    return () => {
      clearTimeout(fireTimer)
      if (clearTimer !== null) clearTimeout(clearTimer)
    }
  }, [stage, started])

  if (!burst) return null
  return (
    <div
      // Trên canvas (`z-40`), và KHÔNG nhận chuột: click vào tim phải là click vào nhân vật
      className="pointer-events-none absolute inset-0 z-50 motion-reduce:hidden"
      aria-hidden
    >
      {burst.particles.map((h, i) => (
        <span
          key={`${burst.key}-${i}`}
          className="absolute select-none leading-none"
          style={{
            left: `${burst.left}%`,
            top: `${burst.top}%`,
            fontSize: h.sizePx,
            color: COLORS[i % COLORS.length],
            textShadow: '0 0 6px rgba(255,255,255,0.9)',
            opacity: 0
          }}
          ref={(el) => {
            // Chạy đúng một lần cho mỗi phần tử: `dataset` đánh dấu, vì ref callback gọi lại mỗi render
            if (!el || el.dataset.played) return
            el.dataset.played = '1'
            const x0 = h.x * burst.unitPx
            const x1 = x0 + h.drift * burst.unitPx
            const rise = burst.unitPx * 3.2
            el.animate(
              [
                { transform: `translate(calc(-50% + ${x0}px), -50%) scale(0.3)`, opacity: 0 },
                { transform: `translate(calc(-50% + ${x0}px), calc(-50% - ${rise * 0.15}px)) scale(1.1)`, opacity: 1, offset: 0.15 },
                { transform: `translate(calc(-50% + ${(x0 + x1) / 2}px), calc(-50% - ${rise * 0.6}px)) scale(1)`, opacity: 0.9, offset: 0.6 },
                { transform: `translate(calc(-50% + ${x1}px), calc(-50% - ${rise}px)) scale(0.9)`, opacity: 0 }
              ],
              { duration: h.lifeMs, delay: h.delayMs, easing: 'ease-out', fill: 'both' }
            )
          }}
        >
          ♥
        </span>
      ))}
    </div>
  )
}
