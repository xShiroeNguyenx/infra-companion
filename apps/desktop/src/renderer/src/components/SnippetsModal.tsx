import { useState } from 'react'
import type { SnippetDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, ConfirmModal, Field, Modal, TextArea, TextInput } from './ui'

/** CRUD snippets. Biến trong script dùng cú pháp {{ten_bien}}. */
export function SnippetsModal({ onClose }: { onClose: () => void }) {
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
    <Modal title="Snippets" onClose={onClose}>
      {editing === null && (
        <>
          {/* width cố định: w-fit của Modal sẽ giãn theo dòng script dài nhất (truncate vô hiệu) */}
          <div className="mb-3 max-h-80 w-[520px] max-w-full overflow-y-auto">
            {snippets.length === 0 && (
              <p className="py-4 text-center text-xs text-zinc-500">
                Chưa có snippet nào. Snippet = lệnh/script lưu sẵn, chạy nhanh trên 1 hay nhiều phiên.
              </p>
            )}
            {snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="mb-1.5 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-zinc-200">{snippet.label}</div>
                  <div className="truncate font-mono text-[10px] text-zinc-500">{snippet.script}</div>
                </div>
                <Button type="button" className="!px-2 !py-1 !text-xs" onClick={() => startEdit(snippet)}>
                  Sửa
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="!px-2 !py-1 !text-xs"
                  onClick={() => setConfirmDelete(snippet)}
                >
                  Xoá
                </Button>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => startEdit('new')}>
              + Snippet mới
            </Button>
          </div>
          {confirmDelete && (
            <ConfirmModal
              title="Xoá snippet"
              message={
                <>
                  Xoá snippet <b>{confirmDelete.label}</b>?
                </>
              }
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
          <Field label="Tên snippet">
            <TextInput autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: Restart nginx" />
          </Field>
          <Field label="Script (biến: {{ten_bien}} — sẽ hỏi giá trị lúc chạy)">
            <TextArea
              rows={6}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder={'sudo systemctl restart {{service}}\nsudo systemctl status {{service}}'}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(null)}>
              Quay lại
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !label.trim() || !script.trim()}>
              {busy ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
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
