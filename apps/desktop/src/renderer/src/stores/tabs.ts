import { create } from 'zustand'
import type { SessionKind, SessionStatus, TerminalCreateRequest } from '@infra/shared'
import { clearTermSession } from '../lib/termBus'
import { errorMessage, useToastsStore } from './toasts'
import { useDataStore } from './data'

/**
 * Cách mở lại 1 pane — lưu vào workspace để dựng lại layout. Chỉ tham chiếu hostId
 * (không denormalize) nên host đồng bộ tới máy nào là mở được tới đó.
 */
export type PaneOrigin =
  | { kind: 'local'; profileId?: string }
  | { kind: 'host'; hostId: string }
  | { kind: 'quick'; target: string }

/** Một pane terminal trong tab (mỗi pane = 1 phiên local/ssh riêng). */
export interface Pane {
  id: string
  sessionId: string
  kind: SessionKind
  title: string
  subtitle?: string
  status: SessionStatus | 'exited'
  statusDetail?: string
  exitCode?: number | null
  exitReason?: string
  /** Cách tạo pane này — để lưu/dựng lại workspace. */
  origin?: PaneOrigin
}

export type TabKind = 'terminal' | 'sftp'

export interface AppTab {
  id: string
  kind: TabKind
  /** terminal: nhiều pane bố trí dạng lưới; gõ broadcast gửi tới mọi pane. */
  panes: Pane[]
  activePaneId: string | null
  broadcast: boolean
  /** sftp: phiên SFTP + home. */
  sftpSessionId?: string
  sftpTitle?: string
  sftpHome?: string
  /** sftp: host đã mở — để lưu/dựng lại workspace. */
  sftpHostId?: string
}

/** Một tab trong workspace đã lưu (chỉ spec để mở lại, không có session sống). */
export type WorkspaceTab =
  | { kind: 'terminal'; broadcast: boolean; panes: PaneOrigin[] }
  | { kind: 'sftp'; hostId: string }

let tabSeq = 1
let paneSeq = 1
const newTabId = (): string => `tab-${tabSeq++}`
const newPaneId = (): string => `pane-${paneSeq++}`

const toastError = (error: unknown): void => useToastsStore.getState().push(errorMessage(error))

interface TabsState {
  tabs: AppTab[]
  activeId: string | null
  /** Gộp mọi tab terminal thành pane trong tab này (1 toolbar, broadcast dùng chung). */
  mergeTabs: (tabId: string) => void
  /** Tách mỗi pane của tab thành 1 tab riêng (đảo của mergeTabs). */
  unmergeTab: (tabId: string) => void
  openLocal: (profileId?: string) => Promise<void>
  openSsh: (hostId: string) => Promise<void>
  /** Mở nhiều host cùng lúc: mỗi host 1 pane trong CÙNG 1 tab mới (chia màn hình sẵn). */
  openSshGroup: (hostIds: string[]) => Promise<void>
  openQuick: (target: string) => Promise<void>
  openSftp: (hostId: string) => Promise<void>
  /** Hiện trang Dashboard (home) — KHÔNG phải tab: activeId=null là đang ở home, chọn tab để quay lại. */
  showDashboard: () => void
  /** Mở thêm pane trong tab đang active (split). opener tạo phiên. */
  splitLocal: (profileId?: string) => Promise<void>
  splitSsh: (hostId: string) => Promise<void>
  closeTab: (id: string) => void
  closePane: (tabId: string, paneId: string) => void
  setActive: (id: string) => void
  setActivePane: (tabId: string, paneId: string) => void
  toggleBroadcast: (tabId: string) => void
  applyStatus: (sessionId: string, status: SessionStatus, detail?: string) => void
  applyExit: (sessionId: string, exitCode: number | null, reason?: string) => void
  cycleTab: (direction: 1 | -1) => void
  activeTab: () => AppTab | undefined
  /** Chụp layout hiện tại thành spec để lưu workspace (bỏ pane/tab không mở lại được). */
  snapshotWorkspace: () => WorkspaceTab[]
  /** Dựng lại layout từ workspace — CỘNG THÊM tab (không đóng tab đang mở). */
  restoreWorkspace: (tabs: WorkspaceTab[]) => Promise<void>
}

/** Suy ra cách mở lại pane từ request tạo phiên. Nguồn DUY NHẤT gán origin. */
function originOf(req: TerminalCreateRequest): PaneOrigin {
  if (req.kind === 'local') return { kind: 'local', profileId: req.profileId }
  if (req.quickTarget) return { kind: 'quick', target: req.quickTarget }
  if (req.hostId) return { kind: 'host', hostId: req.hostId }
  return { kind: 'local' }
}

