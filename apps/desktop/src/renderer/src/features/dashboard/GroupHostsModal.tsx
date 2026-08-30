import type { GroupDto, HostDto } from '@infra/shared'
import { Button, Modal } from '../../components/ui'
import { useTabsStore } from '../../stores/tabs'
import { useWatcherStore } from '../../stores/watcher'
import { useT } from '../../i18n'

/**
 * Danh sách host của MỘT nhóm — mở khi bấm vào tên nhóm trên Dashboard.
 *
 * Card nhóm chỉ đủ chỗ cho vài host đầu; nhóm mười mấy máy thì phải có nơi xem hết và chọn
 * đúng con cần vào. Đây là chỗ đó: mỗi host một dòng, thấy được `user@host:port` và trạng
 * thái, mở lẻ bằng SSH hoặc SFTP — thay vì chỉ có mỗi lựa chọn "mở cả nhóm".
 */
export function GroupHostsModal({
  group,
  hosts,
  onClose
}: {
  readonly group: GroupDto
  readonly hosts: HostDto[]
  readonly onClose: () => void
}) {
  const t = useT()
  const { openSsh, openSshGroup, openSftp } = useTabsStore()
  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const statuses = useWatcherStore((s) => s.statuses)

  /** Mở xong thì đóng modal: người dùng đã chọn được thứ cần, giữ lại chỉ che mất terminal. */
  const openThen = (run: () => Promise<void>): void => {
    void run()
    onClose()
  }

  return (
    <Modal title={group.name} onClose={onClose}>
      <div className="w-[520px] max-w-full">
        <div className="text-subtle mb-2 flex items-center gap-2 text-[11px]">
          <span
            className="size-2 shrink-0 rounded-sm"
            style={{ background: group.color ?? 'var(--c-edge-strong)' }}
          />
          <span>{t('dashboard.groupHosts', { n: hosts.length })}</span>
          {group.username && <span className="truncate">· {group.username}</span>}
        </div>

        {hosts.length === 0 ? (
          <p className="text-subtle py-6 text-center text-xs">{t('group.empty')}</p>
        ) : (
          <div className="mb-3 max-h-80 overflow-y-auto">
            {hosts.map((host) => {
              const status = statuses[host.id]
              // Chưa có kết quả check (watcher tắt / mới bật) = CHƯA BIẾT → xám, không tô đỏ
              const tone =
                !watcherEnabled || status === undefined ? 'bg-edge-strong' : status.ok ? 'bg-success' : 'bg-danger'
              return (
                <div
                  key={host.id}
                  className="border-edge bg-input hover:bg-hover mb-1.5 flex items-center gap-2 rounded border px-3 py-2"
                >
                  <span className={`size-1.5 shrink-0 rounded-full ${tone}`} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    title={t('sidebar.connectTo', { target: host.label })}
                    onClick={() => openThen(() => openSsh(host.id))}
                  >
                    <div className="text-content truncate text-xs font-medium">{host.label}</div>
                    <div className="text-subtle truncate font-mono text-[10px]">
                      {host.username ? `${host.username}@` : ''}
                      {host.hostname}
                      {host.port !== 22 ? `:${host.port}` : ''}
                    </div>
                  </button>
                  <Button
                    type="button"
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => openThen(() => openSftp(host.id))}
                  >
                    SFTP
                  </Button>
                </div>
              )
            })}
          </div>
        )}

        {hosts.length > 0 && (
          <div className="flex justify-end">
            <Button
              variant="primary"
              title={t('sidebar.openGroup', { n: hosts.length })}
              onClick={() => openThen(() => openSshGroup(hosts.map((h) => h.id)))}
            >
              ⊞ {t('dashboard.groupOpenPanes', { n: hosts.length })}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
