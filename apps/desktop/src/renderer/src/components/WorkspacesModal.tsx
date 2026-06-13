import { useState } from 'react'
import { useTabsStore, type WorkspaceTab } from '../stores/tabs'
import { useWorkspacesStore, type Workspace } from '../stores/workspaces'
import { useToastsStore } from '../stores/toasts'
import { useUiStore } from '../stores/ui'
import { Button, ConfirmModal, Field, Modal, TextInput } from './ui'
import { useT } from '../i18n'

/** Tóm tắt nội dung workspace: số tab + số pane terminal + số tab SFTP. */
function summarize(tabs: WorkspaceTab[], t: ReturnType<typeof useT>): string {
  const panes = tabs.reduce((n, tab) => n + (tab.kind === 'terminal' ? tab.panes.length : 0), 0)
  const sftp = tabs.filter((tab) => tab.kind === 'sftp').length
  const parts = [t('ws.summaryTabs', { n: tabs.length }), t('ws.summaryPanes', { n: panes })]
  if (sftp > 0) parts.push(t('ws.summarySftp', { n: sftp }))
  return parts.join(' · ')
}

export function WorkspacesModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { workspaces, saveCurrent, rename, remove, open } = useWorkspacesStore()
  const hasOpenTabs = useTabsStore((s) => s.tabs.length > 0)
  const push = useToastsStore((s) => s.push)
  const setModal = useUiStore((s) => s.setModal)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Workspace | null>(null)

  const onSave = (): void => {
    if (saveCurrent(name)) {
      setName('')
      push(t('ws.saved'), 'info')
    } else {
      push(t('ws.nothingToSave'))
    }
  }

  const onOpen = (id: string): void => {
    open(id)
    setModal(null) // đóng modal để thấy tab vừa mở
  }

  const commitRename = (): void => {
    if (editingId) rename(editingId, editName)
    setEditingId(null)
  }

  return (
    <Modal title={t('ws.title')} onClose={onClose}>
      <div className="w-[min(460px,90vw)]">
        <Field label={t('ws.saveCurrent')}>
          <div className="flex gap-2">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hasOpenTabs) onSave()
              }}
              placeholder={t('ws.namePlaceholder')}
            />
            <Button variant="primary" className="shrink-0" disabled={!hasOpenTabs} onClick={onSave}>
              {t('ws.saveBtn')}
            </Button>
          </div>
        </Field>

        <div className="text-subtle mt-3 mb-2 text-[10px] font-semibold tracking-wider uppercase">
          {t('ws.saved_list')}
        </div>

        {workspaces.length === 0 ? (
          <p className="text-subtle py-3 text-center text-xs leading-relaxed">{t('ws.empty')}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {workspaces.map((ws) => (
              <div key={ws.id} className="border-edge bg-input/40 flex items-center gap-2 rounded border px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  {editingId === ws.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="border-edge-strong bg-input text-content focus:border-accent w-full rounded border px-1.5 py-1 text-sm outline-none"
                    />
                  ) : (
                    <>
                      <div className="text-content truncate text-sm">{ws.name}</div>
                      <div className="text-subtle truncate text-[10px]">{summarize(ws.tabs, t)}</div>
                    </>
                  )}
                </div>
                <Button className="!px-2 !py-1 !text-xs" variant="primary" onClick={() => onOpen(ws.id)}>
                  {t('ws.open')}
                </Button>
                <button
                  className="text-subtle hover:bg-hover hover:text-content rounded p-1.5"
                  title={t('ws.rename')}
                  onClick={() => {
                    setEditingId(ws.id)
                    setEditName(ws.name)
                  }}
                >
                  ✏
                </button>
                <button
                  className="text-subtle hover:bg-hover hover:text-danger rounded p-1.5"
                  title={t('common.delete')}
                  onClick={() => setConfirmDelete(ws)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-subtle mt-3 text-[10px] leading-relaxed">{t('ws.hint')}</p>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title={t('ws.deleteTitle')}
          message={t('ws.deleteConfirm', { name: confirmDelete.name })}
          onConfirm={() => {
            remove(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </Modal>
  )
}
