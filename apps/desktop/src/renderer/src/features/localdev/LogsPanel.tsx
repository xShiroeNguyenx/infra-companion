import { useEffect, useRef, useState } from 'react'
import type { LdLogSourceDto } from '@infra/shared'
import { useLocaldevStore } from '../../stores/localdev'
import { Select } from '../../components/ui'
import { useT } from '../../i18n'

const SOURCES: LdLogSourceDto[] = ['nginx-error', 'nginx-access', 'php-error', 'wp-debug']
const REFRESH_MS = 2_000

/** Xem N KB CUỐI của log (log cần đuôi — khác readFile của hostTools lấy đầu file). */
export function LogsPanel() {
  const t = useT()
  const sites = useLocaldevStore((s) => s.sites)
  const [siteId, setSiteId] = useState('')
  const [which, setWhich] = useState<LdLogSourceDto>('nginx-error')
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('')
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // gen: đổi nguồn/site giữa chừng thì response cũ không được đè kết quả mới
  const gen = useRef(0)
  const preRef = useRef<HTMLPreElement>(null)

  const load = async (): Promise<void> => {
    const my = ++gen.current
    const res = await window.infra.localdev.logTail(siteId, which)
    if (my !== gen.current) return
    setError(res.ok ? null : (res.error ?? 'không đọc được log'))
    setText(res.ok ? res.text : '')
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, which])

  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, siteId, which])

  // Auto-scroll xuống cuối khi đang theo dõi live
  useEffect(() => {
    if (live && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [text, live])

  const lines = text.split('\n')
  const shown = filter.trim() ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="!py-1 !text-xs" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">{t('localdev.log.stack')}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          className="!py-1 !text-xs"
          value={which}
          onChange={(e) => setWhich(e.target.value as LdLogSourceDto)}
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`localdev.log.${s}`)}
            </option>
          ))}
        </Select>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('localdev.log.filter')}
          className="border-edge-strong bg-input text-content placeholder-subtle focus:border-accent min-w-0 flex-1 rounded border px-2 py-1 text-xs outline-none"
        />
        <label className="text-muted flex cursor-pointer items-center gap-1.5 text-xs select-none">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          {t('localdev.log.live')}
        </label>
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-1 text-xs"
          onClick={() => void load()}
        >
          ↻
        </button>
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-1 text-xs"
          onClick={() => window.infra.localdev.openFolder('logs')}
        >
          {t('localdev.openFolder')}
        </button>
      </div>

      {error !== null && <p className="text-danger text-xs">{error}</p>}

      <pre
        ref={preRef}
        className="border-edge bg-app text-muted max-h-[55vh] min-h-40 overflow-auto rounded border p-3 font-mono text-[11px] whitespace-pre-wrap"
      >
        {shown.join('\n') || t('localdev.log.empty')}
      </pre>
    </div>
  )
}
