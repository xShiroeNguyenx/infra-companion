import { useState } from 'react'
import type { HostDto, SshKeyDto } from '@infra/shared'
import { Button, Field, Modal, Select } from './ui'
import { useT } from '../i18n'

/**
 * F43 — đẩy public key lên `~/.ssh/authorized_keys` của một host đang dùng password.
 *
 * Việc vặt hay phải làm nhất khi dựng máy mới, mà trước giờ phải tự gõ tay. Sau khi đẩy, app
 * **đăng nhập thử bằng chính key đó** rồi mới báo thành công — `authorized_keys` sai quyền thì
 * sshd im lặng bỏ qua, không có bước thử thì "đã đẩy xong" là một lời nói dối rất dễ tin.
 */
export function CopyIdModal({
  host,
  keys,
  onClose,
  onInstalled
}: {
  readonly host: HostDto
  readonly keys: SshKeyDto[]
  readonly onClose: () => void
  /** Gọi khi key đã đẩy + xác minh xong, để nơi gọi mời user đổi host sang auth key. */
  readonly onInstalled: (keyId: string) => void
}) {
  const t = useT()
  const [keyId, setKeyId] = useState(keys[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const run = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const result = await window.infra.keys.copyId({ hostId: host.id, keyId })
      if (result.ok) {
        setMessage(result.message)
        setDone(true)
      } else {
        setError(result.message)
      }
    } catch (err) {
      // invoke có thể reject (huỷ nhập mật khẩu login-script, host không nối được…)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('copyId.title', { host: host.label })} onClose={onClose}>
      <div className="w-[440px] max-w-full">
        <p className="text-muted mb-3 text-xs leading-relaxed">{t('copyId.desc')}</p>

        {keys.length === 0 ? (
          <p className="text-warning mb-3 text-xs">{t('copyId.noKeys')}</p>
        ) : (
          <Field label={t('copyId.pickKey')}>
            <Select value={keyId} onChange={(e) => setKeyId(e.target.value)} disabled={done}>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label} ({k.keyType})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {error && <p className="text-danger mb-2 text-xs leading-relaxed">{error}</p>}
        {message && <p className="text-success mb-2 text-xs leading-relaxed">{message}</p>}

        <div className="flex justify-end gap-2">
          {done ? (
            <>
              <Button onClick={onClose}>{t('copyId.close')}</Button>
              {/* Chỉ mời đổi auth SAU KHI đã đăng nhập thử được — đổi trước mà key hỏng
                  thì lần sau không vào được host bằng đường nào cả. */}
              <Button
                variant="primary"
                onClick={() => {
                  onInstalled(keyId)
                  onClose()
                }}
              >
                {t('copyId.switchAuth')}
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={busy || !keyId} onClick={() => void run()}>
              {busy ? t('copyId.working') : t('copyId.run')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
