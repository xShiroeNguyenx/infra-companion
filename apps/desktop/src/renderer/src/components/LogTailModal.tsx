import { useEffect, useRef, useState } from 'react'
import { COMMON_LOG_PATHS, highlightSegments, lineMatches, type LogFilter, type LogLine } from '@infra/shared'
import { Button, ModalOrPanel, Select, TextInput } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useDataStore } from '../stores/data'
import { useT } from '../i18n'

/**
 * Trần số dòng giữ trong bộ nhớ. Một log ồn chạy qua đêm sẽ ăn hết RAM nếu giữ tất cả —
 * đây là cửa sổ theo dõi, không phải kho lưu trữ (muốn lưu thì đã có session logging).
 */
const MAX_LINES = 5000

/**
 * F30 — theo dõi file log mà không chiếm một tab terminal.
 *
 * Trước đây mở `tail -f` là mất trọn một tab, và tab đó không dùng vào việc gì khác được nữa.
 * Panel này chạy qua kênh exec riêng: lọc/tô màu tại chỗ, tự cuộn khi đang ở đáy, và dừng
 * dứt khoát khi đóng.
 */
/**
 * `embedded` = nhúng vào tab/trang (bỏ khung popup). `fill` = vùng log lấp đầy chiều cao còn lại
 * của chỗ nhúng thay vì tính theo `100vh` — cần cho panel đáy Workbench (cao 120–600px, không phải
 * cả cửa sổ). Chỉ có ý nghĩa khi `embedded`.
 */
export function LogTailModal({ onClose, embedded, fill }: { onClose?: () => void; embedded?: boolean; fill?: boolean }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  // Rỗng = chưa chọn. Panel này không tự nối, nhưng mặc định sẵn một máy thì rất dễ bấm
  // Bắt đầu nhầm máy — giữ nhất quán với các hộp thoại khác: phải chọn tường minh.
  const [hostId, setHostId] = useState('')
  const [path, setPath] = useState('/var/log/syslog')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  const [filter, setFilter] = useState<LogFilter>({ query: '', invert: false, caseSensitive: false })
  const [follow, setFollow] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seqRef = useRef(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<string | null>(null)
  sessionRef.current = sessionId

  useEffect(() => {
    const off = window.infra.logTail.onEvent((event) => {
      if (event.id !== sessionRef.current) return
      if (event.kind === 'lines') {
        setLines((prev) => {
          const next = [...prev]
          for (const line of event.lines) next.push({ seq: seqRef.current++, text: line.text, source: line.source })
          // Cắt từ ĐẦU: dòng mới mới là dòng đáng xem
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
        })
      } else {
        setSessionId(null)
        if (event.error) setError(event.error)
      }
    })
    return off
  }, [])

  // Dừng phiên khi đóng panel — không có bước này thì `tail -F` chạy tiếp trên remote
  useEffect(
    () => () => {
      if (sessionRef.current) void window.infra.logTail.stop(sessionRef.current)
    },
    []
  )

  const shown = lines.filter((line) => lineMatches(line.text, filter))

  // Tự cuộn CHỈ khi đang bám đáy: kéo lên đọc mà bị giật xuống là mất chỗ đang đọc
  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [shown.length, follow])

  const start = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const result = await window.infra.logTail.start(hostId, path.trim())
      if (result.ok) {
        setLines([])
        seqRef.current = 0
        setSessionId(result.id)
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    if (!sessionId) return
    await window.infra.logTail.stop(sessionId)
    setSessionId(null)
  }

  return (
    <ModalOrPanel
      embedded={embedded}
      title={t('tail.title')}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="log-tail" onDone={onClose} />}
    >
      {/* Trong tab thì dùng hết chiều rộng — log dài, càng rộng càng đỡ phải cuộn ngang */}
      <div className={embedded ? (fill ? 'flex h-full w-full flex-col' : 'w-full') : 'w-[760px] max-w-full'}>
        <div className="mb-2 flex items-center gap-2">
          <Select value={hostId} onChange={(e) => setHostId(e.target.value)} className="max-w-48" disabled={!!sessionId}>
            <option value="">{t('common.pickHost')}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </Select>
          <TextInput
            className="flex-1 font-mono"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/var/log/nginx/error.log"
            disabled={!!sessionId}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !sessionId && !busy) void start()
            }}
          />
          {/* Gợi ý đường dẫn mặc định của phần mềm hay gặp — ô nhập vẫn tự do, vì bản cài tự
              dựng để log ở đâu cũng được. Chọn xong tự về '' để lần sau còn chọn lại được. */}
          <Select
            value=""
            className="max-w-40"
            disabled={!!sessionId}
            onChange={(e) => {
              if (e.target.value) setPath(e.target.value)
            }}
          >
            <option value="">{t('tail.presets')}</option>
            {COMMON_LOG_PATHS.map((group) => (
              <optgroup key={group.software} label={group.software}>
                {group.paths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {sessionId ? (
            <Button variant="danger" onClick={() => void stop()}>
              {t('tail.stop')}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy || !hostId || !path.trim()} onClick={() => void start()}>
              {busy ? t('tail.starting') : t('tail.start')}
            </Button>
          )}
        </div>

        <div className="mb-2 flex items-center gap-2">
          <TextInput
            className="flex-1"
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            placeholder={t('tail.filterPh')}
          />
          <label className="text-muted flex items-center gap-1 text-[11px] select-none">
            <input
              type="checkbox"
              checked={filter.invert}
              onChange={(e) => setFilter({ ...filter, invert: e.target.checked })}
            />
            {t('tail.invert')}
          </label>
          <label className="text-muted flex items-center gap-1 text-[11px] select-none">
            <input
              type="checkbox"
              checked={filter.caseSensitive}
              onChange={(e) => setFilter({ ...filter, caseSensitive: e.target.checked })}
            />
            Aa
          </label>
          <label className="text-muted flex items-center gap-1 text-[11px] select-none">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            {t('tail.follow')}
          </label>
        </div>

        {error && <p className="text-danger mb-2 text-xs leading-relaxed">{error}</p>}

        <div
          ref={boxRef}
          // Bám đáy hay không do CHÍNH việc user cuộn quyết định, không phải do ô tick
          onScroll={(e) => {
            const el = e.currentTarget
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
          }}
          className={`border-edge bg-app overflow-auto rounded border p-2 font-mono text-[11px] leading-relaxed ${
            embedded ? (fill ? 'min-h-0 flex-1' : 'h-[calc(100vh-16rem)]') : 'h-96'
          }`}
        >
          {shown.length === 0 ? (
            <p className="text-subtle py-8 text-center">{sessionId ? t('tail.waiting') : t('tail.idle')}</p>
          ) : (
            shown.map((line) => (
              <div key={line.seq} className={line.source === 'stderr' ? 'text-warning' : 'text-content'}>
                {highlightSegments(line.text, filter).map((seg, i) =>
                  seg.hit ? (
                    <mark key={i} className="bg-accent/30 text-content rounded-sm">
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )}
                {line.text === '' && ' '}
              </div>
            ))
          )}
        </div>

        <div className="text-subtle mt-1.5 flex items-center justify-between text-[10px]">
          <span>{t('tail.shown', { shown: shown.length, total: lines.length })}</span>
          <span>{t('tail.note')}</span>
        </div>
      </div>
    </ModalOrPanel>
  )
}
