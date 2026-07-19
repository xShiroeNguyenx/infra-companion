import { useRef, useState } from 'react'
import type { ServiceActionDto, ServiceInfoDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, ConfirmModal, Modal, Select } from './ui'
import { useT } from '../i18n'

/**
 * F34 — Systemd manager: list service của 1 host qua kênh exec riêng, start/stop/restart
 * có confirm, xem journalctl 120 dòng cuối ngay trong modal. start/stop thường cần quyền
 * root trên server — không có quyền thì stderr của systemctl hiện nguyên văn.
 */
export function ServicesModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const [hostId, setHostId] = useState('')
  const [filter, setFilter] = useState('')
  const [rows, setRows] = useState<ServiceInfoDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ unit: string; action: ServiceActionDto } | null>(null)
  /** Unit đang mở logs + nội dung (null = đóng). */
  const [logs, setLogs] = useState<{ unit: string; text: string | null } | null>(null)
  const gen = useRef(0)

  const load = async (hid = hostId): Promise<void> => {
    if (!hid) return
    const my = ++gen.current
    setBusy(true)
    setError(null)
    const res = await window.infra.hostTools.listServices(hid)
    if (my !== gen.current) return
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'unknown')
      return
    }
    setRows(res.services)
  }

  const runAction = async (unit: string, action: ServiceActionDto): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await window.infra.hostTools.serviceAction(hostId, unit, action)
    setBusy(false)
    if (!res.ok) setError(res.error ?? res.stderr.trim() ?? 'systemctl lỗi')
    void load()
  }

  const openLogs = async (unit: string): Promise<void> => {
    setLogs({ unit, text: null })
    const res = await window.infra.hostTools.serviceLogs(hostId, unit)
    setLogs((cur) => (cur?.unit === unit ? { unit, text: res.stdout || res.stderr || res.error || '(trống)' } : cur))
  }

  const filtered = (rows ?? []).filter(
    (s) =>
      !filter.trim() ||
      s.unit.toLowerCase().includes(filter.trim().toLowerCase()) ||
      s.description.toLowerCase().includes(filter.trim().toLowerCase())
  )

  return (
    <Modal title={t('svc.title')} onClose={onClose}>
      <div className="w-[760px] max-w-full">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Select
            className="!w-56"
            value={hostId}
            onChange={(e) => {
              setHostId(e.target.value)
              setRows(null)
              setLogs(null)
              if (e.target.value) void load(e.target.value)
            }}
          >
            <option value="">{t('procs.chooseHost')}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </Select>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('svc.filterPh')}
            className="border-edge bg-input text-content placeholder-subtle focus:border-accent min-w-0 flex-1 rounded border px-2 py-1 text-xs outline-none"
          />
          <Button className="!px-2 !py-1 !text-xs" disabled={!hostId || busy} onClick={() => void load()}>
            {busy ? '…' : '↻'}
          </Button>
        </div>

        {error && <p className="text-danger mb-2 text-xs break-all">{error}</p>}

        <div className="border-edge max-h-[45vh] overflow-y-auto rounded border">
          <table className="w-full text-[11px]">
            <thead className="bg-panel text-subtle sticky top-0 text-left">
              <tr>
                <th className="px-2 py-1.5 font-medium">SERVICE</th>
                <th className="px-2 py-1.5 font-medium">{t('svc.state')}</th>
                <th className="px-2 py-1.5 font-medium">{t('svc.desc')}</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-edge/60 divide-y">
              {filtered.map((s) => {
                const running = s.active === 'active' && s.sub === 'running'
                const failed = s.active === 'failed' || s.sub === 'failed'
                return (
                  <tr key={s.unit} className="group hover:bg-hover">
                    <td className="text-content max-w-52 truncate px-2 py-1 font-mono" title={s.unit}>
                      {s.unit.replace(/\.service$/, '')}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <span
                        className={`mr-1 inline-block size-1.5 rounded-full ${
                          running ? 'bg-success' : failed ? 'bg-danger' : 'bg-subtle'
                        }`}
                      />
                      <span className={failed ? 'text-danger' : 'text-muted'}>
                        {s.active}/{s.sub}
                      </span>
                    </td>
                    <td className="text-subtle max-w-56 truncate px-2 py-1" title={s.description}>
                      {s.description}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="opacity-0 group-hover:opacity-100">
                        {!running && (
                          <button
                            className="text-subtle hover:text-success px-1"
                            title={t('svc.start')}
                            onClick={() => setConfirmAction({ unit: s.unit, action: 'start' })}
                          >
                            ▶
                          </button>
                        )}
                        {running && (
                          <button
                            className="text-subtle hover:text-danger px-1"
                            title={t('svc.stop')}
                            onClick={() => setConfirmAction({ unit: s.unit, action: 'stop' })}
                          >
                            ⏹
                          </button>
                        )}
                        <button
                          className="text-subtle hover:text-warning px-1"
                          title={t('svc.restart')}
                          onClick={() => setConfirmAction({ unit: s.unit, action: 'restart' })}
                        >
                          ↻
                        </button>
                        <button className="text-subtle hover:text-content px-1" title={t('svc.logs')} onClick={() => void openLogs(s.unit)}>
                          📜
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
              {rows !== null && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-subtle px-2 py-6 text-center">
                    {t('procs.empty')}
                  </td>
                </tr>
              )}
              {rows === null && (
                <tr>
                  <td colSpan={4} className="text-subtle px-2 py-6 text-center">
                    {busy ? '…' : t('procs.pickFirst')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {logs && (
          <div className="border-edge mt-2 rounded border">
            <div className="border-edge bg-panel flex items-center justify-between border-b px-2 py-1">
              <span className="text-subtle font-mono text-[10px]">journalctl -u {logs.unit} -n 120</span>
              <button className="text-subtle hover:text-content text-xs" onClick={() => setLogs(null)}>
                ✕
              </button>
            </div>
            <pre className="text-muted max-h-48 overflow-auto p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
              {logs.text ?? '…'}
            </pre>
          </div>
        )}

        <p className="text-subtle mt-2 text-[10px] leading-relaxed">{t('svc.note')}</p>
      </div>

      {confirmAction && (
        <ConfirmModal
          title={`systemctl ${confirmAction.action}`}
          message={t('svc.actionConfirm', { action: confirmAction.action, unit: confirmAction.unit })}
          onConfirm={() => {
            const a = confirmAction
            setConfirmAction(null)
            void runAction(a.unit, a.action)
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </Modal>
  )
}
