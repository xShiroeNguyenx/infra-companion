import type { GroupDto, HostDto } from '@infra/shared'
import type { AppTab, Pane } from '../stores/tabs'

/**
 * Màu nhận diện group của 1 host (production đỏ, staging vàng… — groups.color).
 * Hàm thuần: caller đưa hosts/groups đã subscribe từ useDataStore để component re-render đúng.
 */
export function hostColor(hostId: string | null | undefined, hosts: HostDto[], groups: GroupDto[]): string | null {
  if (!hostId) return null
  const host = hosts.find((h) => h.id === hostId)
  if (!host?.groupId) return null
  return groups.find((g) => g.id === host.groupId)?.color ?? null
}

/** hostId mà 1 pane terminal đang nối tới (origin kind 'host') — quick/local không có màu. */
export function paneHostId(pane: Pane | undefined): string | null {
  return pane?.origin?.kind === 'host' ? pane.origin.hostId : null
}

/** Màu của tab: terminal lấy theo pane active (fallback pane đầu); sftp/vnc theo host của tab. */
export function tabColor(tab: AppTab, hosts: HostDto[], groups: GroupDto[]): string | null {
  if (tab.kind === 'sftp') return hostColor(tab.sftpHostId, hosts, groups)
  if (tab.kind === 'vnc') return hostColor(tab.vncHostId, hosts, groups)
  const active = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
  return hostColor(paneHostId(active), hosts, groups)
}
