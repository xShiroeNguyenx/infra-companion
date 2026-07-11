import { useRef, useState, type PointerEvent, type RefObject } from 'react'

export interface DraggablePanel {
  /** Gắn vào phần tử panel (khung ngoài cùng cần định vị). */
  panelRef: RefObject<HTMLDivElement | null>
  /** null = chưa kéo lần nào → panel giữ vị trí neo mặc định qua className.
   *  Có giá trị = toạ độ (theo offsetParent) user đã thả → set qua style left/top. */
  pos: { x: number; y: number } | null
  /** Spread vào phần tử "nắm để kéo" (thường là header). */
  headerHandlers: {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => void
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => void
  }
}

/** Kéo thả panel bằng cách nắm header. Toạ độ tính theo offsetParent (khung app) và
 *  kẹp trong khung để header không văng mất. pos=null khi user chưa kéo → panel neo
 *  vị trí mặc định (className). Vị trí nhớ trong phiên (theo vòng đời component).
 *  Bấm vào <button> trong header KHÔNG khởi động kéo (để nút –/✕ vẫn bấm được).
 *  Dùng chung cho AiExplainPanel / MonitorDock / PluginPanelModal — kết hợp CSS
 *  `resize` (grip góc dưới-phải của Chromium) để vừa kéo vừa chỉnh cỡ. */
export function useDraggablePanel(): DraggablePanel {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ pointerId: number; offX: number; offY: number } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    // Bấm vào nút –/✕… là thao tác nút, không phải bắt đầu kéo
    if ((e.target as HTMLElement).closest('button')) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    drag.current = { pointerId: e.pointerId, offX: e.clientX - rect.left, offY: e.clientY - rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    const panel = panelRef.current
    if (!d || d.pointerId !== e.pointerId || !panel) return
    const parent = panel.offsetParent as HTMLElement | null
    if (!parent) return
    const pr = parent.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    // Kẹp trong khung app: không cho văng mất — header luôn còn với tới được
    const x = Math.min(Math.max(e.clientX - pr.left - d.offX, 0), Math.max(0, pr.width - rect.width))
    const y = Math.min(Math.max(e.clientY - pr.top - d.offY, 0), Math.max(0, pr.height - 40))
    setPos({ x, y })
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }

  return { panelRef, pos, headerHandlers: { onPointerDown, onPointerMove, onPointerUp } }
}