/** Chuyển origin → request để mở lại. */
function reqOf(origin: PaneOrigin): TerminalCreateRequest {
  if (origin.kind === 'local') return { kind: 'local', profileId: origin.profileId, cols: 80, rows: 24 }
  if (origin.kind === 'quick') return { kind: 'ssh', quickTarget: origin.target, cols: 80, rows: 24 }
  return { kind: 'ssh', hostId: origin.hostId, cols: 80, rows: 24 }
}

/** Tạo 1 phiên terminal qua IPC và trả về Pane (kèm origin để lưu workspace). */
async function createPane(req: TerminalCreateRequest): Promise<Pane> {
  const res = await window.infra.terminal.create(req)
  return {
    id: newPaneId(),
    sessionId: res.sessionId,
    kind: res.kind,
    title: res.title,
    subtitle: res.subtitle,
    status: res.kind === 'local' ? 'connected' : 'connecting',
    origin: originOf(req)
  }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,

  mergeTabs: (tabId) =>
    set((state) => {
      const target = state.tabs.find((t) => t.id === tabId)
      if (target?.kind !== 'terminal') return {}
      const terminals = state.tabs.filter((t) => t.kind === 'terminal')
      if (terminals.length < 2) return {}
      // Gom pane theo thứ tự tab trên thanh tab; tab đích giữ vị trí, các tab terminal khác đóng lại
      const panes = terminals.flatMap((t) => t.panes)
      const tabs = state.tabs
        .filter((t) => t.kind !== 'terminal' || t.id === tabId)
        .map((t) => (t.id === tabId ? { ...t, panes } : t))
      return { tabs, activeId: tabId }
    }),

  unmergeTab: (tabId) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === tabId)
      const tab = state.tabs[index]
      if (tab?.kind !== 'terminal' || tab.panes.length < 2) return {}
      const split = tab.panes.map<AppTab>((pane) => ({
        id: newTabId(),
        kind: 'terminal',
        panes: [pane],
        activePaneId: pane.id,
        broadcast: false
      }))
      const tabs = [...state.tabs.slice(0, index), ...split, ...state.tabs.slice(index + 1)]
      const activeId = split.find((t) => t.panes[0]?.id === tab.activePaneId)?.id ?? split[0].id
      return { tabs, activeId }
    }),

  activeTab: () => get().tabs.find((t) => t.id === get().activeId),

  openLocal: async (profileId) => {
    try {
      const pane = await createPane({ kind: 'local', profileId, cols: 80, rows: 24 })
      addTab(set, pane)
    } catch (error) {
      toastError(error)
    }
  },

  openSsh: async (hostId) => {
    try {
      const pane = await createPane({ kind: 'ssh', hostId, cols: 80, rows: 24 })
      addTab(set, pane)
    } catch (error) {
      toastError(error)
    }
  },

  openSshGroup: async (hostIds) => {
    let tabId: string | null = null
    for (const hostId of hostIds) {
      try {
        const pane = await createPane({ kind: 'ssh', hostId, cols: 80, rows: 24 })
        // Host đầu tiên tạo tab mới, các host sau thêm pane vào đó; 1 host lỗi không chặn host khác
        if (tabId === null) tabId = addTab(set, pane)
        else addPane(set, tabId, pane)
      } catch (error) {
        toastError(error)
      }
    }
  },

  openQuick: async (target) => {
    try {
      const pane = await createPane({ kind: 'ssh', quickTarget: target, cols: 80, rows: 24 })
      addTab(set, pane)
    } catch (error) {
      toastError(error)
    }
  },

  openSftp: async (hostId) => {
    try {
      const res = await window.infra.sftp.open(hostId)
      const tab: AppTab = {
        id: newTabId(),
        kind: 'sftp',
        panes: [],
        activePaneId: null,
        broadcast: false,
        sftpSessionId: res.sessionId,
        sftpTitle: res.title,
        sftpHome: res.home,
        sftpHostId: hostId
      }
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
    } catch (error) {
      toastError(error)
    }
  },

  showDashboard: () => set({ activeId: null }),

  splitLocal: async (profileId) => {
    const tab = get().activeTab()
    if (!tab || tab.kind !== 'terminal') return get().openLocal(profileId)
    try {
      const pane = await createPane({ kind: 'local', profileId, cols: 80, rows: 24 })
      addPane(set, tab.id, pane)
    } catch (error) {
      toastError(error)
    }
  },

  splitSsh: async (hostId) => {
    const tab = get().activeTab()
    if (!tab || tab.kind !== 'terminal') return get().openSsh(hostId)
    try {
      const pane = await createPane({ kind: 'ssh', hostId, cols: 80, rows: 24 })
      addPane(set, tab.id, pane)
    } catch (error) {
      toastError(error)
    }
  },

  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    if (tab.kind === 'sftp') {
      if (tab.sftpSessionId) window.infra.sftp.close(tab.sftpSessionId)
    } else {
      for (const pane of tab.panes) {
        window.infra.terminal.kill(pane.sessionId)
        clearTermSession(pane.sessionId)
      }
    }
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id)
      const tabs = state.tabs.filter((t) => t.id !== id)
      let activeId = state.activeId
      if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null
      return { tabs, activeId }
    })
  },

  closePane: (tabId, paneId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    // Pane cuối cùng → đóng cả tab
    if (tab.panes.length <= 1) return get().closeTab(tabId)
    const pane = tab.panes.find((p) => p.id === paneId)
    if (pane) {
      window.infra.terminal.kill(pane.sessionId)
      clearTermSession(pane.sessionId)
    }
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t
        const panes = t.panes.filter((p) => p.id !== paneId)
        const activePaneId = t.activePaneId === paneId ? (panes[0]?.id ?? null) : t.activePaneId
        return { ...t, panes, activePaneId }
      })
    }))
  },

  setActive: (id) => set({ activeId: id }),

  setActivePane: (tabId, paneId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t))
    })),

  toggleBroadcast: (tabId) =>
    set((state) => ({
      // Chỉ tab terminal mới có broadcast (sftp/dashboard không có pane để gõ)
      tabs: state.tabs.map((t) => (t.id === tabId && t.kind === 'terminal' ? { ...t, broadcast: !t.broadcast } : t))
    })),

  applyStatus: (sessionId, status, detail) => {
    set((state) => ({ tabs: mapPaneBySession(state.tabs, sessionId, (p) => ({ ...p, status, statusDetail: detail })) }))
    if (status === 'connected') void useDataStore.getState().refreshHistory()
  },

  applyExit: (sessionId, exitCode, reason) =>
    set((state) => ({
      tabs: mapPaneBySession(state.tabs, sessionId, (p) => ({ ...p, status: 'exited', exitCode, exitReason: reason }))
    })),

  cycleTab: (direction) => {
    const { tabs, activeId } = get()
    if (tabs.length < 2 || !activeId) return
    const index = tabs.findIndex((t) => t.id === activeId)
    const next = tabs[(index + direction + tabs.length) % tabs.length]
    if (next) set({ activeId: next.id })
  },

  snapshotWorkspace: () => {
    const result: WorkspaceTab[] = []
    for (const tab of get().tabs) {
      if (tab.kind === 'sftp') {
        if (tab.sftpHostId) result.push({ kind: 'sftp', hostId: tab.sftpHostId })
        continue
      }
      // Bỏ pane không có origin (không mở lại được); tab rỗng thì bỏ luôn
      const panes = tab.panes.map((p) => p.origin).filter((o): o is PaneOrigin => o !== undefined)
      if (panes.length > 0) result.push({ kind: 'terminal', broadcast: tab.broadcast, panes })
    }
    return result
  },

  restoreWorkspace: async (wtabs) => {
    for (const wt of wtabs) {
      if (wt.kind === 'sftp') {
        await get().openSftp(wt.hostId) // openSftp tự toast nếu host lỗi/đã xoá
        continue
      }
      let tabId: string | null = null
      for (const origin of wt.panes) {
        try {
          const pane = await createPane(reqOf(origin))
          // 1 pane lỗi (host đã xoá…) không chặn các pane khác trong tab
          if (tabId === null) tabId = addTab(set, pane)
          else addPane(set, tabId, pane)
        } catch (error) {
          toastError(error)
        }
      }
      if (tabId !== null && wt.broadcast) {
        const id = tabId
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, broadcast: true } : t)) }))
      }
    }
  }
}))

function addTab(set: (fn: (s: TabsState) => Partial<TabsState>) => void, pane: Pane): string {
  const tab: AppTab = {
    id: newTabId(),
    kind: 'terminal',
    panes: [pane],
    activePaneId: pane.id,
    broadcast: false
  }
  set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
  return tab.id
}

function addPane(set: (fn: (s: TabsState) => Partial<TabsState>) => void, tabId: string, pane: Pane): void {
  set((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, panes: [...t.panes, pane], activePaneId: pane.id } : t))
  }))
}

function mapPaneBySession(tabs: AppTab[], sessionId: string, fn: (p: Pane) => Pane): AppTab[] {
  return tabs.map((t) => {
    if (!t.panes.some((p) => p.sessionId === sessionId)) return t
    return { ...t, panes: t.panes.map((p) => (p.sessionId === sessionId ? fn(p) : p)) }
  })
}
