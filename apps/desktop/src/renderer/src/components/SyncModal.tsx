import { useEffect, useState } from 'react'
import type { SyncStatusDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, Field, Modal, TextInput } from './ui'

/**
 * Sync E2EE (Phase 4): đồng bộ vault mã hoá qua thư mục (Syncthing/Drive/Dropbox/OneDrive…).
 * Backend chỉ thấy blob mã hoá; sync passphrase không bao giờ rời máy.
 */
export function SyncModal({ onClose }: { onClose: () => void }) {
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
    if (!folder.trim()) return setError('Chọn thư mục đồng bộ')
    if (passphrase.length < 8) return setError('Sync passphrase cần ít nhất 8 ký tự')
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
      setMessage('Đã tắt sync trên máy này (dữ liệu local giữ nguyên)')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const configured = status?.configured

  return (
    <Modal title="Sync (mã hoá đầu-cuối)" onClose={onClose}>
      <div className="w-[460px] max-w-full">
        {!configured ? (
          <>
            <p className="mb-3 text-xs leading-relaxed text-zinc-400">
              Đồng bộ vault qua một <b>thư mục</b> được đồng bộ sẵn (Syncthing, Google Drive, Dropbox, OneDrive,
              ổ mạng…). Mọi thứ được mã hoá bằng <b>sync passphrase</b> trước khi rời máy — dịch vụ lưu trữ
              không đọc được. Dùng <b>cùng passphrase + cùng thư mục</b> trên các máy khác để chúng đồng bộ với nhau.
            </p>
            <Field label="Thư mục đồng bộ">
              <div className="flex gap-2">
                <TextInput value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="VD: D:\\Drive\\infra-sync" className="flex-1" />
                <Button type="button" onClick={() => void pickFolder()}>Chọn…</Button>
              </div>
            </Field>
            <Field label="Sync passphrase (giống nhau trên mọi máy)">
              <TextInput type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="••••••••" />
            </Field>
            <p className="mb-3 text-[11px] text-amber-500/90">
              ⚠ Quên sync passphrase = không khôi phục được dữ liệu trên thư mục đó. Có thể khác master password.
            </p>
            {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
            {message && <p className="mb-2 text-xs text-emerald-400">{message}</p>}
            <div className="flex justify-end">
              <Button variant="primary" disabled={busy} onClick={() => void configure()}>
                {busy ? 'Đang thiết lập…' : 'Bật sync & đồng bộ ngay'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs">
              <div className="text-emerald-400">● Sync đang bật</div>
              <div className="mt-1 truncate text-zinc-400">{status?.folder}</div>
              {status?.lastSyncAt && (
                <div className="mt-1 text-zinc-500">
                  Lần cuối: {new Date(status.lastSyncAt).toLocaleString('vi-VN')} — {status.lastMessage}
                </div>
              )}
            </div>
            {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
            {message && <p className="mb-2 text-xs text-emerald-400">{message}</p>}
            <div className="flex justify-between">
              <Button variant="danger" disabled={busy} onClick={() => void disable()}>
                Tắt sync (máy này)
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void syncNow()}>
                {busy ? 'Đang đồng bộ…' : '↻ Đồng bộ ngay'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
