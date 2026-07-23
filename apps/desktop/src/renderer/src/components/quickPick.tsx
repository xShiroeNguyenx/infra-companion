import { useMemo } from 'react'
import type { HostDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useWorkspacesStore, type Workspace } from '../stores/workspaces'

/** 1 cụm host chọn nhanh (nhóm hoặc workspace). */
export interface HostCluster {
  id: string
  name: string
  hostIds: string[]
}

/** Các hostId (SSH) mà 1 workspace tham chiếu — gom từ pane terminal kind='host' + tab sftp. */
export function workspaceHostIds(ws: Workspace, sshHostIds: Set<string>): string[] {
  const ids = new Set<string>()
  for (const tab of ws.tabs) {
    if (tab.kind === 'terminal') {
      for (const pane of tab.panes) if (pane.kind === 'host' && sshHostIds.has(pane.hostId)) ids.add(pane.hostId)
    } else if (tab.kind === 'sftp') {
      if (sshHostIds.has(tab.hostId)) ids.add(tab.hostId)
    }
  }
  return [...ids]
}

/** Chip chọn nhanh theo NHÓM / WORKSPACE (mỗi cụm có ≥1 host SSH trong `hosts`). Dùng chung
 *  cho Monitor + Compare. */
export function useQuickPickChips(hosts: HostDto[]): { groupChips: HostCluster[]; wsChips: HostCluster[] } {
  const groups = useDataStore((s) => s.groups)
  const workspaces = useWorkspacesStore((s) => s.workspaces)
  const sshHostIds = useMemo(() => new Set(hosts.map((h) => h.id)), [hosts])
  const groupChips = useMemo(
    () =>
      groups
        .map((g) => ({ id: g.id, name: g.name, hostIds: hosts.filter((h) => h.groupId === g.id).map((h) => h.id) }))
        .filter((g) => g.hostIds.length > 0),
    [groups, hosts]
  )
  const wsChips = useMemo(
    () =>
      workspaces
        .map((ws) => ({ id: ws.id, name: ws.name, hostIds: workspaceHostIds(ws, sshHostIds) }))
        .filter((ws) => ws.hostIds.length > 0),
    [workspaces, sshHostIds]
  )
  return { groupChips, wsChips }
}

/** Chip chọn nhanh 1 cụm host (nhóm/workspace). active = cả cụm đang được chọn. */
export function QuickChip({
  label,
  count,
  active,
  title,
  onClick
}: {
  label: string
  count: number
  active: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] ${
        active
          ? 'border-accent/50 bg-accent-soft/50 text-accent-fg'
          : 'border-edge bg-input text-muted hover:bg-hover hover:text-content'
      }`}
    >
      <span className="max-w-32 truncate">{label}</span>
      <span className={active ? 'text-accent-fg/70' : 'text-subtle'}>· {count}</span>
    </button>
  )
}
