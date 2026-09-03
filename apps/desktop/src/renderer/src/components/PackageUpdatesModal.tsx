import { useState } from 'react'
import { summarizeFleet, summarizeUpdates, type HostUpdatesDto, type UpdateGroup } from '@infra/shared'
import { Button, ModalOrPanel } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useDataStore } from '../stores/data'
import { useT, type I18nKey } from '../i18n'

/** Quét mấy host cùng lúc. Quá nhiều kết nối song song thì gate/bastion nghẹt. */
const CONCURRENCY = 4

type TFunc = ReturnType<typeof useT>

/** Bảng tra tường minh thay vì ghép chuỗi khoá: ghép thì đổi tên nhóm là mất dịch mà build vẫn xanh. */
const GROUP_KEY: Record<UpdateGroup, I18nKey> = {
  kernel: 'pkg.group.kernel',
  core: 'pkg.group.core',
  web: 'pkg.group.web',
  db: 'pkg.group.db',
  runtime: 'pkg.group.runtime',
  other: 'pkg.group.other'
}

/** Nhóm nào đáng lo thì tô theo mức đó — mắt tìm màu trước khi đọc chữ. */
const GROUP_TINT: Record<UpdateGroup, string> = {
  kernel: 'border-danger/40 bg-danger/10 text-danger',
  core: 'border-warning/40 bg-warning/10 text-warning',
  web: 'border-edge bg-hover text-content',
  db: 'border-edge bg-hover text-content',
  runtime: 'border-edge bg-hover text-content',
  other: 'border-edge bg-hover text-subtle'
}

/**
 * Một máy trong kết quả quét, trả lời theo thứ tự: *có gấp không*, *có phải khởi động lại
 * không*, *đợt này đụng vào cái gì* — rồi mới tới danh sách tên gói, và danh sách đó **mặc
 * định gấp lại**.
 *
 * Trước đây thẻ này in thẳng 12 tên gói đầu tiên rồi "+423". Với một máy 435 gói thì đó là một
 * bức tường tên không trả lời được câu hỏi nào cả — người đọc vẫn phải tự SSH vào để hiểu.
 */
