import { useEffect, useMemo, useState } from 'react'
import type { CloudAccountDto, CloudInstanceDto, CloudProvider, DoAccountDto } from '@infra/shared'
import { Button, Field, Modal, Select, TextArea, TextInput } from './ui'
import { useT } from '../i18n'
import { useDataStore } from '../stores/data'
import { errorMessage, useToastsStore } from '../stores/toasts'

/** Sentinel cho option "tạo group mới" — cùng khuôn NEW_GROUP của form host. */
const NEW_GROUP = '__new__'
/** Sentinel cho option "thêm tài khoản mới" trong picker tài khoản. */
const NEW_ACCOUNT = '__newaccount__'

type Provider = 'do' | CloudProvider

const PROVIDERS: ReadonlyArray<{ key: Provider; label: string }> = [
  { key: 'do', label: 'DigitalOcean' },
  { key: 'aws', label: 'AWS EC2' },
  { key: 'gcp', label: 'Google Cloud' },
  { key: 'azure', label: 'Azure' }
]

/** Tên group mặc định + nhãn nguồn ghi vào notes, theo provider. */
const GROUP_NAME: Record<Provider, string> = { do: 'DigitalOcean', aws: 'AWS', gcp: 'GCP', azure: 'Azure' }
const SOURCE_LABEL: Record<Provider, string | undefined> = {
  do: undefined, // giữ format notes cũ của DigitalOcean
  aws: 'AWS EC2',
  gcp: 'GCP Compute',
  azure: 'Azure VM'
}

/**
 * F05 — Cloud import: DigitalOcean / AWS EC2 / GCP Compute / Azure VM trong MỘT hộp thoại.
 *
 * Mỗi provider một danh bạ tài khoản (credentials mã hoá DEK trong vault, không bao giờ về
 * renderer), cùng chung phần xem trước + import: mọi provider được parse về một DTO
 * (CloudInstanceDto) nên danh sách, dedupe theo địa chỉ và đường tạo host là một.
 * Tài khoản mới CHỈ được giữ lại sau khi lấy danh sách thành công — credentials gõ nhầm
 * không thành tài khoản rác (với AWS/GCP/Azure: lưu tạm để gọi, lỗi thì xoá ngay).
 */
