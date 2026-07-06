import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TabsBar } from './components/TabsBar'
import { PromptsHost } from './components/PromptsHost'
import { VaultGate } from './components/VaultGate'
import { CommandPalette, type Command } from './components/CommandPalette'
import { SnippetsModal } from './components/SnippetsModal'
import { TunnelsModal } from './components/TunnelsModal'
import { KeysModal } from './components/KeysModal'
import { BulkRunModal } from './components/BulkRunModal'
import { NetToolboxModal } from './components/NetToolboxModal'
import { MonitorModal } from './components/MonitorModal'
import { MonitorDock } from './components/MonitorDock'
import { SyncModal } from './components/SyncModal'
import { AiModal } from './components/AiModal'
import { RecordingsModal } from './components/RecordingsModal'
import { SettingsModal } from './components/SettingsModal'
import { WorkspacesModal } from './components/WorkspacesModal'
import { PluginsModal } from './components/PluginsModal'
import { PluginPanelModal } from './components/PluginPanelModal'
import { UpdateBanner } from './components/UpdateBanner'
import { SftpView } from './features/sftp/SftpView'
import { useT } from './i18n'
import { TerminalTabView } from './features/terminal/TerminalTabView'
import { useDataStore } from './stores/data'
import { useTabsStore } from './stores/tabs'
import { useSettingsStore } from './stores/settings'
import { useToastsStore } from './stores/toasts'
import { useUiStore } from './stores/ui'
import { usePluginStore } from './stores/plugins'
import { useMonitorStore } from './stores/monitor'
import { useVaultStore } from './stores/vault'

