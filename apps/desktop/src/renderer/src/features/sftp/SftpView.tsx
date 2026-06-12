import { useEffect, useMemo, useState } from 'react'
import type { TransferEvent } from '@infra/shared'
import { formatSize } from '../../lib/paths'
import { errorMessage, useToastsStore } from '../../stores/toasts'
import type { AppTab } from '../../stores/tabs'
import { FilePane, usePane, type PaneAdapter } from './FilePane'
import { useT } from '../../i18n'

/** Tab SFTP: dual-pane local ↔ remote + hàng đợi transfer ở đáy. */
export function SftpView({ tab, active }: { tab: AppTab; active: boolean }) {
  const t = useT()
  const [transfers, setTransfers] = useState<TransferEvent[]>([])
  const sid = tab.sftpSessionId ?? ''

  const localAdapter = useMemo<PaneAdapter>(
    () => ({
      initialPath: () => window.infra.fs.home(),
      list: (path) => window.infra.fs.list(path),
      mkdir: (path) => window.infra.fs.mkdir(path),
      rename: (from, to) => window.infra.fs.rename(from, to),
      delete: (path) => window.infra.fs.delete(path)
    }),
    []
  )

  const remoteAdapter = useMemo<PaneAdapter>(
    () => ({
      initialPath: () => Promise.resolve(tab.sftpHome ?? '/'),
      list: (path) => window.infra.sftp.list(sid, path),
      mkdir: (path) => window.infra.sftp.mkdir(sid, path),
      rename: (from, to) => window.infra.sftp.rename(sid, from, to),
      delete: (path, isDir) => window.infra.sftp.delete(sid, path, isDir),
      chmod: (path, mode) => window.infra.sftp.chmod(sid, path, mode),
      edit: (path) => window.infra.sftp.edit(sid, path)
    }),
    [sid, tab.sftpHome]
  )

  const local = usePane(localAdapter)
  const remote = usePane(remoteAdapter)

  useEffect(() => {
    return window.infra.sftp.onTransfer((event) => {
      setTransfers((prev) => {
        const idx = prev.findIndex((t) => t.id === event.id)
        const next = idx >= 0 ? [...prev.slice(0, idx), event, ...prev.slice(idx + 1)] : [...prev, event]
        return next.slice(-20)
      })
      if (event.status === 'done') {
        // refresh pane đích sau khi transfer xong
        if (event.kind === 'download') void local.refresh()
        else void remote.refresh()
      }
      if (event.status === 'error' && event.error) {
        useToastsStore.getState().push(`${event.label}: ${event.error}`)
      }
    })
  }, [local, remote])

  const upload = async (): Promise<void> => {
    if (!local.selected) return
    const localPath =
      local.path.endsWith('\\') || local.path.endsWith('/')
        ? local.path + local.selected.name
        : `${local.path}${local.path.includes('\\') ? '\\' : '/'}${local.selected.name}`
    try {
      await window.infra.sftp.upload(sid, localPath, remote.path)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  const download = async (): Promise<void> => {
    if (!remote.selected) return
    const remotePath = remote.path.endsWith('/') ? remote.path + remote.selected.name : `${remote.path}/${remote.selected.name}`
    try {
      await window.infra.sftp.download(sid, remotePath, local.path)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  const activeTransfers = transfers.filter((t) => t.status === 'running')

  return (
    <div className={`absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      <div className="flex min-h-0 flex-1 gap-0 p-2">
        <FilePane title="Local" adapter={localAdapter} pane={local} />
        <div className="flex flex-col items-center justify-center gap-2 px-1.5">
          <button
            className="rounded border border-edge-strong px-2 py-1 text-sm text-content hover:bg-hover disabled:opacity-40"
            title={t('sftp.uploadTip')}
            disabled={!local.selected}
            onClick={() => void upload()}
          >
            →
          </button>
          <button
            className="rounded border border-edge-strong px-2 py-1 text-sm text-content hover:bg-hover disabled:opacity-40"
            title={t('sftp.downloadTip')}
            disabled={!remote.selected}
            onClick={() => void download()}
          >
            ←
          </button>
        </div>
        <FilePane title="Remote" adapter={remoteAdapter} pane={remote} />
      </div>

      {transfers.length > 0 && (
        <div className="max-h-28 shrink-0 overflow-y-auto border-t border-edge bg-panel px-3 py-1.5">
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-subtle uppercase">
            {t('sftp.transfers')} {activeTransfers.length > 0 ? t('sftp.running', { n: activeTransfers.length }) : ''}
          </div>
          {[...transfers].reverse().map((transfer) => (
            <div key={transfer.id} className="mb-1 flex items-center gap-2 text-[11px]">
              <span
                className={
                  transfer.status === 'error'
                    ? 'text-danger'
                    : transfer.status === 'done'
                      ? 'text-success'
                      : 'text-warning'
                }
              >
                {transfer.kind === 'download' ? '↓' : '↑'}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted">{transfer.label}</span>
              {transfer.status === 'running' && transfer.total > 0 && (
                <div className="h-1 w-32 overflow-hidden rounded bg-hover">
                  <div
                    className="h-full bg-accent-hover"
                    style={{ width: `${Math.min(100, (transfer.transferred / transfer.total) * 100)}%` }}
                  />
                </div>
              )}
              <span className="w-20 text-right text-subtle">
                {transfer.status === 'done'
                  ? t('sftp.done')
                  : transfer.status === 'error'
                    ? t('sftp.error')
                    : `${formatSize(transfer.transferred)}/${formatSize(transfer.total)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
