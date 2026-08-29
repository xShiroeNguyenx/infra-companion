import { useEffect, useState } from 'react'
import type { RevealKind } from '@infra/shared'
import { Button, Field, Modal, TextInput } from './ui'
import { useT } from '../i18n'

/** Bao lâu thì tự che lại sau khi hiện. Đủ để đọc/gõ lại, không đủ để quên mất đang share màn hình. */
const AUTO_HIDE_SEC = 20

/**
 * Xem lại bí mật đã lưu (mật khẩu host / passphrase key).
 *
 * Ba ràng buộc cố ý, đừng gỡ khi sửa sau này:
 *  1. Giá trị nằm trong state CỦA COMPONENT, không vào zustand — vào store thì nó sống lâu
 *     hơn hộp thoại và lộ ra mọi chỗ dump state.
 *  2. Tự che lại sau {@link AUTO_HIDE_SEC} giây, và xoá sạch khi unmount.
 *  3. Nút chép đi đường RIÊNG (`secrets.copy`): main tự ghi clipboard nên giá trị KHÔNG hề
 *     vào renderer. Muốn chép thì đừng bấm "hiện" trước — không cần thiết.
 */
export function RevealSecretModal({
  kind,
  id,
  title,
  onClose
}: {
  kind: RevealKind
  id: string
  title: string
  onClose: () => void
}) {
  const t = useT()
  const [masterPassword, setMasterPassword] = useState('')
  const [value, setValue] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Đếm ngược rồi tự che. Cleanup chạy cả khi unmount → đóng modal là giá trị biến mất.
  useEffect(() => {
    if (value === null) return
    setRemaining(AUTO_HIDE_SEC)
    const timer = setInterval(() => {
      setRemaining((left) => {
        if (left <= 1) {
          setValue(null)
          return 0
        }
        return left - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [value])

  const call = async (mode: 'reveal' | 'copy'): Promise<void> => {
    setError(null)
    setCopied(false)
    setBusy(true)
    try {
      const request = { kind, id, masterPassword }
      const result = mode === 'reveal' ? await window.infra.secrets.reveal(request) : await window.infra.secrets.copy(request)
      if (!result.ok) {
        setError(
          result.cooldownSec ? t('reveal.cooldown', { n: result.cooldownSec }) : (result.error ?? t('reveal.failed'))
        )
        return
      }
      setMasterPassword('') // đã dùng xong, đừng giữ lại trong ô
      if (mode === 'reveal') setValue(result.value ?? '')
      else setCopied(true)
    } catch (err) {
      // invoke có thể reject (vault khoá giữa chừng…) — không bắt thì busy kẹt true
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`${t('reveal.title')} — ${title}`} onClose={onClose}>
      <div className="w-[420px] max-w-full">
        <p className="mb-3 text-xs leading-relaxed text-muted">{t('reveal.desc')}</p>

        {value === null ? (
          <>
            <Field label={t('reveal.master')}>
              <TextInput
                type="password"
                autoFocus
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) void call('reveal')
                }}
                placeholder="••••••••"
              />
            </Field>
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
            {copied && <p className="mb-2 text-xs text-success">{t('reveal.copied', { n: 30 })}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" disabled={busy} onClick={() => void call('copy')}>
                {t('reveal.copy')}
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void call('reveal')}>
                {busy ? t('reveal.checking') : t('reveal.show')}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-subtle">{t('reveal.copyHint')}</p>
          </>
        ) : (
          <>
            <div className="mb-2 rounded border border-edge bg-input px-3 py-2">
              <div className="font-mono text-sm break-all select-all">{value}</div>
            </div>
            <p className="mb-3 text-[11px] text-warning/90">{t('reveal.autoHide', { n: remaining })}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setValue(null)}>
                {t('reveal.hide')}
              </Button>
              <Button variant="primary" onClick={onClose}>
                {t('reveal.done')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
