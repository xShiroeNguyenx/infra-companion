import { useEffect, useRef, useState } from 'react'
import type { LdServiceDto, LdServiceStateDto } from '@infra/shared'
import { useLocaldevStore } from '../../stores/localdev'
import { useT } from '../../i18n'

/** Màu chấm theo trạng thái — khuôn ServicesModal (systemd) để nhìn quen mắt. */
const DOT: Record<LdServiceStateDto, string> = {
  running: 'bg-success',
  starting: 'bg-warning animate-pulse',
  stopping: 'bg-warning animate-pulse',
  restarting: 'bg-warning animate-pulse',
  stopped: 'bg-edge-strong',
  crashed: 'bg-danger',
  unhealthy: 'bg-warning',
  'missing-runtime': 'bg-danger'
}

const REFRESH_MS = 3_000

/** Bật/tắt/khởi động lại nginx + các worker php, kèm log của từng service. */
export function ServicesPanel() {
  const t = useT()
  const services = useLocaldevStore((s) => s.services)
  const serviceAction = useLocaldevStore((s) => s.serviceAction)
  const stopAll = useLocaldevStore((s) => s.stopAll)
  const [busy, setBusy] = useState<string | null>(null)
  const [logOf, setLogOf] = useState<string | null>(null)
  const [logText, setLogText] = useState('')
  // gen: response cũ về muộn không được đè kết quả mới (khuôn ProcessesModal)
  const gen = useRef(0)

  // Auto-refresh: trạng thái process đổi do crash/restart, không chỉ do user bấm
  useEffect(() => {
    const timer = setInterval(() => void useLocaldevStore.getState().refreshAll(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const act = async (id: string, action: 'start' | 'stop' | 'restart'): Promise<void> => {
    setBusy(`${id}:${action}`)
    try {
      await serviceAction(id, action)
    } finally {
      setBusy(null)
    }
  }

  const openLog = async (id: string): Promise<void> => {
    const my = ++gen.current
    setLogOf(id)
    setLogText('…')
    const res = await window.infra.localdev.logTail('', id.startsWith('php') ? 'php-error' : 'nginx-error')
    if (my !== gen.current) return
    setLogText(res.ok ? res.text || '(log trống)' : (res.error ?? 'không đọc được log'))
  }

  if (services.length === 0) {
    return <p className="text-subtle py-8 text-center text-xs">{t('localdev.noServices')}</p>
  }

  // Nhóm theo groupId để pool php 4 worker không làm rối danh sách
  const groups = [...new Set(services.map((s) => s.groupId))]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-1 text-xs"
          onClick={() => void stopAll()}
        >
          {t('localdev.stopAll')}
        </button>
      </div>

      {groups.map((groupId) => {
        const list = services.filter((s) => s.groupId === groupId)
        const anyRunning = list.some((s) => s.state === 'running')
        return (
          <div key={groupId} className="border-edge rounded border">
            <div className="border-edge bg-panel flex items-center gap-2 border-b px-3 py-1.5">
              <span className="text-content flex-1 text-xs font-medium">{groupId}</span>
              <span className="text-subtle text-[10px]">
                {list.filter((s) => s.state === 'running').length}/{list.length}
              </span>
              <button
                className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-0.5 text-[11px]"
                disabled={busy !== null}
                onClick={() => void (anyRunning ? act(groupId, 'stop') : act(groupId, 'start')).catch(() => {})}
                title={anyRunning ? t('localdev.svc.stop') : t('localdev.svc.start')}
              >
                {anyRunning ? '⏹' : '▶'}
              </button>
            </div>
            {list.map((s) => (
              <ServiceRow key={s.id} svc={s} busy={busy} onAct={act} onLog={() => void openLog(s.id)} />
            ))}
          </div>
        )
      })}

      {logOf !== null && (
        <div className="border-edge rounded border">
          <div className="border-edge bg-panel flex items-center gap-2 border-b px-3 py-1.5">
            <span className="text-content flex-1 text-xs">📜 {logOf}</span>
            <button className="text-subtle hover:text-content" onClick={() => setLogOf(null)}>
              ✕
            </button>
          </div>
          <pre className="text-muted max-h-64 overflow-auto p-3 font-mono text-[11px] whitespace-pre-wrap">
            {logText}
          </pre>
        </div>
      )}
    </div>
  )
}

function ServiceRow({
  svc,
  busy,
  onAct,
  onLog
}: {
  svc: LdServiceDto
  busy: string | null
  onAct: (id: string, a: 'start' | 'stop' | 'restart') => Promise<void>
  onLog: () => void
}) {
  const t = useT()
  const running = svc.state === 'running'
  return (
    <div className="group border-edge/60 flex items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
      <span className={`size-2 shrink-0 rounded-full ${DOT[svc.state]}`} title={svc.state} />
      <span className="text-content min-w-0 flex-1 truncate text-xs">{svc.label}</span>
      {svc.ports.length > 0 && <span className="text-subtle shrink-0 font-mono text-[10px]">:{svc.ports[0]}</span>}
      {svc.pid !== null && <span className="text-subtle shrink-0 text-[10px]">pid {svc.pid}</span>}
      {svc.restarts > 0 && (
        <span className="text-warning shrink-0 text-[10px]" title={t('localdev.svc.restarts')}>
          ↻{svc.restarts}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-1.5 text-[11px]"
          disabled={busy !== null}
          onClick={() => void onAct(svc.id, running ? 'stop' : 'start')}
        >
          {running ? '⏹' : '▶'}
        </button>
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-1.5 text-[11px]"
          disabled={busy !== null}
          onClick={() => void onAct(svc.id, 'restart')}
          title={t('localdev.svc.restart')}
        >
          ↻
        </button>
        <button
          className="border-edge-strong text-muted hover:bg-hover rounded border px-1.5 text-[11px]"
          onClick={onLog}
        >
          📜
        </button>
      </div>
      {svc.lastError !== null && (
        <span className="text-danger max-w-[40%] shrink-0 truncate text-[10px]" title={svc.lastError}>
          {svc.lastError}
        </span>
      )}
    </div>
  )
}
