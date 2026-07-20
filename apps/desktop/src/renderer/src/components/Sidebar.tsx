import { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupDto, HostDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useTabsStore } from '../stores/tabs'
import { useToastsStore } from '../stores/toasts'
import { useRdpStore } from '../stores/rdp'
import { useWatcherStore } from '../stores/watcher'
import { useFavoritesStore } from '../stores/favorites'
import { useUiStore, type AppModal } from '../stores/ui'
import { GroupEditorModal } from './GroupEditorModal'
import { HostEditorModal } from './HostEditorModal'
import { NotesModal } from './NotesModal'
import { Button, ConfirmModal } from './ui'
import { useT } from '../i18n'

const QUICK_PATTERN = /^[^@\s]+@[^@\s]+$/

// Modal toàn cục (bulk/monitor/ai…) chuyển sang useUiStore — App là nơi mount duy nhất.
// Sidebar chỉ giữ editor host/group (cần props).
type OpenModal =
  | { kind: 'host'; host: HostDto | null; duplicate?: boolean }
  | { kind: 'group'; group: GroupDto | null }
  | { kind: 'notes'; host: HostDto }
  | null

/** Cột trái: Quick Connect / tìm kiếm, hosts theo group, lịch sử, menu công cụ. */
export function Sidebar() {
  const t = useT()
  const { hosts, groups, history, refreshAll, deleteGroup } = useDataStore()
  const { openSsh, openQuick, openSshGroup } = useTabsStore()
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const setWatcherEnabled = useWatcherStore((s) => s.setEnabled)
  const favIds = useFavoritesStore((s) => s.ids)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<OpenModal>(null)
  const [deletingGroup, setDeletingGroup] = useState<GroupDto | null>(null)
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
    // Khi KHÔNG tìm kiếm: hiện cả group RỖNG (để đổi tên/xoá được — trước đây group không host
    // bị ẩn hoàn toàn nên kẹt luôn). Khi đang tìm kiếm thì chỉ hiện group có host khớp cho gọn.
    const showEmpty = !query.trim()
    const result: Array<{ group: GroupDto | null; hosts: HostDto[] }> = []
    for (const group of groups) {
      const list = byGroup.get(group.id) ?? []
      if (list.length || showEmpty) result.push({ group, hosts: list })
    }
    const ungrouped = byGroup.get(null)
    if (ungrouped?.length) result.push({ group: null, hosts: ungrouped })
    return result
  }, [filtered, groups, query])

  // Host đã ghim (tôn trọng cả ô tìm kiếm); hiện ở mục "Yêu thích" đầu danh sách.
  const favHosts = useMemo(() => filtered.filter((h) => favIds.includes(h.id)), [filtered, favIds])

  const openHostEditor = (host: HostDto, duplicate = false): void => setModal({ kind: 'host', host, duplicate })
  const openNotes = (host: HostDto): void => setModal({ kind: 'notes', host })

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

  // Thu gọn: chỉ còn thanh hẹp với nút mở lại — vùng làm việc chiếm phần còn lại.
  if (sidebarCollapsed) {
    return (
      <div className="border-edge bg-panel flex w-8 shrink-0 flex-col items-center border-r py-1.5 select-none">
        <button
          className="text-muted hover:bg-hover hover:text-content rounded px-1.5 py-1 text-sm leading-none"
          title={`${t('sidebar.expand')} (Ctrl+Shift+H)`}
          aria-label={t('sidebar.expand')}
          onClick={toggleSidebar}
        >
          »
        </button>
      </div>
    )
  }

  return (
    <div className="border-edge bg-panel flex w-60 shrink-0 flex-col border-r select-none">
      <div className="p-2">
        <div className="flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (isQuick) connectQuick()
                else if (filtered.length === 1) void openSsh(filtered[0]!.id)
              }
            }}
            placeholder={t('sidebar.searchPlaceholder')}
            className="border-edge bg-input text-content placeholder-subtle focus:border-accent w-full min-w-0 flex-1 rounded border px-2.5 py-1.5 text-xs outline-none"
          />
          <button
            className="text-subtle hover:bg-hover hover:text-content shrink-0 rounded px-1 py-1 text-sm leading-none"
            title={`${t('sidebar.collapse')} (Ctrl+Shift+H)`}
            aria-label={t('sidebar.collapse')}
            onClick={toggleSidebar}
          >
            «
          </button>
        </div>
        {isQuick && (
          <button
            className="border-accent/40 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60 mt-1.5 flex w-full items-center gap-1.5 rounded border px-2.5 py-1.5 text-left text-xs"
            onClick={connectQuick}
          >
            <span className="text-accent">→</span> {t('sidebar.connectTo', { target: query.trim() })}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {favHosts.length > 0 && (
          <div className="mb-2">
            <div className="px-1 py-1">
              <span className="text-warning/80 text-[10px] font-semibold tracking-wider uppercase">
                ★ {t('sidebar.favorites')}
              </span>
            </div>
            {favHosts.map((host) => (
              <HostRow
                key={`fav-${host.id}`}
                host={host}
                color={groups.find((g) => g.id === host.groupId)?.color ?? null}
                onEdit={openHostEditor}
                onNotes={openNotes}
              />
            ))}
          </div>
        )}

        {sections.map((section) => (
          <div key={section.group?.id ?? '__ungrouped__'} className="mb-2">
            <div className="group/header flex items-center px-1 py-1">
              {/* Chấm màu nhận diện group (đặt trong group editor) */}
              {section.group?.color && (
                <span className="mr-1.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: section.group.color }} />
              )}
              <span className="text-subtle flex-1 text-[10px] font-semibold tracking-wider uppercase">
                {section.group?.name ?? (groups.length > 0 ? t('sidebar.other') : t('sidebar.global'))}
              </span>
              {section.hosts.length > 1 && (
                <button
                  className="text-subtle hover:bg-hover hover:text-warning rounded p-0.5 opacity-0 group-hover/header:opacity-100"
                  title={t('sidebar.openGroup', { n: section.hosts.length })}
                  onClick={() => void openSshGroup(section.hosts.map((h) => h.id))}
                >
                  <GridIcon />
                </button>
              )}
              {section.group && (
                <button
                  className="text-subtle hover:bg-hover hover:text-content rounded p-0.5 opacity-0 group-hover/header:opacity-100"
                  title={t('sidebar.editGroup')}
                  onClick={() => setModal({ kind: 'group', group: section.group })}
                >
                  <PencilIcon />
                </button>
              )}
              {section.group && (
                <button
                  className="text-subtle hover:bg-hover hover:text-danger rounded p-0.5 opacity-0 group-hover/header:opacity-100"
                  title={t('sidebar.deleteGroup')}
                  onClick={() => setDeletingGroup(section.group)}
                >
                  <TrashIcon />
                </button>
              )}
            </div>
            {section.group && section.hosts.length === 0 ? (
              <p className="text-subtle px-2 py-1 text-[10px] italic">{t('sidebar.groupEmpty')}</p>
            ) : (
              section.hosts.map((host) => (
                <HostRow
                  key={host.id}
                  host={host}
                  color={section.group?.color ?? null}
                  onEdit={openHostEditor}
                  onNotes={openNotes}
                />
              ))
            )}
          </div>
        ))}

        {hosts.length === 0 && (
          <p className="text-subtle px-2 py-6 text-center text-[11px] leading-relaxed">
            {t('sidebar.empty')}
          </p>
        )}

        {history.length > 0 && (
          <div className="border-edge/70 mt-3 border-t pt-2">
            <div className="text-subtle px-1 py-1 text-[10px] font-semibold tracking-wider uppercase">
              {t('sidebar.recent')}
            </div>
            {/* Store giữ 50 mục cho Dashboard tính thống kê — sidebar chỉ hiện 8 như cũ */}
            {history.slice(0, 8).map((entry) => (
              <button
                key={entry.id}
                className="text-muted hover:bg-hover hover:text-content block w-full truncate rounded px-2 py-1 text-left text-[11px]"
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

      <div className="border-edge flex gap-1.5 border-t p-2" ref={menuRef}>
        <Button className="flex-1 !py-1 !text-xs" variant="primary" onClick={() => setModal({ kind: 'host', host: null })}>
          {t('sidebar.addHost')}
        </Button>
        <Button className="flex-1 !py-1 !text-xs" onClick={() => openAppModal('keys')}>
          {t('sidebar.keys')}
        </Button>
        <div className="relative">
          <Button className="!px-2 !py-1 !text-xs" onClick={() => setMenuOpen((v) => !v)} title={t('sidebar.moreTools')}>
            ⋯
          </Button>
          {menuOpen && (
            <div className="border-edge-strong bg-elevated absolute right-0 bottom-9 z-50 min-w-44 rounded-md border py-1 shadow-xl">
              <MenuItem label={t('menu.workspaces')} onClick={() => { setMenuOpen(false); openAppModal('workspaces') }} />
              <MenuItem label={t('menu.bulk')} onClick={() => { setMenuOpen(false); openAppModal('bulk') }} />
              <MenuItem label={t('menu.monitor')} onClick={() => { setMenuOpen(false); openAppModal('monitor') }} />
              {/* F39: toggle watcher nền — ✓ khi đang bật (chấm xanh/đỏ cạnh host) */}
              <MenuItem
                label={`${watcherEnabled ? '✓ ' : ''}${t('menu.watcher')}`}
                onClick={() => { setMenuOpen(false); setWatcherEnabled(!watcherEnabled) }}
              />
              <MenuItem label={t('menu.processes')} onClick={() => { setMenuOpen(false); openAppModal('processes') }} />
              <MenuItem label={t('menu.services')} onClick={() => { setMenuOpen(false); openAppModal('services') }} />
              <MenuItem label={t('menu.compare')} onClick={() => { setMenuOpen(false); openAppModal('compare') }} />
              <MenuItem label={t('menu.ai')} onClick={() => { setMenuOpen(false); openAppModal('ai') }} />
              <MenuItem label={t('menu.aiDiagnose')} onClick={() => { setMenuOpen(false); openAppModal('ai-diagnose') }} />
              <MenuItem label={t('menu.recordings')} onClick={() => { setMenuOpen(false); openAppModal('recordings') }} />
              <MenuItem label={t('menu.net')} onClick={() => { setMenuOpen(false); openAppModal('net') }} />
              <MenuItem label={t('menu.sync')} onClick={() => { setMenuOpen(false); openAppModal('sync') }} />
              <MenuItem label={t('menu.snippets')} onClick={() => { setMenuOpen(false); openAppModal('snippets') }} />
              <MenuItem label={t('menu.tunnels')} onClick={() => { setMenuOpen(false); openAppModal('tunnels') }} />
              <MenuItem label={t('menu.plugins')} onClick={() => { setMenuOpen(false); openAppModal('plugins') }} />
              <MenuItem label={t('menu.createGroup')} onClick={() => { setMenuOpen(false); setModal({ kind: 'group', group: null }) }} />
              <MenuItem label={t('menu.import')} onClick={() => void runImport()} />
              <div className="border-edge my-1 border-t" />
              <MenuItem label={t('menu.settings')} onClick={() => { setMenuOpen(false); openAppModal('settings') }} />
            </div>
          )}
        </div>
      </div>

      {modal?.kind === 'host' && (
        <HostEditorModal host={modal.host} duplicate={modal.duplicate} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'group' && <GroupEditorModal group={modal.group} onClose={() => setModal(null)} />}
      {modal?.kind === 'notes' && (
        <NotesModal
          host={modal.host}
          onEdit={() => setModal({ kind: 'host', host: modal.host })}
          onClose={() => setModal(null)}
        />
      )}
      {deletingGroup && (
        <ConfirmModal
          title={t('group.delete')}
          message={
            <>
              {t('group.deleteMsg', { name: deletingGroup.name })}
              {hosts.some((h) => h.groupId === deletingGroup.id) && (
                <span className="text-warning mt-2 block text-xs">{t('group.deleteHostsNote')}</span>
              )}
            </>
          }
          onConfirm={() => {
            const g = deletingGroup
            setDeletingGroup(null)
            void deleteGroup(g.id)
          }}
          onCancel={() => setDeletingGroup(null)}
        />
      )}
    </div>
  )
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function openAppModal(kind: AppModal): void {
  useUiStore.getState().setModal(kind)
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="text-muted hover:bg-hover hover:text-content block w-full px-3 py-1.5 text-left text-xs whitespace-nowrap"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/** Một dòng host trong sidebar (dùng chung cho mục Yêu thích lẫn các group). */
function HostRow({
  host,
  color,
  onEdit,
  onNotes
}: {
  host: HostDto
  /** Màu nhận diện group (viền trái) — null = không tô. */
  color?: string | null
  onEdit: (host: HostDto, duplicate?: boolean) => void
  onNotes: (host: HostDto) => void
}) {
  const t = useT()
  const openSsh = useTabsStore((s) => s.openSsh)
  const splitSsh = useTabsStore((s) => s.splitSsh)
  const openSftp = useTabsStore((s) => s.openSftp)
  const openVnc = useTabsStore((s) => s.openVnc)
  const openRdp = useRdpStore((s) => s.open)
  const favorite = useFavoritesStore((s) => s.ids.includes(host.id))
  const toggleFav = useFavoritesStore((s) => s.toggle)
  // F39: trạng thái watcher nền (chấm xanh/đỏ) — undefined khi watcher tắt/chưa check
  const watch = useWatcherStore((s) => s.statuses[host.id])
  const isRemoteDesktop = host.protocol === 'vnc' || host.protocol === 'rdp'
  const openHost = (): void => {
    if (host.protocol === 'vnc') void openVnc(host.id)
    else if (host.protocol === 'rdp') void openRdp(host.id)
    else void openSsh(host.id)
  }
  const dotClass =
    watch === undefined
      ? 'bg-subtle group-hover:bg-success'
      : watch.ok
        ? 'bg-success'
        : 'bg-danger'
  return (
    <div
      className="group hover:bg-hover flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
      style={color ? { boxShadow: `inset 2px 0 0 ${color}` } : undefined}
      onClick={openHost}
      title={`${host.username ?? '(group)'}@${host.hostname}:${host.port}${host.jumpChain?.length ? ` (qua ${host.jumpChain.length} jump)` : ''}${
        watch ? `\n${watch.ok ? `✓ ${t('watcher.up', { ms: watch.latencyMs ?? 0 })}` : `✗ ${t('watcher.down')}`}` : ''
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${dotClass}`} />
      <div className="min-w-0 flex-1">
        <div className="text-content truncate text-xs">
          {host.label}
          {host.jumpChain?.length ? <span className="text-warning/80 ml-1 text-[9px]">⛓{host.jumpChain.length}</span> : null}
        </div>
        <div className="text-subtle truncate text-[10px]">
          {host.username ? `${host.username}@` : ''}
          {host.hostname}
        </div>
      </div>
      {/* Host được ghim: sao vàng hiện thường trực (chỉ báo), không chiếm chỗ nhóm hover */}
      {favorite && (
        <button
          className="text-warning hover:bg-edge-strong shrink-0 rounded p-1"
          title={t('sidebar.unfavorite')}
          onClick={(e) => {
            e.stopPropagation()
            toggleFav(host.id)
          }}
        >
          <StarIcon filled />
        </button>
      )}
      {/* Nhóm nút hành động: ẩn HẲN khi không hover (hidden) → tên host có đủ chỗ hiện full;
          chỉ hiện (flex) khi hover. Ghi chú cũng nằm trong đây → chỉ lộ khi hover. */}
      <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {!favorite && (
          <button
            className="text-subtle hover:bg-edge-strong hover:text-warning rounded p-1"
            title={t('sidebar.favorite')}
            onClick={(e) => {
              e.stopPropagation()
              toggleFav(host.id)
            }}
          >
            <StarIcon filled={false} />
          </button>
        )}
        {host.notes && (
          <button
            className="text-muted hover:bg-edge-strong hover:text-content rounded p-1"
            title={t('sidebar.viewNotes')}
            onClick={(e) => {
              e.stopPropagation()
              onNotes(host)
            }}
          >
            <NoteIcon />
          </button>
        )}
        {isRemoteDesktop ? (
          <button
            className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1 text-xs"
            title={host.protocol === 'vnc' ? t('sidebar.openVnc') : t('sidebar.openRdp')}
            onClick={(e) => {
              e.stopPropagation()
              openHost()
            }}
          >
            🖥️
          </button>
        ) : (
          <>
            <button
              className="text-subtle hover:bg-edge-strong hover:text-warning rounded p-1"
              title={t('sidebar.splitHost')}
              onClick={(e) => {
                e.stopPropagation()
                void splitSsh(host.id)
              }}
            >
              <SplitIcon />
            </button>
            <button
              className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1"
              title={t('sidebar.openSftp')}
              onClick={(e) => {
                e.stopPropagation()
                void openSftp(host.id)
              }}
            >
              <FolderIcon />
            </button>
          </>
        )}
        <button
          className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1"
          title={t('sidebar.duplicateHost')}
          onClick={(e) => {
            e.stopPropagation()
            onEdit(host, true)
          }}
        >
          <CopyIcon />
        </button>
        <button
          className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1"
          title={t('sidebar.editHost')}
          onClick={(e) => {
            e.stopPropagation()
            onEdit(host)
          }}
        >
          <PencilIcon />
        </button>
      </div>
    </div>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <path d="M8 1.7l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.9 4.2 13.5l.7-4.3-3.1-3 4.3-.6z" strokeLinejoin="round" />
    </svg>
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

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </svg>
  )
}

function NoteIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h4" strokeLinecap="round" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2" width="13" height="12" rx="1" />
      <path d="M8 2v12M1.5 8h13" />
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
