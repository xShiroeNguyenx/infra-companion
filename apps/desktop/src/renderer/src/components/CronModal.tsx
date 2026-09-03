import { useEffect, useState } from 'react'
import { detectUserColumn, type CronScopeDto } from '@infra/shared'
import { Button, ConfirmModal, ModalOrPanel, Select, TextArea } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
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
interface CronJobRow {
  schedule: string
  /** Chỉ ở phạm vi `system`: cột USER giữa lịch và lệnh. */
  user?: string
  command: string
}

function splitJob(raw: string, withUser: boolean): CronJobRow | null {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null
  if (/^==>\s.+\s<==$/.test(trimmed)) return null // dấu phân cách file của `tail -n +1`
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) return null
  /**
   * `/etc/crontab` và `/etc/cron.d/*` có SÁU trường: sau 5 trường lịch còn một cột USER rồi
   * mới tới lệnh. Không tách thì lệnh hiện ra thành "deploy /usr/local/cron/x.sh" — sai kiểu
   * khó thấy, vì phần lịch vẫn đúng nên nhìn qua tưởng ổn.
   */
  const take = (schedule: string, rest: string): CronJobRow => {
    if (withUser) {
      const split = rest.match(/^(\S+)\s+(.+)$/)
      if (split) return { schedule, user: split[1]!, command: split[2]! }
    }
    return { schedule, command: rest }
  }
  const special = trimmed.match(/^(@\w+)\s+(.+)$/)
  if (special) return take(special[1]!, special[2]!)
  const five = trimmed.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/)
  return five ? take(five[1]!.replace(/\s+/g, ' '), five[2]!) : null
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
export function CronModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const groups = useDataStore((s) => s.groups)
  // Rỗng = CHƯA chọn máy. Cố ý không lấy host đầu tiên: mở hộp thoại lên mà tự động mở kết
  // nối SSH tới một máy mình không chọn là hành vi không ai muốn, nhất là khi máy đó production.
  const [hostId, setHostId] = useState('')
  /**
   * Cron nằm ở BA chỗ. Mặc định `user` như lệnh `crontab -l`, nhưng phải chọn được chỗ khác:
   * job hệ thống thường nằm ở root hoặc `/etc/crontab`, và `crontab -l` không đụng tới chúng —
   * nên màn hình báo "chưa có crontab nào" trong khi máy vẫn đang chạy job đều đặn.
   */
  const [scope, setScope] = useState<CronScopeDto>('user')
  /**
   * Có cột USER (6 trường) hay không. `null` = để app tự dò từ nội dung; true/false = user đã
   * ép tay. Cần ép tay được vì việc dò KHÔNG thể chắc chắn: `0 5 * * * sh /x.sh` và
   * `0 5 * * * deploy /x.sh` giống hệt nhau về hình dạng.
   */
  const [forceUserColumn, setForceUserColumn] = useState<boolean | null>(null)
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

  /**
   * Đổi máy hoặc đổi phạm vi thì XOÁ kết quả cũ, nhưng KHÔNG tự đọc lại.
   *
   * Ở đây có HAI lựa chọn phải đặt xong mới đọc được (máy + phạm vi). Tự chạy ngay sau lựa
   * chọn đầu tiên nghĩa là lần nào cũng tốn một lượt SSH vô ích rồi báo "chưa có crontab nào" —
   * đúng lúc user còn chưa kịp chọn phạm vi. Nên đọc là do bấm nút.
   *
   * Xoá kết quả cũ thì bắt buộc: giữ lại nội dung của máy trước mà đầu trang đã đổi tên máy
   * khác là hiển thị sai một cách rất dễ tin.
   */
  useEffect(() => {
    setLoaded(false)
    setOriginal('')
    setDraft('')
    setError(null)
    setMessage(null)
    setForceUserColumn(null)
  }, [hostId, scope])

  /**
   * ⚠️ KHÔNG bao giờ đưa `t` vào dependency của effect có IO: `useT()` trả về một hàm MỚI mỗi
   * lần render, nên effect sẽ chạy lại sau mỗi `setState` → đọc crontab qua SSH trong vòng lặp
   * vô hạn. Vì thế lỗi lưu ở dạng THÔ ('' = lỗi không có mô tả) và chỉ dịch lúc render — cũng
   * đúng hơn: đổi ngôn ngữ thì thông báo đổi theo.
   */
  const read = async (): Promise<void> => {
    if (!hostId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await window.infra.diag.cronRead(hostId, scope)
      if (res.ok) {
        setOriginal(res.content)
        setDraft(res.content)
        setLoaded(true)
      } else {
        setError(res.error ?? '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setConfirming(false)
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await window.infra.diag.cronWrite(hostId, draft, scope)
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

  // `system` gồm NHIỀU file (/etc/crontab + /etc/cron.d/*) → chỉ đọc; ghi nhiều file qua một
  // ô text là cái bẫy, và đó là các file quyết định máy chạy gì lúc nửa đêm.
  const writable = scope !== 'system'
  const dirty = draft !== original
  // `system` chắc chắn 6 trường; hai scope kia phải DÒ, vì crontab của root trên máy thật hay
  // được viết theo định dạng hệ thống. User ép tay được khi dò sai.
  const hasUserColumn = forceUserColumn ?? (scope === 'system' || detectUserColumn(original))
  const jobs = original
    .split('\n')
    .map((line) => splitJob(line, hasUserColumn))
    .filter((j): j is CronJobRow => j !== null)

  return (
    <ModalOrPanel
      embedded={embedded}
      title={t('cron.title')}
      onClose={onClose}
      closeOnBackdrop={false}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="cron" onDone={onClose} />}
    >
      <div className={embedded ? 'w-full' : 'w-[700px] max-w-full'}>
        <div className="mb-2 flex items-center gap-2">
          <Select value={hostId} onChange={(e) => setHostId(e.target.value)} className="max-w-56">
            <option value="">{t('common.pickHost')}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </Select>
          <Select value={scope} onChange={(e) => setScope(e.target.value as CronScopeDto)} className="max-w-56">
            <option value="user">{t('cron.scopeUser')}</option>
            <option value="root">{t('cron.scopeRoot')}</option>
            <option value="system">{t('cron.scopeSystem')}</option>
          </Select>
          {isProduction && (
            <span className="border-danger/50 bg-danger/10 text-danger rounded border px-1.5 py-0.5 text-[10px] font-medium">
              {t('cron.production')}
            </span>
          )}
          {/* Đọc là do BẤM: hai lựa chọn ở trên phải đặt xong đã (xem ghi chú ở effect xoá) */}
          <Button variant="primary" className="ml-auto" disabled={!hostId || busy} onClick={() => void read()}>
            {busy ? t('cron.reading') : loaded ? t('cron.reread') : t('cron.read')}
          </Button>
        </div>
        <p className="text-subtle mb-2 text-[11px] leading-relaxed">{t(`cron.scopeHint.${scope}` as 'cron.scopeHint.user')}</p>

        {/* Việc dò cột user không thể chắc chắn → luôn cho ép tay, và nói rõ đang tự dò hay
            đang bị ép. Đoán thầm rồi hiện sai là kiểu lỗi người dùng không có cách nào sửa. */}
        {loaded && jobs.length > 0 && (
          <label className="text-muted mb-2 flex items-center gap-2 text-[11px] select-none">
            <input
              type="checkbox"
              checked={hasUserColumn}
              onChange={(e) => setForceUserColumn(e.target.checked)}
            />
            {t('cron.userColumn')}
            {forceUserColumn === null && <span className="text-subtle">({t('cron.autoDetected')})</span>}
          </label>
        )}

        {!hostId ? (
          <p className="text-subtle py-8 text-center text-xs">{t('common.pickHostHint')}</p>
        ) : busy ? (
          <p className="text-subtle py-8 text-center text-xs">{t('cron.loading')}</p>
        ) : !loaded && error === null ? (
          <p className="text-subtle py-8 text-center text-xs">{t('cron.pressRead')}</p>
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
                      {/* Cột user chỉ có ở /etc/crontab + /etc/cron.d — hiện riêng, vì "job này
                          chạy dưới quyền ai" là nửa còn lại của câu trả lời */}
                      {job.user && <span className="text-warning shrink-0 font-mono">{job.user}</span>}
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
              readOnly={!writable}
            />
            <p className="text-subtle mt-1 text-[10px] leading-relaxed">
              {writable ? t('cron.note') : t('cron.noteReadOnly')}
            </p>
          </>
        )}

        {/* '' = lỗi không kèm mô tả → dịch lúc render (xem ghi chú ở effect đọc crontab) */}
        {error !== null && <p className="text-danger mt-2 text-xs leading-relaxed">{error || t('cron.readFailed')}</p>}
        {message && <p className="text-success mt-2 text-xs">{message}</p>}

        {writable && (
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" disabled={!dirty} onClick={() => setDraft(original)}>
              {t('cron.revert')}
            </Button>
            <Button variant="danger" disabled={busy || !dirty || !loaded} onClick={() => setConfirming(true)}>
              {busy ? t('cron.saving') : t('cron.save')}
            </Button>
          </div>
        )}

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
    </ModalOrPanel>
  )
}
