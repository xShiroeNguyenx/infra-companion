import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  kind: 'error' | 'info'
}

let nextId = 1

interface ToastsState {
  toasts: Toast[]
  push: (message: string, kind?: Toast['kind']) => void
  dismiss: (id: number) => void
}

export const useToastsStore = create<ToastsState>((set) => ({
  toasts: [],
  push: (message, kind = 'error') => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Rút message gọn từ lỗi IPC ("Error invoking remote method 'x': Error: <msg>"). */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const match = /Error: ([^]*)$/.exec(raw)
  return match?.[1] ?? raw
}
