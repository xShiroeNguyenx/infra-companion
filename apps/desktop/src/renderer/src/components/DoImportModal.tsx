import { useEffect, useMemo, useState } from 'react'
import type { DoDropletDto, DoListErrorKind } from '@infra/shared'
import { Button, Field, Modal, Select, TextInput } from './ui'
import { useT } from '../i18n'
import { useDataStore } from '../stores/data'
import { errorMessage, useToastsStore } from '../stores/toasts'

/** Sentinel cho option "tạo group mới" — cùng khuôn NEW_GROUP của form host. */
const NEW_GROUP = '__new__'
/** Trùng DO_DEFAULT_GROUP_NAME bên @infra/core — renderer không import được core (§5). */
const DEFAULT_GROUP_NAME = 'DigitalOcean'

/**
 * F05 — import host từ DigitalOcean.
 *
 * Hai bước trong một hộp thoại: (1) token → lấy danh sách droplet, (2) tick chọn → tạo host.
 * Token chỉ được LƯU (mã hoá trong vault) sau khi gọi API thành công — token gõ nhầm không
 * ghi đè token đúng đang lưu. Token thật không bao giờ về renderer, ở đây chỉ có `hasToken`.
 * Droplet đã có host trùng địa chỉ bị khoá chọn — import lại không nhân đôi danh sách host.
 */
export function DoImportModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const groups = useDataStore((s) => s.groups)
  const keys = useDataStore((s) => s.keys)
  const refreshAll = useDataStore((s) => s.refreshAll)

  const [hasToken, setHasToken] = useState(false)
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [listError, setListError] = useState<{ kind: DoListErrorKind; detail?: string } | null>(null)
  const [droplets, setDroplets] = useState<DoDropletDto[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [groupChoice, setGroupChoice] = useState(NEW_GROUP)
  const [newGroupName, setNewGroupName] = useState(DEFAULT_GROUP_NAME)
  const [username, setUsername] = useState('root')
  const [keyId, setKeyId] = useState('')
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<{ imported: number; skipped: number; noIp: number; group: string } | null>(null)

  useEffect(() => {
    // Chạy đúng MỘT lần lúc mở; không đưa hàm nào vào deps (bài học vòng lặp effect v0.2.12)
    void window.infra.importer
      .doConfig()
      .then((cfg) => setHasToken(cfg.hasToken))
      .catch(() => {})
  }, [])

  const importable = (d: DoDropletDto): boolean => !d.exists && (d.publicIp !== null || d.privateIp !== null)
  const importableIds = useMemo(() => (droplets ?? []).filter(importable).map((d) => d.id), [droplets])

  const fetchList = async (): Promise<void> => {
    setFetching(true)
    setListError(null)
    setDone(null)
    try {
      const result = await window.infra.importer.doListDroplets(token.trim() || undefined)
      if (!result.ok) {
        setListError({ kind: result.error, detail: result.detail })
        return
      }
      const sorted = [...result.droplets].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      )
      setDroplets(sorted)
      setWarnings(result.warnings)
      setSelected(new Set(sorted.filter(importable).map((d) => d.id)))
      if (token.trim() && remember) {
        await window.infra.importer.doSetToken(token.trim())
        setHasToken(true)
        setToken('')
      }
    } catch (error) {
      setListError({ kind: 'network', detail: errorMessage(error) })
    } finally {
      setFetching(false)
    }
  }

  const deleteToken = async (): Promise<void> => {
    try {
      await window.infra.importer.doSetToken('')
      setHasToken(false)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  const toggle = (id: number): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runImport = async (): Promise<void> => {
    if (!droplets || selected.size === 0) return
    setImporting(true)
    try {
      const chosen = droplets.filter((d) => selected.has(d.id))
      const result = await window.infra.importer.doImport(chosen, {
        groupId: groupChoice === NEW_GROUP ? null : groupChoice,
        newGroupName: newGroupName.trim() || undefined,
        username: username.trim() || null,
        keyId: keyId || null
      })
      await refreshAll()
      setDone({ imported: result.imported, skipped: result.skipped, noIp: result.noIp, group: result.groupName })
      for (const warning of result.warnings.slice(0, 3)) useToastsStore.getState().push(warning)
      // Đánh dấu tại chỗ các droplet vừa import để bấm Import lần nữa không tạo bản trùng
      setDroplets((list) =>
        list ? list.map((d) => (selected.has(d.id) && importable(d) ? { ...d, exists: true } : d)) : list
      )
      setSelected(new Set())
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal title={t('doImport.title')} onClose={onClose} closeOnBackdrop={false}>
      <div className="w-[620px] max-w-full">
        <p className="text-muted mb-3 text-xs leading-relaxed">{t('doImport.desc')}</p>

        {hasToken ? (
          <div className="mb-3 flex items-center gap-2 text-xs">
            <span className="text-success">✓ {t('doImport.tokenSaved')}</span>
            <button type="button" className="text-subtle hover:text-danger underline" onClick={() => void deleteToken()}>
              {t('doImport.tokenDelete')}
            </button>
          </div>
        ) : (
          <Field label={t('doImport.tokenLabel')}>
            <TextInput
              type="password"
              value={token}
              placeholder={t('doImport.tokenPlaceholder')}
              autoFocus
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !fetching) void fetchList()
              }}
            />
            <span className="text-subtle mt-1 block text-[11px] normal-case">{t('doImport.tokenHint')}</span>
            <span className="mt-1 flex items-center gap-1.5 text-[11px] normal-case">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="text-muted">{t('doImport.tokenRemember')}</span>
            </span>
          </Field>
        )}

        <div className="mb-3">
          <Button variant="primary" disabled={fetching || (!hasToken && token.trim() === '')} onClick={() => void fetchList()}>
            {fetching ? t('doImport.fetching') : t('doImport.fetch')}
          </Button>
        </div>

        {listError && (
          <p className="text-danger mb-3 text-xs">
            {t(`doImport.err.${listError.kind}` as 'doImport.err.noToken')}
            {listError.detail ? ` (${listError.detail})` : ''}
          </p>
        )}
        {warnings.map((warning) => (
          <p key={warning} className="text-warning mb-1 text-[11px]">
            {warning}
          </p>
        ))}

        {droplets && droplets.length === 0 && <p className="text-muted mb-3 text-xs">{t('doImport.empty')}</p>}

        {droplets && droplets.length > 0 && (
          <>
            <div className="mb-1.5 flex items-center gap-2 text-[11px]">
              <span className="text-muted flex-1">
                {t('doImport.found', { n: droplets.length, sel: selected.size })}
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
              {droplets.map((d) => {
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
                      title={d.status}
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
                    <span className="text-subtle w-12 truncate text-right" title={d.image}>
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
                    placeholder={DEFAULT_GROUP_NAME}
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
