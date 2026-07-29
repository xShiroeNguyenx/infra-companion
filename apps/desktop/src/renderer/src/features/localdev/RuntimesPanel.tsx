import { useState } from 'react'
import type { LdRuntimeDto, LdRuntimeProgressDto } from '@infra/shared'
import { useLocaldevStore } from '../../stores/localdev'
import { ConfirmModal } from '../../components/ui'
import { useT } from '../../i18n'

/**
 * Cài/gỡ runtime + công cụ (PHP, nginx, MariaDB, phpMyAdmin, Composer, Node…).
 * - Nút chính: TẢI QUA MẠNG rồi verify sha256 đã ghim trong source app (PHP có; nginx thì
 *   nginx.org không công bố nên app tự tính và ghi lại — note trên card nói rõ điều đó).
 * - Nút 📁: chọn file bạn tự tải (escape hatch khi AV/mạng công ty chặn tải).
 */
export function RuntimesPanel() {
  const t = useT()
  const runtimes = useLocaldevStore((s) => s.runtimes)
  const downloads = useLocaldevStore((s) => s.downloads)
  const installRuntime = useLocaldevStore((s) => s.installRuntime)
  const removeRuntime = useLocaldevStore((s) => s.removeRuntime)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const install = async (id: string, fromFile?: boolean): Promise<void> => {
    setBusy(id)
    try {
      await installRuntime(id, fromFile)
    } finally {
      setBusy(null)
    }
  }

  if (runtimes.length === 0) {
    return <p className="text-subtle py-8 text-center text-xs">{t('localdev.noRuntimes')}</p>
  }

  // Chia 2 nhóm: stack bắt buộc (PHP/nginx/MariaDB) vs công cụ tuỳ chọn (phpMyAdmin, Composer,
  // Node…). Một danh sách phẳng gần 10 mục không cho user biết cái nào PHẢI cài để site chạy.
  const groups = [
    { key: 'stack' as const, label: t('localdev.rt.groupStack'), items: runtimes.filter((r) => r.kind !== 'tool') },
    { key: 'tools' as const, label: t('localdev.rt.groupTools'), items: runtimes.filter((r) => r.kind === 'tool') }
  ].filter((g) => g.items.length > 0)

  return (
    <div className="space-y-2">
      <p className="text-subtle text-[11px] leading-relaxed">{t('localdev.rt.hint')}</p>

      {groups.map((g) => (
        <div key={g.key} className="space-y-2 pt-1">
          <p className="text-subtle text-[10px] font-medium tracking-wide uppercase">{g.label}</p>
          {g.items.map((rt) => (
            <RuntimeCard
              key={rt.id}
              rt={rt}
              dl={downloads[rt.id]}
              busy={busy === rt.id}
              onInstall={(fromFile) => void install(rt.id, fromFile)}
              onRemove={() => setConfirmRemove(rt.id)}
            />
          ))}
        </div>
      ))}

      {confirmRemove !== null && (
        <ConfirmModal
          title={t('localdev.rt.removeTitle')}
          message={
            <>
              <p>{t('localdev.rt.removeMsg', { id: confirmRemove })}</p>
              {/* datadir nằm NGOÀI runtimes/ nên gỡ runtime không mất DB — nói rõ để user
                  không tưởng mình vừa xoá sạch dữ liệu site */}
              {confirmRemove.startsWith('mariadb-') && (
                <p className="text-subtle mt-2 text-[11px] leading-relaxed">{t('localdev.rt.removeDbNote')}</p>
              )}
            </>
          }
          confirmLabel={t('localdev.rt.remove')}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => {
            const id = confirmRemove
            setConfirmRemove(null)
            void removeRuntime(id)
          }}
        />
      )}
    </div>
  )
}

/** 1 dòng runtime: trạng thái, version, nút cài/gỡ, note và thanh tiến độ khi đang tải. */
function RuntimeCard({
  rt,
  dl,
  busy,
  onInstall,
  onRemove
}: {
  rt: LdRuntimeDto
  dl: LdRuntimeProgressDto | undefined
  busy: boolean
  onInstall: (fromFile?: boolean) => void
  onRemove: () => void
}) {
  const t = useT()
  const working = busy || (dl !== undefined && dl.phase !== 'done' && dl.phase !== 'error')
  const dot = rt.state === 'ok' ? 'bg-success' : rt.state === 'broken' ? 'bg-danger' : 'bg-edge-strong'
  const installLabel = working
    ? '…'
    : rt.sizeBytes > 0
      ? t('localdev.rt.installSize', { mb: String(Math.round(rt.sizeBytes / 1e6)) })
      : t('localdev.rt.installNet')

  return (
    <div className="border-edge bg-input rounded border p-3">
      <div className="flex items-center gap-2">
        <span className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className="text-content min-w-0 flex-1 truncate text-xs font-medium">{rt.label}</span>
        <span className="text-subtle shrink-0 font-mono text-[10px]">{rt.version}</span>
        {rt.eol && (
          <span className="text-warning shrink-0 text-[10px]" title={t('localdev.rt.eolHint')}>
            EOL
          </span>
        )}
        {rt.installed ? (
          <button
            className="border-edge-strong text-muted hover:text-danger hover:border-danger/50 shrink-0 rounded border px-2 py-0.5 text-[11px]"
            onClick={onRemove}
          >
            {t('localdev.rt.remove')}
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="border-accent/50 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60 rounded border px-2 py-0.5 text-[11px]"
              disabled={working}
              onClick={() => onInstall()}
            >
              {installLabel}
            </button>
            <button
              className="border-edge-strong text-muted hover:bg-hover rounded border px-1.5 py-0.5 text-[11px]"
              disabled={working}
              title={t('localdev.rt.install')}
              onClick={() => onInstall(true)}
            >
              📁
            </button>
          </div>
        )}
      </div>

      {rt.state === 'broken' && <p className="text-danger mt-1.5 text-[11px] leading-relaxed">{t('localdev.rt.broken')}</p>}
      {rt.note !== undefined && rt.note !== '' && (
        <p className="text-subtle mt-1.5 text-[10px] leading-relaxed">ℹ {rt.note}</p>
      )}

      {dl !== undefined && dl.phase !== 'done' && (
        <div className="mt-2">
          <div className="bg-hover h-1.5 overflow-hidden rounded">
            <div
              className={`h-full ${dl.phase === 'error' ? 'bg-danger' : 'bg-accent'}`}
              style={{ width: `${String(Math.min(100, Math.max(0, dl.percent)))}%` }}
            />
          </div>
          <p className={`mt-1 text-[10px] ${dl.phase === 'error' ? 'text-danger' : 'text-subtle'}`}>
            {dl.phase === 'error' ? dl.error : t(`localdev.rt.phase.${dl.phase}`)}
          </p>
        </div>
      )}
    </div>
  )
}
