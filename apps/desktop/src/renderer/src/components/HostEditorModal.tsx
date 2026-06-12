import { useEffect, useState } from 'react'
import type { AuthType, HostDto, HostInput, HostProtocol, LoginStep, SerialPortInfo } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { envToText, textToEnv } from '../lib/env'
import { Button, ConfirmModal, Field, Modal, Select, TextArea, TextInput } from './ui'

const NEW_GROUP = '__new__'
const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400]
const DEFAULT_PORT: Record<HostProtocol, number> = { ssh: 22, telnet: 23, serial: 115200 }

/** Mẫu cho flow: ssh vào A → su sang user khác → ssh tiếp sang B. */
const SU_SSH_TEMPLATE: LoginStep[] = [
  { expect: '', send: 'su - <user>', secret: false },
  { expect: 'assword', send: '', secret: true },
  { expect: '$', send: 'ssh <user>@<server-B>', secret: false }
]

export function HostEditorModal({ host, onClose }: { host: HostDto | null; onClose: () => void }) {
  const { hosts, groups, keys, snippets, saveHost, deleteHost, saveGroup } = useDataStore()
  const [protocol, setProtocol] = useState<HostProtocol>(host?.protocol ?? 'ssh')
  const [label, setLabel] = useState(host?.label ?? '')
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
  const [jumpChain, setJumpChain] = useState<string[]>(host?.jumpChain ?? [])
  const [jumpToAdd, setJumpToAdd] = useState('')
  const [envText, setEnvText] = useState(envToText(host?.env ?? null))
  const [startupSnippetId, setStartupSnippetId] = useState(host?.startupSnippetId ?? '')
  const [agentForward, setAgentForward] = useState(host?.agentForward ?? false)
  const [loginSteps, setLoginSteps] = useState<LoginStep[]>(host?.loginSteps ?? [])
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(
      host &&
        (host.jumpChain?.length || host.env || host.startupSnippetId || host.agentForward || host.loginSteps?.length)
    )
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const hostLabel = (id: string): string => hosts.find((h) => h.id === id)?.label ?? '(đã xoá)'
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
    if (!hostname.trim()) return setError(isSerial ? 'Chọn/nhập cổng COM' : 'Nhập hostname/IP')
    const portNum = Number(port)
    if (isSerial) {
      if (!Number.isInteger(portNum) || portNum < 50) return setError('Baud rate không hợp lệ')
    } else if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65_535) {
      return setError('Port không hợp lệ')
    }
    if (isSsh && authType === 'key' && !keyId) return setError('Chọn SSH key (hoặc tạo trong mục Keys)')
    if (isSsh && authType === 'secret' && !secretRef.trim()) return setError('Nhập tham chiếu secret (op:// , bw:// , vault://)')

    setBusy(true)
    let finalGroupId: string | null = groupId || null
    if (groupId === NEW_GROUP) {
      if (!newGroupName.trim()) {
        setBusy(false)
        return setError('Nhập tên group mới')
      }
      const group = await saveGroup({ name: newGroupName.trim() })
      if (!group) return setBusy(false)
      finalGroupId = group.id
    }

    const sshOnly = isSsh
    const input: HostInput = {
      id: host?.id,
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
      loginSteps: sshOnly && loginSteps.filter((s) => s.send || s.secret).length > 0 ? loginSteps : null
    }
    const ok = await saveHost(input)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    // closeOnBackdrop=false: form dài — click hụt ra ngoài không được làm mất dữ liệu đang nhập
    <Modal title={host ? 'Sửa host' : 'Thêm host'} onClose={onClose} closeOnBackdrop={false}>
      <form
        className="max-h-[70vh] overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Tên hiển thị">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="VD: Web server production" />
        </Field>

        <Field label="Giao thức">
          <Select value={protocol} onChange={(e) => changeProtocol(e.target.value as HostProtocol)}>
            <option value="ssh">SSH</option>
            <option value="telnet">Telnet</option>
            <option value="serial">Serial (COM / USB)</option>
          </Select>
        </Field>

        {isSerial ? (
          <div className="flex gap-2">
            <div className="flex-1">
              <Field label="Cổng COM">
                {serialPorts.length > 0 ? (
                  <Select value={hostname} onChange={(e) => setHostname(e.target.value)}>
                    <option value="">— Chọn cổng —</option>
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
                    placeholder="COM3 / /dev/ttyUSB0 (cắm thiết bị rồi mở lại)"
                  />
                )}
              </Field>
            </div>
            <div className="w-28">
              <Field label="Baud">
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
              <Field label="Hostname / IP">
                <TextInput
                  autoFocus
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="192.168.1.10"
                />
              </Field>
            </div>
            <div className="w-24">
              <Field label="Port">
                <TextInput value={port} onChange={(e) => setPort(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {isSsh && (
          <Field label="Username">
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="(kế thừa từ group)"
            />
          </Field>
        )}

        {isSsh && (
          <Field label="Xác thực">
            <Select value={authType} onChange={(e) => setAuthType(e.target.value as '' | AuthType)}>
              <option value="">(kế thừa từ group)</option>
              <option value="password">Password</option>
              <option value="key">SSH Key</option>
              <option value="agent">SSH Agent (OS)</option>
              <option value="secret">Secret manager (1Password / Bitwarden / Vault)</option>
              <option value="none">Không cần xác thực (server cho vào thẳng)</option>
            </Select>
          </Field>
        )}

        {isSsh && authType === 'secret' && (
          <Field label="Tham chiếu secret (lấy password lúc kết nối, không lưu trong app)">
            <TextInput
              value={secretRef}
              onChange={(e) => setSecretRef(e.target.value)}
              placeholder="op://Vault/jpapst04/password  ·  bw://<item>  ·  vault://secret/jpapst04#password"
            />
          </Field>
        )}

        {isSsh && authType === 'password' && (
          <>
            <Field label={host?.hasPassword ? 'Password (để trống = giữ nguyên)' : 'Password (để trống = hỏi khi kết nối)'}>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setClearPassword(false)
                }}
                placeholder={host?.hasPassword ? '••••••••' : ''}
              />
            </Field>
            {host?.hasPassword && (
              <label className="mb-2.5 -mt-1 flex items-center gap-2 text-xs text-zinc-400 select-none">
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={(e) => setClearPassword(e.target.checked)}
                />
                Xoá password đã lưu (sẽ hỏi mỗi lần kết nối)
              </label>
            )}
          </>
        )}

        {isSsh && authType === 'key' && (
          <Field label="SSH Key">
            <Select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
              <option value="">— Chọn key —</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label} ({k.keyType})
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Group">
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">— Không nhóm —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={NEW_GROUP}>+ Tạo group mới…</option>
          </Select>
        </Field>
        {groupId === NEW_GROUP && (
          <Field label="Tên group mới">
            <TextInput value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
          </Field>
        )}

        {isSsh && (
          <button
            type="button"
            className="mb-2 text-xs text-blue-400 hover:text-blue-300"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? '▾' : '▸'} Nâng cao (jump host, env, startup…)
          </button>
        )}

        {isSsh && showAdvanced && (
          <div className="mb-2 rounded border border-zinc-800 bg-zinc-950/50 p-2.5">
            <Field label="Jump hosts (kết nối xuyên qua, theo thứ tự)">
              <div>
                {jumpChain.map((id, index) => (
                  <div key={id} className="mb-1 flex items-center gap-1.5 text-xs text-zinc-300">
                    <span className="text-zinc-600">{index + 1}.</span>
                    <span className="flex-1 truncate">{hostLabel(id)}</span>
                    <button
                      type="button"
                      className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      title="Xoá khỏi chain"
                      onClick={() => setJumpChain((prev) => prev.filter((x) => x !== id))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <Select value={jumpToAdd} onChange={(e) => setJumpToAdd(e.target.value)} className="!text-xs">
                    <option value="">+ Thêm jump host…</option>
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
                    Thêm
                  </Button>
                </div>
              </div>
            </Field>

            <Field label="Biến môi trường (KEY=VALUE mỗi dòng)">
              <TextArea rows={2} value={envText} onChange={(e) => setEnvText(e.target.value)} />
            </Field>

            <Field label="Startup snippet">
              <Select value={startupSnippetId} onChange={(e) => setStartupSnippetId(e.target.value)}>
                <option value="">(không có)</option>
                {snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="mb-2.5 flex items-center gap-2 text-xs text-zinc-400 select-none">
              <input type="checkbox" checked={agentForward} onChange={(e) => setAgentForward(e.target.checked)} />
              Agent forwarding (chuyển tiếp ssh-agent — tương đương ssh -A)
            </label>

            <Field label="Login script (tự gõ lệnh sau khi login — vd su rồi ssh tiếp)">
              <div>
                {loginSteps.map((step, index) => (
                  <div key={index} className="mb-1.5 flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-right text-[10px] text-zinc-600">{index + 1}</span>
                    <input
                      value={step.expect ?? ''}
                      onChange={(e) =>
                        setLoginSteps((prev) =>
                          prev.map((s, i) => (i === index ? { ...s, expect: e.target.value } : s))
                        )
                      }
                      placeholder="chờ chuỗi…"
                      title='Chờ chuỗi này xuất hiện trong output rồi mới gửi (vd "assword", "$"). Trống = gửi sau 0.8s'
                      className="w-24 shrink-0 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-blue-600"
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
                          ? host?.loginSteps?.[index]?.secret
                            ? '•••• (để trống = giữ nguyên)'
                            : 'mật khẩu (trống = hỏi khi kết nối)'
                          : 'lệnh gửi đi…'
                      }
                      className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-blue-600"
                    />
                    <label
                      className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-500 select-none"
                      title="Là mật khẩu: lưu mã hoá, không hiển thị lại"
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
                      className="shrink-0 rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      title="Xoá bước"
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
                    + Bước
                  </Button>
                  {loginSteps.length === 0 && (
                    <Button
                      type="button"
                      className="!px-2 !py-1 !text-xs"
                      title="Điền sẵn 3 bước: su → nhập mật khẩu → ssh sang server khác"
                      onClick={() => setLoginSteps(SU_SSH_TEMPLATE.map((s) => ({ ...s })))}
                    >
                      Mẫu: su → ssh
                    </Button>
                  )}
                </div>
                {loginSteps.length > 0 && (
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">
                    Chạy lần lượt sau khi login (cả khi auto-reconnect). Mật khẩu 🔒 được mã hoá trong vault;
                    để trống sẽ hỏi mỗi lần kết nối.
                  </p>
                )}
              </div>
            </Field>
          </div>
        )}

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {host ? (
            <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
              Xoá host
            </Button>
          ) : (
            <span />
          )}
          {confirmDelete && host && (
            <ConfirmModal
              title="Xoá host"
              message={
                <>
                  Xoá vĩnh viễn host <b>{host.label}</b>? Mật khẩu/login script lưu kèm sẽ mất theo.
                </>
              }
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
              Huỷ
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
