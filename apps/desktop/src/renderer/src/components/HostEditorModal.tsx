import { useEffect, useState } from 'react'
import type { AuthType, HostDto, HostInput, HostProtocol, LoginStep, SerialPortInfo } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { envToText, textToEnv } from '../lib/env'
import { Button, ConfirmModal, Field, Modal, Select, TextArea, TextInput } from './ui'
import { useT } from '../i18n'

const NEW_GROUP = '__new__'
const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400]
const DEFAULT_PORT: Record<HostProtocol, number> = { ssh: 22, telnet: 23, serial: 115200 }

/** Mẫu cho flow: ssh vào A → su sang user khác → ssh tiếp sang B. */
const SU_SSH_TEMPLATE: LoginStep[] = [
  { expect: '', send: 'su - <user>', secret: false },
  { expect: 'assword', send: '', secret: true },
  { expect: '$', send: 'ssh <user>@<server-B>', secret: false }
]

export function HostEditorModal({
  host,
  duplicate = false,
  onClose
}: {
  host: HostDto | null
  /** Nhân bản: dùng host làm mẫu nhưng lưu thành host MỚI (bỏ id). */
  duplicate?: boolean
  onClose: () => void
}) {
  const t = useT()
  const { hosts, groups, keys, snippets, saveHost, deleteHost, saveGroup } = useDataStore()
  // isEdit = đang sửa host có sẵn. Nhân bản tuy có `host` mẫu nhưng vẫn là tạo mới.
  const isEdit = host !== null && !duplicate
  const [protocol, setProtocol] = useState<HostProtocol>(host?.protocol ?? 'ssh')
  const [label, setLabel] = useState(duplicate && host ? `${host.label} (copy)` : (host?.label ?? ''))
  const [hostname, setHostname] = useState(host?.hostname ?? '')
  const [port, setPort] = useState(String(host?.port ?? 22))
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([])
  const [username, setUsername] = useState(host?.username ?? '')
  const [authType, setAuthType] = useState<'' | AuthType>(host?.authType ?? '')
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [keyId, setKeyId] = useState(host?.keyId ?? '')
  const [secretRef, setSecretRef] = useState(host?.secretRef ?? '')
  const [groupId, setGroupId] = useState(host?.groupId ?? '')
  const [newGroupName, setNewGroupName] = useState('')
  const [notes, setNotes] = useState(host?.notes ?? '')
  const [jumpChain, setJumpChain] = useState<string[]>(host?.jumpChain ?? [])
  const [jumpToAdd, setJumpToAdd] = useState('')
  const [envText, setEnvText] = useState(envToText(host?.env ?? null))
  const [startupSnippetId, setStartupSnippetId] = useState(host?.startupSnippetId ?? '')
  const [agentForward, setAgentForward] = useState(host?.agentForward ?? false)
  const [tmux, setTmux] = useState(host?.tmux ?? false)
  const [loginSteps, setLoginSteps] = useState<LoginStep[]>(host?.loginSteps ?? [])
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(
      host &&
        (host.jumpChain?.length ||
          host.env ||
          host.startupSnippetId ||
          host.agentForward ||
          host.tmux ||
          host.loginSteps?.length)
    )
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const hostLabel = (id: string): string => hosts.find((h) => h.id === id)?.label ?? t('host.deleted')
  const jumpCandidates = hosts.filter((h) => h.id !== host?.id && !jumpChain.includes(h.id))
  const isSsh = protocol === 'ssh'
  const isSerial = protocol === 'serial'

  // Nạp danh sách cổng serial khi chọn protocol serial
  useEffect(() => {
    if (protocol === 'serial') void window.infra.serial.listPorts().then(setSerialPorts)
  }, [protocol])

  const changeProtocol = (next: HostProtocol): void => {
    setProtocol(next)
    // đổi port mặc định nếu user chưa nhập gì khác thường
    const cur = Number(port)
    if (Object.values(DEFAULT_PORT).includes(cur) || !port) setPort(String(DEFAULT_PORT[next]))
  }

  const submit = async (): Promise<void> => {
    setError(null)
    if (!hostname.trim()) return setError(isSerial ? t('host.errCom') : t('host.errHostname'))
    const portNum = Number(port)
    if (isSerial) {
      if (!Number.isInteger(portNum) || portNum < 50) return setError(t('host.errBaud'))
    } else if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65_535) {
      return setError(t('host.errPort'))
    }
    if (isSsh && authType === 'key' && !keyId) return setError(t('host.errKey'))
    if (isSsh && authType === 'secret' && !secretRef.trim()) return setError(t('host.errSecret'))

    setBusy(true)
    let finalGroupId: string | null = groupId || null
    if (groupId === NEW_GROUP) {
      if (!newGroupName.trim()) {
        setBusy(false)
        return setError(t('host.errGroupName'))
      }
      const group = await saveGroup({ name: newGroupName.trim() })
      if (!group) return setBusy(false)
      finalGroupId = group.id
    }

    const sshOnly = isSsh
    const input: HostInput = {
      id: isEdit ? host!.id : undefined,
      groupId: finalGroupId,
      protocol,
      label: label.trim() || `${username || 'host'}@${hostname}`,
      hostname: hostname.trim(),
      port: portNum,
      username: sshOnly ? username.trim() || null : null,
      authType: sshOnly ? authType || null : null,
      keyId: sshOnly && authType === 'key' ? keyId : null,
      secretRef: sshOnly && authType === 'secret' ? secretRef.trim() : null,
      // undefined = giữ nguyên password cũ; null = xoá; string = đặt mới
      password: sshOnly ? (clearPassword ? null : password ? password : undefined) : null,
      jumpChain: sshOnly && jumpChain.length > 0 ? jumpChain : null,
      env: sshOnly ? textToEnv(envText) : null,
      startupSnippetId: sshOnly ? startupSnippetId || null : null,
      agentForward: sshOnly ? agentForward : false,
      tmux: sshOnly ? tmux : false,
      notes: notes.trim() || null,
      loginSteps: sshOnly && loginSteps.filter((s) => s.send || s.secret).length > 0 ? loginSteps : null
    }
    const ok = await saveHost(input)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    // closeOnBackdrop=false: form dài — click hụt ra ngoài không được làm mất dữ liệu đang nhập
    <Modal title={isEdit ? t('host.titleEdit') : duplicate ? t('host.titleDuplicate') : t('host.titleAdd')} onClose={onClose} closeOnBackdrop={false}>
      <form
        className="max-h-[70vh] overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={t('host.displayName')}>
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('host.displayNamePh')} />
        </Field>

        <Field label={t('host.protocol')}>
          <Select value={protocol} onChange={(e) => changeProtocol(e.target.value as HostProtocol)}>
            <option value="ssh">SSH</option>
            <option value="telnet">Telnet</option>
            <option value="serial">{t('host.protoSerial')}</option>
          </Select>
        </Field>

        {isSerial ? (
          <div className="flex gap-2">
            <div className="flex-1">
              <Field label={t('host.comPort')}>
                {serialPorts.length > 0 ? (
                  <Select value={hostname} onChange={(e) => setHostname(e.target.value)}>
                    <option value="">{t('host.chooseCom')}</option>
                    {serialPorts.map((p) => (
                      <option key={p.path} value={p.path}>
                        {p.path} {p.label !== p.path ? `— ${p.label}` : ''}
                      </option>
                    ))}
                    {hostname && !serialPorts.some((p) => p.path === hostname) && (
                      <option value={hostname}>{hostname}</option>
                    )}
                  </Select>
                ) : (
                  <TextInput
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    placeholder={t('host.comPh')}
                  />
                )}
              </Field>
            </div>
            <div className="w-28">
              <Field label={t('host.baud')}>
                <Select value={port} onChange={(e) => setPort(e.target.value)}>
                  {BAUD_RATES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="flex-1">
              <Field label={t('host.hostname')}>
                <TextInput
                  autoFocus
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="192.168.1.10"
                />
              </Field>
            </div>
            <div className="w-24">
              <Field label={t('host.port')}>
                <TextInput value={port} onChange={(e) => setPort(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {isSsh && (
          <Field label={t('host.username')}>
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('host.inheritGroup')}
            />
          </Field>
        )}

        {isSsh && (
          <Field label={t('host.auth')}>
            <Select value={authType} onChange={(e) => setAuthType(e.target.value as '' | AuthType)}>
              <option value="">{t('host.inheritGroup')}</option>
              <option value="password">{t('host.authPassword')}</option>
              <option value="key">{t('auth.key')}</option>
              <option value="agent">{t('auth.agent')}</option>
              <option value="secret">{t('host.authSecret')}</option>
              <option value="none">{t('auth.none')}</option>
            </Select>
          </Field>
        )}

        {isSsh && authType === 'secret' && (
          <Field label={t('host.secretRef')}>
            <TextInput
              value={secretRef}
              onChange={(e) => setSecretRef(e.target.value)}
              placeholder="op://Vault/jpapst04/password  ·  bw://<item>  ·  vault://secret/jpapst04#password"
            />
          </Field>
        )}

        {isSsh && authType === 'password' && (
          <>
            <Field label={isEdit && host?.hasPassword ? t('host.pwKeep') : t('host.pwAsk')}>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setClearPassword(false)
                }}
                placeholder={isEdit && host?.hasPassword ? '••••••••' : ''}
              />
            </Field>
            {duplicate && host?.hasPassword && (
              <p className="mb-2.5 -mt-1 text-[10px] leading-relaxed text-warning/80">
                {t('host.pwDupNote')}
              </p>
            )}
            {isEdit && host?.hasPassword && (
              <label className="mb-2.5 -mt-1 flex items-center gap-2 text-xs text-muted select-none">
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={(e) => setClearPassword(e.target.checked)}
                />
                {t('host.pwClear')}
              </label>
            )}
          </>
        )}

        {isSsh && authType === 'key' && (
          <Field label={t('host.sshKey')}>
            <Select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
              <option value="">{t('auth.chooseKey')}</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label} ({k.keyType})
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('host.group')}>
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">{t('host.noGroup')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={NEW_GROUP}>{t('host.newGroupOpt')}</option>
          </Select>
        </Field>
        {groupId === NEW_GROUP && (
          <Field label={t('host.newGroupName')}>
            <TextInput value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
          </Field>
        )}

        <Field label={t('host.notes')}>
          <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('host.notesPh')} />
        </Field>

        {isSsh && (
          <button
            type="button"
            className="mb-2 text-xs text-accent-fg hover:text-accent-fg"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? '▾' : '▸'} {t('host.advanced')}
          </button>
        )}

        {isSsh && showAdvanced && (
          <div className="mb-2 rounded border border-edge bg-input/50 p-2.5">
            <Field label={t('host.jumpHosts')}>
              <div>
                {jumpChain.map((id, index) => (
                  <div key={id} className="mb-1 flex items-center gap-1.5 text-xs text-content">
                    <span className="text-subtle">{index + 1}.</span>
                    <span className="flex-1 truncate">{hostLabel(id)}</span>
                    <button
                      type="button"
                      className="rounded px-1 text-subtle hover:bg-hover hover:text-content"
                      title={t('host.removeJump')}
                      onClick={() => setJumpChain((prev) => prev.filter((x) => x !== id))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <Select value={jumpToAdd} onChange={(e) => setJumpToAdd(e.target.value)} className="!text-xs">
                    <option value="">{t('host.addJump')}</option>
                    {jumpCandidates.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    className="!px-2 !py-1 !text-xs"
                    disabled={!jumpToAdd}
                    onClick={() => {
                      if (jumpToAdd) {
                        setJumpChain((prev) => [...prev, jumpToAdd])
                        setJumpToAdd('')
                      }
                    }}
                  >
                    {t('host.add')}
                  </Button>
                </div>
              </div>
            </Field>

            <Field label={t('host.env')}>
              <TextArea rows={2} value={envText} onChange={(e) => setEnvText(e.target.value)} />
            </Field>

            <Field label={t('host.startup')}>
              <Select value={startupSnippetId} onChange={(e) => setStartupSnippetId(e.target.value)}>
                <option value="">{t('common.none')}</option>
                {snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="mb-2.5 flex items-center gap-2 text-xs text-muted select-none">
              <input type="checkbox" checked={agentForward} onChange={(e) => setAgentForward(e.target.checked)} />
              {t('host.agentFwd')}
            </label>

            <label className="mb-1 flex items-center gap-2 text-xs text-muted select-none" title={t('host.tmuxTip')}>
              <input type="checkbox" checked={tmux} onChange={(e) => setTmux(e.target.checked)} />
              {t('host.tmux')}
            </label>
            <p className="mb-2.5 -mt-0.5 ml-6 text-[10px] leading-relaxed text-subtle">{t('host.tmuxHint')}</p>

            <Field label={t('host.loginScript')}>
              <div>
                {loginSteps.map((step, index) => (
                  <div key={index} className="mb-1.5 flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-right text-[10px] text-subtle">{index + 1}</span>
                    <input
                      value={step.expect ?? ''}
                      onChange={(e) =>
                        setLoginSteps((prev) =>
                          prev.map((s, i) => (i === index ? { ...s, expect: e.target.value } : s))
                        )
                      }
                      placeholder={t('host.expectPh')}
                      title={t('host.expectTip')}
                      className="w-24 shrink-0 rounded border border-edge-strong bg-input px-1.5 py-1 text-[11px] text-content outline-none focus:border-accent"
                    />
                    <input
                      type={step.secret ? 'password' : 'text'}
                      value={step.send}
                      onChange={(e) =>
                        setLoginSteps((prev) =>
                          prev.map((s, i) => (i === index ? { ...s, send: e.target.value } : s))
                        )
                      }
                      placeholder={
                        step.secret
                          ? isEdit && host?.loginSteps?.[index]?.secret
                            ? t('host.stepPwKeep')
                            : t('host.stepPwAsk')
                          : t('host.stepSendPh')
                      }
                      className="min-w-0 flex-1 rounded border border-edge-strong bg-input px-1.5 py-1 font-mono text-[11px] text-content outline-none focus:border-accent"
                    />
                    <label
                      className="flex shrink-0 items-center gap-1 text-[10px] text-subtle select-none"
                      title={t('host.secretTip')}
                    >
                      <input
                        type="checkbox"
                        checked={step.secret ?? false}
                        onChange={(e) =>
                          setLoginSteps((prev) =>
                            prev.map((s, i) => (i === index ? { ...s, secret: e.target.checked } : s))
                          )
                        }
                      />
                      🔒
                    </label>
                    <button
                      type="button"
                      className="shrink-0 rounded px-1 text-subtle hover:bg-hover hover:text-content"
                      title={t('host.removeStep')}
                      onClick={() => setLoginSteps((prev) => prev.filter((_, i) => i !== index))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    className="!px-2 !py-1 !text-xs"
                    onClick={() => setLoginSteps((prev) => [...prev, { expect: '', send: '', secret: false }])}
                  >
                    {t('host.addStep')}
                  </Button>
                  {loginSteps.length === 0 && (
                    <Button
                      type="button"
                      className="!px-2 !py-1 !text-xs"
                      title={t('host.suTemplateTip')}
                      onClick={() => setLoginSteps(SU_SSH_TEMPLATE.map((s) => ({ ...s })))}
                    >
                      {t('host.suTemplate')}
                    </Button>
                  )}
                </div>
                {loginSteps.length > 0 && (
                  <p className="mt-1.5 text-[10px] leading-relaxed text-subtle">
                    {t('host.loginNote')}
                  </p>
                )}
              </div>
            </Field>
          </div>
        )}

        {error && <p className="mb-3 text-xs text-danger">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {isEdit ? (
            <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
              {t('host.deleteHost')}
            </Button>
          ) : (
            <span />
          )}
          {confirmDelete && isEdit && host && (
            <ConfirmModal
              title={t('host.deleteHost')}
              message={t('host.deleteConfirm', { label: host.label })}
              onConfirm={() => {
                setConfirmDelete(false)
                // chỉ đóng editor khi xoá thành công — thất bại thì giữ modal, lỗi đã có toast
                void deleteHost(host.id).then((ok) => {
                  if (ok) onClose()
                })
              }}
              onCancel={() => setConfirmDelete(false)}
            />
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
