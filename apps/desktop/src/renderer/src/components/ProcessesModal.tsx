import { useEffect, useRef, useState } from 'react'
import type { ProcessInfoDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, ConfirmModal, Modal, Select } from './ui'
import { useT } from '../i18n'

const REFRESH_MS = 5_000

/**
 * F33 — Process viewer kiểu top: list process của 1 host SSH qua kênh exec riêng
 * (không đụng terminal đang mở, xuyên login-script như Bulk). Sort CPU/RAM, filter,
 * kill có confirm (TERM trước; KILL cho tiến trình cứng đầu). Linux only.
 */
export function ProcessesModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const [hostId, setHostId] = useState('')
  const [sortBy, setSortBy] = useState<'cpu' | 'mem'>('cpu')
  const [filter, setFilter] = useState('')
  const [auto, setAuto] = useState(false)
  const [rows, setRows] = useState<ProcessInfoDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmKill, setConfirmKill] = useState<{ proc: ProcessInfoDto; signal: 'TERM' | 'KILL' } | null>(null)
  // Đổi host/sort giữa chừng → response cũ về muộn không được đè kết quả mới
  const gen = useRef(0)

  const load = async (hid = hostId, sort = sortBy): Promise<void> => {
    if (!hid) return
    const my = ++gen.current
    setBusy(true)
    setError(null)
    const res = await window.infra.hostTools.listProcesses(hid, sort)
    if (my !== gen.current) return
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'unknown')
      return
    }
    setRows(res.processes)
  }

  // Auto-refresh 5s khi bật (chỉ khi đã chọn host)
  useEffect(() => {
    if (!auto || !hostId) return
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, hostId, sortBy])

  const kill = async (proc: ProcessInfoDto, signal: 'TERM' | 'KILL'): Promise<void> => {
    const res = await window.infra.hostTools.killProcess(hostId, proc.pid, signal)
    if (!res.ok) setError(res.error ?? res.stderr ?? 'kill lỗi')
    else void load()
  }

  const filtered = (rows ?? []).filter(
    (p) =>
      !filter.trim() ||
      p.command.toLowerCase().includes(filter.trim().toLowerCase()) ||
      p.user.toLowerCase().includes(filter.trim().toLowerCase()) ||
      String(p.pid) === filter.trim()
  )

  return (
    <Modal title={t('procs.title')} onClose={onClose}>
      <div className="w-[760px] max-w-full">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Select
            className="!w-56"
            value={hostId}
            onChange={(e) => {
              setHostId(e.target.value)
              setRows(null)
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
          {/* Sort segmented: CPU | RAM */}
          <div className="border-edge-strong flex overflow-hidden rounded border text-xs">
            {(['cpu', 'mem'] as const).map((k) => (
              <button
                key={k}
                className={`px-2.5 py-1 ${sortBy === k ? 'bg-accent-soft/60 text-accent-fg' : 'text-muted hover:bg-hover'}`}
                onClick={() => {
                  setSortBy(k)
                  if (hostId) void load(hostId, k)
                }}
              >
                {k === 'cpu' ? 'CPU' : 'RAM'}
              </button>
            ))}
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('procs.filterPh')}
            className="border-edge bg-input text-content placeholder-subtle focus:border-accent min-w-0 flex-1 rounded border px-2 py-1 text-xs outline-none"
          />
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted select-none">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            {t('procs.auto')}
          </label>
          <Button className="!px-2 !py-1 !text-xs" disabled={!hostId || busy} onClick={() => void load()}>
            {busy ? '…' : '↻'}
          </Button>
        </div>

        {error && <p className="text-danger mb-2 text-xs">{error}</p>}

        <div className="border-edge max-h-[55vh] overflow-y-auto rounded border">
          <table className="w-full text-[11px]">
            <thead className="bg-panel text-subtle sticky top-0 text-left">
              <tr>
                <th className="px-2 py-1.5 font-medium">PID</th>
                <th className="px-2 py-1.5 font-medium">USER</th>
                <th className="px-2 py-1.5 text-right font-medium">CPU%</th>
                <th className="px-2 py-1.5 text-right font-medium">MEM%</th>
                <th className="px-2 py-1.5 text-right font-medium">RSS</th>
                <th className="px-2 py-1.5 font-medium">TIME</th>
                <th className="px-2 py-1.5 font-medium">COMMAND</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-edge/60 divide-y">
              {filtered.map((p) => (
                <tr key={p.pid} className="group hover:bg-hover">
                  <td className="text-muted px-2 py-1 font-mono">{p.pid}</td>
                  <td className="text-muted px-2 py-1">{p.user}</td>
                  <td className={`px-2 py-1 text-right font-mono ${p.cpuPct >= 50 ? 'text-warning' : 'text-content'}`}>
                    {p.cpuPct.toFixed(1)}
                  </td>
                  <td className={`px-2 py-1 text-right font-mono ${p.memPct >= 30 ? 'text-warning' : 'text-content'}`}>
                    {p.memPct.toFixed(1)}
                  </td>
                  <td className="text-muted px-2 py-1 text-right font-mono">{fmtRss(p.rssKb)}</td>
                  <td className="text-subtle px-2 py-1 font-mono">{p.elapsed}</td>
                  <td className="text-content max-w-48 truncate px-2 py-1 font-mono" title={p.command}>
                    {p.command}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <button
                      className="text-subtle hover:text-danger rounded px-1 opacity-0 group-hover:opacity-100"
                      title={t('procs.kill')}
                      onClick={() => setConfirmKill({ proc: p, signal: 'TERM' })}
                    >
                      ✕
                    </button>
                    <button
                      className="text-subtle hover:text-danger rounded px-1 text-[10px] font-semibold opacity-0 group-hover:opacity-100"
                      title={t('procs.kill9')}
                      onClick={() => setConfirmKill({ proc: p, signal: 'KILL' })}
                    >
                      -9
                    </button>
                  </td>
                </tr>
              ))}
              {rows !== null && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-subtle px-2 py-6 text-center">
                    {t('procs.empty')}
                  </td>
                </tr>
              )}
              {rows === null && (
                <tr>
                  <td colSpan={8} className="text-subtle px-2 py-6 text-center">
                    {busy ? '…' : t('procs.pickFirst')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-subtle mt-2 text-[10px] leading-relaxed">{t('procs.note')}</p>
      </div>

      {confirmKill && (
        <ConfirmModal
          title={confirmKill.signal === 'KILL' ? t('procs.kill9') : t('procs.kill')}
          message={t('procs.killConfirm', {
            signal: confirmKill.signal,
            pid: confirmKill.proc.pid,
            cmd: confirmKill.proc.command
          })}
          onConfirm={() => {
            const target = confirmKill
            setConfirmKill(null)
            void kill(target.proc, target.signal)
          }}
          onCancel={() => setConfirmKill(null)}
        />
      )}
    </Modal>
  )
}

/** RSS KB → chuỗi gọn (MB/GB). */
function fmtRss(kb: number): string {
  if (kb >= 1_048_576) return `${(kb / 1_048_576).toFixed(1)}G`
  if (kb >= 1024) return `${Math.round(kb / 1024)}M`
  return `${kb}K`
}
