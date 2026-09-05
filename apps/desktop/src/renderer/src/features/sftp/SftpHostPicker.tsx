import { useMemo, useState, type ReactNode } from 'react'
import { filterHosts, groupHostSections, type HostDto } from '@infra/shared'
import { useDataStore } from '../../stores/data'
import { useFavoritesStore } from '../../stores/favorites'
import { Modal, TextInput } from '../../components/ui'
import { useT } from '../../i18n'

/**
 * Hộp "Chọn host" của trang SFTP: ô tìm + danh sách host SSH chia theo nhóm (★ yêu thích lên
 * đầu). Chỉ liệt kê host **SSH** — SFTP chạy trên SSH, host telnet/serial/VNC/RDP chọn vào cũng
 * chỉ ra lỗi, nên không cho chọn ngay từ đầu.
 *
 * Dùng chung `filterHosts` / `groupHostSections` với cột host và trang Hosts, để "host này thuộc
 * nhóm nào" không lệch giữa ba nơi.
 */
export function SftpHostPicker({
  currentHostId,
  onPick,
  onClose
}: {
  readonly currentHostId: string | null
  readonly onPick: (hostId: string) => void
  readonly onClose: () => void
}) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts)
  const groups = useDataStore((s) => s.groups)
  const favIds = useFavoritesStore((s) => s.ids)
  const [query, setQuery] = useState('')

  const sshHosts = useMemo(() => hosts.filter((h) => h.protocol === 'ssh'), [hosts])
  const filtered = useMemo(() => filterHosts(sshHosts, query), [sshHosts, query])
  const sections = useMemo(() => groupHostSections(groups, filtered, false), [groups, filtered])
  const favHosts = useMemo(() => filtered.filter((h) => favIds.includes(h.id)), [filtered, favIds])

  const row = (host: HostDto, color: string | null): ReactNode => {
    const current = host.id === currentHostId
    return (
      <button
        key={host.id}
        type="button"
        onClick={() => onPick(host.id)}
        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
          current ? 'bg-accent-soft/40' : 'hover:bg-hover'
        }`}
        style={color ? { boxShadow: `inset 2px 0 0 ${color}` } : undefined}
      >
        <span className="min-w-0 flex-1">
          <span className="text-content block truncate text-xs font-medium">
            {favIds.includes(host.id) && <span className="text-warning">★ </span>}
            {host.label}
          </span>
          <span className="text-subtle block truncate font-mono text-[10px]">
            {host.username ? `${host.username}@` : ''}
            {host.hostname}
            {host.port !== 22 ? `:${host.port}` : ''}
          </span>
        </span>
        {current && <span className="text-accent shrink-0 text-xs">✓</span>}
      </button>
    )
  }

  return (
    <Modal title={t('sftp.selectHost')} onClose={onClose}>
      <div className="w-[min(520px,90vw)]">
        <TextInput
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter khi chỉ còn ĐÚNG một kết quả → chọn luôn; nhiều kết quả thì không đoán
            if (e.key === 'Enter' && filtered.length === 1) onPick(filtered[0]!.id)
          }}
          placeholder={t('sftp.pickerSearch')}
          className="!text-xs"
        />
        <div className="mt-2 max-h-[55vh] space-y-3 overflow-y-auto">
          {sshHosts.length === 0 ? (
            <p className="text-subtle py-6 text-center text-xs">{t('sftp.pickerEmpty')}</p>
          ) : filtered.length === 0 ? (
            <p className="text-subtle py-6 text-center text-xs">{t('hosts.noMatch', { q: query.trim() })}</p>
          ) : (
            <>
              {favHosts.length > 0 && (
                <Section title={`★ ${t('sidebar.favorites')}`} tone="text-warning">
                  {favHosts.map((h) => row(h, groups.find((g) => g.id === h.groupId)?.color ?? null))}
                </Section>
              )}
              {sections.map((section) => (
                <Section
                  key={section.group?.id ?? '__ungrouped__'}
                  title={section.group?.name ?? t('hosts.ungrouped')}
                  color={section.group?.color ?? null}
                >
                  {section.hosts.map((h) => row(h, section.group?.color ?? null))}
                </Section>
              ))}
            </>
          )}
        </div>
        <p className="text-subtle mt-2 text-[10px]">{t('sftp.onlySsh')}</p>
      </div>
    </Modal>
  )
}

function Section({
  title,
  color,
  tone = 'text-subtle',
  children
}: {
  readonly title: string
  readonly color?: string | null
  readonly tone?: string
  readonly children: ReactNode
}) {
  return (
    <div>
      <div className={`mb-1 flex items-center gap-1.5 px-1 text-[10px] font-semibold tracking-wider uppercase ${tone}`}>
        {color && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
        <span className="truncate">{title}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}
