import { useEffect, useState } from 'react'
import type { SyncRunResult, SyncStatusDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, Field, Modal, Select, TextInput } from './ui'
import { useT } from '../i18n'

const AUTO_CHOICES = [0, 5, 15, 30, 60]

/**
 * Sync E2EE (Phase 4): đồng bộ vault mã hoá qua thư mục (Syncthing/Drive/Dropbox/OneDrive…).
 * Backend chỉ thấy blob mã hoá; sync passphrase không bao giờ rời máy.
 *
 * Ngoài thư mục còn có đường "chuyển bằng file": xuất/nhập thẳng blob, dùng khi ngồi máy khác
 * và chỉ có trình duyệt — không cần cài client đồng bộ nào.
 */
export function SyncModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [status, setStatus] = useState<SyncStatusDto | null>(null)
  const [folder, setFolder] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [filePass, setFilePass] = useState('')
  const [showFile, setShowFile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Lần chạy vừa rồi bị chặn vì nghi ghi đè mất dữ liệu → hiện nút ghi đè có chủ ý. */
  const [blocked, setBlocked] = useState(false)

  const refresh = (): void => {
    void window.infra.sync.status().then(setStatus)
  }
  useEffect(refresh, [])

  const pickFolder = async (): Promise<void> => {
    const picked = await window.infra.sync.pickFolder()
    if (picked) setFolder(picked)
  }

  /**
   * Bọc chung mọi hành động gọi main: reset thông báo, khoá nút, và quan trọng nhất là
   * `catch` — invoke có thể reject (vault khoá, path không hợp lệ…), không bắt thì `busy`
   * kẹt true và nút treo vĩnh viễn.
   */
  const run = async (action: () => Promise<SyncRunResult>, onOk?: (r: SyncRunResult) => void): Promise<void> => {
    setError(null)
    setMessage(null)
    setBlocked(false)
    setBusy(true)
    try {
      const result = await action()
      if (result.ok) {
        setMessage(result.message)
        onOk?.(result)
        refresh()
        void useDataStore.getState().refreshAll() // dữ liệu có thể vừa được kéo về
      } else {
        setError(result.message)
        setBlocked(result.needsConfirm === true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const configure = (force = false): void => {
    if (!folder.trim()) return setError(t('sync.errFolder'))
    if (passphrase.length < 8) return setError(t('sync.errPass'))
    void run(
      () => window.infra.sync.configure(folder.trim(), passphrase, force),
      () => setPassphrase('')
    )
  }

  const syncNow = (force = false): void => void run(() => window.infra.sync.now(force))

  const setAuto = async (minutes: number): Promise<void> => {
    try {
      setStatus(await window.infra.sync.setAuto(minutes))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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

  const fileSection = (
    <div className="mb-3 rounded border border-edge bg-input px-3 py-2">
      <button
        type="button"
        className="w-full text-left text-xs text-accent hover:underline"
        onClick={() => setShowFile((v) => !v)}
      >
        {showFile ? '▾' : '▸'} {t('sync.fileTitle')}
      </button>
      {showFile && (
        <>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">{t('sync.fileDesc')}</p>
          <Field label={t('sync.filePass')}>
            <TextInput
              type="password"
              value={filePass}
              onChange={(e) => setFilePass(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(() => window.infra.sync.exportFile(filePass), () => setFilePass(''))}
            >
              {t('sync.export')}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(() => window.infra.sync.importFile(filePass), () => setFilePass(''))}
            >
              {t('sync.import')}
            </Button>
          </div>
        </>
      )}
    </div>
  )

  const feedback = (
    <>
      {error && <p className="mb-2 whitespace-pre-line text-xs text-danger">{error}</p>}
      {message && <p className="mb-2 text-xs text-success">{message}</p>}
    </>
  )

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
            {fileSection}
            {feedback}
            <div className="flex justify-end gap-2">
              {blocked && (
                <Button variant="danger" disabled={busy} onClick={() => configure(true)}>
                  {t('sync.force')}
                </Button>
              )}
              <Button variant="primary" disabled={busy} onClick={() => configure()}>
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
            <Field label={t('sync.auto')}>
              <Select
                value={String(status?.autoMinutes ?? 0)}
                onChange={(e) => void setAuto(Number(e.target.value))}
              >
                {AUTO_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? t('sync.autoOff') : t('sync.autoEvery', { n: String(m) })}
                  </option>
                ))}
              </Select>
            </Field>
            {fileSection}
            {feedback}
            <div className="flex items-center justify-between gap-2">
              <Button variant="danger" disabled={busy} onClick={() => void disable()}>
                {t('sync.disable')}
              </Button>
              <div className="flex gap-2">
                {blocked && (
                  <Button variant="danger" disabled={busy} onClick={() => syncNow(true)}>
                    {t('sync.force')}
                  </Button>
                )}
                <Button variant="primary" disabled={busy} onClick={() => syncNow()}>
                  {busy ? t('sync.syncing') : t('sync.now')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
