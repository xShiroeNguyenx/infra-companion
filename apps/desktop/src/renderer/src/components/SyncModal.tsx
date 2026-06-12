import { useEffect, useState } from 'react'
import type { SyncStatusDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, Field, Modal, TextInput } from './ui'
import { useT } from '../i18n'

/**
 * Sync E2EE (Phase 4): đồng bộ vault mã hoá qua thư mục (Syncthing/Drive/Dropbox/OneDrive…).
 * Backend chỉ thấy blob mã hoá; sync passphrase không bao giờ rời máy.
 */
export function SyncModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [status, setStatus] = useState<SyncStatusDto | null>(null)
  const [folder, setFolder] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = (): void => {
    void window.infra.sync.status().then(setStatus)
  }
  useEffect(refresh, [])

  const pickFolder = async (): Promise<void> => {
    const picked = await window.infra.sync.pickFolder()
    if (picked) setFolder(picked)
  }

  // invoke có thể reject (vault khoá, path không hợp lệ…) — không bắt thì busy kẹt true, nút treo vĩnh viễn
  const configure = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    if (!folder.trim()) return setError(t('sync.errFolder'))
    if (passphrase.length < 8) return setError(t('sync.errPass'))
    setBusy(true)
    try {
      const result = await window.infra.sync.configure(folder.trim(), passphrase)
      if (result.ok) {
        setPassphrase('')
        setMessage(result.message)
        refresh()
        void useDataStore.getState().refreshAll() // dữ liệu có thể vừa được kéo về
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.infra.sync.now()
      if (result.ok) {
        setMessage(result.message)
        refresh()
        void useDataStore.getState().refreshAll()
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const disable = async (): Promise<void> => {
    try {
      setStatus(await window.infra.sync.disable())
      setMessage(t('sync.disabled'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const configured = status?.configured

  return (
    <Modal title={t('sync.title')} onClose={onClose}>
      <div className="w-[460px] max-w-full">
        {!configured ? (
          <>
            <p className="mb-3 text-xs leading-relaxed text-muted">{t('sync.desc')}</p>
            <Field label={t('sync.folder')}>
              <div className="flex gap-2">
                <TextInput value={folder} onChange={(e) => setFolder(e.target.value)} placeholder={t('sync.folderPh')} className="flex-1" />
                <Button type="button" onClick={() => void pickFolder()}>{t('sync.choose')}</Button>
              </div>
            </Field>
            <Field label={t('sync.passphrase')}>
              <TextInput type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="••••••••" />
            </Field>
            <p className="mb-3 text-[11px] text-warning/90">{t('sync.warn')}</p>
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
            {message && <p className="mb-2 text-xs text-success">{message}</p>}
            <div className="flex justify-end">
              <Button variant="primary" disabled={busy} onClick={() => void configure()}>
                {busy ? t('sync.setting') : t('sync.enable')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 rounded border border-edge bg-input px-3 py-2 text-xs">
              <div className="text-success">{t('sync.on')}</div>
              <div className="mt-1 truncate text-muted">{status?.folder}</div>
              {status?.lastSyncAt && (
                <div className="mt-1 text-subtle">
                  {t('sync.last', { time: new Date(status.lastSyncAt).toLocaleString(), msg: status.lastMessage ?? '' })}
                </div>
              )}
            </div>
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
            {message && <p className="mb-2 text-xs text-success">{message}</p>}
            <div className="flex justify-between">
              <Button variant="danger" disabled={busy} onClick={() => void disable()}>
                {t('sync.disable')}
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void syncNow()}>
                {busy ? t('sync.syncing') : t('sync.now')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
