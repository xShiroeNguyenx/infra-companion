import { useTabsStore } from '../stores/tabs'
import { useVaultStore } from '../stores/vault'
import { useT } from '../i18n'
import type { I18nKey } from '../i18n/dict'

const STATUS_KEY: Record<string, I18nKey> = {
  connecting: 'status.connecting',
  reconnecting: 'status.reconnecting',
  connected: 'status.connected',
  exited: 'status.exited'
}

export function StatusBar() {
  const t = useT()
  const { tabs, activeId } = useTabsStore()
  const lock = useVaultStore((s) => s.lock)
  const tab = tabs.find((t) => t.id === activeId)
  const { electron, node } = window.infra.versions
  const appVersion = __APP_VERSION__

  let info = t('status.noSession')
  if (tab?.kind === 'sftp') {
    info = tab.sftpTitle ?? 'SFTP'
  } else if (tab) {
    const pane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
    if (pane) {
      const statusText = STATUS_KEY[pane.status] ? t(STATUS_KEY[pane.status]!) : pane.status
      info = `${pane.subtitle ?? pane.title} — ${statusText}${pane.statusDetail ? ` (${pane.statusDetail})` : ''}`
      if (tab.broadcast && tab.panes.length > 1) info += ` · ${t('status.broadcast', { n: tab.panes.length })}`
    }
  }

  return (
    <div className="border-edge bg-panel text-subtle flex h-6 shrink-0 items-center justify-between border-t px-3 text-[11px] select-none">
      <span className="truncate">{info}</span>
      <span className="flex items-center gap-3">
        <button className="hover:text-content" title={t('status.lockVault')} onClick={() => void lock()}>
          🔒 {t('status.lockVault')}
        </button>
        <span>
          Infra Companion {appVersion} · Electron {electron} · Node {node}
        </span>
      </span>
    </div>
  )
}
