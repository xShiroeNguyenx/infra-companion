import { useEffect, useState } from 'react'
import type { KnownHostDto } from '@infra/shared'
import { Button, ConfirmModal, Modal, TextInput } from './ui'
import { useT } from '../i18n'

/**
 * F44 — xem / quên fingerprint đã TOFU.
 *
 * Không phải để gỡ bế tắc: prompt mismatch vẫn có nút "vẫn tin". Đây là để RÀ SOÁT — trước
 * đây không có đường nào nhìn lại mình đã tin những gì, và sau khi dựng lại server thì mỗi
 * lần nối phải bấm qua một cảnh báo đỏ. Cảnh báo bị bấm quen tay là cảnh báo đã hỏng.
 */
export function KnownHostsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [entries, setEntries] = useState<KnownHostDto[]>([])
  const [filter, setFilter] = useState('')
  const [confirm, setConfirm] = useState<KnownHostDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.infra.knownHosts
      .list()
      .then(setEntries)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const forget = async (id: string): Promise<void> => {
    setError(null)
    try {
      setEntries(await window.infra.knownHosts.forget(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? entries.filter(
        (e) => e.hostPattern.toLowerCase().includes(needle) || e.fingerprintSha256.toLowerCase().includes(needle)
      )
    : entries

  return (
    <Modal title={t('knownHosts.title')} onClose={onClose}>
      <div className="w-[560px] max-w-full">
        <p className="text-muted mb-3 text-xs leading-relaxed">{t('knownHosts.desc')}</p>

        {entries.length > 0 && (
          <TextInput
            className="mb-2"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('knownHosts.filter')}
          />
        )}

        {error && <p className="text-danger mb-2 text-xs">{error}</p>}

        {shown.length === 0 ? (
          <p className="text-subtle py-6 text-center text-xs">
            {entries.length === 0 ? t('knownHosts.empty') : t('knownHosts.noMatch')}
          </p>
        ) : (
          <div className="mb-3 max-h-80 overflow-y-auto">
            {shown.map((entry) => (
              <div
                key={entry.id}
                className="border-edge bg-input mb-1.5 flex items-center gap-2 rounded border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-content truncate text-xs font-medium">
                    {entry.hostPattern} <span className="text-subtle font-normal">· {entry.keyType}</span>
                  </div>
                  {/* Fingerprint để nguyên, không cắt: cắt đi thì không đối chiếu được với
                      `ssh-keygen -lf` trên server, mà đối chiếu mới là việc duy nhất cần làm. */}
                  <div className="text-subtle font-mono text-[10px] break-all">{entry.fingerprintSha256}</div>
                  <div className="text-subtle text-[10px]">
                    {t('knownHosts.seen', {
                      first: new Date(entry.firstSeen).toLocaleDateString(),
                      last: new Date(entry.lastSeen).toLocaleString()
                    })}
                  </div>
                </div>
                <Button type="button" variant="danger" className="!px-2 !py-1 !text-xs" onClick={() => setConfirm(entry)}>
                  {t('knownHosts.forget')}
                </Button>
              </div>
            ))}
          </div>
        )}

        {confirm && (
          <ConfirmModal
            title={t('knownHosts.forget')}
            message={t('knownHosts.forgetConfirm', { host: confirm.hostPattern })}
            onConfirm={() => {
              void forget(confirm.id)
              setConfirm(null)
            }}
            onCancel={() => setConfirm(null)}
          />
        )}
      </div>
    </Modal>
  )
}
