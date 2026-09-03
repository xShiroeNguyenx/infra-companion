import { useState } from 'react'
import type { HostUpdatesDto } from '@infra/shared'
import { Button, Modal } from './ui'
import { useDataStore } from '../stores/data'
import { useT } from '../i18n'

/** Quét mấy host cùng lúc. Quá nhiều kết nối song song thì gate/bastion nghẹt. */
const CONCURRENCY = 4

/**
 * F37 — "máy nào cần vá gì", quét cả fleet.
 *
 * Câu hỏi này hiện phải SSH vào từng máy gõ tay nên với vài chục host thì thực tế không ai
 * hỏi. Ở đây tick host rồi quét một lượt, ra bảng đọc được.
 *
 * ⚠️ CHỈ ĐỌC — cố ý không có nút "vá tất cả": vá là việc phải có mặt mà xem, và một nút chạy
 * `apt upgrade` trên cả fleet là thứ chỉ cần bấm nhầm một lần.
 */
export function PackageUpdatesModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const [selected, setSelected] = useState<Set<string>>(new Set(hosts.map((h) => h.id)))
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

  return (
    <Modal title={t('pkg.title')} onClose={onClose}>
      <div className="w-[640px] max-w-full">
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
            <div className="flex justify-end">
              <Button variant="primary" disabled={busy || selected.size === 0} onClick={() => void scan()}>
                {busy ? t('pkg.scanning', { done, total: selected.size }) : t('pkg.scan', { n: selected.size })}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-2 max-h-96 overflow-y-auto">
              {ordered.map((row) => {
                const security = row.updates.filter((u) => u.security)
                return (
                  <div key={row.hostId} className="border-edge bg-input mb-1.5 rounded border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-content min-w-0 flex-1 truncate text-xs font-medium">
                        {labelOf(row.hostId)}
                      </span>
                      <span className="text-subtle shrink-0 font-mono text-[10px]">{row.manager}</span>
                      {security.length > 0 && (
                        <span className="border-danger/50 bg-danger/10 text-danger shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium">
                          {t('pkg.security', { n: security.length })}
                        </span>
                      )}
                      <span className="text-subtle shrink-0 text-[11px]">
                        {t('pkg.count', { n: row.updates.length })}
                      </span>
                    </div>
                    {row.error ? (
                      <div className="text-danger mt-1 text-[11px] leading-relaxed">{row.error}</div>
                    ) : row.updates.length > 0 ? (
                      <div className="text-subtle mt-1 font-mono text-[10px] leading-relaxed break-all">
                        {row.updates.slice(0, 12).map((u) => (
                          <span key={u.name} className={u.security ? 'text-danger' : undefined}>
                            {u.name}
                            {'  '}
                          </span>
                        ))}
                        {row.updates.length > 12 && <span>+{row.updates.length - 12}</span>}
                      </div>
                    ) : (
                      <div className="text-success mt-1 text-[11px]">{t('pkg.upToDate')}</div>
                    )}
                  </div>
                )
              })}
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
    </Modal>
  )
}
