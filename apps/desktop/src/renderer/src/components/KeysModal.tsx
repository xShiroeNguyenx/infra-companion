import { useState } from 'react'
import { useDataStore } from '../stores/data'
import { useToastsStore } from '../stores/toasts'
import { Button, ConfirmModal, Field, Modal, TextArea, TextInput } from './ui'

export function KeysModal({ onClose }: { onClose: () => void }) {
  const { keys, generateKey, importKey, deleteKey } = useDataStore()
  const push = useToastsStore((s) => s.push)
  const [mode, setMode] = useState<'list' | 'generate' | 'import'>('list')
  const [label, setLabel] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null)

  const reset = (): void => {
    setMode('list')
    setLabel('')
    setPrivateKey('')
    setPassphrase('')
  }

  const copyPublic = (publicKey: string): void => {
    void navigator.clipboard.writeText(publicKey).then(() => push('Đã copy public key', 'info'))
  }

  return (
    <Modal title="SSH Keys" onClose={onClose}>
      {mode === 'list' && (
        <>
          <div className="mb-3 max-h-72 overflow-y-auto">
            {keys.length === 0 && <p className="py-4 text-center text-xs text-subtle">Chưa có key nào</p>}
            {keys.map((key) => (
              <div
                key={key.id}
                className="mb-1.5 flex items-center gap-2 rounded border border-edge bg-input px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-content">{key.label}</div>
                  <div className="truncate font-mono text-[10px] text-subtle">
                    {key.keyType} · {key.source === 'generated' ? 'đã sinh' : 'đã import'}
                    {key.hasPassphrase ? ' · có passphrase' : ''}
                  </div>
                </div>
                <Button type="button" className="!px-2 !py-1 !text-xs" onClick={() => copyPublic(key.publicKey)}>
                  Copy pub
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="!px-2 !py-1 !text-xs"
                  onClick={() => setConfirmDelete({ id: key.id, label: key.label })}
                >
                  Xoá
                </Button>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setMode('import')}>Import key</Button>
            <Button variant="primary" onClick={() => setMode('generate')}>
              Sinh key mới
            </Button>
          </div>
          {confirmDelete && (
            <ConfirmModal
              title="Xoá SSH key"
              message={
                <>
                  Xoá vĩnh viễn key <b>{confirmDelete.label}</b>? Private key không khôi phục được — host đang dùng
                  key này sẽ không kết nối được nữa.
                </>
              }
              onConfirm={() => {
                void deleteKey(confirmDelete.id)
                setConfirmDelete(null)
              }}
              onCancel={() => setConfirmDelete(null)}
            />
          )}
        </>
      )}

      {mode === 'generate' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!label.trim()) return
            setBusy(true)
            void generateKey(label.trim()).then((ok) => {
              setBusy(false)
              if (ok) reset()
            })
          }}
        >
          <p className="mb-3 text-xs text-muted">
            Sinh cặp khoá <b>ed25519</b> mới. Private key được mã hoá và lưu trong vault.
          </p>
          <Field label="Tên key">
            <TextInput autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: work-laptop" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={reset}>
              Quay lại
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !label.trim()}>
              {busy ? 'Đang sinh…' : 'Sinh key'}
            </Button>
          </div>
        </form>
      )}

      {mode === 'import' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!label.trim() || !privateKey.trim()) return
            setBusy(true)
            void importKey({
              label: label.trim(),
              privateKey,
              passphrase: passphrase || undefined
            }).then((ok) => {
              setBusy(false)
              if (ok) reset()
            })
          }}
        >
          <Field label="Tên key">
            <TextInput autoFocus value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Private key (OpenSSH / PEM / PuTTY .ppk)">
            <TextArea
              rows={6}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </Field>
          <Field label="Passphrase (nếu key được mã hoá)">
            <TextInput type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={reset}>
              Quay lại
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !label.trim() || !privateKey.trim()}>
              {busy ? 'Đang import…' : 'Import'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
