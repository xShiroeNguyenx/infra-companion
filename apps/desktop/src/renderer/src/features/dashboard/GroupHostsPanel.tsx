import type { GroupDto, HostDto } from '@infra/shared'
import { Button } from '../../components/ui'
import { useTabsStore } from '../../stores/tabs'
import { useWatcherStore } from '../../stores/watcher'
import { useT } from '../../i18n'

/**
 * Danh sách host đầy đủ của MỘT nhóm — hiện NGAY TẠI khu "Nhóm host" của Dashboard, thay chỗ
 * lưới card, với nút ← quay lại. Trước đây là popup (GroupHostsModal): popup che cả Dashboard
 * chỉ để trả lời "nhóm này có những máy nào", và đóng lại là mất chỗ đứng. Inline thì mở vài
 * host liên tiếp vẫn quay về đúng danh sách đang xem.
 *
 * KHÔNG tự đóng sau khi mở host: mở một tab là app tự chuyển sang tab đó rồi, quay lại
 * Dashboard thấy danh sách còn nguyên là đúng ý người đang mở lần lượt nhiều máy.
 */
export function GroupHostsPanel({
  group,
  hosts,
  onBack
}: {
  readonly group: GroupDto
  readonly hosts: HostDto[]
  readonly onBack: () => void
}) {
  const t = useT()
  const { openSsh, openSshGroup, openSftp } = useTabsStore()
  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const statuses = useWatcherStore((s) => s.statuses)

  return (
    <div className="border-edge-strong bg-elevated rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="border-edge text-muted hover:bg-hover hover:text-content shrink-0 rounded border px-2 py-1 text-xs"
        >
          ← {t('dashboard.back')}
        </button>
        <span className="size-2 shrink-0 rounded-sm" style={{ background: group.color ?? 'var(--c-edge-strong)' }} />
        <span className="text-content min-w-0 truncate text-sm font-semibold">{group.name}</span>
        <span className="text-subtle text-[11px]">{t('dashboard.groupHosts', { n: hosts.length })}</span>
        {group.username && <span className="text-subtle truncate text-[11px]">· {group.username}</span>}
        {hosts.length > 0 && (
          <Button
            variant="primary"
            className="ml-auto !px-2.5 !py-1 !text-xs"
            title={t('sidebar.openGroup', { n: hosts.length })}
            onClick={() => void openSshGroup(hosts.map((h) => h.id))}
          >
            ⊞ {t('dashboard.groupOpenPanes', { n: hosts.length })}
          </Button>
        )}
      </div>

      {hosts.length === 0 ? (
        <p className="text-subtle py-6 text-center text-xs">{t('group.empty')}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {hosts.map((host) => {
            const status = statuses[host.id]
            // Chưa có kết quả check (watcher tắt / mới bật) = CHƯA BIẾT → xám, không tô đỏ
            const tone =
              !watcherEnabled || status === undefined ? 'bg-edge-strong' : status.ok ? 'bg-success' : 'bg-danger'
            return (
              <div
                key={host.id}
                className="border-edge bg-input hover:bg-hover flex items-center gap-2 rounded border px-3 py-2"
              >
                <span className={`size-1.5 shrink-0 rounded-full ${tone}`} />
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer text-left"
                  title={t('sidebar.connectTo', { target: host.label })}
                  onClick={() => void openSsh(host.id)}
                >
                  <div className="text-content truncate text-xs font-medium">{host.label}</div>
                  <div className="text-subtle truncate font-mono text-[10px]">
                    {host.username ? `${host.username}@` : ''}
                    {host.hostname}
                    {host.port !== 22 ? `:${host.port}` : ''}
                  </div>
                </button>
                {/* KHÔNG dùng Button mặc định ở đây: hover của nó là bg-hover — trùng đúng màu
                    hover của cả DÒNG, nên rê chuột vào nút không thấy gì đổi và nó đọc như một
                    cái nhãn. Trong khi bấm nút (SFTP) và bấm dòng (SSH) là hai việc khác nhau,
                    nên nút phải đổi sang tông accent để thấy rõ mình đang sắp bấm cái gì. */}
                <button
                  type="button"
                  title={`${t('sidebar.openSftp')} — ${host.label}`}
                  onClick={() => void openSftp(host.id)}
                  className="border-edge-strong bg-app text-muted hover:border-accent hover:bg-accent-soft/40 hover:text-accent-fg shrink-0 cursor-pointer rounded border px-2 py-1 text-[11px] font-medium"
                >
                  SFTP
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
