import { useEffect, useState } from 'react'
import type { HostKeyQuestion, PasswordQuestion } from '@infra/shared'
import { Button, Field, Modal, TextInput } from './ui'
import { useT } from '../i18n'

type Question =
  | { type: 'hostkey'; q: HostKeyQuestion }
  | { type: 'password'; q: PasswordQuestion }

/** Hứng câu hỏi từ main (host key TOFU, password Quick Connect) và hiện modal lần lượt. */
export function PromptsHost() {
  const t = useT()
  const [queue, setQueue] = useState<Question[]>([])
  const [password, setPassword] = useState('')

  useEffect(() => {
    const offHostKey = window.infra.prompts.onHostKey((q) =>
      setQueue((prev) => [...prev, { type: 'hostkey', q }])
    )
    const offPassword = window.infra.prompts.onPassword((q) =>
      setQueue((prev) => [...prev, { type: 'password', q }])
    )
    return () => {
      offHostKey()
      offPassword()
    }
  }, [])

  const current = queue[0]
  if (!current) return null

  const finish = (requestId: string, answer: unknown): void => {
    window.infra.prompts.answer(requestId, answer)
    setQueue((prev) => prev.slice(1))
    setPassword('')
  }

  if (current.type === 'password') {
    const { q } = current
    return (
      // closeOnBackdrop=false: misclick không được tính là "Huỷ" với prompt bảo mật
      <Modal title={t('prompts.passwordTitle', { target: q.target })} onClose={() => finish(q.requestId, null)} closeOnBackdrop={false}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            finish(q.requestId, password || null)
          }}
        >
          <Field label={t('prompts.password')}>
            <TextInput
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => finish(q.requestId, null)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary">
              {t('prompts.connect')}
            </Button>
          </div>
        </form>
      </Modal>
    )
  }

  const { q } = current
  const mismatch = q.kind === 'mismatch'
  return (
    <Modal
      title={mismatch ? t('prompts.hostkeyMismatch') : t('prompts.hostkeyNew')}
      danger={mismatch}
      onClose={() => finish(q.requestId, false)}
      closeOnBackdrop={false}
    >
      {mismatch ? (
        <p className="text-danger mb-3 max-w-96 text-xs leading-relaxed">
          {t('prompts.mismatchDesc', { host: q.host, port: q.port })}
        </p>
      ) : (
        <p className="text-muted mb-3 max-w-96 text-xs leading-relaxed">
          {t('prompts.newDesc', { host: q.host, port: q.port })}
        </p>
      )}

      <div className="border-edge-strong bg-input mb-3 rounded border px-3 py-2 font-mono text-[11px]">
        <div className="text-subtle">{q.keyType}</div>
        <div className="text-content break-all">{q.fingerprint}</div>
        {mismatch && q.knownFingerprint && (
          <div className="border-edge mt-2 border-t pt-2">
            <div className="text-subtle">{t('prompts.savedBefore')}</div>
            <div className="text-danger break-all line-through">{q.knownFingerprint}</div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={() => finish(q.requestId, false)}>{t('prompts.disconnect')}</Button>
        <Button variant={mismatch ? 'danger' : 'primary'} onClick={() => finish(q.requestId, true)}>
          {mismatch ? t('prompts.trustMismatch') : t('prompts.trustNew')}
        </Button>
      </div>
    </Modal>
  )
}
