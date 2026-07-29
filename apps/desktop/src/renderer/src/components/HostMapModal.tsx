import { useEffect, useState } from 'react'
import type { HostMapGroupDto, HostMapTargetDto } from '@infra/shared'
import { useHostmapStore } from '../stores/hostmap'
import { useDataStore } from '../stores/data'
import { Button, ConfirmModal, Field, Modal, Select, TextArea, TextInput } from './ui'
import { useT } from '../i18n'

/**
 * HostMap — "đổi IP của domain" để test đúng 1 server trong cụm load balance.
 *
 * KHÔNG sửa file hosts và KHÔNG cần quyền admin: app mở browser Chromium với
 * `--host-resolver-rules` nên DNS chỉ bị ghi đè trong cửa sổ đó, hostname giữ nguyên (cert vẫn
 * khớp), và mở song song được nhiều cửa sổ tới nhiều server — thứ file hosts không làm được.
 */

const uid = (): string => Math.random().toString(36).slice(2, 10)

/** IPv4/IPv6 thô — chỉ để UI cảnh báo sớm; main mới là chỗ validate thật (net.isIP). */
const looksLikeIp = (s: string): boolean => /^[0-9.]+$/.test(s) || s.includes(':')

export function HostMapModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { groups, browsers, profilesBytes, loaded, busyGroupId, refresh, deleteGroup, setActive, open, openAll, copyCurl, clearProfiles } =
    useHostmapStore()
  const [mode, setMode] = useState<'list' | 'edit'>('list')
  const [editing, setEditing] = useState<HostMapGroupDto | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<HostMapGroupDto | null>(null)

  useEffect(() => {
    if (!loaded) void refresh()
  }, [loaded, refresh])

  const openNew = (): void => {
    setEditing(null)
    setMode('edit')
  }

  if (mode === 'edit') {
    return (
      <GroupForm
        group={editing}
        onDone={() => {
          setMode('list')
          setEditing(null)
        }}
      />
    )
  }

  return (
    <Modal title={t('hostmap.title')} onClose={onClose}>
      <div className="w-[560px] max-w-full">
        <p className="text-subtle mb-3 text-[11px] leading-relaxed">{t('hostmap.hint')}</p>

        {browsers.length === 0 && loaded && (
          <p className="border-warning/40 bg-warning/5 text-warning mb-3 rounded border px-2 py-1.5 text-[11px] leading-relaxed">
            {t('hostmap.noBrowser')}
          </p>
        )}

        <div className="max-h-[24rem] overflow-y-auto">
          {loaded && groups.length === 0 && (
            <p className="text-subtle py-6 text-center text-xs">{t('hostmap.empty')}</p>
          )}

          {groups.map((g) => {
            const busy = busyGroupId === g.id
            return (
              <div key={g.id} className="border-edge bg-input mb-2 rounded border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-content min-w-0 flex-1 truncate text-xs font-medium">{g.name}</span>
                  <span className="text-subtle shrink-0 text-[10px]">
                    {t('hostmap.countDomains', { n: String(g.patterns.length) })}
                  </span>
                  <button
                    className="border-edge-strong text-muted hover:bg-hover shrink-0 rounded border px-2 py-0.5 text-[11px]"
                    onClick={() => {
                      setEditing(g)
                      setMode('edit')
                    }}
                  >
                    {t('hostmap.edit')}
                  </button>
                  <button
                    className="border-edge-strong text-muted hover:text-danger hover:border-danger/50 shrink-0 rounded border px-2 py-0.5 text-[11px]"
                    onClick={() => setConfirmDelete(g)}
                  >
                    {t('hostmap.delete')}
                  </button>
                </div>

                <p className="text-subtle mt-1 truncate font-mono text-[10px]" title={g.patterns.join(', ')}>
                  {g.patterns.join(', ') || '—'}
                </p>

                {/* Chip server: bấm = chọn (không mở gì) — đây là thao tác dùng nhiều nhất */}
                <div className="mt-2 flex flex-wrap gap-1">
                  {g.targets.length === 0 && <span className="text-subtle text-[11px]">{t('hostmap.noTarget')}</span>}
                  {g.targets.map((tg) => {
                    const active = tg.id === g.activeTargetId
                    return (
                      <button
                        key={tg.id}
                        title={tg.ip}
                        className={`rounded border px-2 py-0.5 text-[11px] ${
                          active
                            ? 'border-accent/60 bg-accent-soft/50 text-accent-fg'
                            : 'border-edge-strong text-muted hover:bg-hover'
                        }`}
                        onClick={() => void setActive(g.id, tg.id)}
                      >
                        {active ? '● ' : ''}
                        {tg.label}
                      </button>
                    )
                  })}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button
                    variant="primary"
                    className="!px-2 !py-1 !text-xs"
                    disabled={busy || g.activeTargetId === null || browsers.length === 0}
                    onClick={() => void open(g.id)}
                  >
                    {busy ? '…' : t('hostmap.open')}
                  </Button>
                  <Button
                    className="!px-2 !py-1 !text-xs"
                    disabled={busy || g.targets.length < 2 || browsers.length === 0}
                    title={t('hostmap.openAllHint')}
                    onClick={() => void openAll(g.id)}
                  >
                    {t('hostmap.openAll', { n: String(g.targets.length) })}
                  </Button>
                  <Button
                    className="!px-2 !py-1 !text-xs"
                    disabled={g.activeTargetId === null}
                    title={t('hostmap.curlHint')}
                    onClick={() => void copyCurl(g.id)}
                  >
                    {t('hostmap.curl')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="border-edge mt-3 flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-subtle text-[10px]">
            {t('hostmap.profiles', { mb: String(Math.round(profilesBytes / 1e6)) })}{' '}
            {profilesBytes > 0 && (
              <button className="hover:text-danger underline" onClick={() => void clearProfiles()}>
                {t('hostmap.clearProfiles')}
              </button>
            )}
          </span>
          <Button variant="primary" className="!px-2 !py-1 !text-xs" onClick={openNew}>
            {t('hostmap.add')}
          </Button>
        </div>
      </div>

      {confirmDelete !== null && (
        <ConfirmModal
          title={t('hostmap.deleteTitle')}
          message={<p>{t('hostmap.deleteMsg', { name: confirmDelete.name })}</p>}
          confirmLabel={t('hostmap.delete')}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const id = confirmDelete.id
            setConfirmDelete(null)
            void deleteGroup(id)
          }}
        />
      )}
    </Modal>
  )
}

/** Form thêm/sửa 1 nhóm: domain (mỗi dòng 1) + danh sách server đích. */
function GroupForm({ group, onDone }: { group: HostMapGroupDto | null; onDone: () => void }) {
  const t = useT()
  const saveGroup = useHostmapStore((s) => s.saveGroup)
  const browsers = useHostmapStore((s) => s.browsers)
  const hosts = useDataStore((s) => s.hosts)

  const [name, setName] = useState(group?.name ?? '')
  const [patternsText, setPatternsText] = useState((group?.patterns ?? []).join('\n'))
  const [targets, setTargets] = useState<HostMapTargetDto[]>(group?.targets ?? [])
  const [url, setUrl] = useState(group?.url ?? '')
  const [browserId, setBrowserId] = useState(group?.browserId ?? '')
  const [error, setError] = useState<string | null>(null)

  /** Server đã lưu trong app mà hostname là IP → thêm được trực tiếp làm đích. */
  const ipHosts = hosts.filter((h) => looksLikeIp(h.hostname))

  const patterns = patternsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const setTarget = (i: number, patch: Partial<HostMapTargetDto>): void =>
    setTargets((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const submit = async (): Promise<void> => {
    setError(null)
    if (name.trim().length === 0) return setError(t('hostmap.errName'))
    if (patterns.length === 0) return setError(t('hostmap.errDomains'))
    const clean = targets
      .map((x) => ({ ...x, label: x.label.trim() || x.ip.trim(), ip: x.ip.trim() }))
      .filter((x) => x.ip.length > 0)
    if (clean.length === 0) return setError(t('hostmap.errTargets'))
    const ok = await saveGroup({
      ...(group ? { id: group.id } : {}),
      name: name.trim(),
      patterns,
      targets: clean,
      activeTargetId: clean.some((x) => x.id === group?.activeTargetId) ? group!.activeTargetId : (clean[0]?.id ?? null),
      url: url.trim().length > 0 ? url.trim() : null,
      browserId: browserId.length > 0 ? browserId : null
    })
    if (ok) onDone()
  }

  return (
    <Modal title={group ? t('hostmap.editTitle') : t('hostmap.addTitle')} onClose={onDone}>
      <div className="w-[520px] max-w-full">
        <Field label={t('hostmap.name')}>
          <TextInput value={name} placeholder={t('hostmap.namePh')} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label={t('hostmap.domains')}>
          <TextArea
            rows={5}
            value={patternsText}
            placeholder={'www.webike.pk\nvn.webike.net\n*.webike.net'}
            onChange={(e) => setPatternsText(e.target.value)}
          />
        </Field>
        <p className="text-subtle -mt-1.5 mb-2.5 text-[10px] leading-relaxed">{t('hostmap.domainsHint')}</p>

        <span className="text-muted mb-1 block text-[11px] font-medium tracking-wide uppercase">
          {t('hostmap.targets')}
        </span>
        {targets.map((tg, i) => (
          <div key={tg.id} className="mb-1.5 flex items-center gap-1.5">
            <TextInput
              className="!w-40"
              value={tg.label}
              placeholder={t('hostmap.targetLabelPh')}
              onChange={(e) => setTarget(i, { label: e.target.value })}
            />
            <TextInput
              className="flex-1"
              value={tg.ip}
              placeholder="59.106.231.202"
              onChange={(e) => setTarget(i, { ip: e.target.value })}
            />
            <button
              className="border-edge-strong text-muted hover:text-danger hover:border-danger/50 shrink-0 rounded border px-2 py-1 text-[11px]"
              title={t('hostmap.removeTarget')}
              onClick={() => setTargets((prev) => prev.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}

        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <Button
            className="!px-2 !py-1 !text-xs"
            onClick={() => setTargets((prev) => [...prev, { id: uid(), label: '', ip: '' }])}
          >
            {t('hostmap.addTarget')}
          </Button>
          {ipHosts.length > 0 && (
            <Select
              className="!w-auto !text-xs"
              value=""
              onChange={(e) => {
                const h = ipHosts.find((x) => x.id === e.target.value)
                if (h) setTargets((prev) => [...prev, { id: uid(), label: h.label, ip: h.hostname }])
              }}
            >
              <option value="">{t('hostmap.fromServer')}</option>
              {ipHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label} — {h.hostname}
                </option>
              ))}
            </Select>
          )}
        </div>

        <Field label={t('hostmap.url')}>
          <TextInput
            value={url}
            placeholder={patterns[0] ? `https://${patterns[0].replace(/^\*\./, '')}/` : 'https://…'}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>

        <Field label={t('hostmap.browser')}>
          <Select value={browserId} onChange={(e) => setBrowserId(e.target.value)}>
            <option value="">{t('hostmap.browserAuto')}</option>
            {browsers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>

        {error !== null && <p className="text-danger mb-2 text-[11px]">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button className="!px-3 !py-1 !text-xs" onClick={onDone}>
            {t('hostmap.cancel')}
          </Button>
          <Button variant="primary" className="!px-3 !py-1 !text-xs" onClick={() => void submit()}>
            {t('hostmap.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
