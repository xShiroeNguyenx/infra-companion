import { useState } from 'react'
import type { AuthType, GroupDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, ConfirmModal, Field, Modal, Select, TextArea, TextInput } from './ui'
import { envToText, textToEnv } from '../lib/env'

/** Editor group + các field cấu hình mà hosts bên trong kế thừa (P22). */
export function GroupEditorModal({ group, onClose }: { group: GroupDto | null; onClose: () => void }) {
  const { keys, snippets, saveGroup, deleteGroup } = useDataStore()
  const [name, setName] = useState(group?.name ?? '')
  const [username, setUsername] = useState(group?.username ?? '')
  const [authType, setAuthType] = useState<'' | AuthType>(group?.authType ?? '')
  const [keyId, setKeyId] = useState(group?.keyId ?? '')
  const [envText, setEnvText] = useState(envToText(group?.env ?? null))
  const [startupSnippetId, setStartupSnippetId] = useState(group?.startupSnippetId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    if (!name.trim()) return setError('Nhập tên group')
    if (authType === 'key' && !keyId) return setError('Chọn SSH key cho group')
    setBusy(true)
    const saved = await saveGroup({
      id: group?.id,
      name: name.trim(),
      username: username.trim() || null,
      authType: authType || null,
      keyId: authType === 'key' ? keyId : null,
      env: textToEnv(envText),
      startupSnippetId: startupSnippetId || null
    })
    setBusy(false)
    if (saved) onClose()
  }

  return (
    <Modal title={group ? `Group: ${group.name}` : 'Tạo group'} onClose={onClose} closeOnBackdrop={false}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Tên group">
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
          Các field dưới đây là <b>mặc định kế thừa</b> cho mọi host trong group (host có thể override).
        </p>

        <Field label="Username mặc định">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} placeholder="(không đặt)" />
        </Field>

        <Field label="Xác thực mặc định">
          <Select value={authType} onChange={(e) => setAuthType(e.target.value as '' | AuthType)}>
            <option value="">(không đặt)</option>
            <option value="password">Password (hỏi khi kết nối)</option>
            <option value="key">SSH Key</option>
            <option value="agent">SSH Agent (OS)</option>
            <option value="none">Không cần xác thực (server cho vào thẳng)</option>
          </Select>
        </Field>

        {authType === 'key' && (
          <Field label="SSH Key">
            <Select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
              <option value="">— Chọn key —</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label} ({k.keyType})
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Biến môi trường (KEY=VALUE, mỗi dòng một biến)">
          <TextArea rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="APP_ENV=production" />
        </Field>

        <Field label="Startup snippet (chạy sau khi login)">
          <Select value={startupSnippetId} onChange={(e) => setStartupSnippetId(e.target.value)}>
            <option value="">(không có)</option>
            {snippets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {group ? (
            <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
              Xoá group
            </Button>
          ) : (
            <span />
          )}
          {confirmDelete && group && (
            <ConfirmModal
              title="Xoá group"
              message={
                <>
                  Xoá group <b>{group.name}</b>? Host bên trong không bị xoá nhưng sẽ mất cấu hình kế thừa
                  (username/auth/env mặc định).
                </>
              }
              onConfirm={() => {
                setConfirmDelete(false)
                void deleteGroup(group.id).then((ok) => {
                  if (ok) onClose()
                })
              }}
              onCancel={() => setConfirmDelete(false)}
            />
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