export default function App() {
  const t = useT()
  const vaultState = useVaultStore((s) => s.state)
  const { tabs, activeId, openLocal } = useTabsStore()
  const toasts = useToastsStore((s) => s.toasts)
  const dismiss = useToastsStore((s) => s.dismiss)
  const bgImage = useSettingsStore((s) => s.backgroundImage)
  const bgOpacity = useSettingsStore((s) => s.backgroundOpacity)
  const bgBlur = useSettingsStore((s) => s.backgroundBlur)
  const bgPosition = useSettingsStore((s) => s.backgroundPosition)
  const bgFit = useSettingsStore((s) => s.backgroundFit)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // store chung để Sidebar/palette cùng mở — tránh 2 instance modal dẫm chân nhau
  const modal = useUiStore((s) => s.modal)
  const setModal = useUiStore((s) => s.setModal)
  const pluginPanel = usePluginStore((s) => s.panel)
  const monitorActive = useMonitorStore((s) => s.active)
  const pluginCommands = usePluginStore((s) => s.contributions)
  const booted = useRef(false)
  const openedInitialTab = useRef(false)

  useEffect(() => {
    // refresh chỉ chạy 1 lần; listener thì subscribe/unsubscribe theo vòng đời effect
    // (guard cả effect bằng booted sẽ làm listener chết vĩnh viễn nếu bật StrictMode)
    if (!booted.current) {
      booted.current = true
      void useVaultStore.getState().refresh()
    }
    const offLocked = window.infra.vault.onLocked(() => useVaultStore.getState().markLocked())
    const offExit = window.infra.terminal.onExit((e) =>
      useTabsStore.getState().applyExit(e.sessionId, e.exitCode, e.reason)
    )
    const offStatus = window.infra.terminal.onStatus((e) =>
      useTabsStore.getState().applyStatus(e.sessionId, e.status, e.detail)
    )
    const offTunnel = window.infra.tunnels.onState((e) =>
      useDataStore.getState().applyTunnelState(e.ruleId, e.status, e.detail)
    )
    const offContrib = window.infra.plugins.onContributionsChanged((list) =>
      usePluginStore.getState().applyContributions(list)
    )
    const offPanel = window.infra.plugins.onPanel((p) => usePluginStore.getState().setPanel(p))
    const offNotify = window.infra.plugins.onNotify((n) => useToastsStore.getState().push(n.message))
    const offSample = window.infra.monitor.onSample((s) => useMonitorStore.getState().applySample(s))
    return () => {
      offLocked()
      offExit()
      offStatus()
      offTunnel()
      offContrib()
      offPanel()
      offNotify()
      offSample()
    }
  }, [])

  useEffect(() => {
    if (vaultState !== 'unlocked') return
    void useDataStore.getState().refreshAll()
    void usePluginStore.getState().refresh()
    if (!openedInitialTab.current) {
      openedInitialTab.current = true
      if (useTabsStore.getState().tabs.length === 0) void openLocal()
    }
  }, [vaultState, openLocal])

  // Báo main phiên terminal đang active (cho plugin api.terminal.getActiveSessionId)
  useEffect(() => {
    const tab = tabs.find((tb) => tb.id === activeId)
    let sid: string | null = null
    if (tab && tab.kind === 'terminal') {
      const pane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
      sid = pane?.sessionId ?? null
    }
    window.infra.terminal.setActive(sid)
  }, [tabs, activeId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // vault đang khoá: không cho shortcut mở tab/modal sau lưng màn hình khoá
      if (useVaultStore.getState().state !== 'unlocked') return
      // Command palette: Ctrl+Shift+P
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyP') {
        event.preventDefault()
        event.stopPropagation()
        setPaletteOpen((v) => !v)
        return
      }
      if (!event.ctrlKey) return
      const state = useTabsStore.getState()
      if (event.shiftKey && event.code === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        state.cycleTab(-1)
      } else if (event.code === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        state.cycleTab(1)
      } else if (event.shiftKey && event.code === 'KeyT') {
        event.preventDefault()
        event.stopPropagation()
        void state.openLocal()
      } else if (event.shiftKey && event.code === 'KeyW') {
        event.preventDefault()
        event.stopPropagation()
        if (state.activeId) state.closeTab(state.activeId)
      } else if (event.shiftKey && event.code === 'KeyD') {
        event.preventDefault()
        event.stopPropagation()
        void state.splitLocal()
      } else if (event.shiftKey && event.code === 'KeyB') {
        event.preventDefault()
        event.stopPropagation()
        if (state.activeId) state.toggleBroadcast(state.activeId)
      } else if (event.shiftKey && event.code === 'KeyH') {
        event.preventDefault()
        event.stopPropagation()
        useUiStore.getState().toggleSidebar()
      } else if (!event.shiftKey && event.code === 'KeyI') {
        event.preventDefault()
        event.stopPropagation()
        setModal('ai')
      }
    }
    // capture: chặn trước khi xterm xử lý (Ctrl+I là ký tự Tab trong terminal — không chặn sẽ dính cả 2)
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  if (vaultState === 'loading') {
    return <div className="bg-app h-screen" />
  }

  // Khoá vault: phủ VaultGate dạng overlay, KHÔNG unmount cây tab —
  // unmount sẽ dispose xterm → mất sạch scrollback dù session trong main vẫn sống (auto-lock 15')
  const locked = vaultState !== 'unlocked'

  const paletteCommands: Command[] = [
    { id: 'open-workspaces', label: t('menu.workspaces'), run: () => setModal('workspaces') },
    { id: 'open-bulk', label: t('menu.bulk'), run: () => setModal('bulk') },
    { id: 'open-monitor', label: t('menu.monitor'), run: () => setModal('monitor') },
    { id: 'open-net', label: t('menu.net'), run: () => setModal('net') },
    { id: 'open-ai', label: t('menu.ai'), run: () => setModal('ai') },
    { id: 'open-recordings', label: t('menu.recordings'), run: () => setModal('recordings') },
    { id: 'open-sync', label: t('menu.sync'), run: () => setModal('sync') },
    { id: 'open-snippets', label: t('menu.snippets'), run: () => setModal('snippets') },
    { id: 'open-tunnels', label: t('menu.tunnels'), run: () => setModal('tunnels') },
    { id: 'open-keys', label: `🔑 ${t('sidebar.keys')}`, run: () => setModal('keys') },
    { id: 'open-settings', label: t('menu.settings'), run: () => setModal('settings') },
    { id: 'open-plugins', label: t('menu.plugins'), run: () => setModal('plugins') },
    { id: 'open-logs', label: t('menu.openLogs'), run: () => window.infra.terminal.openLogFolder() },
    { id: 'toggle-sidebar', label: t('menu.toggleSidebar'), run: () => useUiStore.getState().toggleSidebar() },
    ...pluginCommands.map((c) => ({
      id: `plugin-${c.pluginId}-${c.commandId}`,
      label: c.title,
      hint: 'plugin',
      run: () => {
        const tab = tabs.find((tb) => tb.id === activeId)
        const sid =
          tab && tab.kind === 'terminal'
            ? ((tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0])?.sessionId ?? null)
            : null
        void window.infra.plugins.invokeCommand(c.pluginId, c.commandId, sid)
      }
    }))
  ]

  return (
    // isolate: App root là stacking context riêng → ảnh nền ở z âm nằm trên nền bg-app
    // nhưng dưới MỌI nội dung & overlay (modal/prompt/palette) mà không cần nâng z nội dung
    <div className="bg-app text-content relative isolate flex h-screen flex-col">
      {bgImage && (
        <div
          aria-hidden
          // -inset-8 để mép blur tràn ra ngoài viewport (body overflow:hidden cắt), tránh viền nhạt
          className="pointer-events-none absolute -inset-8"
          style={{
            zIndex: -10,
            backgroundImage: `url(${bgImage})`,
            backgroundSize: bgFit,
            backgroundPosition: bgPosition,
            backgroundRepeat: 'no-repeat',
            opacity: bgOpacity,
            filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined
          }}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <UpdateBanner />
          <TabsBar />
          <div className="relative flex-1 overflow-hidden">
            {/* Tab ẩn được giấu bằng CSS (active=false), KHÔNG unmount — unmount xterm → mất scrollback */}
            <div className="relative h-full">
              {tabs.map((tab) =>
                tab.kind === 'sftp' ? (
                  <SftpView key={tab.id} tab={tab} active={tab.id === activeId} />
                ) : (
                  <TerminalTabView key={tab.id} tab={tab} active={tab.id === activeId} />
                )
              )}
            </div>
            {tabs.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <button
                  className="border-edge-strong text-muted hover:border-subtle hover:text-content rounded-lg border px-6 py-3 text-sm"
                  onClick={() => void openLocal()}
                >
                  {t('app.newTerminalHint')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <StatusBar />

      <PromptsHost />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} extraCommands={paletteCommands} />}
      {modal === 'snippets' && <SnippetsModal onClose={() => setModal(null)} />}
      {modal === 'tunnels' && <TunnelsModal onClose={() => setModal(null)} />}
      {modal === 'keys' && <KeysModal onClose={() => setModal(null)} />}
      {modal === 'bulk' && <BulkRunModal onClose={() => setModal(null)} />}
      {modal === 'net' && <NetToolboxModal onClose={() => setModal(null)} />}
      {modal === 'monitor' && <MonitorModal onClose={() => setModal(null)} />}
      {modal === 'sync' && <SyncModal onClose={() => setModal(null)} />}
      {modal === 'ai' && <AiModal onClose={() => setModal(null)} />}
      {modal === 'recordings' && <RecordingsModal onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'workspaces' && <WorkspacesModal onClose={() => setModal(null)} />}
      {modal === 'plugins' && <PluginsModal onClose={() => setModal(null)} />}
      {monitorActive && <MonitorDock />}
      {pluginPanel && (
        <PluginPanelModal panel={pluginPanel} onClose={() => usePluginStore.getState().setPanel(null)} />
      )}

      {locked && (
        <div className="absolute inset-0 z-[100]">
          <VaultGate />
        </div>
      )}

      {toasts.length > 0 && (
        <div className="absolute right-3 bottom-9 z-50 flex flex-col gap-2">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              className={`max-w-96 rounded border px-3 py-2 text-left text-xs shadow-lg ${
                toast.kind === 'error'
                  ? 'border-danger/60 bg-danger/15 text-danger'
                  : 'border-edge-strong bg-elevated text-content'
              }`}
              onClick={() => dismiss(toast.id)}
            >
              {toast.message}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
