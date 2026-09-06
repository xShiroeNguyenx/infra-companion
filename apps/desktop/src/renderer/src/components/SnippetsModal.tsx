import { useState } from 'react'
import type { SnippetDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, ConfirmModal, Field, ModalOrPanel, TextArea, TextInput } from './ui'
import { useT } from '../i18n'

/**
 * CRUD snippets. Biến trong script dùng cú pháp {{ten_bien}}.
 * `embedded` = nhúng phẳng vào vùng chính (theme Navigator → mục Snippets) thay vì popup.
 */
export function SnippetsModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const { snippets, saveSnippet, deleteSnippet } = useDataStore()
  const [editing, setEditing] = useState<SnippetDto | 'new' | null>(null)
  const [label, setLabel] = useState('')
  const [script, setScript] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SnippetDto | null>(null)

  const startEdit = (snippet: SnippetDto | 'new'): void => {
    setEditing(snippet)
    setLabel(snippet === 'new' ? '' : snippet.label)
    setScript(snippet === 'new' ? '' : snippet.script)
  }

  const submit = async (): Promise<void> => {
    if (!label.trim() || !script.trim()) return
    setBusy(true)
    const ok = await saveSnippet({
      id: editing === 'new' ? undefined : editing?.id,
      label: label.trim(),
      script
    })
    setBusy(false)
    if (ok) setEditing(null)
  }

  return (
    <ModalOrPanel embedded={embedded} title="Snippets" onClose={onClose}>
      {editing === null && (
        <>
          {/* width cố định: w-fit của Modal sẽ giãn theo dòng script dài nhất (truncate vô hiệu).
              Nhúng vào trang thì lấy hết bề rộng, để vùng cha cuộn, và xếp 2 cột khi vùng nhúng
              đủ rộng (container query, cha là `@container` trong ModalOrPanel). */}
          <div
            className={`mb-3 grid max-w-full content-start gap-1.5 ${
              embedded ? 'w-full @3xl:grid-cols-2' : 'max-h-80 w-[520px] overflow-y-auto'
            }`}
          >
            {snippets.length === 0 && (
              <p className="col-span-full py-4 text-center text-xs text-subtle">
                {t('snippet.empty')}
              </p>
            )}
            {snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="flex min-w-0 items-center gap-2 rounded border border-edge bg-input px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-content">{snippet.label}</div>
                  <div className="truncate font-mono text-[10px] text-subtle">{snippet.script}</div>
                </div>
                <Button type="button" className="!px-2 !py-1 !text-xs" onClick={() => startEdit(snippet)}>
                  {t('snippet.edit')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="!px-2 !py-1 !text-xs"
                  onClick={() => setConfirmDelete(snippet)}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => startEdit('new')}>
              {t('snippet.new')}
            </Button>
          </div>
          {confirmDelete && (
            <ConfirmModal
              title={t('snippet.deleteTitle')}
              message={t('snippet.deleteMsg', { label: confirmDelete.label })}
              onConfirm={() => {
                void deleteSnippet(confirmDelete.id)
                setConfirmDelete(null)
              }}
              onCancel={() => setConfirmDelete(null)}
            />
          )}
        </>
      )}

      {editing !== null && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label={t('snippet.name')}>
            <TextInput autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('snippet.namePh')} />
          </Field>
          <Field label={t('snippet.script')}>
            <TextArea
              rows={6}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder={'sudo systemctl restart {{service}}\nsudo systemctl status {{service}}'}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(null)}>
              {t('snippet.back')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !label.trim() || !script.trim()}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      )}
    </ModalOrPanel>
  )
}

/** Parse các biến {{x}} duy nhất trong script. */
export function parseSnippetVars(script: string): string[] {
  const vars = new Set<string>()
  for (const match of script.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)) {
    vars.add(match[1]!)
  }
  return [...vars]
}

export function substituteSnippet(script: string, values: Record<string, string>): string {
  return script.replaceAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_m, name: string) => values[name] ?? '')
}
