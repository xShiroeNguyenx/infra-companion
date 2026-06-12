import { useState } from 'react'
import type { AuthType, GroupDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, ConfirmModal, Field, Modal, Select, TextArea, TextInput } from './ui'
import { envToText, textToEnv } from '../lib/env'
import { useT } from '../i18n'

/** Editor group + các field cấu hình mà hosts bên trong kế thừa (P22). */
export function GroupEditorModal({ group, onClose }: { group: GroupDto | null; onClose: () => void }) {
  const t = useT()
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
    if (!name.trim()) return setError(t('group.errName'))
    if (authType === 'key' && !keyId) return setError(t('group.errKey'))
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
    <Modal title={group ? t('group.titleEdit', { name: group.name }) : t('group.titleNew')} onClose={onClose} closeOnBackdrop={false}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={t('group.name')}>
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <p className="text-subtle mb-2 text-[11px] leading-relaxed">{t('group.inheritNote')}</p>

        <Field label={t('group.defaultUsername')}>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('common.notSet')} />
        </Field>

        <Field label={t('group.defaultAuth')}>
          <Select value={authType} onChange={(e) => setAuthType(e.target.value as '' | AuthType)}>
            <option value="">{t('common.notSet')}</option>
            <option value="password">{t('auth.passwordAsk')}</option>
            <option value="key">{t('auth.key')}</option>
            <option value="agent">{t('auth.agent')}</option>
            <option value="none">{t('auth.none')}</option>
          </Select>
        </Field>

        {authType === 'key' && (
          <Field label={t('auth.key')}>
            <Select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
              <option value="">{t('auth.chooseKey')}</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label} ({k.keyType})
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('group.env')}>
          <TextArea rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="APP_ENV=production" />
        </Field>

        <Field label={t('group.startup')}>
          <Select value={startupSnippetId} onChange={(e) => setStartupSnippetId(e.target.value)}>
            <option value="">{t('common.none')}</option>
            {snippets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>

        {error && <p className="text-danger mb-3 text-xs">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {group ? (
            <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
              {t('group.delete')}
            </Button>
          ) : (
            <span />
          )}
          {confirmDelete && group && (
            <ConfirmModal
              title={t('group.delete')}
              message={t('group.deleteMsg', { name: group.name })}
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
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
