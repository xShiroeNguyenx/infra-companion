import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@infra/shared'

interface PendingPrompt {
  resolve: (answer: unknown) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingPrompt>()
let registered = false

const PROMPT_TIMEOUT_MS = 120_000

/**
 * F53 — móc gọi TRƯỚC mỗi câu hỏi gửi sang renderer. `main/index.ts` dùng nó để hiện lại cửa sổ
 * chính khi nó đang ẩn trong khay: một câu hỏi (host key mới, mật khẩu) mà không ai thấy thì
 * chỉ hết giờ rồi bị coi là từ chối, và tunnel bật từ khay "im lặng không lên" không rõ vì sao.
 */
let visibilityHook: ((target: WebContents) => void) | null = null

export function setPromptVisibilityHook(hook: ((target: WebContents) => void) | null): void {
  visibilityHook = hook
}

/**
 * Cho phép main hỏi renderer (host key TOFU, password Quick Connect…):
 * main gửi event kèm requestId → renderer hiện modal → trả lời qua PROMPT_ANSWER.
 */
export function registerPromptIpc(): void {
  if (registered) return
  registered = true
  ipcMain.on(IPC.PROMPT_ANSWER, (_event, requestId: string, answer: unknown) => {
    const entry = pending.get(requestId)
    if (!entry) return
    pending.delete(requestId)
    clearTimeout(entry.timer)
    entry.resolve(answer)
  })
}

export function askRenderer<TAnswer>(
  target: WebContents,
  channel: string,
  payload: Record<string, unknown>
): Promise<TAnswer | null> {
  registerPromptIpc()
  return new Promise((resolve) => {
    if (target.isDestroyed()) return resolve(null)
    const requestId = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(requestId)
      resolve(null) // hết giờ → coi như từ chối
    }, PROMPT_TIMEOUT_MS)
    pending.set(requestId, { resolve: (answer) => resolve(answer as TAnswer), timer })
    visibilityHook?.(target)
    target.send(channel, { requestId, ...payload })
  })
}
