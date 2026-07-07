import { useCallback, useEffect, useState } from 'react'
import type { MarketplacePluginDto, PluginInfoDto, PluginStatusDto } from '@infra/shared'
import { useT, type I18nKey } from '../i18n'
import { usePluginStore } from '../stores/plugins'
import { useToastsStore } from '../stores/toasts'
import { Button, Modal } from './ui'

const STATUS_KEY: Record<PluginStatusDto, I18nKey> = {
  active: 'plugins.status.active',
  disabled: 'plugins.status.disabled',
  failed: 'plugins.status.failed',
  crashed: 'plugins.status.crashed',
  loading: 'plugins.status.loading'
}

const STATUS_CLASS: Record<PluginStatusDto, string> = {
  active: 'bg-success/20 text-success',
  disabled: 'bg-hover text-subtle',
  failed: 'bg-danger/20 text-danger',
  crashed: 'bg-danger/20 text-danger',
  loading: 'bg-warning/20 text-warning'
}

/** Quản lý plugin: tab Đã cài (bật/tắt, reload, mở thư mục, xem lỗi/log)
 *  + tab Marketplace (F52): danh mục JSON công khai, cài/cập nhật 1 click. */
export function PluginsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const plugins = usePluginStore((s) => s.plugins)
  const rescan = usePluginStore((s) => s.rescan)
  const setEnabled = usePluginStore((s) => s.setEnabled)
  const reload = usePluginStore((s) => s.reload)
  const [tab, setTab] = useState<'installed' | 'market'>('installed')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Mở modal là quét lại thư mục → plugin mới copy vào hiện ngay (không cần khởi động lại app)
  useEffect(() => {
    void rescan()
  }, [rescan])

  const tabClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs ${active ? 'bg-hover text-content font-medium' : 'text-subtle hover:text-content'}`

  return (
    <Modal title={t('plugins.title')} onClose={onClose}>
      <div className="w-[600px] max-w-full">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button className={tabClass(tab === 'installed')} onClick={() => setTab('installed')}>
              {t('market.tab.installed')} ({plugins.length})
            </button>
            <button className={tabClass(tab === 'market')} onClick={() => setTab('market')}>
              🛒 {t('market.tab.browse')}
            </button>
          </div>
          {tab === 'installed' && (
            <div className="text-subtle flex items-center gap-3 text-[11px]">
              <button className="hover:text-content" onClick={() => void rescan()}>
                ↻ {t('plugins.rescan')}
              </button>
              <button className="hover:text-content" onClick={() => window.infra.plugins.openFolder()}>
                📂 {t('plugins.openFolder')}
              </button>
            </div>
          )}
        </div>

        {tab === 'installed' ? (
          <div className="max-h-[60vh] overflow-y-auto">
            {plugins.length === 0 && <p className="text-subtle py-8 text-center text-xs">{t('plugins.empty')}</p>}

            {plugins.map((p) => (
              <PluginRow
                key={p.id}
                plugin={p}
                expanded={expanded === p.id}
                onToggleExpand={() => setExpanded(expanded === p.id ? null : p.id)}
                onSetEnabled={(enabled) => void setEnabled(p.id, enabled)}
                onReload={() => void reload(p.id)}
              />
            ))}
          </div>
        ) : (
          <MarketTab installed={plugins} onInstalled={rescan} />
        )}
      </div>
    </Modal>
  )
}

/** So semver "a > b" tối giản cho nút Cập nhật (bỏ prerelease). Không import @infra/core
 *  vào renderer — barrel của core kéo theo module Node (ssh2…) làm vỡ bundle web. */
function semverGt(a: string, b: string): boolean {
  const pa = a.split('-')[0]!.split('.').map(Number)
  const pb = b.split('-')[0]!.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

function MarketTab({ installed, onInstalled }: { installed: PluginInfoDto[]; onInstalled: () => Promise<void> }) {
  const t = useT()
  const push = useToastsStore((s) => s.push)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<MarketplacePluginDto[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const res = await window.infra.marketplace.list()
    setItems(res.plugins)
    setError(res.ok ? null : (res.error ?? '?'))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const install = async (p: MarketplacePluginDto): Promise<void> => {
    setBusyId(p.id)
    const res = await window.infra.marketplace.install(p.id)
    if (res.ok) {
      await onInstalled() // rescan → plugin nạp ngay, tab Đã cài cập nhật
      push(t('market.installedOk', { name: p.name }), 'info')
    } else {
      push(t('market.installFailed', { msg: res.error ?? '?' }))
    }
    setBusyId(null)
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      {loading && <p className="text-subtle py-8 text-center text-xs">{t('market.loading')}</p>}
      {!loading && error && (
        <div className="py-8 text-center">
          <p className="text-danger mb-2 text-xs">{t('market.error', { msg: error })}</p>
          <Button className="!px-3 !py-1 !text-xs" onClick={() => void load()}>
            ↻ {t('market.retry')}
          </Button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="text-subtle py-8 text-center text-xs">{t('market.empty')}</p>
      )}

      {!loading &&
        !error &&
        items.map((p) => {
          const local = installed.find((i) => i.id === p.id)
          const busy = busyId === p.id
          const canUpdate = local && semverGt(p.version, local.version)
          return (
            <div key={p.id} className="border-edge bg-input mb-1.5 rounded border px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-content truncate text-xs font-medium">{p.name}</span>
                    <span className="text-subtle text-[10px]">v{p.version}</span>
                    {p.author && <span className="text-subtle truncate text-[10px]">— {p.author}</span>}
                  </div>
                  {p.description && <div className="text-subtle mt-0.5 truncate text-[11px]">{p.description}</div>}
                </div>
                <div className="shrink-0">
                  {local && !canUpdate ? (
                    <span className="text-success text-[11px]">{t('market.installed')}</span>
                  ) : (
                    <Button
                      className="!px-2 !py-1 !text-xs"
                      variant="primary"
                      disabled={busy}
                      onClick={() => void install(p)}
                    >
                      {busy
                        ? t('market.installing')
                        : canUpdate
                          ? t('market.update', { v: `v${p.version}` })
                          : t('market.install')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
    </div>
  )
}

function PluginRow({
  plugin: p,
  expanded,
  onToggleExpand,
  onSetEnabled,
  onReload
}: {
  plugin: PluginInfoDto
  expanded: boolean
  onToggleExpand: () => void
  onSetEnabled: (enabled: boolean) => void
  onReload: () => void
}) {
  const t = useT()
  const hasDetail = Boolean(p.error) || p.logTail.length > 0
  return (
    <div className="border-edge bg-input mb-1.5 rounded border px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-content truncate text-xs font-medium">{p.name}</span>
            <span className="text-subtle text-[10px]">v{p.version}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[p.status]}`}>
              {t(STATUS_KEY[p.status])}
            </span>
          </div>
          {p.description && <div className="text-subtle mt-0.5 truncate text-[11px]">{p.description}</div>}
          {p.commands.length > 0 && (
            <div className="text-subtle mt-0.5 text-[10px]">
              {t('plugins.commands', { n: p.commands.length })}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasDetail && (
            <button className="text-subtle hover:text-content px-1 text-xs" onClick={onToggleExpand}>
              {expanded ? '▲' : '▼'}
            </button>
          )}
          <Button className="!px-2 !py-1 !text-xs" onClick={onReload}>
            {t('plugins.reload')}
          </Button>
          <Button
            className="!px-2 !py-1 !text-xs"
            variant={p.enabled ? 'default' : 'primary'}
            onClick={() => onSetEnabled(!p.enabled)}
          >
            {p.enabled ? t('plugins.disable') : t('plugins.enable')}
          </Button>
        </div>
      </div>

      {expanded && hasDetail && (
        <div className="border-edge mt-2 border-t pt-2">
          {p.error && <div className="text-danger mb-1 text-[11px]">{t('plugins.lastError')}: {p.error}</div>}
          {p.logTail.length > 0 && (
            <pre className="text-subtle max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px]">
              {p.logTail.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
