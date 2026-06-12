import { useState } from 'react'
import { useVaultStore } from '../stores/vault'
import { useT } from '../i18n'
import { Button, Field, TextInput } from './ui'

/** Màn hình chặn toàn app khi vault chưa khởi tạo hoặc đang khoá. */
export function VaultGate() {
  const t = useT()
  const { state, busy, error, setup, unlock } = useVaultStore()
  const isSetup = state === 'uninitialized'
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = (): void => {
    setLocalError(null)
    if (isSetup) {
      if (password.length < 8) return setLocalError(t('vault.errMin'))
      if (password !== confirm) return setLocalError(t('vault.errMismatch'))
      void setup(password, remember)
    } else {
      if (!password) return setLocalError(t('vault.errEmpty'))
      void unlock(password, remember)
    }
  }

  return (
    <div className="bg-app flex h-screen items-center justify-center">
      <div className="border-edge bg-elevated w-[380px] rounded-xl border p-6 shadow-2xl">
        <div className="text-content mb-1 text-lg font-semibold">Infra Companion</div>
        <p className="text-subtle mb-5 text-xs">
          {isSetup ? t('vault.setupDesc') : t('vault.unlockDesc')}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label={t('vault.masterPassword')}>
            <TextInput
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          {isSetup && (
            <Field label={t('vault.confirmPassword')}>
              <TextInput
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
          )}

          <label className="text-muted mb-4 flex items-center gap-2 text-xs select-none">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t('vault.remember')}
          </label>

          {(localError ?? error) && <p className="text-danger mb-3 text-xs">{localError ?? error}</p>}

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? t('vault.processing') : isSetup ? t('vault.create') : t('vault.unlock')}
          </Button>
        </form>
      </div>
    </div>
  )
}
