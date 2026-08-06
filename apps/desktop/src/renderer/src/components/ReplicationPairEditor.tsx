import { useState } from 'react'
import type { ReplPairDto, ReplProbeMode, ReplReplicaInput, TunnelRuleDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useReplicationStore } from '../stores/replication'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { Button, Field, Modal, Select, TextInput } from './ui'
import { useT } from '../i18n'

/**
 * F55 — Form khai báo một CỤM replication: 1 master + N slave.
 *
 * Mỗi đầu (master và từng slave) chọn được MỘT trong hai nguồn:
 *  - **Host SSH**: MySQL nằm trên chính host đó (app bắc cầu tới `127.0.0.1:<cổng>`), hoặc chạy
 *    `mysql` CLI ngay trên host.
 *  - **Tunnel đã lưu**: MySQL nằm ở MÁY KHÁC trong mạng trong (vd `10.20.30.40:3306`) — chỉ tới
 *    được qua tunnel. App bật tunnel rồi nối vào đầu local của nó. Bắt buộc phải đi đường này vì
 *    cách bắc cầu thẳng từ host chỉ là `direct-tcpip` phát từ gate, sẽ đi sai mạng (regression
 *    v0.1.31 đã sửa cho tunnel, không lặp lại ở đây).
 *
 * **Credential**: cụm có một cặp user/mật khẩu MẶC ĐỊNH, và master cùng từng slave đều ghi đè
 * được bằng ⚙ — vì không phải nơi nào cũng có một tài khoản giám sát dùng chung. Thiếu vế nào ở
 * cấp riêng thì vế đó lấy của cụm (chỉ khai user riêng thì mật khẩu vẫn của cụm, và ngược lại).
 *
 * Master để trống được: khi đó vẫn đo được độ trễ và trạng thái thread của từng slave, chỉ mất
 * phần so vị trí binlog với master.
 */

type Source = { kind: 'host' | 'tunnel'; id: string }

const encode = (s: Source | null): string => (s ? `${s.kind}:${s.id}` : '')
function decode(value: string): Source | null {
  const idx = value.indexOf(':')
  if (idx < 0) return null
  const kind = value.slice(0, idx)
  const id = value.slice(idx + 1)
  if ((kind !== 'host' && kind !== 'tunnel') || !id) return null
  return { kind, id }
}

/** Nhãn tunnel trong dropdown: đủ để phân biệt khi có cả chục tunnel. */
const tunnelLabel = (t: TunnelRuleDto): string =>
  `${t.label || `:${t.bindPort}`} — ${t.bindHost || '127.0.0.1'}:${t.bindPort} → ${t.destHost}:${t.destPort}`

/** Credential riêng đang soạn cho một đầu. `undefined` ở password = chưa động vào → giữ cũ. */
interface DraftCreds {
  user: string
  password: string | undefined
  hasSaved: boolean
  open: boolean
}
const newCreds = (user = '', hasSaved = false): DraftCreds => ({
  user,
  password: undefined,
  hasSaved,
  // Mở sẵn ô nếu đầu này ĐANG có credential riêng, để user thấy ngay chứ không phải đi tìm
  open: Boolean(user) || hasSaved
})

/** Slave đang soạn trong form (chưa lưu). `key` để React theo dõi hàng, độc lập với id thật. */
interface DraftReplica {
  key: string
  /** id thật nếu là slave đã lưu — giữ nguyên để cảnh báo không bị coi là slave mới. */
  id?: string
  label: string
  source: string
  dbPort: string
  creds: DraftCreds
}

let draftSeq = 0
const newDraft = (dbPort: string): DraftReplica => {
  draftSeq += 1
  return { key: `new-${draftSeq}`, label: '', source: '', dbPort, creds: newCreds() }
}

