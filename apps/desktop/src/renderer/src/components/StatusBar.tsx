import { useTabsStore } from '../stores/tabs'
import { useVaultStore } from '../stores/vault'

const STATUS_LABEL: Record<string, string> = {
  connecting: 'đang kết nối…',
  reconnecting: 'đang kết nối lại…',
  connected: 'đã kết nối',
  exited: 'đã kết thúc'
}

export function StatusBar() {
  const { tabs, activeId } = useTabsStore()
  const lock = useVaultStore((s) => s.lock)
  const tab = tabs.find((t) => t.id === activeId)
  const { electron, node } = window.infra.versions

  let info = 'Không có phiên nào'
  if (tab?.kind === 'sftp') {
    info = tab.sftpTitle ?? 'SFTP'
  } else if (tab) {
    const pane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
    if (pane) {
      info = `${pane.subtitle ?? pane.title} — ${STATUS_LABEL[pane.status] ?? pane.status}${
        pane.statusDetail ? ` (${pane.statusDetail})` : ''
      }`
      if (tab.broadcast && tab.panes.length > 1) info += ` · 📡 broadcast ${tab.panes.length} pane`
    }
  }

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-zinc-800 bg-[#11151f] px-3 text-[11px] text-zinc-500 select-none">
      <span className="truncate">{info}</span>
      <span className="flex items-center gap-3">
        <button className="hover:text-zinc-200" title="Khoá vault ngay" onClick={() => void lock()}>
          🔒 Khoá vault
        </button>
        <span>
          Infra Companion 0.1.0 · Electron {electron} · Node {node}
        </span>
      </span>
    </div>
  )
}
