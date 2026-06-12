import { useCallback, useEffect, useState } from 'react'
import type { FileEntryDto } from '@infra/shared'
import { formatSize, formatTime, joinPath, parentPath } from '../../lib/paths'
import { errorMessage, useToastsStore } from '../../stores/toasts'
import { ConfirmModal } from '../../components/ui'

/** Adapter trừu tượng hoá local FS vs SFTP để FilePane dùng chung. */
export interface PaneAdapter {
  initialPath(): Promise<string>
  list(path: string): Promise<FileEntryDto[]>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  delete(path: string, isDir: boolean): Promise<void>
  chmod?(path: string, mode: string): Promise<void>
  /** Mở file bằng editor local, auto-upload khi đổi (chỉ SFTP). */
  edit?(path: string): Promise<void>
}

export interface PaneState {
  path: string
  entries: FileEntryDto[]
  selected: FileEntryDto | null
  navigate: (to: string) => Promise<void>
  refresh: () => Promise<void>
  setSelected: (entry: FileEntryDto | null) => void
}

type PromptMode = { kind: 'mkdir' } | { kind: 'rename'; entry: FileEntryDto } | { kind: 'chmod'; entry: FileEntryDto }

export function usePane(adapter: PaneAdapter): PaneState {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<FileEntryDto[]>([])
  const [selected, setSelected] = useState<FileEntryDto | null>(null)

  const navigate = useCallback(
    async (to: string) => {
      try {
        const list = await adapter.list(to)
        list.sort((a, b) => {
          if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        setPath(to)
        setEntries(list)
        setSelected(null)
      } catch (error) {
        useToastsStore.getState().push(errorMessage(error))
      }
    },
    [adapter]
  )

  const refresh = useCallback(() => navigate(path), [navigate, path])

  useEffect(() => {
    void adapter.initialPath().then(navigate)
    // chỉ chạy 1 lần khi mount
  }, [adapter, navigate])

  return { path, entries, selected, navigate, refresh, setSelected }
}

export function FilePane({
  title,
  adapter,
  pane
}: {
  title: string
  adapter: PaneAdapter
  pane: PaneState
}) {
  const [pathInput, setPathInput] = useState(pane.path)
  const [prompt, setPrompt] = useState<PromptMode | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<FileEntryDto | null>(null)

  const doDelete = (entry: FileEntryDto): void => {
    void adapter
      .delete(joinPath(pane.path, entry.name), entry.kind === 'dir')
      .then(() => pane.refresh())
      .catch((error) => useToastsStore.getState().push(errorMessage(error)))
  }

  useEffect(() => setPathInput(pane.path), [pane.path])

  const submitPrompt = async (): Promise<void> => {
    if (!prompt || !promptValue.trim()) return setPrompt(null)
    const value = promptValue.trim()
    try {
      if (prompt.kind === 'mkdir') {
        await adapter.mkdir(joinPath(pane.path, value))
      } else if (prompt.kind === 'rename') {
        await adapter.rename(joinPath(pane.path, prompt.entry.name), joinPath(pane.path, value))
      } else if (prompt.kind === 'chmod' && adapter.chmod) {
        await adapter.chmod(joinPath(pane.path, prompt.entry.name), value)
      }
      setPrompt(null)
      setPromptValue('')
      await pane.refresh()
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  const iconFor = (entry: FileEntryDto): string => (entry.kind === 'dir' ? '📁' : entry.kind === 'symlink' ? '🔗' : '📄')

  return (
    <div className="flex min-w-0 flex-1 flex-col border border-zinc-800 bg-[#0e121b]">
      <div className="flex items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
        <span className="mr-1 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">{title}</span>
        <input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void pane.navigate(pathInput.trim())
          }}
          className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 font-mono text-[11px] text-zinc-300 outline-none focus:border-blue-600"
        />
        <PaneButton title="Lên thư mục cha" onClick={() => void pane.navigate(parentPath(pane.path))}>
          ↑
        </PaneButton>
        <PaneButton title="Refresh" onClick={() => void pane.refresh()}>
          ⟳
        </PaneButton>
        <PaneButton title="Thư mục mới" onClick={() => { setPrompt({ kind: 'mkdir' }); setPromptValue('') }}>
          +📁
        </PaneButton>
      </div>

      {prompt && (
        <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
          <span className="text-[11px] text-zinc-400">
            {prompt.kind === 'mkdir' ? 'Tên thư mục:' : prompt.kind === 'rename' ? 'Tên mới:' : 'Mode (octal):'}
          </span>
          <input
            autoFocus
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitPrompt()
              if (e.key === 'Escape') setPrompt(null)
            }}
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-blue-600"
          />
          <PaneButton title="OK" onClick={() => void submitPrompt()}>✓</PaneButton>
          <PaneButton title="Huỷ" onClick={() => setPrompt(null)}>✕</PaneButton>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-[#0e121b] text-zinc-600">
            <tr>
              <th className="px-2 py-1 font-medium">Tên</th>
              <th className="w-20 px-2 py-1 text-right font-medium">Kích thước</th>
              <th className="w-28 px-2 py-1 font-medium">Sửa đổi</th>
            </tr>
          </thead>
          <tbody>
            {pane.entries.map((entry) => {
              const isSelected = pane.selected?.name === entry.name
              return (
                <tr
                  key={entry.name}
                  className={`cursor-pointer select-none ${isSelected ? 'bg-blue-900/40 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/50'}`}
                  onClick={() => pane.setSelected(entry)}
                  onDoubleClick={() => {
                    if (entry.kind === 'dir') void pane.navigate(joinPath(pane.path, entry.name))
                  }}
                >
                  <td className="truncate px-2 py-1">
                    {iconFor(entry)} {entry.name}
                  </td>
                  <td className="px-2 py-1 text-right text-zinc-500">
                    {entry.kind === 'file' ? formatSize(entry.size) : ''}
                  </td>
                  <td className="px-2 py-1 text-zinc-500">{formatTime(entry.mtimeMs)}</td>
                </tr>
              )
            })}
            {pane.entries.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2 py-6 text-center text-zinc-600">
                  (trống)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-1 border-t border-zinc-800 px-2 py-1">
        <PaneButton
          title="Đổi tên"
          disabled={!pane.selected}
          onClick={() => {
            if (pane.selected) {
              setPrompt({ kind: 'rename', entry: pane.selected })
              setPromptValue(pane.selected.name)
            }
          }}
        >
          Đổi tên
        </PaneButton>
        <PaneButton
          title="Xoá"
          disabled={!pane.selected}
          onClick={() => {
            // PHẢI confirm: phía Local là rm đệ quy không qua Recycle Bin — một misclick = mất cả thư mục
            if (pane.selected) setConfirmDelete(pane.selected)
          }}
        >
          Xoá
        </PaneButton>
        {confirmDelete && (
          <ConfirmModal
            title={confirmDelete.kind === 'dir' ? 'Xoá thư mục' : 'Xoá file'}
            message={
              <>
                Xoá vĩnh viễn <b>{confirmDelete.name}</b>
                {confirmDelete.kind === 'dir' ? ' và toàn bộ nội dung bên trong' : ''}? Không qua thùng rác, không
                khôi phục được.
              </>
            }
            onConfirm={() => {
              doDelete(confirmDelete)
              setConfirmDelete(null)
            }}
            onCancel={() => setConfirmDelete(null)}
          />
        )}
        {adapter.chmod && (
          <PaneButton
            title="Đổi quyền (chmod)"
            disabled={!pane.selected}
            onClick={() => {
              if (pane.selected) {
                setPrompt({ kind: 'chmod', entry: pane.selected })
                setPromptValue(pane.selected.mode ?? '644')
              }
            }}
          >
            chmod
          </PaneButton>
        )}
        {adapter.edit && (
          <PaneButton
            title="Sửa bằng editor local — tự upload khi save"
            disabled={!pane.selected || pane.selected.kind !== 'file'}
            onClick={() => {
              if (pane.selected) {
                void adapter
                  .edit!(joinPath(pane.path, pane.selected.name))
                  .catch((error) => useToastsStore.getState().push(errorMessage(error)))
              }
            }}
          >
            ✏ Sửa
          </PaneButton>
        )}
      </div>
    </div>
  )
}

function PaneButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded border border-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 ${props.className ?? ''}`}
    />
  )
}
