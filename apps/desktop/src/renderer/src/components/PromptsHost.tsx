import { useEffect, useState } from 'react'
import type { HostKeyQuestion, PasswordQuestion } from '@infra/shared'
import { Button, Field, Modal, TextInput } from './ui'

type Question =
  | { type: 'hostkey'; q: HostKeyQuestion }
  | { type: 'password'; q: PasswordQuestion }

/** Hứng câu hỏi từ main (host key TOFU, password Quick Connect) và hiện modal lần lượt. */
export function PromptsHost() {
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
      <Modal title={`Mật khẩu cho ${q.target}`} onClose={() => finish(q.requestId, null)} closeOnBackdrop={false}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            finish(q.requestId, password || null)
          }}
        >
          <Field label="Password">
            <TextInput
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => finish(q.requestId, null)}>
              Huỷ
            </Button>
            <Button type="submit" variant="primary">
              Kết nối
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
      title={mismatch ? '⚠ HOST KEY ĐÃ THAY ĐỔI' : 'Host chưa từng kết nối'}
      danger={mismatch}
      onClose={() => finish(q.requestId, false)}
      closeOnBackdrop={false}
    >
      {mismatch ? (
        <p className="mb-3 text-xs leading-relaxed text-red-300">
          Fingerprint của <b>{q.host}:{q.port}</b> KHÔNG khớp với lần kết nối trước. Có thể server vừa cài
          lại — hoặc đang bị tấn công man-in-the-middle. Chỉ tiếp tục nếu bạn chắc chắn lý do.
        </p>
      ) : (
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">
          Lần đầu kết nối tới <b className="text-zinc-200">{q.host}:{q.port}</b>. Hãy xác minh fingerprint
          dưới đây trùng với fingerprint trên server trước khi tin tưởng.
        </p>
      )}

      <div className="mb-3 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[11px]">
        <div className="text-zinc-500">{q.keyType}</div>
        <div className="break-all text-zinc-200">{q.fingerprint}</div>
        {mismatch && q.knownFingerprint && (
          <div className="mt-2 border-t border-zinc-800 pt-2">
            <div className="text-zinc-500">Đã lưu trước đó:</div>
            <div className="break-all text-red-400 line-through">{q.knownFingerprint}</div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={() => finish(q.requestId, false)}>Ngắt kết nối</Button>
        <Button variant={mismatch ? 'danger' : 'primary'} onClick={() => finish(q.requestId, true)}>
          {mismatch ? 'Vẫn tin tưởng (thay fingerprint)' : 'Tin tưởng & tiếp tục'}
        </Button>
      </div>
    </Modal>
  )
}
