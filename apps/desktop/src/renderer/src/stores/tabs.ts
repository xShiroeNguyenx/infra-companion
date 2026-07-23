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

export type TabKind = 'terminal' | 'sftp' | 'vnc' | 'monitor' | 'compare'

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
  /** vnc (F13): phiên VNC — noVNC nối vào ws://127.0.0.1:<wsPort>/?token=<token>. */
  vncSessionId?: string
  vncWsPort?: number
  vncToken?: string
  vncTitle?: string
  vncHostId?: string
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
  /** Gộp CHỌN LỌC: chỉ gộp các tab terminal trong `tabIds` (luôn gồm tab đích) vào tab đích. */
  mergeTabsSelected: (tabId: string, tabIds: string[]) => void
  /** Tách mỗi pane của tab thành 1 tab riêng (đảo của mergeTabs). */
  unmergeTab: (tabId: string) => void
  /** Đổi vị trí 1 pane trong tab (delta -1 = sang trái/lên, +1 = sang phải/xuống). */
  movePane: (tabId: string, paneId: string, delta: -1 | 1) => void
  /** Đưa 1 pane lên đầu danh sách — thành "cửa sổ chính" ở layout main-left/main-top. */
  setMainPane: (tabId: string, paneId: string) => void
  openLocal: (profileId?: string) => Promise<void>
  openSsh: (hostId: string) => Promise<void>
  /** Mở nhiều host cùng lúc: mỗi host 1 pane trong CÙNG 1 tab mới (chia màn hình sẵn). */
  openSshGroup: (hostIds: string[]) => Promise<void>
  openQuick: (target: string) => Promise<void>
  openSftp: (hostId: string) => Promise<void>
  /** Mở tab VNC (F13): main dựng cầu ws↔tcp qua jump host, noVNC render trong tab. */
  openVnc: (hostId: string) => Promise<void>
  /** Hiện trang Dashboard (home) — KHÔNG phải tab: activeId=null là đang ở home, chọn tab để quay lại. */
  showDashboard: () => void
  /** Mở Monitoring thành 1 tab riêng (như tab server) — chỉ 1 tab monitor duy nhất; đã có thì focus lại.
   *  Tab này đọc dữ liệu real-time từ useMonitorStore (chung với dock/cửa sổ tách rời). */
  openMonitorTab: () => void
  /** Mở So sánh config thành 1 tab riêng (chỉ 1 tab compare duy nhất; đã có thì focus lại). */
  openCompareTab: () => void
  /** Mở thêm pane trong tab đang active (split). opener tạo phiên. */
  splitLocal: (profileId?: string) => Promise<void>
  splitSsh: (hostId: string) => Promise<void>
  closeTab: (id: string) => void
  closePane: (tabId: string, paneId: string) => void
  /** Mở lại phiên cho pane đã exited (vd mất kết nối sau 3 lần auto-retry) — giữ nguyên pane/layout,
   *  scrollback cũ được nối tiếp (TerminalPane chụp snapshot theo sessionId MỚI khi remount). */
  reconnectPane: (tabId: string, paneId: string) => Promise<void>
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

  mergeTabsSelected: (tabId, tabIds) =>
    set((state) => {
      const target = state.tabs.find((t) => t.id === tabId)
      if (target?.kind !== 'terminal') return {}
      const ids = new Set(tabIds)
      ids.add(tabId) // tab đích luôn nằm trong nhóm gộp
      // Các tab terminal được chọn, giữ thứ tự trên thanh tab
      const chosen = state.tabs.filter((t) => t.kind === 'terminal' && ids.has(t.id))
      if (chosen.length < 2) return {} // không đủ để gộp
      const panes = chosen.flatMap((t) => t.panes)
      const tabs = state.tabs
        // Giữ lại: tab không phải terminal, tab terminal KHÔNG chọn, và chính tab đích
        .filter((t) => t.kind !== 'terminal' || !ids.has(t.id) || t.id === tabId)
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

  openVnc: async (hostId) => {
    try {
      const res = await window.infra.vnc.open(hostId)
      const tab: AppTab = {
        id: newTabId(),
        kind: 'vnc',
        panes: [],
        activePaneId: null,
        broadcast: false,
        vncSessionId: res.sessionId,
        vncWsPort: res.wsPort,
        vncToken: res.token,
        vncTitle: res.title,
        vncHostId: hostId
      }
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
    } catch (error) {
      toastError(error)
    }
  },

  showDashboard: () => set({ activeId: null }),

  openMonitorTab: () =>
    set((state) => {
      const existing = state.tabs.find((t) => t.kind === 'monitor')
      if (existing) return { activeId: existing.id }
      const tab: AppTab = {
        id: newTabId(),
        kind: 'monitor',
        panes: [],
        activePaneId: null,
        broadcast: false
      }
      return { tabs: [...state.tabs, tab], activeId: tab.id }
    }),

  openCompareTab: () =>
    set((state) => {
      const existing = state.tabs.find((t) => t.kind === 'compare')
      if (existing) return { activeId: existing.id }
      const tab: AppTab = {
        id: newTabId(),
        kind: 'compare',
        panes: [],
        activePaneId: null,
        broadcast: false
      }
      return { tabs: [...state.tabs, tab], activeId: tab.id }
    }),

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
    } else if (tab.kind === 'vnc') {
      if (tab.vncSessionId) window.infra.vnc.close(tab.vncSessionId)
    } else if (tab.kind === 'terminal') {
      for (const pane of tab.panes) {
        window.infra.terminal.kill(pane.sessionId)
        clearTermSession(pane.sessionId)
      }
    }
    // kind 'monitor': không có phiên nào để dọn (đọc chung useMonitorStore) — chỉ gỡ tab
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

  reconnectPane: async (tabId, paneId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    const pane = tab?.panes.find((p) => p.id === paneId)
    const origin = pane?.origin
    // Chỉ pane đã exited và có origin (cách mở lại) — status connecting chặn luôn double-click
    if (!pane || pane.status !== 'exited' || !origin) return
    const prev = pane
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id !== tabId
          ? t
          : { ...t, panes: t.panes.map((p) => (p.id === paneId ? { ...p, status: 'connecting' as const } : p)) }
      )
    }))
    try {
      const res = await window.infra.terminal.create(reqOf(origin))
      // Dọn phiên cũ: main đã dọn khi exit (kill chỉ để chắc), termBus xoá hàng đợi/snapshot id cũ
      window.infra.terminal.kill(prev.sessionId)
      clearTermSession(prev.sessionId)
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id !== tabId
            ? t
            : {
                ...t,
                panes: t.panes.map((p) =>
                  p.id !== paneId
                    ? p
                    : {
                        ...p,
                        sessionId: res.sessionId,
                        kind: res.kind,
                        title: res.title,
                        subtitle: res.subtitle,
                        status: res.kind === 'local' ? 'connected' : 'connecting',
                        statusDetail: undefined,
                        exitCode: undefined,
                        exitReason: undefined
                      }
                )
              }
        )
      }))
    } catch (error) {
      // Tạo phiên thất bại (host đã xoá, huỷ nhập password…) → toast + trả lại overlay exited cũ
      toastError(error)
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id !== tabId
            ? t
            : {
                ...t,
                panes: t.panes.map((p) =>
                  p.id === paneId
                    ? { ...p, status: 'exited' as const, exitCode: prev.exitCode, exitReason: prev.exitReason }
                    : p
                )
              }
        )
      }))
    }
  },

  setActive: (id) => set({ activeId: id }),

  setActivePane: (tabId, paneId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t))
    })),

  movePane: (tabId, paneId, delta) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t
        const idx = t.panes.findIndex((p) => p.id === paneId)
        const to = idx + delta
        if (idx < 0 || to < 0 || to >= t.panes.length) return t
        const panes = [...t.panes]
        const [moved] = panes.splice(idx, 1)
        panes.splice(to, 0, moved!)
        return { ...t, panes }
      })
    })),

  setMainPane: (tabId, paneId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t
        const idx = t.panes.findIndex((p) => p.id === paneId)
        if (idx <= 0) return t // đã là pane đầu → không cần đổi
        const panes = [...t.panes]
        const [moved] = panes.splice(idx, 1)
        panes.unshift(moved!)
        return { ...t, panes }
      })
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