export function CloudImportModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const groups = useDataStore((s) => s.groups)
  const keys = useDataStore((s) => s.keys)
  const refreshAll = useDataStore((s) => s.refreshAll)

  const [provider, setProvider] = useState<Provider>('do')
  const [doAccounts, setDoAccounts] = useState<DoAccountDto[]>([])
  const [cloudAccounts, setCloudAccounts] = useState<CloudAccountDto[]>([])
  const [accountChoice, setAccountChoice] = useState(NEW_ACCOUNT)
  const [accountLabel, setAccountLabel] = useState('')
  // Credentials của form thêm tài khoản — chỉ nằm trong state lúc gõ, lưu xong là xoá
  const [doToken, setDoToken] = useState('')
  const [awsRegion, setAwsRegion] = useState('')
  const [awsAccessKey, setAwsAccessKey] = useState('')
  const [awsSecretKey, setAwsSecretKey] = useState('')
  const [gcpKeyJson, setGcpKeyJson] = useState('')
  const [azTenant, setAzTenant] = useState('')
  const [azClient, setAzClient] = useState('')
  const [azSecret, setAzSecret] = useState('')
  const [azSubscription, setAzSubscription] = useState('')

  const [fetching, setFetching] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [instances, setInstances] = useState<CloudInstanceDto[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [groupChoice, setGroupChoice] = useState(NEW_GROUP)
  const [newGroupName, setNewGroupName] = useState(GROUP_NAME.do)
  const [username, setUsername] = useState('root')
  const [keyId, setKeyId] = useState('')
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<{ imported: number; skipped: number; noIp: number; group: string } | null>(null)

  const accountsOfProvider = useMemo(
    () =>
      provider === 'do'
        ? doAccounts.map((a) => ({ id: a.id, label: a.label }))
        : cloudAccounts.filter((a) => a.provider === provider).map((a) => ({ id: a.id, label: a.label })),
    [provider, doAccounts, cloudAccounts]
  )

  useEffect(() => {
    // Chạy đúng MỘT lần lúc mở; không đưa hàm nào vào deps (bài học vòng lặp effect v0.2.12)
    void (async () => {
      try {
        const [doCfg, cloud] = await Promise.all([
          window.infra.importer.doConfig(),
          window.infra.importer.cloudAccounts()
        ])
        setDoAccounts(doCfg.accounts)
        setCloudAccounts(cloud)
        if (doCfg.accounts.length > 0) setAccountChoice(doCfg.accounts[0]!.id)
      } catch {
        // vault khoá / main chưa sẵn sàng — modal vẫn mở được, lỗi lộ khi bấm
      }
    })()
  }, [])

  /** Đổi provider = đổi nguồn — danh sách máy và tài khoản đang chọn không được đứng lại. */
  const pickProvider = (next: Provider): void => {
    setProvider(next)
    const list =
      next === 'do' ? doAccounts : cloudAccounts.filter((a) => a.provider === next)
    setAccountChoice(list[0]?.id ?? NEW_ACCOUNT)
    setInstances(null)
    setWarnings([])
    setSelected(new Set())
    setListError(null)
    setDone(null)
    setNewGroupName(GROUP_NAME[next])
  }

  const pickAccount = (choice: string): void => {
    setAccountChoice(choice)
    setInstances(null)
    setWarnings([])
    setSelected(new Set())
    setListError(null)
    setDone(null)
  }

  const importable = (d: CloudInstanceDto): boolean => !d.exists && (d.publicIp !== null || d.privateIp !== null)
  const importableIds = useMemo(() => (instances ?? []).filter(importable).map((d) => d.id), [instances])

  const applyList = (list: CloudInstanceDto[], warns: string[]): void => {
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    setInstances(sorted)
    setWarnings(warns)
    setSelected(new Set(sorted.filter(importable).map((d) => d.id)))
  }

  /** Kiểm đủ trường của form tài khoản mới theo provider — trả JSON credentials + config. */
  const newAccountPayload = (): { config: Record<string, string>; secretJson: string } | null => {
    if (provider === 'aws') {
      if (!awsRegion.trim() || !awsAccessKey.trim() || !awsSecretKey) return null
      return {
        config: { region: awsRegion.trim() },
        secretJson: JSON.stringify({ accessKeyId: awsAccessKey.trim(), secretAccessKey: awsSecretKey })
      }
    }
    if (provider === 'gcp') {
      if (!gcpKeyJson.trim()) return null
      return { config: {}, secretJson: gcpKeyJson.trim() }
    }
    if (provider === 'azure') {
      if (!azTenant.trim() || !azClient.trim() || !azSecret || !azSubscription.trim()) return null
      return {
        config: { subscriptionId: azSubscription.trim() },
        secretJson: JSON.stringify({ tenantId: azTenant.trim(), clientId: azClient.trim(), clientSecret: azSecret })
      }
    }
    return null
  }

  const clearCredInputs = (): void => {
    setDoToken('')
    setAwsAccessKey('')
    setAwsSecretKey('')
    setGcpKeyJson('')
    setAzSecret('')
    setAccountLabel('')
  }

  const fetchList = async (): Promise<void> => {
    setFetching(true)
    setListError(null)
    setDone(null)
    try {
      if (provider === 'do') {
        const isNew = accountChoice === NEW_ACCOUNT
        const result = await window.infra.importer.doListDroplets(
          isNew ? { tokenOverride: doToken.trim() } : { accountId: accountChoice }
        )
        if (!result.ok) {
          setListError(
            `${t(`doImport.err.${result.error}` as 'doImport.err.noToken')}${result.detail ? ` (${result.detail})` : ''}`
          )
          return
        }
        applyList(result.droplets, result.warnings)
        if (isNew && doToken.trim()) {
          // Token chỉ lưu SAU khi gọi thành công — token gõ nhầm không thành tài khoản rác
          const saved = await window.infra.importer.doSaveAccount({
            label: accountLabel.trim() || GROUP_NAME.do,
            token: doToken.trim()
          })
          setDoAccounts((list) => [...list, saved])
          setAccountChoice(saved.id)
          clearCredInputs()
        }
        return
      }

      // AWS/GCP/Azure: tài khoản mới phải LƯU TẠM mới gọi được (credentials không đi qua
      // đường liệt kê) — lỗi thì XOÁ NGAY để giữ bất biến "chỉ giữ tài khoản đã chạy được"
      let accountId = accountChoice
      let created: CloudAccountDto | null = null
      if (accountChoice === NEW_ACCOUNT) {
        const payload = newAccountPayload()
        if (!payload) {
          setListError(t('cloudImport.errFields'))
          return
        }
        created = await window.infra.importer.cloudSaveAccount({
          label: accountLabel.trim() || PROVIDERS.find((p) => p.key === provider)!.label,
          provider: provider as CloudProvider,
          config: payload.config,
          secretJson: payload.secretJson
        })
        accountId = created.id
      }
      const result = await window.infra.importer.cloudListInstances(accountId)
      if (!result.ok) {
        if (created) await window.infra.importer.cloudDeleteAccount(created.id)
        setListError(
          `${t(`cloudImport.err.${result.error}` as 'cloudImport.err.auth')}${result.detail ? ` (${result.detail})` : ''}`
        )
        return
      }
      applyList(result.instances, result.warnings)
      if (created) {
        setCloudAccounts((list) => [...list, created])
        setAccountChoice(created.id)
        clearCredInputs()
      }
    } catch (error) {
      setListError(errorMessage(error))
    } finally {
      setFetching(false)
    }
  }

  const deleteAccount = async (): Promise<void> => {
    const id = accountChoice
    if (id === NEW_ACCOUNT) return
    try {
      if (provider === 'do') {
        await window.infra.importer.doDeleteAccount(id)
        setDoAccounts((list) => {
          const next = list.filter((a) => a.id !== id)
          pickAccount(next[0]?.id ?? NEW_ACCOUNT)
          return next
        })
      } else {
        await window.infra.importer.cloudDeleteAccount(id)
        setCloudAccounts((list) => {
          const next = list.filter((a) => a.id !== id)
          pickAccount(next.find((a) => a.provider === provider)?.id ?? NEW_ACCOUNT)
          return next
        })
      }
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runImport = async (): Promise<void> => {
    if (!instances || selected.size === 0) return
    setImporting(true)
    try {
      const chosen = instances.filter((d) => selected.has(d.id))
      const result = await window.infra.importer.doImport(chosen, {
        groupId: groupChoice === NEW_GROUP ? null : groupChoice,
        newGroupName: newGroupName.trim() || undefined,
        username: username.trim() || null,
        keyId: keyId || null,
        source: SOURCE_LABEL[provider]
      })
      await refreshAll()
      setDone({ imported: result.imported, skipped: result.skipped, noIp: result.noIp, group: result.groupName })
      for (const warning of result.warnings.slice(0, 3)) useToastsStore.getState().push(warning)
      // Đánh dấu tại chỗ các máy vừa import để bấm Import lần nữa không tạo bản trùng
      setInstances((list) =>
        list ? list.map((d) => (selected.has(d.id) && importable(d) ? { ...d, exists: true } : d)) : list
      )
      setSelected(new Set())
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  const isNewAccount = accountChoice === NEW_ACCOUNT

  /** Form credentials cho tài khoản MỚI, theo provider. */
  const newAccountForm = (
    <>
      {provider === 'do' && (
        <Field label={t('doImport.tokenLabel')}>
          <TextInput
            type="password"
            value={doToken}
            placeholder={t('doImport.tokenPlaceholder')}
            onChange={(e) => setDoToken(e.target.value)}
          />
          <span className="text-subtle mt-1 block text-[11px] normal-case">{t('doImport.tokenHint')}</span>
        </Field>
      )}
      {provider === 'aws' && (
        <>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label={t('cloudImport.aws.region')}>
              <TextInput value={awsRegion} onChange={(e) => setAwsRegion(e.target.value)} placeholder="ap-southeast-1" />
            </Field>
            <Field label={t('cloudImport.aws.accessKey')}>
              <TextInput value={awsAccessKey} onChange={(e) => setAwsAccessKey(e.target.value)} />
            </Field>
          </div>
          <Field label={t('cloudImport.aws.secretKey')}>
            <TextInput type="password" value={awsSecretKey} onChange={(e) => setAwsSecretKey(e.target.value)} />
          </Field>
          <p className="text-subtle mb-2 text-[11px]">{t('cloudImport.aws.hint')}</p>
        </>
      )}
      {provider === 'gcp' && (
        <>
          <Field label={t('cloudImport.gcp.keyJson')}>
            <TextArea rows={5} value={gcpKeyJson} onChange={(e) => setGcpKeyJson(e.target.value)} placeholder='{"type":"service_account", …}' />
          </Field>
          <p className="text-subtle mb-2 text-[11px]">{t('cloudImport.gcp.hint')}</p>
        </>
      )}
      {provider === 'azure' && (
        <>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label={t('cloudImport.az.tenant')}>
              <TextInput value={azTenant} onChange={(e) => setAzTenant(e.target.value)} />
            </Field>
            <Field label={t('cloudImport.az.client')}>
              <TextInput value={azClient} onChange={(e) => setAzClient(e.target.value)} />
            </Field>
            <Field label={t('cloudImport.az.secret')}>
              <TextInput type="password" value={azSecret} onChange={(e) => setAzSecret(e.target.value)} />
            </Field>
            <Field label={t('cloudImport.az.subscription')}>
              <TextInput value={azSubscription} onChange={(e) => setAzSubscription(e.target.value)} />
            </Field>
          </div>
          <p className="text-subtle mb-2 text-[11px]">{t('cloudImport.az.hint')}</p>
        </>
      )}
      <Field label={t('doImport.accountName')}>
        <TextInput
          value={accountLabel}
          placeholder={t('doImport.accountNamePh')}
          onChange={(e) => setAccountLabel(e.target.value)}
        />
        <span className="text-muted mt-1 block text-[11px] normal-case">{t('cloudImport.saveNote')}</span>
      </Field>
    </>
  )

  const canFetch =
    !fetching &&
    (!isNewAccount ||
      (provider === 'do' ? doToken.trim() !== '' : newAccountPayload() !== null))

  return (
    <Modal title={t('doImport.title')} onClose={onClose} closeOnBackdrop={false}>
      <div className="w-[640px] max-w-full">
        <p className="text-muted mb-3 text-xs leading-relaxed">{t('doImport.desc')}</p>

        <Field label={t('cloudImport.provider')}>
          <div className="grid grid-cols-4 gap-1.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => pickProvider(p.key)}
                className={`cursor-pointer rounded border px-2 py-1.5 text-xs ${
                  provider === p.key
                    ? 'border-accent bg-accent-soft/40 text-content'
                    : 'border-edge-strong text-muted hover:bg-hover'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('doImport.accountLabel')}>
          <div className="flex items-center gap-2">
            <Select value={accountChoice} onChange={(e) => pickAccount(e.target.value)}>
              {accountsOfProvider.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
              <option value={NEW_ACCOUNT}>{t('cloudImport.accountNew')}</option>
            </Select>
            {!isNewAccount && (
              <button
                type="button"
                className="text-subtle hover:text-danger shrink-0 text-xs underline"
                onClick={() => void deleteAccount()}
              >
                {t('doImport.accountDelete')}
              </button>
            )}
          </div>
        </Field>

        {isNewAccount && newAccountForm}

        <div className="mb-3">
          <Button variant="primary" disabled={!canFetch} onClick={() => void fetchList()}>
            {fetching ? t('doImport.fetching') : t('doImport.fetch')}
          </Button>
        </div>

        {listError && <p className="text-danger mb-3 text-xs whitespace-pre-line">{listError}</p>}
        {warnings.map((warning) => (
          <p key={warning} className="text-warning mb-1 text-[11px]">
            {warning}
          </p>
        ))}

        {instances && instances.length === 0 && <p className="text-muted mb-3 text-xs">{t('doImport.empty')}</p>}

        {instances && instances.length > 0 && (
          <>
            <div className="mb-1.5 flex items-center gap-2 text-[11px]">
              <span className="text-muted flex-1">
                {t('doImport.found', { n: instances.length, sel: selected.size })}
              </span>
              <button
                type="button"
                className="text-subtle hover:text-content underline"
                onClick={() => setSelected(new Set(importableIds))}
              >
                {t('doImport.selectAll')}
              </button>
              <button
                type="button"
                className="text-subtle hover:text-content underline"
                onClick={() => setSelected(new Set())}
              >
                {t('doImport.selectNone')}
              </button>
            </div>

            <div className="border-edge-strong mb-3 max-h-64 overflow-y-auto rounded border">
              {instances.map((d) => {
                const address = d.publicIp ?? d.privateIp
                const disabled = !importable(d)
                return (
                  <label
                    key={d.id}
                    className={`border-edge flex items-center gap-2 border-b px-2 py-1.5 text-xs last:border-b-0 ${
                      disabled ? 'opacity-50' : 'hover:bg-hover cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={selected.has(d.id)}
                      onChange={() => toggle(d.id)}
                    />
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${d.status === 'active' ? 'bg-success' : 'bg-subtle'}`}
                      title={d.status || '?'}
                    />
                    <span className="text-content min-w-0 flex-1 truncate font-medium" title={d.name}>
                      {d.name}
                    </span>
                    <span className="text-muted font-mono">{address ?? '—'}</span>
                    {d.publicIp === null && d.privateIp !== null && (
                      <span className="text-warning text-[10px]">{t('doImport.privateOnly')}</span>
                    )}
                    {address === null && <span className="text-warning text-[10px]">{t('doImport.noIp')}</span>}
                    {d.exists && <span className="text-subtle text-[10px]">{t('doImport.exists')}</span>}
                    <span className="text-subtle w-24 truncate text-right" title={`${d.region} ${d.sizeSlug}`.trim()}>
                      {d.region}
                    </span>
                  </label>
                )
              })}
            </div>

            <div className="mb-3 grid grid-cols-2 gap-x-3">
              <Field label={t('doImport.groupLabel')}>
                <Select value={groupChoice} onChange={(e) => setGroupChoice(e.target.value)}>
                  <option value={NEW_GROUP}>{t('doImport.groupNew')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
                {groupChoice === NEW_GROUP && (
                  <TextInput
                    className="mt-1.5"
                    value={newGroupName}
                    placeholder={GROUP_NAME[provider]}
                    onChange={(e) => setNewGroupName(e.target.value)}
                  />
                )}
              </Field>
              <div>
                <Field label={t('doImport.userLabel')}>
                  <TextInput value={username} onChange={(e) => setUsername(e.target.value)} />
                  <span className="text-subtle mt-1 block text-[11px] normal-case">{t('doImport.userHint')}</span>
                </Field>
                <Field label={t('doImport.keyLabel')}>
                  <Select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
                    <option value="">{t('doImport.keyNone')}</option>
                    {keys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>

            {done && (
              <p className="text-success mb-2 text-xs">
                {t('doImport.done', { n: done.imported, group: done.group })}
                {done.skipped > 0 ? ` ${t('doImport.doneSkipped', { n: done.skipped })}` : ''}
                {done.noIp > 0 ? ` ${t('doImport.doneNoIp', { n: done.noIp })}` : ''}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>{t('common.close')}</Button>
              <Button variant="primary" disabled={importing || selected.size === 0} onClick={() => void runImport()}>
                {importing ? t('doImport.running') : t('doImport.run', { n: selected.size })}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
