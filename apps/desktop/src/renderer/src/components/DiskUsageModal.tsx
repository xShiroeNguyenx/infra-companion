import { useCallback, useEffect, useState } from 'react'
import type { DiskUsageResultDto, HostDto } from '@infra/shared'
import { Button, Modal, Select } from './ui'
import { useDataStore } from '../stores/data'
import { useT } from '../i18n'

/** KB → chuỗi đọc được. Bản nhỏ viết lại ở renderer vì không import được `@infra/core` (§5). */
function formatKb(sizeKb: number): string {
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = sizeKb
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Thư mục cha, null khi đã ở gốc. */
function parentOf(path: string): string | null {
  const clean = path.replace(/\/+$/, '')
  if (clean === '' || clean === '/') return null
  const idx = clean.lastIndexOf('/')
  return idx < 0 ? null : idx === 0 ? '/' : clean.slice(0, idx)
}

/**
 * F36 — "thư mục nào đang ăn dung lượng", kiểu ncdu.
 *
 * Đi từng cấp một (`du -d 1`) chứ không quét cả cây: trên máy production cây `/` có thể mất
 * nhiều phút và phần lớn kết quả không ai đọc. Bấm vào một dòng là đi xuống, có nút lên cấp.
 */
export function DiskUsageModal({ host, onClose }: { readonly host: HostDto | null; readonly onClose: () => void }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts)
  const [hostId, setHostId] = useState(host?.id ?? hosts[0]?.id ?? '')
  const [path, setPath] = useState('/')
  const [result, setResult] = useState<DiskUsageResultDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(
    async (targetPath: string): Promise<void> => {
      if (!hostId) return
      setError(null)
      setBusy(true)
      try {
        const res = await window.infra.diag.disk(hostId, targetPath)
        if (res.ok) {
          setResult(res)
          setPath(res.usage?.path ?? targetPath)
        } else {
          setError(res.error ?? t('disk.failed'))
        }
      } catch (err) {
        // invoke có thể reject (huỷ nhập mật khẩu login-script, host không nối được…)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [hostId, t]
  )

  useEffect(() => {
    void scan('/')
    // Đổi host thì quét lại từ gốc — giữ path cũ của máy khác là vô nghĩa
  }, [hostId, scan])

  const parent = parentOf(path)
  const usage = result?.usage ?? null

  return (
    <Modal title={t('disk.title')} onClose={onClose}>
      <div className="w-[640px] max-w-full">
        <div className="mb-2 flex items-center gap-2">
          <Select value={hostId} onChange={(e) => setHostId(e.target.value)} className="max-w-56">
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </Select>
          <code className="text-content min-w-0 flex-1 truncate font-mono text-xs">{path}</code>
          <Button type="button" disabled={busy || !parent} onClick={() => void scan(parent ?? '/')}>
            ↑
          </Button>
          <Button type="button" disabled={busy} onClick={() => void scan(path)}>
            ↻
          </Button>
        </div>

        {/* df trước du: câu hỏi thật là "phân vùng nào sắp đầy", rồi mới tới "trong đó cái gì to" */}
        {result && result.filesystems.length > 0 && (
          <div className="border-edge bg-input mb-2 rounded border px-3 py-2">
            <div className="text-subtle mb-1 text-[10px] font-semibold tracking-wider uppercase">
              {t('disk.filesystems')}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {result.filesystems.map((fs) => (
                <span key={fs.mountedOn} className="text-[11px]">
                  <span className="text-muted font-mono">{fs.mountedOn}</span>{' '}
                  <span className={fs.usePercent >= 90 ? 'text-danger font-medium' : 'text-subtle'}>
                    {fs.usePercent}%
                  </span>{' '}
                  <span className="text-subtle">({t('disk.free', { size: formatKb(fs.availKb) })})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-danger mb-2 text-xs leading-relaxed">{error}</p>}

        {busy && !usage ? (
          <p className="text-subtle py-6 text-center text-xs">{t('disk.scanning')}</p>
        ) : usage ? (
          <>
            <div className="text-subtle mb-1.5 text-[11px]">
              {t('disk.total', { size: formatKb(usage.totalKb) })}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {usage.entries.length === 0 ? (
                <p className="text-subtle py-6 text-center text-xs">{t('disk.empty')}</p>
              ) : (
                usage.entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    disabled={busy}
                    onClick={() => void scan(entry.path)}
                    className="border-edge bg-input hover:bg-hover hover:border-accent/60 relative mb-1 flex w-full items-center gap-2 overflow-hidden rounded border px-3 py-1.5 text-left"
                  >
                    {/* Thanh nền theo tỉ lệ — đọc bằng mắt nhanh hơn đọc con số */}
                    <span
                      className="bg-accent/15 absolute inset-y-0 left-0"
                      style={{ width: `${Math.min(100, entry.percent)}%` }}
                    />
                    <span className="text-content relative min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
                    <span className="text-subtle relative shrink-0 text-[11px]">{entry.percent}%</span>
                    <span className="text-content relative w-20 shrink-0 text-right text-xs">
                      {formatKb(entry.sizeKb)}
                    </span>
                  </button>
                ))
              )}
            </div>
            <p className="text-subtle mt-2 text-[10px] leading-relaxed">{t('disk.note')}</p>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