export function ReplicationPairEditor({ pair, onClose }: { pair: ReplPairDto | null; onClose: () => void }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  // Chỉ tunnel loại L (local forward) mới có đầu local để nối MySQL vào
  const tunnels = useDataStore((s) => s.tunnels).filter((x) => x.type === 'L' && x.destHost && x.destPort)
  const savePair = useReplicationStore((s) => s.savePair)

  const [name, setName] = useState(pair?.name ?? '')
  const [dbPort, setDbPort] = useState(String(pair?.dbPort ?? 3306))
  const [masterSel, setMasterSel] = useState(
    encode(
      pair?.masterTunnelId
        ? { kind: 'tunnel', id: pair.masterTunnelId }
        : pair?.masterHostId
          ? { kind: 'host', id: pair.masterHostId }
          : null
    )
  )
  const [masterCreds, setMasterCreds] = useState<DraftCreds>(
    newCreds(pair?.masterDbUser ?? '', pair?.masterHasDbPassword ?? false)
  )
  const [replicas, setReplicas] = useState<DraftReplica[]>(() =>
    pair && pair.replicas.length > 0
      ? pair.replicas.map((r) => ({
          key: r.id,
          id: r.id,
          label: r.label,
          source: encode(r.tunnelId ? { kind: 'tunnel', id: r.tunnelId } : { kind: 'host', id: r.hostId }),
          dbPort: String(r.dbPort),
          creds: newCreds(r.dbUser, r.hasDbPassword)
        }))
      : [newDraft(String(pair?.dbPort ?? 3306))]
  )
  const [dbUser, setDbUser] = useState(pair?.dbUser ?? '')
  // undefined = chưa động vào → giữ mật khẩu cũ. Chuỗi = đặt mới ('' = xoá).
  const [dbPassword, setDbPassword] = useState<string | undefined>(undefined)
  const [cliBinary, setCliBinary] = useState(pair?.cliBinary ?? 'mysql')
  const [probeMode, setProbeMode] = useState<ReplProbeMode>(pair?.probeMode ?? 'auto')
  const [pollIntervalSec, setPollIntervalSec] = useState(String(pair?.pollIntervalSec ?? 15))
  const [busy, setBusy] = useState(false)

  const master = decode(masterSel)
  const filled = replicas.filter((r) => decode(r.source) !== null)
  const anyTunnel = [master, ...filled.map((r) => decode(r.source))].some((s) => s?.kind === 'tunnel')
  const anyHost = [master, ...filled.map((r) => decode(r.source))].some((s) => s?.kind === 'host')

  const clusterHasPassword = (dbPassword !== undefined && dbPassword !== '') || (pair?.hasDbPassword ?? false)
  /**
   * Credential CÓ HIỆU LỰC của một đầu — phải khớp đúng fallback mà vault áp: thiếu vế nào ở cấp
   * riêng thì vế đó lấy của cụm.
   */
  const effective = (c: DraftCreds): { user: string; hasPassword: boolean } => ({
    user: c.user.trim() || dbUser.trim(),
    hasPassword: c.password !== undefined && c.password !== '' ? true : c.hasSaved || clusterHasPassword
  })
  /** Qua tunnel thì nối từ MÁY LOCAL nên không dùng được credential sẵn trên server. */
  const tunnelNeedsCreds = (source: Source | null, c: DraftCreds): boolean => {
    if (source?.kind !== 'tunnel') return false
    const eff = effective(c)
    return !eff.user || !eff.hasPassword
  }
  const missingCreds =
    tunnelNeedsCreds(master, masterCreds) ||
    replicas.some((r) => tunnelNeedsCreds(decode(r.source), r.creds))

  const patch = (key: string, change: Partial<DraftReplica>): void =>
    setReplicas((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)))
  const patchCreds = (key: string, change: Partial<DraftCreds>): void =>
    setReplicas((prev) => prev.map((r) => (r.key === key ? { ...r, creds: { ...r.creds, ...change } } : r)))

  /** hostId lưu kèm cả khi đi qua tunnel: lấy từ via-host của tunnel (để nhãn + lọc theo host). */
  const hostIdOf = (source: Source): string | null => {
    if (source.kind === 'host') return source.id
    return tunnels.find((x) => x.id === source.id)?.hostId ?? null
  }

  const submit = async (): Promise<void> => {
    const list: ReplReplicaInput[] = []
    for (const draft of replicas) {
      const source = decode(draft.source)
      if (!source) continue
      const hostId = hostIdOf(source)
      if (!hostId) {
        useToastsStore.getState().push(t('repl.field.tunnelGone'), 'error')
        return
      }
      list.push({
        id: draft.id,
        label: draft.label.trim(),
        hostId,
        tunnelId: source.kind === 'tunnel' ? source.id : null,
        dbPort: Number(draft.dbPort),
        dbUser: draft.creds.user.trim(),
        dbPassword: draft.creds.password
      })
    }
    if (list.length === 0) return

    setBusy(true)
    try {
      await savePair({
        id: pair?.id,
        name: name.trim() || t('repl.defaultName'),
        masterHostId: master ? hostIdOf(master) : null,
        masterTunnelId: master?.kind === 'tunnel' ? master.id : null,
        masterDbUser: masterCreds.user.trim(),
        masterDbPassword: masterCreds.password,
        replicas: list,
        dbPort: Number(dbPort),
        dbUser: dbUser.trim(),
        dbPassword,
        cliBinary: cliBinary.trim() || 'mysql',
        probeMode,
        pollIntervalSec: Number(pollIntervalSec),
        watchEnabled: pair?.watchEnabled ?? false
      })
      onClose()
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /** Select gộp Host SSH + Tunnel đã lưu — cùng câu hỏi "MySQL ở đâu", nên cùng một ô. */
  const sourceSelect = (value: string, onChange: (v: string) => void, emptyLabel: string, className = '') => (
    <Select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      <optgroup label={t('repl.field.groupHosts')}>
        {hosts.map((h) => (
          <option key={h.id} value={`host:${h.id}`}>
            {h.label}
          </option>
        ))}
      </optgroup>
      {tunnels.length > 0 && (
        <optgroup label={t('repl.field.groupTunnels')}>
          {tunnels.map((x) => (
            <option key={x.id} value={`tunnel:${x.id}`}>
              {tunnelLabel(x)}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  )

  /** Nút ⚙ mở/đóng ô credential riêng; tô sáng khi đầu đó ĐANG có credential riêng. */
  const credsToggle = (c: DraftCreds, onToggle: () => void) => {
    const overridden = Boolean(c.user.trim()) || c.hasSaved || (c.password !== undefined && c.password !== '')
    return (
      <button
        className={`shrink-0 rounded px-1.5 text-xs ${overridden ? 'text-accent-fg' : 'text-subtle hover:text-content'}`}
        title={overridden ? t('repl.field.credsOwnOn') : t('repl.field.credsOwn')}
        onClick={onToggle}
      >
        ⚙
      </button>
    )
  }

  /** Hai ô user/mật khẩu riêng của một đầu — để trống là kế thừa của cụm. */
  const credsRow = (c: DraftCreds, set: (change: Partial<DraftCreds>) => void) => (
    <div className="border-edge/60 mt-1 mb-1 flex flex-wrap items-center gap-2 rounded border border-dashed px-2 py-1.5">
      <span className="text-subtle shrink-0 text-[10px] tracking-wide uppercase">{t('repl.field.credsOwn')}</span>
      <TextInput
        className="!w-40"
        value={c.user}
        placeholder={dbUser.trim() || t('repl.field.credsInherit')}
        onChange={(e) => set({ user: e.target.value })}
      />
      <TextInput
        className="!w-40"
        type="password"
        value={c.password ?? ''}
        placeholder={c.hasSaved ? t('repl.field.passwordKeep') : t('repl.field.credsInherit')}
        onChange={(e) => set({ password: e.target.value })}
      />
      <span className="text-subtle text-[10px]">{t('repl.field.credsInheritHint')}</span>
    </div>
  )

  return (
    <Modal title={pair ? t('repl.editPair') : t('repl.addPair')} onClose={onClose} closeOnBackdrop={false}>
      <div className="w-[660px] max-w-full">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3">
          <Field label={t('repl.field.name')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t('repl.field.namePh')} />
          </Field>
          <Field label={anyHost ? t('repl.field.dbPort') : t('repl.field.dbPortUnused')}>
            <TextInput
              className="!w-24"
              value={dbPort}
              inputMode="numeric"
              disabled={!anyHost}
              onChange={(e) => setDbPort(e.target.value)}
            />
          </Field>
          <Field label={t('repl.field.pollInterval')}>
            <TextInput
              className="!w-24"
              value={pollIntervalSec}
              inputMode="numeric"
              onChange={(e) => setPollIntervalSec(e.target.value)}
            />
          </Field>
        </div>

        <Field label={t('repl.field.masterTarget')}>
          <div className="flex items-center gap-1.5">
            {sourceSelect(masterSel, setMasterSel, t('repl.field.masterNone'), '!min-w-0 !flex-1')}
            {credsToggle(masterCreds, () => setMasterCreds({ ...masterCreds, open: !masterCreds.open }))}
          </div>
        </Field>
        {masterCreds.open && credsRow(masterCreds, (change) => setMasterCreds({ ...masterCreds, ...change }))}
        <p className="text-subtle -mt-1 mb-3 text-[10px] leading-relaxed">{t('repl.field.masterHint')}</p>

        {/* --- Danh sách slave --------------------------------------------- */}
        <div className="mb-1 flex items-center justify-between">
          <span className="text-muted text-[11px] font-medium tracking-wide uppercase">
            {t('repl.field.replicaList', { n: filled.length })}
          </span>
          <Button
            className="!px-2 !py-0.5 !text-xs"
            onClick={() => setReplicas((prev) => [...prev, newDraft(dbPort)])}
          >
            + {t('repl.field.addReplica')}
          </Button>
        </div>
        <p className="text-subtle mb-2 text-[10px] leading-relaxed">{t('repl.field.replicaListHint')}</p>

        <div className="border-edge mb-3 flex max-h-[34vh] flex-col gap-1.5 overflow-y-auto rounded border p-2">
          {replicas.map((draft, i) => (
            <div key={draft.key}>
              <div className="flex items-center gap-1.5">
                <span className="text-subtle w-4 shrink-0 text-right text-[10px]">{i + 1}</span>
                <TextInput
                  className="!w-28 shrink-0"
                  value={draft.label}
                  placeholder={t('repl.field.replicaLabelPh')}
                  onChange={(e) => patch(draft.key, { label: e.target.value })}
                />
                {sourceSelect(
                  draft.source,
                  (v) => patch(draft.key, { source: v }),
                  t('repl.field.choose'),
                  '!min-w-0 !flex-1'
                )}
                <TextInput
                  className="!w-20 shrink-0"
                  value={draft.dbPort}
                  inputMode="numeric"
                  disabled={decode(draft.source)?.kind === 'tunnel'}
                  onChange={(e) => patch(draft.key, { dbPort: e.target.value })}
                />
                {credsToggle(draft.creds, () => patchCreds(draft.key, { open: !draft.creds.open }))}
                <button
                  className="text-subtle hover:text-danger shrink-0 rounded px-1.5 text-xs disabled:opacity-30"
                  title={t('repl.field.removeReplica')}
                  disabled={replicas.length === 1}
                  onClick={() => setReplicas((prev) => prev.filter((r) => r.key !== draft.key))}
                >
                  ✕
                </button>
              </div>
              {draft.creds.open && (
                <div className="ml-5">{credsRow(draft.creds, (change) => patchCreds(draft.key, change))}</div>
              )}
            </div>
          ))}
        </div>

        {tunnels.length === 0 && (
          <p className="text-subtle -mt-2 mb-3 text-[10px] leading-relaxed">{t('repl.field.noTunnels')}</p>
        )}
        {anyTunnel && (
          <p className="text-warning -mt-2 mb-3 text-[10px] leading-relaxed">{t('repl.field.tunnelHint')}</p>
        )}

        <div className="grid grid-cols-2 gap-x-3">
          <Field label={t('repl.field.dbUser')}>
            <TextInput
              value={dbUser}
              onChange={(e) => setDbUser(e.target.value)}
              placeholder={t('repl.field.dbUserPh')}
            />
          </Field>
          <Field label={t('repl.field.dbPassword')}>
            <TextInput
              type="password"
              value={dbPassword ?? ''}
              onChange={(e) => setDbPassword(e.target.value)}
              placeholder={pair?.hasDbPassword ? t('repl.field.passwordKeep') : t('repl.field.passwordPh')}
            />
          </Field>
        </div>
        <p className="text-subtle -mt-1 mb-3 text-[10px] leading-relaxed">{t('repl.field.credHint')}</p>

        <div className="grid grid-cols-2 gap-x-3">
          <Field label={t('repl.field.probeMode')}>
            <Select
              value={anyTunnel && !anyHost ? 'driver' : probeMode}
              disabled={anyTunnel && !anyHost}
              onChange={(e) => setProbeMode(e.target.value as ReplProbeMode)}
            >
              <option value="auto">{t('repl.mode.auto')}</option>
              <option value="driver">{t('repl.mode.driver')}</option>
              <option value="cli">{t('repl.mode.cli')}</option>
            </Select>
          </Field>
          <Field label={t('repl.field.cliBinary')}>
            <Select value={cliBinary} disabled={!anyHost} onChange={(e) => setCliBinary(e.target.value)}>
              <option value="mysql">mysql</option>
              <option value="mariadb">mariadb</option>
            </Select>
          </Field>
        </div>

        <p className="text-subtle mb-3 text-[10px] leading-relaxed">{t('repl.field.grantHint')}</p>

        {missingCreds && (
          <p className="text-danger mb-2 text-[11px] leading-relaxed">{t('repl.field.tunnelCredMissing')}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={filled.length === 0 || busy || missingCreds}
            onClick={() => void submit()}
          >
            {busy ? '…' : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
