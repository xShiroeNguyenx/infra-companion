import { useEffect, useMemo, useRef, useState } from 'react'
import { useDataStore } from '../stores/data'
import { useTabsStore } from '../stores/tabs'
import { useVaultStore } from '../stores/vault'
import { useT } from '../i18n'

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
  const t = useT()
  const hosts = useDataStore((s) => s.hosts)
  const groups = useDataStore((s) => s.groups)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo<Command[]>(() => {
    const tabs = useTabsStore.getState()
    const list: Command[] = [
      { id: 'new-local', label: t('palette.newLocal'), hint: 'Ctrl+Shift+T', run: () => void tabs.openLocal() },
      { id: 'split-local', label: t('palette.splitLocal'), run: () => void tabs.splitLocal() },
      {
        id: 'broadcast',
        label: t('palette.broadcast'),
        hint: t('palette.broadcastHint'),
        run: () => {
          const active = tabs.activeTab()
          if (active) tabs.toggleBroadcast(active.id)
        }
      },
      {
        id: 'close-tab',
        label: t('palette.closeTab'),
        hint: 'Ctrl+Shift+W',
        run: () => {
          if (tabs.activeId) tabs.closeTab(tabs.activeId)
        }
      },
      { id: 'lock-vault', label: t('palette.lockVault'), run: () => void useVaultStore.getState().lock() },
      ...extraCommands,
      ...hosts.map((host) => ({
        id: `ssh-${host.id}`,
        label: t('palette.ssh', { label: host.label }),
        hint: `${host.username ?? ''}@${host.hostname}`,
        run: () => void tabs.openSsh(host.id)
      })),
      ...hosts.map((host) => ({
        id: `sftp-${host.id}`,
        label: t('palette.sftp', { label: host.label }),
        hint: host.hostname,
        run: () => void tabs.openSftp(host.id)
      })),
      ...hosts.map((host) => ({
        id: `split-${host.id}`,
        label: t('palette.splitSsh', { label: host.label }),
        hint: t('palette.splitSshHint'),
        run: () => void tabs.splitSsh(host.id)
      })),
      ...groups.flatMap((group) => {
        const memberIds = hosts.filter((h) => h.groupId === group.id).map((h) => h.id)
        if (memberIds.length < 2) return []
        return [
          {
            id: `open-group-${group.id}`,
            label: t('palette.openGroup', { label: group.name, n: memberIds.length }),
            hint: t('palette.openGroupHint'),
            run: () => void tabs.openSshGroup(memberIds)
          }
        ]
      })
    ]
    return list
  }, [hosts, groups, extraCommands, t])

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
        className="border-edge-strong bg-elevated w-[560px] max-w-[90vw] overflow-hidden rounded-lg border shadow-2xl"
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
          placeholder={t('palette.placeholder')}
          className="border-edge text-content placeholder-subtle w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.map((command, i) => (
            <button
              key={command.id}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                i === index ? 'bg-accent/25 text-content' : 'text-muted hover:bg-hover'
              }`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(command)}
            >
              <span className="min-w-0 flex-1 truncate">{command.label}</span>
              {command.hint && <span className="text-subtle shrink-0 text-[11px]">{command.hint}</span>}
            </button>
          ))}
          {filtered.length === 0 && <p className="text-subtle px-4 py-3 text-sm">{t('palette.noMatch')}</p>}
        </div>
      </div>
    </div>
  )
}