function HostResultCard({ row, label, t }: { row: HostUpdatesDto; label: string; t: TFunc }) {
  const [open, setOpen] = useState(false)
  const s = summarizeUpdates(row.updates)
  const security = row.updates.filter((u) => u.security).map((u) => u.name)

  return (
    <div className="border-edge bg-input mb-1.5 rounded border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-content min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
        <span className="text-subtle shrink-0 font-mono text-[10px]">{row.manager}</span>
        {s.security > 0 && (
          <span className="border-danger/50 bg-danger/10 text-danger shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium">
            {t('pkg.security', { n: s.security })}
          </span>
        )}
        <span className="text-subtle shrink-0 text-[11px]">{t('pkg.count', { n: s.total })}</span>
      </div>

      {row.error ? (
        <div className="text-danger mt-1 text-[11px] leading-relaxed">{row.error}</div>
      ) : s.total === 0 ? (
        <div className="text-success mt-1 text-[11px]">{t('pkg.upToDate')}</div>
      ) : (
        <>
          {/* Câu kết luận bằng lời — thứ duy nhất phải đọc nếu chỉ có hai giây */}
          <div className={`mt-1 text-[11px] leading-relaxed ${s.security > 0 ? 'text-danger' : 'text-muted'}`}>
            {s.security > 0 ? t('pkg.verdictSecurity', { n: s.security }) : t('pkg.verdictNormal')}
          </div>
          {s.needsReboot && <div className="text-warning mt-0.5 text-[11px] leading-relaxed">⚠ {t('pkg.rebootWhy')}</div>}

          {/* "Đợt này đụng vào cái gì" — sáu con số thay cho 435 cái tên */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {s.groups.map((g) => (
              <span key={g.group} className={`rounded border px-1.5 py-0.5 text-[10px] ${GROUP_TINT[g.group]}`}>
                {t(GROUP_KEY[g.group])} {g.names.length}
              </span>
            ))}
          </div>

          <button
            type="button"
            className="text-accent hover:text-content mt-1.5 text-[11px]"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t('pkg.hideDetails') : t('pkg.showDetails', { n: s.total })}
          </button>

          {open && (
            <div className="border-edge mt-1.5 space-y-1.5 border-t pt-1.5">
              {/* Gói bảo mật tách riêng lên đầu: đó là danh sách người ta thật sự cần chép ra */}
              {security.length > 0 && (
                <div>
                  <div className="text-danger text-[10px] font-medium">
                    {t('pkg.securityGroup')} ({security.length})
                  </div>
                  <div className="text-danger/90 font-mono text-[10px] leading-relaxed break-all">
                    {security.join('  ')}
                  </div>
                </div>
              )}
              {s.groups.map((g) => (
                <div key={g.group}>
                  <div className="text-muted text-[10px] font-medium">
                    {t(GROUP_KEY[g.group])} ({g.names.length})
                  </div>
                  <div className="text-subtle font-mono text-[10px] leading-relaxed break-all">{g.names.join('  ')}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * F37 — "máy nào cần vá gì", quét cả fleet.
 *
 * Câu hỏi này hiện phải SSH vào từng máy gõ tay nên với vài chục host thì thực tế không ai
 * hỏi. Ở đây tick host rồi quét một lượt, ra bảng đọc được.
 *
 * ⚠️ CHỈ ĐỌC — cố ý không có nút "vá tất cả": vá là việc phải có mặt mà xem, và một nút chạy
 * `apt upgrade` trên cả fleet là thứ chỉ cần bấm nhầm một lần.
 */
export function PackageUpdatesModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  /**
   * Bắt đầu bằng KHÔNG chọn máy nào. Tick sẵn cả fleet nghĩa là một cú bấm vô ý mở kết nối SSH
   * tới mọi máy trong danh sách — đọc thì vô hại, nhưng vẫn là hàng chục phiên đăng nhập không
   * ai yêu cầu, và trên fleet lớn thì mất vài phút mới dừng lại được.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<HostUpdatesDto[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const scan = async (): Promise<void> => {
    const ids = hosts.filter((h) => selected.has(h.id)).map((h) => h.id)
    if (ids.length === 0) return
    setBusy(true)
    setResults([])
    setDone(0)
    const collected: HostUpdatesDto[] = []
    // Chạy theo lô thay vì Promise.all cả loạt: một fleet 30 máy mở 30 kết nối cùng lúc
    // qua cùng một gate là cách chắc chắn để bị nghẽn hoặc bị chặn
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = await Promise.all(
        ids.slice(i, i + CONCURRENCY).map(async (hostId) => {
          try {
            return await window.infra.diag.updates(hostId)
          } catch (err) {
            return {
              hostId,
              manager: 'unknown' as const,
              updates: [],
              error: err instanceof Error ? err.message : String(err)
            }
          }
        })
      )
      collected.push(...batch)
      setResults([...collected])
      setDone(collected.length)
    }
    setBusy(false)
  }

  const labelOf = (hostId: string): string => hosts.find((h) => h.id === hostId)?.label ?? hostId
  // Máy có bản vá bảo mật lên đầu, rồi tới máy nhiều bản cập nhật nhất
  const ordered = [...results].sort((a, b) => {
    const secA = a.updates.filter((u) => u.security).length
    const secB = b.updates.filter((u) => u.security).length
    return secB - secA || b.updates.length - a.updates.length || labelOf(a.hostId).localeCompare(labelOf(b.hostId))
  })
  const fleet = summarizeFleet(results)

  return (
    <ModalOrPanel
      embedded={embedded}
      title={t('pkg.title')}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="pkg-updates" onDone={onClose} />}
    >
      {/* Quét cả fleet mất vài phút — trong tab thì dùng hết chiều rộng cho danh sách kết quả */}
      <div className={embedded ? 'w-full' : 'w-[640px] max-w-full'}>
        <p className="text-muted mb-2 text-xs leading-relaxed">{t('pkg.desc')}</p>

        {results.length === 0 ? (
          <>
            <div className="border-edge bg-input mb-2 max-h-64 overflow-y-auto rounded border p-2">
              {hosts.map((h) => (
                <label key={h.id} className="hover:bg-hover flex items-center gap-2 rounded px-2 py-1 text-xs select-none">
                  <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggle(h.id)} />
                  <span className="text-content truncate">{h.label}</span>
                  <span className="text-subtle truncate font-mono text-[10px]">{h.hostname}</span>
                </label>
              ))}
              {hosts.length === 0 && <p className="text-subtle py-4 text-center text-xs">{t('pkg.noHosts')}</p>}
            </div>
            <div className="flex items-center justify-between gap-2">
              {/* Chọn cả fleet vẫn làm được, nhưng phải là một hành động CÓ Ý */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="!px-2 !py-1 !text-xs"
                  disabled={busy || hosts.length === 0}
                  onClick={() => setSelected(new Set(hosts.map((h) => h.id)))}
                >
                  {t('pkg.selectAll', { n: hosts.length })}
                </Button>
                <Button
                  type="button"
                  className="!px-2 !py-1 !text-xs"
                  disabled={busy || selected.size === 0}
                  onClick={() => setSelected(new Set())}
                >
                  {t('pkg.selectNone')}
                </Button>
              </div>
              <Button variant="primary" disabled={busy || selected.size === 0} onClick={() => void scan()}>
                {busy
                  ? t('pkg.scanning', { done, total: selected.size })
                  : selected.size === 0
                    ? t('pkg.pickHosts')
                    : t('pkg.scan', { n: selected.size })}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* Tình hình cả fleet ĐẶT TRƯỚC danh sách máy: câu hỏi đầu tiên là "có gấp không",
                câu "máy nào" chỉ đến sau đó */}
            <div className="border-edge bg-hover mb-2 rounded border px-3 py-2">
              <div className="text-content text-xs font-medium">
                {t('pkg.fleetLine', { scanned: fleet.scanned, need: fleet.needPatch, clean: fleet.clean })}
                {fleet.failed > 0 && <span className="text-danger"> · {t('pkg.fleetFailed', { n: fleet.failed })}</span>}
              </div>
              {fleet.securityHosts > 0 && (
                <div className="text-danger mt-1 text-[11px] leading-relaxed">
                  {t('pkg.fleetSecurity', { hosts: fleet.securityHosts, pkgs: fleet.securityPackages })}
                </div>
              )}
              {fleet.rebootHosts > 0 && (
                <div className="text-warning mt-0.5 text-[11px] leading-relaxed">
                  {t('pkg.fleetReboot', { n: fleet.rebootHosts })}
                </div>
              )}
              {fleet.securityHosts === 0 && fleet.needPatch > 0 && (
                <div className="text-muted mt-1 text-[11px] leading-relaxed">{t('pkg.fleetNoSecurity')}</div>
              )}
            </div>

            <div className="mb-2 max-h-96 overflow-y-auto">
              {ordered.map((row) => (
                <HostResultCard key={row.hostId} row={row} label={labelOf(row.hostId)} t={t} />
              ))}
            </div>
            <div className="flex justify-between">
              <Button type="button" onClick={() => setResults([])}>
                {t('pkg.back')}
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void scan()}>
                {busy ? t('pkg.scanning', { done, total: selected.size }) : t('pkg.rescan')}
              </Button>
            </div>
          </>
        )}
      </div>
    </ModalOrPanel>
  )
}
