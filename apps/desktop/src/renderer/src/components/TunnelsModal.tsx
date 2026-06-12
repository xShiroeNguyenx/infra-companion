import { useState } from 'react'
import type { TunnelRuleDto, TunnelType } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { Button, ConfirmModal, Field, Modal, Select, TextInput } from './ui'
import { useT } from '../i18n'
import type { I18nKey } from '../i18n/dict'

const TYPE_KEY: Record<TunnelType, I18nKey> = {
  L: 'tunnel.typeL',
  R: 'tunnel.typeR',
  D: 'tunnel.typeD'
}

/** Tunnel Dashboard: danh sách rule + trạng thái runtime + form thêm rule. */
export function TunnelsModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { hosts, tunnels, tunnelStates, saveTunnel, deleteTunnel, startTunnel, stopTunnel } = useDataStore()
  const [mode, setMode] = useState<'list' | 'add'>('list')
  const [hostId, setHostId] = useState('')
  const [type, setType] = useState<TunnelType>('L')
  const [bindPort, setBindPort] = useState('')
  const [destHost, setDestHost] = useState('127.0.0.1')
  const [destPort, setDestPort] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TunnelRuleDto | null>(null)

  const hostLabel = (id: string): string => hosts.find((h) => h.id === id)?.label ?? t('tunnel.hostDeleted')

  const submit = async (): Promise<void> => {
    setError(null)
    if (!hostId) return setError(t('tunnel.errHost'))
    const bind = Number(bindPort)
    if (!Number.isInteger(bind) || bind < 1 || bind > 65_535) return setError(t('tunnel.errBind'))
    let dest: number | null = null
    if (type !== 'D') {
      dest = Number(destPort)
      if (!destHost.trim()) return setError(t('tunnel.errDestHost'))
      if (!Number.isInteger(dest) || dest < 1 || dest > 65_535) return setError(t('tunnel.errDestPort'))
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
    <Modal title={t('tunnel.title')} onClose={onClose}>
      {mode === 'list' && (
        <>
          {/* width cố định: w-fit của Modal sẽ giãn theo label dài nhất (truncate vô hiệu) */}
          <div className="mb-3 max-h-80 w-[520px] max-w-full overflow-y-auto">
            {tunnels.length === 0 && (
              <p className="py-4 text-center text-xs text-subtle">{t('tunnel.empty')}</p>
            )}
            {tunnels.map((rule) => {
              const state = tunnelStates[rule.id]?.status ?? 'stopped'
              const detail = tunnelStates[rule.id]?.detail
              const running = state === 'active' || state === 'starting'
              return (
                <div
                  key={rule.id}
                  className="mb-1.5 flex items-center gap-2 rounded border border-edge bg-input px-3 py-2"
                >
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      state === 'active'
                        ? 'bg-success'
                        : state === 'starting'
                          ? 'animate-pulse bg-warning'
                          : state === 'error'
                            ? 'bg-danger'
                            : 'bg-edge-strong'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-content">
                      [{rule.type}] {rule.label || `:${rule.bindPort}`}
                    </div>
                    <div className="truncate text-[10px] text-subtle">
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
                    {running ? t('tunnel.stop') : t('tunnel.start')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => setConfirmDelete(rule)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              )
            })}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setMode('add')}>
              {t('tunnel.new')}
            </Button>
          </div>
          {confirmDelete && (
            <ConfirmModal
              title={t('tunnel.deleteTitle')}
              message={t('tunnel.deleteMsg', { label: confirmDelete.label || `:${confirmDelete.bindPort}` })}
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
          <Field label={t('tunnel.viaHost')}>
            <Select value={hostId} onChange={(e) => setHostId(e.target.value)} autoFocus>
              <option value="">{t('tunnel.chooseHost')}</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tunnel.kind')}>
            <Select value={type} onChange={(e) => setType(e.target.value as TunnelType)}>
              {(Object.keys(TYPE_KEY) as TunnelType[]).map((ty) => (
                <option key={ty} value={ty}>
                  {t(TYPE_KEY[ty])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={type === 'R' ? t('tunnel.bindServer') : t('tunnel.bindLocal')}>
            <TextInput value={bindPort} onChange={(e) => setBindPort(e.target.value)} placeholder={t('tunnel.bindPh')} />
          </Field>
          {type !== 'D' && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Field label={t('tunnel.destHost')}>
                  <TextInput value={destHost} onChange={(e) => setDestHost(e.target.value)} />
                </Field>
              </div>
              <div className="w-28">
                <Field label={t('tunnel.destPort')}>
                  <TextInput value={destPort} onChange={(e) => setDestPort(e.target.value)} placeholder="3306" />
                </Field>
              </div>
            </div>
          )}
          {error && <p className="mb-3 text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setMode('list')}>
              {t('tunnel.back')}
            </Button>
            <Button type="submit" variant="primary">
              {t('tunnel.save')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
