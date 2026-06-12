import { useState } from 'react'
import { useVaultStore } from '../stores/vault'
import { Button, Field, TextInput } from './ui'

/** Màn hình chặn toàn app khi vault chưa khởi tạo hoặc đang khoá. */
export function VaultGate() {
  const { state, busy, error, setup, unlock } = useVaultStore()
  const isSetup = state === 'uninitialized'
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = (): void => {
    setLocalError(null)
    if (isSetup) {
      if (password.length < 8) return setLocalError('Master password phải có ít nhất 8 ký tự')
      if (password !== confirm) return setLocalError('Mật khẩu nhập lại không khớp')
      void setup(password, remember)
    } else {
      if (!password) return setLocalError('Nhập master password')
      void unlock(password, remember)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#0b0e14]">
      <div className="w-[380px] rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-2xl">
        <div className="mb-1 text-lg font-semibold text-zinc-100">Infra Companion</div>
        <p className="mb-5 text-xs text-zinc-500">
          {isSetup
            ? 'Tạo master password để mã hoá vault (hosts, passwords, SSH keys). Mất mật khẩu này = mất dữ liệu — không có cách khôi phục.'
            : 'Vault đang khoá. Nhập master password để mở.'}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label="Master password">
            <TextInput
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          {isSetup && (
            <Field label="Nhập lại master password">
              <TextInput
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
          )}

          <label className="mb-4 flex items-center gap-2 text-xs text-zinc-400 select-none">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Ghi nhớ trên máy này (mở khoá tự động qua Windows DPAPI)
          </label>

          {(localError ?? error) && <p className="mb-3 text-xs text-red-400">{localError ?? error}</p>}

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Đang xử lý…' : isSetup ? 'Tạo vault' : 'Mở khoá'}
          </Button>
        </form>
      </div>
    </div>
  )
}
