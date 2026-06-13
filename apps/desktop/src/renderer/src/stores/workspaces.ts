import { create } from 'zustand'
import { useTabsStore, type WorkspaceTab } from './tabs'
import { errorMessage, useToastsStore } from './toasts'

const KEY = 'infra.workspaces'

/** Một workspace đã lưu: tên + spec các tab (không chứa session sống). Lưu trên máy này. */
export interface Workspace {
  id: string
  name: string
  tabs: WorkspaceTab[]
  savedAt: number
}

function read(): Workspace[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as Workspace[]) : []
  } catch {
    return []
  }
}

function persist(list: Workspace[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
}

let seq = Date.now()
const newId = (): string => `ws-${seq++}`

interface WorkspacesState {
  workspaces: Workspace[]
  /** Lưu layout đang mở thành workspace mới. Trả về false nếu không có gì để lưu. */
  saveCurrent: (name: string) => boolean
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  /** Mở workspace — CỘNG THÊM tab vào những gì đang mở (phiên mới, không có scrollback cũ). */
  open: (id: string) => void
}

export const useWorkspacesStore = create<WorkspacesState>((set, get) => ({
  workspaces: read(),

  saveCurrent: (name) => {
    const tabs = useTabsStore.getState().snapshotWorkspace()
    if (tabs.length === 0) return false
    const ws: Workspace = {
      id: newId(),
      name: name.trim() || `Workspace ${get().workspaces.length + 1}`,
      tabs,
      savedAt: Date.now()
    }
    const list = [...get().workspaces, ws]
    persist(list)
    set({ workspaces: list })
    return true
  },

  rename: (id, name) => {
    const list = get().workspaces.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name } : w))
    persist(list)
    set({ workspaces: list })
  },

  remove: (id) => {
    const list = get().workspaces.filter((w) => w.id !== id)
    persist(list)
    set({ workspaces: list })
  },

  open: (id) => {
    const ws = get().workspaces.find((w) => w.id === id)
    if (!ws) return
    void useTabsStore
      .getState()
      .restoreWorkspace(ws.tabs)
      .catch((error) => useToastsStore.getState().push(errorMessage(error)))
  }
}))
