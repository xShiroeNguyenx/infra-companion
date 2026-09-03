import { useState } from 'react'
import type { RotateResult } from '@infra/shared'
import { Button, Field, ModalOrPanel, Select } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useDataStore } from '../stores/data'
import { useT } from '../i18n'

/**
 * F42 — xoay vòng SSH key trên nhiều host.
 *
 * Từng host: đẩy key mới → **đăng nhập thử bằng chính key mới** → chỉ khi đó mới gỡ key cũ.
 * Bất biến quan trọng nhất nằm ở main: không bao giờ gỡ key cũ khi key mới chưa chứng minh là
 * dùng được — làm ngược lại là tự khoá mình ra khỏi cả fleet.
 *
 * Chạy TUẦN TỰ chứ không song song: đây là thao tác ghi vào quyền đăng nhập, thấy hỏng ở máy
 * đầu tiên thì phải dừng được ngay chứ không phải sau khi đã đụng vào cả hai chục máy.
 */
export function KeyRotateModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const keys = useDataStore((s) => s.keys)
  const [newKeyId, setNewKeyId] = useState(keys[0]?.id ?? '')
  const [oldKeyId, setOldKeyId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<RotateResult[]>([])
  const [busy, setBusy] = useState(false)
  const stopRef = useState({ stop: false })[0]

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const run = async (): Promise<void> => {
    const ids = hosts.filter((h) => selected.has(h.id)).map((h) => h.id)
    if (ids.length === 0 || !newKeyId) return
    setBusy(true)
    setResults([])
    stopRef.stop = false
    const collected: RotateResult[] = []
    for (const hostId of ids) {
      if (stopRef.stop) break
      try {
        collected.push(await window.infra.keys.rotate({ hostId, newKeyId, oldKeyId: oldKeyId || null }))
      } catch (err) {
        collected.push({
          hostId,
          host: hosts.find((h) => h.id === hostId)?.label ?? hostId,
          stage: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      }
      setResults([...collected])
    }
    setBusy(false)
  }

  const tone: Record<RotateResult['stage'], string> = {
    rotated: 'text-success',
    installed: 'text-warning',
    'not-verified': 'text-danger',
    error: 'text-danger'
  }

  return (
    <ModalOrPanel
      embedded={embedded}
      title={t('rotate.title')}
      onClose={onClose}
      closeOnBackdrop={false}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="key-rotate" onDone={onClose} />}
    >
      {/* Xoay key chạy tuần tự qua từng máy — việc dài nhất trong nhóm này, rất nên ở tab */}
      <div className={embedded ? 'w-full' : 'w-[620px] max-w-full'}>
        <p className="text-muted mb-3 text-xs leading-relaxed">{t('rotate.desc')}</p>

        {keys.length === 0 ? (
          <p className="text-warning mb-3 text-xs">{t('copyId.noKeys')}</p>
        ) : (
          <>
            <Field label={t('rotate.newKey')}>
              <Select value={newKeyId} onChange={(e) => setNewKeyId(e.target.value)} disabled={busy}>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label} ({k.keyType})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('rotate.oldKey')}>
              <Select value={oldKeyId} onChange={(e) => setOldKeyId(e.target.value)} disabled={busy}>
                <option value="">{t('rotate.noRemove')}</option>
                {keys
                  .filter((k) => k.id !== newKeyId)
                  .map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label} ({k.keyType})
                    </option>
                  ))}
              </Select>
            </Field>
          </>
        )}

        <div className="border-edge bg-input mb-2 max-h-48 overflow-y-auto rounded border p-2">
          {hosts.map((h) => (
            <label key={h.id} className="hover:bg-hover flex items-center gap-2 rounded px-2 py-1 text-xs select-none">
              <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggle(h.id)} disabled={busy} />
              <span className="text-content truncate">{h.label}</span>
              <span className="text-subtle truncate font-mono text-[10px]">{h.hostname}</span>
            </label>
          ))}
          {hosts.length === 0 && <p className="text-subtle py-4 text-center text-xs">{t('pkg.noHosts')}</p>}
        </div>

        {results.length > 0 && (
          <div className="mb-2 max-h-48 overflow-y-auto">
            {results.map((r) => (
              <div key={r.hostId} className="border-edge bg-input mb-1 rounded border px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-content min-w-0 flex-1 truncate text-xs font-medium">{r.host}</span>
                  <span className={`shrink-0 text-[10px] font-medium ${tone[r.stage]}`}>
                    {t(`rotate.stage.${r.stage}` as 'rotate.stage.rotated')}
                  </span>
                </div>
                <div className="text-subtle mt-0.5 text-[10px] leading-relaxed">{r.message}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {busy ? (
            <Button variant="danger" onClick={() => (stopRef.stop = true)}>
              {t('rotate.stopAfter')}
            </Button>
          ) : (
            <Button variant="primary" disabled={selected.size === 0 || !newKeyId} onClick={() => void run()}>
              {t('rotate.run', { n: selected.size })}
            </Button>
          )}
        </div>
        <p className="text-subtle mt-2 text-[10px] leading-relaxed">{t('rotate.note')}</p>
      </div>
    </ModalOrPanel>
  )
}
