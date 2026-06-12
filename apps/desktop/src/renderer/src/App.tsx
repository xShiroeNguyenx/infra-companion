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
import { SyncModal } from './components/SyncModal'
import { AiModal } from './components/AiModal'
import { RecordingsModal } from './components/RecordingsModal'
import { UpdateBanner } from './components/UpdateBanner'
import { SftpView } from './features/sftp/SftpView'
import { TerminalTabView } from './features/terminal/TerminalTabView'
import { useDataStore } from './stores/data'
import { useTabsStore } from './stores/tabs'
import { useToastsStore } from './stores/toasts'
import { useUiStore } from './stores/ui'
import { useVaultStore } from './stores/vault'

export default function App() {
  const vaultState = useVaultStore((s) => s.state)
  const { tabs, activeId, openLocal } = useTabsStore()
  const toasts = useToastsStore((s) => s.toasts)
  const dismiss = useToastsStore((s) => s.dismiss)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // store chung để Sidebar/palette cùng mở — tránh 2 instance modal dẫm chân nhau
  const modal = useUiStore((s) => s.modal)
  const setModal = useUiStore((s) => s.setModal)
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
    return () => {
      offLocked()
      offExit()
      offStatus()
      offTunnel()
    }
  }, [])

  useEffect(() => {
    if (vaultState !== 'unlocked') return
    void useDataStore.getState().refreshAll()
    if (!openedInitialTab.current) {
      openedInitialTab.current = true
      if (useTabsStore.getState().tabs.length === 0) void openLocal()
    }
  }, [vaultState, openLocal])

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
    return <div className="h-screen bg-[#0b0e14]" />
  }

  // Khoá vault: phủ VaultGate dạng overlay, KHÔNG unmount cây tab —
  // unmount sẽ dispose xterm → mất sạch scrollback dù session trong main vẫn sống (auto-lock 15')
  const locked = vaultState !== 'unlocked'

  const paletteCommands: Command[] = [
    { id: 'open-bulk', label: '⚡ Bulk Execution — chạy lệnh trên nhiều host', run: () => setModal('bulk') },
    { id: 'open-monitor', label: '📊 Monitoring Dashboard', run: () => setModal('monitor') },
    { id: 'open-net', label: '🛰 Network Toolbox (ping/DNS/port)', run: () => setModal('net') },
    { id: 'open-ai', label: '🤖 Trợ lý AI (sinh lệnh / giải thích)', run: () => setModal('ai') },
    { id: 'open-recordings', label: '⏯ Bản ghi phiên (replay)', run: () => setModal('recordings') },
    { id: 'open-sync', label: '🔄 Sync (mã hoá đầu-cuối)', run: () => setModal('sync') },
    { id: 'open-snippets', label: '⚡ Quản lý Snippets', run: () => setModal('snippets') },
    { id: 'open-tunnels', label: '⇄ Tunnels (port forwarding)', run: () => setModal('tunnels') },
    { id: 'open-keys', label: '🔑 SSH Keys', run: () => setModal('keys') },
    { id: 'open-logs', label: '📂 Mở thư mục log phiên', run: () => window.infra.terminal.openLogFolder() }
  ]

  return (
    <div className="relative flex h-screen flex-col bg-[#0b0e14] text-zinc-200">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <UpdateBanner />
          <TabsBar />
          <div className="relative flex-1 overflow-hidden">
            {tabs.map((tab) =>
              tab.kind === 'sftp' ? (
                <SftpView key={tab.id} tab={tab} active={tab.id === activeId} />
              ) : (
                <TerminalTabView key={tab.id} tab={tab} active={tab.id === activeId} />
              )
            )}
            {tabs.length === 0 && (
              <div className="flex h-full items-center justify-center">
                <button
                  className="rounded-lg border border-zinc-700 px-6 py-3 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                  onClick={() => void openLocal()}
                >
                  + Mở terminal mới (Ctrl+Shift+T) · Ctrl+Shift+P để mở Command Palette
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
                  ? 'border-red-800 bg-red-950/90 text-red-200'
                  : 'border-zinc-700 bg-zinc-900/95 text-zinc-200'
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
