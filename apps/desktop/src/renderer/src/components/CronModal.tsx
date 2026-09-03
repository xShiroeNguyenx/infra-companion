import { useEffect, useState } from 'react'
import { Button, ConfirmModal, Modal, Select, TextArea } from './ui'
import { useDataStore } from '../stores/data'
import { useT } from '../i18n'

/**
 * Đọc lịch chạy của một dòng crontab để hiện dạng người đọc được.
 *
 * Bản nhỏ viết lại ở renderer vì renderer KHÔNG import được `@infra/core` (§5); bản chuẩn có
 * test nằm ở `packages/core/src/diag/crontab.ts`. Trả về null khi biểu thức phức tạp —
 * UI hiện nguyên văn, đoán sai còn tệ hơn không đoán.
 */
function describe(schedule: string): { key: string; params?: Record<string, string> } | null {
  const specials: Record<string, string> = {
    '@reboot': 'cron.atReboot',
    '@yearly': 'cron.yearly',
    '@annually': 'cron.yearly',
    '@monthly': 'cron.monthly',
    '@weekly': 'cron.weekly',
    '@daily': 'cron.daily',
    '@midnight': 'cron.daily',
    '@hourly': 'cron.hourly'
  }
  const s = schedule.trim()
  const special = specials[s.toLowerCase()]
  if (special) return { key: special }

  const p = s.split(/\s+/)
  if (p.length !== 5) return null
  const [min, hour, dom, mon, dow] = p as [string, string, string, string, string]
  const star = (v: string): boolean => v === '*'
  const num = (v: string): string | null => (/^\d{1,2}$/.test(v) ? String(Number(v)) : null)
  const at = (h: string, m: string): string => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`

  const every = min.match(/^\*\/(\d+)$/)
  if (every && star(hour) && star(dom) && star(mon) && star(dow)) {
    return { key: 'cron.everyNMin', params: { n: String(Number(every[1])) } }
  }
  if (num(min) && star(hour) && star(dom) && star(mon) && star(dow)) {
    return { key: 'cron.hourlyAt', params: { m: num(min)! } }
  }
  if (num(min) && num(hour) && star(dom) && star(mon) && star(dow)) {
    return { key: 'cron.dailyAt', params: { time: at(num(hour)!, num(min)!) } }
  }
  if (num(min) && num(hour) && star(dom) && star(mon) && num(dow)) {
    return { key: 'cron.weeklyAt', params: { dow: num(dow)!, time: at(num(hour)!, num(min)!) } }
  }
  if (num(min) && num(hour) && num(dom) && star(mon) && star(dow)) {
    return { key: 'cron.monthlyAt', params: { dom: num(dom)!, time: at(num(hour)!, num(min)!) } }
  }
  return null
}

/** Tách một dòng crontab thành lịch + lệnh để hiện bảng. null khi không phải dòng job. */
function splitJob(raw: string): { schedule: string; command: string } | null {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) return null
  const special = trimmed.match(/^(@\w+)\s+(.+)$/)
  if (special) return { schedule: special[1]!, command: special[2]! }
  const five = trimmed.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/)
  return five ? { schedule: five[1]!.replace(/\s+/g, ' '), command: five[2]! } : null
}

/**
 * F35 — xem và sửa crontab của một host.
 *
 * Sửa bằng ô text thô chứ không phải form từng dòng: crontab thật có comment, biến môi trường
 * và cú pháp lạ; dựng lại file từ một form chỉ hiểu được vài dạng là cách chắc chắn để xoá mất
 * thứ của người khác. Bảng phía trên chỉ để ĐỌC cho nhanh.
 *
 * ⚠️ Lưu là ghi đè crontab trên production → luôn hỏi xác nhận, và luôn hiện lại nội dung cũ.
 */
export function CronModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const groups = useDataStore((s) => s.groups)
  const [hostId, setHostId] = useState(hosts[0]?.id ?? '')
  const [original, setOriginal] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const host = hosts.find((h) => h.id === hostId)
  // Cờ production kế thừa qua chuỗi group — chỉ cần MỘT nhóm trên đường lên gốc bật là tính
  const isProduction = ((): boolean => {
    const byId = new Map(groups.map((g) => [g.id, g]))
    const seen = new Set<string>()
    let current = host?.groupId ?? null
    while (current && !seen.has(current)) {
      seen.add(current)
      const group = byId.get(current)
      if (!group) break
      if (group.production) return true
      current = group.parentId
    }
    return false
  })()

  useEffect(() => {
    if (!hostId) return
    setLoaded(false)
    setError(null)
    setMessage(null)
    void window.infra.diag
      .cronRead(hostId)
      .then((res) => {
        if (res.ok) {
          setOriginal(res.content)
          setDraft(res.content)
          setLoaded(true)
        } else {
          setError(res.error ?? t('cron.readFailed'))
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [hostId, t])

  const save = async (): Promise<void> => {
    setConfirming(false)
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await window.infra.diag.cronWrite(hostId, draft)
      if (res.ok) {
        setOriginal(draft)
        setMessage(t('cron.saved'))
      } else {
        setError(res.error ?? t('cron.saveFailed'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const dirty = draft !== original
  const jobs = original
    .split('\n')
    .map(splitJob)
    .filter((j): j is { schedule: string; command: string } => j !== null)

  return (
    <Modal title={t('cron.title')} onClose={onClose} closeOnBackdrop={false}>
      <div className="w-[700px] max-w-full">
        <div className="mb-2 flex items-center gap-2">
          <Select value={hostId} onChange={(e) => setHostId(e.target.value)} className="max-w-56">
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </Select>
          {isProduction && (
            <span className="border-danger/50 bg-danger/10 text-danger rounded border px-1.5 py-0.5 text-[10px] font-medium">
              {t('cron.production')}
            </span>
          )}
        </div>

        {!loaded && !error ? (
          <p className="text-subtle py-8 text-center text-xs">{t('cron.loading')}</p>
        ) : (
          <>
            {jobs.length > 0 && (
              <div className="border-edge bg-input mb-2 max-h-40 overflow-y-auto rounded border p-2">
                {jobs.map((job, i) => {
                  const desc = describe(job.schedule)
                  return (
                    <div key={i} className="flex items-baseline gap-2 py-0.5 text-[11px]">
                      <span className="text-accent w-40 shrink-0 truncate">
                        {desc ? t(desc.key as 'cron.daily', desc.params) : <code>{job.schedule}</code>}
                      </span>
                      <span className="text-muted min-w-0 flex-1 truncate font-mono">{job.command}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <TextArea
              rows={12}
              className="font-mono text-[11px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('cron.empty')}
            />
            <p className="text-subtle mt-1 text-[10px] leading-relaxed">{t('cron.note')}</p>
          </>
        )}

        {error && <p className="text-danger mt-2 text-xs leading-relaxed">{error}</p>}
        {message && <p className="text-success mt-2 text-xs">{message}</p>}

        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" disabled={!dirty} onClick={() => setDraft(original)}>
            {t('cron.revert')}
          </Button>
          <Button variant="danger" disabled={busy || !dirty || !loaded} onClick={() => setConfirming(true)}>
            {busy ? t('cron.saving') : t('cron.save')}
          </Button>
        </div>

        {confirming && (
          <ConfirmModal
            title={t('cron.confirmTitle')}
            message={
              <>
                {t('cron.confirmBody', { host: host?.label ?? '' })}
                {isProduction && <div className="text-danger mt-2 font-medium">{t('cron.confirmProduction')}</div>}
              </>
            }
            confirmLabel={t('cron.save')}
            onConfirm={() => void save()}
            onCancel={() => setConfirming(false)}
          />
        )}
      </div>
    </Modal>
  )
}
