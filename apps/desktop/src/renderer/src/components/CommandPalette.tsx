import { useEffect, useMemo, useRef, useState } from 'react'
import { useDataStore } from '../stores/data'
import { useTabsStore } from '../stores/tabs'
import { useVaultStore } from '../stores/vault'

export interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

/**
 * Command Palette (Ctrl+Shift+P): mọi hành động qua bàn phím —
 * connect host, mở local, split, broadcast, snippet, tunnels, lock vault…
 * `extraCommands` cho phép App tiêm các lệnh mở modal (snippets/tunnels/keys).
 */
export function CommandPalette({
  onClose,
  extraCommands
}: {
  onClose: () => void
  extraCommands: Command[]
}) {
  const hosts = useDataStore((s) => s.hosts)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo<Command[]>(() => {
    const tabs = useTabsStore.getState()
    const list: Command[] = [
      { id: 'new-local', label: 'Mở terminal local mới', hint: 'Ctrl+Shift+T', run: () => void tabs.openLocal() },
      { id: 'split-local', label: 'Split: thêm pane local vào tab hiện tại', run: () => void tabs.splitLocal() },
      {
        id: 'broadcast',
        label: 'Bật/tắt Broadcast cho tab hiện tại',
        hint: 'gõ 1 pane → mọi pane',
        run: () => {
          const t = tabs.activeTab()
          if (t) tabs.toggleBroadcast(t.id)
        }
      },
      {
        id: 'close-tab',
        label: 'Đóng tab hiện tại',
        hint: 'Ctrl+Shift+W',
        run: () => {
          if (tabs.activeId) tabs.closeTab(tabs.activeId)
        }
      },
      { id: 'lock-vault', label: '🔒 Khoá vault', run: () => void useVaultStore.getState().lock() },
      ...extraCommands,
      ...hosts.map((host) => ({
        id: `ssh-${host.id}`,
        label: `SSH: ${host.label}`,
        hint: `${host.username ?? ''}@${host.hostname}`,
        run: () => void tabs.openSsh(host.id)
      })),
      ...hosts.map((host) => ({
        id: `sftp-${host.id}`,
        label: `SFTP: ${host.label}`,
        hint: host.hostname,
        run: () => void tabs.openSftp(host.id)
      })),
      ...hosts.map((host) => ({
        id: `split-${host.id}`,
        label: `Split SSH: ${host.label}`,
        hint: 'mở trong pane mới (broadcast)',
        run: () => void tabs.splitSsh(host.id)
      }))
    ]
    return list
  }, [hosts, extraCommands])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 50)
    return commands.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(q)).slice(0, 50)
  }, [commands, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setIndex(0)
  }, [query])

  const run = (command: Command | undefined): void => {
    if (!command) return
    onClose()
    command.run()
  }

  return (
    <div className="absolute inset-0 z-[60] flex items-start justify-center bg-black/50 pt-24" onMouseDown={onClose}>
      <div
        className="w-[560px] max-w-[90vw] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(filtered[index])
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
          placeholder="Gõ lệnh hoặc tên host… (↑↓ chọn, Enter chạy)"
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none"
        />
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.map((command, i) => (
            <button
              key={command.id}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                i === index ? 'bg-blue-600/30 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/60'
              }`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(command)}
            >
              <span className="min-w-0 flex-1 truncate">{command.label}</span>
              {command.hint && <span className="shrink-0 text-[11px] text-zinc-500">{command.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && <p className="px-4 py-3 text-sm text-zinc-500">Không có lệnh khớp</p>}
        </div>
      </div>
    </div>
  )
}
