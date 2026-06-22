import { useEffect, useState } from 'react'
import type { PluginInfoDto, PluginStatusDto } from '@infra/shared'
import { useT, type I18nKey } from '../i18n'
import { usePluginStore } from '../stores/plugins'
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

/** Quản lý plugin: bật/tắt, reload, mở thư mục, xem lỗi/log. */
export function PluginsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const plugins = usePluginStore((s) => s.plugins)
  const rescan = usePluginStore((s) => s.rescan)
  const setEnabled = usePluginStore((s) => s.setEnabled)
  const reload = usePluginStore((s) => s.reload)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Mở modal là quét lại thư mục → plugin mới copy vào hiện ngay (không cần khởi động lại app)
  useEffect(() => {
    void rescan()
  }, [rescan])

  return (
    <Modal title={t('plugins.title')} onClose={onClose}>
      <div className="w-[600px] max-w-full">
        <div className="text-subtle mb-2 flex items-center justify-between text-[11px]">
          <span>{t('plugins.count', { n: plugins.length })}</span>
          <div className="flex items-center gap-3">
            <button className="hover:text-content" onClick={() => void rescan()}>
              ↻ {t('plugins.rescan')}
            </button>
            <button className="hover:text-content" onClick={() => window.infra.plugins.openFolder()}>
              📂 {t('plugins.openFolder')}
            </button>
          </div>
        </div>

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
      </div>
    </Modal>
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
