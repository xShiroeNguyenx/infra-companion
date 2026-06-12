import { useState } from 'react'
import type { TunnelRuleDto, TunnelType } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, ConfirmModal, Field, Modal, Select, TextInput } from './ui'

const TYPE_LABEL: Record<TunnelType, string> = {
  L: 'Local (máy này → qua SSH → đích)',
  R: 'Remote (server → về máy này)',
  D: 'Dynamic (SOCKS5 proxy)'
}

/** Tunnel Dashboard: danh sách rule + trạng thái runtime + form thêm rule. */
export function TunnelsModal({ onClose }: { onClose: () => void }) {
  const { hosts, tunnels, tunnelStates, saveTunnel, deleteTunnel, startTunnel, stopTunnel } = useDataStore()
  const [mode, setMode] = useState<'list' | 'add'>('list')
  const [hostId, setHostId] = useState('')
  const [type, setType] = useState<TunnelType>('L')
  const [bindPort, setBindPort] = useState('')
  const [destHost, setDestHost] = useState('127.0.0.1')
  const [destPort, setDestPort] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TunnelRuleDto | null>(null)

  const hostLabel = (id: string): string => hosts.find((h) => h.id === id)?.label ?? '(host đã xoá)'

  const submit = async (): Promise<void> => {
    setError(null)
    if (!hostId) return setError('Chọn host')
    const bind = Number(bindPort)
    if (!Number.isInteger(bind) || bind < 1 || bind > 65_535) return setError('Bind port không hợp lệ')
    let dest: number | null = null
    if (type !== 'D') {
      dest = Number(destPort)
      if (!destHost.trim()) return setError('Nhập destination host')
      if (!Number.isInteger(dest) || dest < 1 || dest > 65_535) return setError('Destination port không hợp lệ')
    }
    const ok = await saveTunnel({
      hostId,
      type,
      bindPort: bind,
      destHost: type === 'D' ? null : destHost.trim(),
      destPort: type === 'D' ? null : dest,
      label: type === 'D' ? `SOCKS5 :${bind}` : `:${bind} → ${destHost}:${destPort}`
    })
    if (ok) {
      setMode('list')
      setBindPort('')
      setDestPort('')
    }
  }

  return (
    <Modal title="Port Forwarding — Tunnels" onClose={onClose}>
      {mode === 'list' && (
        <>
          {/* width cố định: w-fit của Modal sẽ giãn theo label dài nhất (truncate vô hiệu) */}
          <div className="mb-3 max-h-80 w-[520px] max-w-full overflow-y-auto">
            {tunnels.length === 0 && (
              <p className="py-4 text-center text-xs text-zinc-500">Chưa có tunnel nào</p>
            )}
            {tunnels.map((rule) => {
              const state = tunnelStates[rule.id]?.status ?? 'stopped'
              const detail = tunnelStates[rule.id]?.detail
              const running = state === 'active' || state === 'starting'
              return (
                <div
                  key={rule.id}
                  className="mb-1.5 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2"
                >
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      state === 'active'
                        ? 'bg-emerald-500'
                        : state === 'starting'
                          ? 'animate-pulse bg-amber-400'
                          : state === 'error'
                            ? 'bg-red-500'
                            : 'bg-zinc-600'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-zinc-200">
                      [{rule.type}] {rule.label || `:${rule.bindPort}`}
                    </div>
                    <div className="truncate text-[10px] text-zinc-500">
                      {hostLabel(rule.hostId)}
                      {state === 'error' && detail ? ` — ${detail}` : ''}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={running ? 'default' : 'primary'}
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => void (running ? stopTunnel(rule.id) : startTunnel(rule.id))}
                  >
                    {running ? 'Dừng' : 'Chạy'}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => setConfirmDelete(rule)}
                  >
                    Xoá
                  </Button>
                </div>
              )
            })}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setMode('add')}>
              + Tunnel mới
            </Button>
          </div>
          {confirmDelete && (
            <ConfirmModal
              title="Xoá tunnel"
              message={
                <>
                  Xoá tunnel <b>{confirmDelete.label || `:${confirmDelete.bindPort}`}</b>? Nếu đang chạy sẽ bị dừng.
                </>
              }
              onConfirm={() => {
                void deleteTunnel(confirmDelete.id)
                setConfirmDelete(null)
              }}
              onCancel={() => setConfirmDelete(null)}
            />
          )}
        </>
      )}

      {mode === 'add' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label="Qua host">
            <Select value={hostId} onChange={(e) => setHostId(e.target.value)} autoFocus>
              <option value="">— Chọn host —</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Loại">
            <Select value={type} onChange={(e) => setType(e.target.value as TunnelType)}>
              {(Object.keys(TYPE_LABEL) as TunnelType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={type === 'R' ? 'Port trên server (bind)' : 'Port local (bind)'}>
            <TextInput value={bindPort} onChange={(e) => setBindPort(e.target.value)} placeholder="VD: 8080" />
          </Field>
          {type !== 'D' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Field label="Destination host">
                  <TextInput value={destHost} onChange={(e) => setDestHost(e.target.value)} />
                </Field>
              </div>
              <div className="w-28">
                <Field label="Dest port">
                  <TextInput value={destPort} onChange={(e) => setDestPort(e.target.value)} placeholder="3306" />
                </Field>
              </div>
            </div>
          )}
          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setMode('list')}>
              Quay lại
            </Button>
            <Button type="submit" variant="primary">
              Lưu tunnel
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
