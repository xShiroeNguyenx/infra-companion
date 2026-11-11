import type { IMarker, Terminal } from '@xterm/xterm'
import { pickPromptJump } from '@infra/shared'

/**
 * Ctrl+↑ / Ctrl+↓ — nhảy giữa các prompt trong scrollback (phần cuối của F23).
 *
 * Mỗi mốc OSC 133;A (prompt bắt đầu) được ghim bằng một marker của xterm. Marker tự đi theo
 * dòng của nó khi scrollback bị cắt bớt ở đầu, và tự huỷ khi dòng đó bị xoá hẳn, nên không phải
 * tự tính lại số dòng. Chọn đích là hàm thuần {@link pickPromptJump}; file này chỉ cuộn và nháy.
 */

/** Trần số mốc giữ lại — scrollback 10 nghìn dòng hiếm khi có nhiều prompt hơn thế. */
const MAX_PROMPTS = 1000
/** Dải sáng trên dòng prompt vừa nhảy tới, để thấy mình đang ở đâu cả khi viewport không cuộn được. */
const FLASH_MS = 900

export interface PromptNav {
  /** Gọi ở mốc OSC 133;A. */
  onPromptStart: () => void
  /** Có mốc nào để nhảy không — không có thì pane trả phím cho terminal như cũ. */
  hasPrompts: () => boolean
  /** Nhảy; trả false nếu không có chỗ nào để đi (đã ở đầu/cuối). */
  jump: (direction: 'prev' | 'next', running: boolean, flashColor: string) => boolean
  /** User gõ phím → lần nhảy sau tính lại từ chỗ đang đứng. */
  resetCursor: () => void
  dispose: () => void
}

export function createPromptNav(term: Terminal): PromptNav {
  const prompts: IMarker[] = []
  let current: IMarker | null = null
  let flashTimer: ReturnType<typeof setTimeout> | null = null
  let flashDispose: (() => void) | null = null

  const prune = (): void => {
    for (let i = prompts.length - 1; i >= 0; i--) if (prompts[i]!.isDisposed) prompts.splice(i, 1)
    while (prompts.length > MAX_PROMPTS) prompts.shift()!.dispose()
    if (current?.isDisposed) current = null
  }

  const flash = (marker: IMarker, color: string): void => {
    if (flashTimer !== null) clearTimeout(flashTimer)
    flashDispose?.()
    const d = term.registerDecoration({ marker, x: 0, width: term.cols, backgroundColor: color, layer: 'bottom' })
    flashDispose = d ? () => d.dispose() : null
    flashTimer = setTimeout(() => {
      flashTimer = null
      flashDispose?.()
      flashDispose = null
    }, FLASH_MS)
  }

  return {
    onPromptStart: () => {
      if (term.buffer.active.type !== 'normal') return
      const m = term.registerMarker(0) as IMarker | undefined
      if (!m || m.isDisposed) return
      // Prompt in lại ở cùng một dòng (Ctrl+L, prompt vẽ lại) → không giữ hai mốc trùng
      const last = prompts[prompts.length - 1]
      if (last && !last.isDisposed && last.line === m.line) last.dispose()
      prompts.push(m)
      prune()
    },
    hasPrompts: () => {
      prune()
      return prompts.length > 0
    },
    jump: (direction, running, flashColor) => {
      const buf = term.buffer.active
      if (buf.type !== 'normal') return false
      prune()
      const target = pickPromptJump({
        prompts: prompts.map((m) => m.line),
        direction,
        current: current?.line ?? null,
        viewportTop: buf.viewportY,
        rows: term.rows,
        baseY: buf.baseY,
        cursorLine: buf.baseY + buf.cursorY,
        running
      })
      if (target.kind === 'none') return false
      if (target.kind === 'bottom') {
        current = null
        term.scrollToBottom()
        return true
      }
      const marker = prompts.find((m) => m.line === target.line) ?? null
      current = marker
      term.scrollToLine(target.line)
      if (marker) flash(marker, flashColor)
      return true
    },
    resetCursor: () => {
      current = null
    },
    dispose: () => {
      if (flashTimer !== null) clearTimeout(flashTimer)
      flashDispose?.()
      for (const m of prompts) m.dispose()
      prompts.length = 0
      current = null
    }
  }
}
