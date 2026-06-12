import { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupDto, HostDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useTabsStore } from '../stores/tabs'
import { useToastsStore } from '../stores/toasts'
import { useUiStore, type AppModal } from '../stores/ui'
import { GroupEditorModal } from './GroupEditorModal'
import { HostEditorModal } from './HostEditorModal'
import { Button } from './ui'

const QUICK_PATTERN = /^[^@\s]+@[^@\s]+$/

// Modal toàn cục (bulk/monitor/ai…) chuyển sang useUiStore — App là nơi mount duy nhất.
// Sidebar chỉ giữ editor host/group (cần props).
type OpenModal =
  | { kind: 'host'; host: HostDto | null }
  | { kind: 'group'; group: GroupDto | null }
  | null

/** Cột trái: Quick Connect / tìm kiếm, hosts theo group, lịch sử, menu công cụ. */
export function Sidebar() {
  const { hosts, groups, history, refreshAll } = useDataStore()
  const { openSsh, openQuick, openSftp, splitSsh } = useTabsStore()
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<OpenModal>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  const isQuick = QUICK_PATTERN.test(query.trim()) || /^[^@\s]+@.+:\d+$/.test(query.trim())

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return hosts
    return hosts.filter(
      (h) =>
        h.label.toLowerCase().includes(q) ||
        h.hostname.toLowerCase().includes(q) ||
        (h.username ?? '').toLowerCase().includes(q)
    )
  }, [hosts, query])

  const sections = useMemo(() => {
    const byGroup = new Map<string | null, HostDto[]>()
    for (const host of filtered) {
      const list = byGroup.get(host.groupId) ?? []
      list.push(host)
      byGroup.set(host.groupId, list)
    }
    const result: Array<{ group: GroupDto | null; hosts: HostDto[] }> = []
    for (const group of groups) {
      const list = byGroup.get(group.id)
      if (list?.length) result.push({ group, hosts: list })
    }
    const ungrouped = byGroup.get(null)
    if (ungrouped?.length) result.push({ group: null, hosts: ungrouped })
    return result
  }, [filtered, groups])

  const connectQuick = (): void => {
    if (!isQuick) return
    void openQuick(query.trim())
    setQuery('')
  }

  const runImport = async (): Promise<void> => {
    setMenuOpen(false)
    const result = await window.infra.importer.sshConfig()
    if (!result) return
    await refreshAll()
    const push = useToastsStore.getState().push
    push(`Đã import ${result.hostsImported} hosts, ${result.keysImported} keys vào group "${result.groupName}"`, 'info')
    for (const warning of result.warnings.slice(0, 3)) push(warning)
  }

  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-[#0e121b] select-none">
      <div className="p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (isQuick) connectQuick()
              else if (filtered.length === 1) void openSsh(filtered[0]!.id)
            }
          }}
          placeholder="Tìm host hoặc user@host…"
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-blue-600"
        />
        {isQuick && (
          <button
            className="mt-1.5 flex w-full items-center gap-1.5 rounded border border-blue-900/60 bg-blue-950/40 px-2.5 py-1.5 text-left text-xs text-blue-300 hover:bg-blue-900/40"
            onClick={connectQuick}
          >
            <span className="text-blue-500">→</span> Kết nối {query.trim()}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sections.map((section) => (
          <div key={section.group?.id ?? '__ungrouped__'} className="mb-2">
            <div className="group/header flex items-center px-1 py-1">
              <span className="flex-1 text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">
                {section.group?.name ?? (groups.length > 0 ? 'Khác' : 'Hosts')}
              </span>
              {section.group && (
                <button
                  className="rounded p-0.5 text-zinc-600 opacity-0 group-hover/header:opacity-100 hover:bg-zinc-800 hover:text-zinc-300"
                  title="Sửa group"
                  onClick={() => setModal({ kind: 'group', group: section.group })}
                >
                  <PencilIcon />
                </button>
              )}
            </div>
            {section.hosts.map((host) => (
              <div
                key={host.id}
                className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-800/70"
                onClick={() => void openSsh(host.id)}
                title={`${host.username ?? '(group)'}@${host.hostname}:${host.port}${host.jumpChain?.length ? ` (qua ${host.jumpChain.length} jump)` : ''}`}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-zinc-600 group-hover:bg-emerald-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-zinc-200">
                    {host.label}
                    {host.jumpChain?.length ? <span className="ml-1 text-[9px] text-amber-500/80">⛓{host.jumpChain.length}</span> : null}
                  </div>
                  <div className="truncate text-[10px] text-zinc-500">
                    {host.username ? `${host.username}@` : ''}
                    {host.hostname}
                  </div>
                </div>
                <button
                  className="rounded p-1 text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-amber-300"
                  title="Mở trong pane mới của tab hiện tại (split — để broadcast nhiều server)"
                  onClick={(e) => {
                    e.stopPropagation()
                    void splitSsh(host.id)
                  }}
                >
                  <SplitIcon />
                </button>
                <button
                  className="rounded p-1 text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200"
                  title="Mở SFTP"
                  onClick={(e) => {
                    e.stopPropagation()
                    void openSftp(host.id)
                  }}
                >
                  <FolderIcon />
                </button>
                <button
                  className="rounded p-1 text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200"
                  title="Sửa host"
                  onClick={(e) => {
                    e.stopPropagation()
                    setModal({ kind: 'host', host })
                  }}
                >
                  <PencilIcon />
                </button>
              </div>
            ))}
          </div>
        ))}

        {hosts.length === 0 && (
          <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-zinc-600">
            Chưa có host nào.
            <br />
            Bấm <b>+ Host</b> để thêm, gõ <b>user@host</b> để Quick Connect, hoặc menu ⋯ để import từ ssh_config.
          </p>
        )}

        {history.length > 0 && (
          <div className="mt-3 border-t border-zinc-800/70 pt-2">
            <div className="px-1 py-1 text-[10px] font-semibold tracking-wider text-zinc-600 uppercase">
              Gần đây
            </div>
            {history.map((entry) => (
              <button
                key={entry.id}
                className="block w-full truncate rounded px-2 py-1 text-left text-[11px] text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200"
                onClick={() => {
                  if (entry.hostId) void openSsh(entry.hostId)
                  else void openQuick(entry.target.replace(/:22$/, ''))
                }}
              >
                {entry.target}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1.5 border-t border-zinc-800 p-2" ref={menuRef}>
        <Button className="flex-1 !py-1 !text-xs" variant="primary" onClick={() => setModal({ kind: 'host', host: null })}>
          + Host
        </Button>
        <Button className="flex-1 !py-1 !text-xs" onClick={() => openAppModal('keys')}>
          Keys
        </Button>
        <div className="relative">
          <Button className="!px-2 !py-1 !text-xs" onClick={() => setMenuOpen((v) => !v)} title="Công cụ khác">
            ⋯
          </Button>
          {menuOpen && (
            <div className="absolute bottom-9 right-0 z-50 min-w-44 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
              <MenuItem label="⚡ Bulk Execution (chạy đa host)" onClick={() => { setMenuOpen(false); openAppModal('bulk') }} />
              <MenuItem label="📊 Monitoring Dashboard" onClick={() => { setMenuOpen(false); openAppModal('monitor') }} />
              <MenuItem label="🤖 Trợ lý AI" onClick={() => { setMenuOpen(false); openAppModal('ai') }} />
              <MenuItem label="⏯ Bản ghi phiên (replay)" onClick={() => { setMenuOpen(false); openAppModal('recordings') }} />
              <MenuItem label="🛰 Network Toolbox" onClick={() => { setMenuOpen(false); openAppModal('net') }} />
              <MenuItem label="🔄 Sync (E2EE)" onClick={() => { setMenuOpen(false); openAppModal('sync') }} />
              <MenuItem label="⚡ Snippets" onClick={() => { setMenuOpen(false); openAppModal('snippets') }} />
              <MenuItem label="⇄ Tunnels (port forwarding)" onClick={() => { setMenuOpen(false); openAppModal('tunnels') }} />
              <MenuItem label="🗂 Tạo group" onClick={() => { setMenuOpen(false); setModal({ kind: 'group', group: null }) }} />
              <MenuItem label="📥 Import từ ssh_config…" onClick={() => void runImport()} />
            </div>
          )}
        </div>
      </div>

      {modal?.kind === 'host' && <HostEditorModal host={modal.host} onClose={() => setModal(null)} />}
      {modal?.kind === 'group' && <GroupEditorModal group={modal.group} onClose={() => setModal(null)} />}
    </div>
  )
}

function openAppModal(kind: AppModal): void {
  useUiStore.getState().setModal(kind)
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700/60 hover:text-zinc-100"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.1 1.6a1.9 1.9 0 0 1 2.7 2.7l-8.3 8.3-3.7 1 1-3.7 8.3-8.3z" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 2h4l1.5 2h7.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
    </svg>
  )
}

function SplitIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2" width="13" height="12" rx="1" />
      <path d="M8 2v12" />
    </svg>
  )
}
