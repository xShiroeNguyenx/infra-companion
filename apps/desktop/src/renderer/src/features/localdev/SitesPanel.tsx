import { useCallback, useEffect, useState } from 'react'
import type { LdSiteDto, LdWpConfigDto } from '@infra/shared'
import { useLocaldevStore } from '../../stores/localdev'
import { useTabsStore } from '../../stores/tabs'
import { Button, ConfirmModal, TextInput } from '../../components/ui'
import { useT } from '../../i18n'

/**
 * Danh sách site local + thêm site trỏ vào FOLDER CÓ SẴN (M1).
 * Site do user trỏ vào có `createdByApp=false` ⇒ app không bao giờ xoá file của họ; nút Xoá
 * chỉ bỏ khỏi danh sách.
 */
export function SitesPanel() {
  const t = useT()
  const sites = useLocaldevStore((s) => s.sites)
  const addSite = useLocaldevStore((s) => s.addSite)
  const deleteSite = useLocaldevStore((s) => s.deleteSite)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<LdSiteDto | null>(null)

  const pick = async (): Promise<void> => {
    const dir = await window.infra.localdev.sitePickFolder()
    if (!dir) return
    setRootPath(dir)
    // Gợi ý tên từ tên thư mục để user không phải gõ
    if (!name.trim()) setName(dir.split(/[\\/]/).filter(Boolean).pop() ?? '')
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const created = await addSite(name.trim(), rootPath.trim())
      if (created) {
        setAdding(false)
        setName('')
        setRootPath('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-subtle text-[11px]">{t('localdev.site.hint')}</p>
        {!adding && (
          <Button className="!px-2 !py-1 !text-xs" onClick={() => setAdding(true)}>
            + {t('localdev.site.add')}
          </Button>
        )}
      </div>

      {adding && (
        <div className="border-edge bg-input space-y-2 rounded border p-3">
          <div>
            <div className="text-subtle mb-1 text-[10px] font-semibold tracking-wide uppercase">
              {t('localdev.site.folder')}
            </div>
            <div className="flex gap-2">
              <TextInput
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder="D:\www\my-site"
                className="!font-mono !text-xs"
              />
              <button
                onClick={() => void pick()}
                className="border-edge text-muted hover:bg-hover shrink-0 rounded border px-3 text-sm"
              >
                …
              </button>
            </div>
          </div>
          <div>
            <div className="text-subtle mb-1 text-[10px] font-semibold tracking-wide uppercase">
              {t('localdev.site.name')}
            </div>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="My site" />
          </div>
          <p className="text-subtle text-[10px] leading-relaxed">{t('localdev.site.addHint')}</p>
          <div className="flex justify-end gap-2">
            <Button
              className="!px-2 !py-1 !text-xs"
              onClick={() => {
                setAdding(false)
                setName('')
                setRootPath('')
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              className="!px-2 !py-1 !text-xs"
              disabled={!name.trim() || !rootPath.trim() || busy}
              onClick={() => void submit()}
            >
              {busy ? '…' : t('localdev.site.create')}
            </Button>
          </div>
        </div>
      )}

      {sites.length === 0 && !adding && (
        <p className="text-subtle py-8 text-center text-xs">{t('localdev.noSites')}</p>
      )}

      {sites.map((s) => (
        <SiteRow key={s.id} site={s} onDelete={() => setConfirmDel(s)} />
      ))}

      {confirmDel !== null && (
        <ConfirmModal
          title={t('localdev.site.delTitle')}
          message={
            <>
              <p className="mb-2">{t('localdev.site.delMsg', { name: confirmDel.name })}</p>
              <p className="text-subtle text-[11px] leading-relaxed">{t('localdev.site.delKeepFiles')}</p>
            </>
          }
          confirmLabel={t('localdev.site.delConfirm')}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => {
            const id = confirmDel.id
            setConfirmDel(null)
            // removeFiles=false: KHÔNG xoá file của user
            void deleteSite(id, false)
          }}
        />
      )}
    </div>
  )
}

/** 1 hàng site — cũng dùng lại được ở Dashboard về sau. */
export function SiteRow({ site, onDelete }: { site: LdSiteDto; onDelete?: () => void }) {
  const t = useT()
  const openSiteShell = useTabsStore((s) => s.openSiteShell)
  const [showDb, setShowDb] = useState(false)
  const url = `http://${site.domain}:${String(site.httpPort)}/`
  // Site tĩnh không cần DB → không làm rối UI bằng nút vô nghĩa
  const needsDb = site.kind !== 'static'
  return (
    <div className="border-edge bg-input rounded border">
      <div className="group flex items-center gap-2 px-3 py-2">
        <span
          className={`size-2 shrink-0 rounded-full ${
            site.status === 'ready' ? 'bg-success' : site.status === 'error' ? 'bg-danger' : 'bg-warning animate-pulse'
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="text-content truncate text-xs font-medium">{site.name}</div>
          <div className="text-subtle truncate font-mono text-[10px]">{url}</div>
        </div>
        <span className="text-subtle shrink-0 text-[10px] uppercase">{site.kind}</span>
        {site.phpVersion !== null && (
          <span className="text-subtle shrink-0 font-mono text-[10px]">{site.phpVersion.replace('php-', 'php ')}</span>
        )}
        {needsDb && (
          <button
            className={`shrink-0 rounded border px-1.5 text-[10px] ${
              site.dbName !== null
                ? 'border-edge-strong text-muted hover:bg-hover'
                : 'border-warning/50 text-warning hover:bg-hover'
            }`}
            title={site.dbName !== null ? t('localdev.db.show') : t('localdev.db.none')}
            onClick={() => setShowDb((v) => !v)}
          >
            {site.dbName !== null ? `🗄 ${t('localdev.db.chip')}` : `🗄 ${t('localdev.db.noneShort')}`}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
          <button
            className="border-edge-strong text-muted hover:bg-hover rounded border px-1.5 text-[11px]"
            title={t('localdev.site.open')}
            onClick={() => window.infra.localdev.siteOpen(site.id)}
          >
            ↗
          </button>
          <button
            className="border-edge-strong text-muted hover:bg-hover rounded border px-1.5 text-[11px]"
            title={t('localdev.site.terminal')}
            onClick={() => void openSiteShell(site.id)}
          >
            ⌨
          </button>
          <button
            className="border-edge-strong text-muted hover:bg-hover rounded border px-1.5 text-[11px]"
            title={t('localdev.site.openFolder')}
            onClick={() => window.infra.localdev.openFolder('site', site.id)}
          >
            📁
          </button>
          {onDelete && (
            <button
              className="border-edge-strong text-subtle hover:text-danger hover:border-danger/50 rounded border px-1.5 text-[11px]"
              title={t('common.delete')}
              onClick={onDelete}
            >
              🗑
            </button>
          )}
        </div>
        {site.lastError !== null && (
          <span className="text-danger max-w-[35%] shrink-0 truncate text-[10px]" title={site.lastError}>
            {site.lastError}
          </span>
        )}
      </div>
      {showDb && needsDb && <SiteDbBlock site={site} />}
    </div>
  )
}

/**
 * Thông tin kết nối database của 1 site — đủ để dán vào Navicat/wp-config.php.
 *
 * Password hiện dưới dạng ẩn cho tới khi bấm 👁: nó KHÔNG phải bí mật thật (wp-config.php trên
 * đĩa đã có nó dạng thô), nhưng dev hay share màn hình nên mặc định không phơi ra.
 */
function SiteDbBlock({ site }: { site: LdSiteDto }) {
  const t = useT()
  const dbStatus = useLocaldevStore((s) => s.dbStatus)
  const provisionDb = useLocaldevStore((s) => s.provisionDb)
  const dumpDb = useLocaldevStore((s) => s.dumpDb)
  const importDb = useLocaldevStore((s) => s.importDb)
  const writeWpConfig = useLocaldevStore((s) => s.writeWpConfig)
  const openAdminer = useLocaldevStore((s) => s.openAdminer)
  const openPhpMyAdmin = useLocaldevStore((s) => s.openPhpMyAdmin)
  // Chỉ hiện nút của công cụ ĐÃ CÀI: bấm rồi mới nhận "chưa cài" là một lần bấm vô ích.
  const pmaInstalled = useLocaldevStore((s) =>
    s.runtimes.some((r) => r.id.startsWith('phpmyadmin-') && r.installed)
  )
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [wp, setWp] = useState<LdWpConfigDto | null>(null)

  // Đọc wp-config.php để biết site đang trỏ vào DB nào và DB app cấp có dữ liệu chưa —
  // hai câu hỏi đúng lúc user thấy "Error establishing a database connection".
  const loadWp = useCallback(async (): Promise<void> => {
    try {
      setWp(await window.infra.localdev.siteWpConfigRead(site.id))
    } catch {
      setWp(null)
    }
  }, [site.id])

  useEffect(() => {
    void loadWp()
  }, [loadWp, site.dbName, site.dbPass])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      await loadWp()
    } finally {
      setBusy(false)
    }
  }

  if (site.dbName === null) {
    return (
      <div className="border-edge space-y-2 border-t px-3 py-2">
        <p className="text-subtle text-[11px] leading-relaxed">{t('localdev.db.provisionHint')}</p>
        {dbStatus !== null && !dbStatus.installed && (
          <p className="text-warning text-[11px]">{t('localdev.db.needRuntime')}</p>
        )}
        <Button
          variant="primary"
          className="!px-2 !py-1 !text-xs"
          disabled={busy || dbStatus === null || !dbStatus.installed}
          onClick={() => void run(() => provisionDb(site.id))}
        >
          {busy ? '…' : t('localdev.db.provision')}
        </Button>
      </div>
    )
  }

  const host = dbStatus?.host ?? '127.0.0.1'
  const port = dbStatus?.port ?? 3307
  const rows: Array<[string, string]> = [
    [t('localdev.db.host'), `${host}:${String(port)}`],
    [t('localdev.db.name'), site.dbName],
    [t('localdev.db.user'), site.dbUser ?? ''],
    [t('localdev.db.pass'), site.dbPass ?? '']
  ]

  return (
    <div className="border-edge space-y-1.5 border-t px-3 py-2">
      {rows.map(([label, value], i) => {
        const isPass = i === rows.length - 1
        return (
          <div key={label} className="flex items-center gap-2">
            <span className="text-subtle w-24 shrink-0 text-[10px] tracking-wide uppercase">{label}</span>
            <code className="text-content min-w-0 flex-1 truncate font-mono text-[11px]">
              {isPass && !reveal ? '••••••••••••' : value}
            </code>
            {isPass && (
              <button
                className="border-edge-strong text-muted hover:bg-hover shrink-0 rounded border px-1.5 text-[10px]"
                title={reveal ? t('localdev.db.hide') : t('localdev.db.reveal')}
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? '🙈' : '👁'}
              </button>
            )}
            <button
              className="border-edge-strong text-muted hover:bg-hover shrink-0 rounded border px-1.5 text-[10px]"
              title={t('localdev.db.copy')}
              onClick={() => void navigator.clipboard.writeText(value)}
            >
              ⧉
            </button>
          </div>
        )
      })}
      {/* Hai lý do THẬT khiến site vẫn báo lỗi kết nối dù DB đã cấp — nói thẳng ở đây */}
      {wp?.exists === true && wp.matches === false && (
        <div className="border-warning/40 bg-warning/5 mt-1 rounded border px-2 py-1.5">
          <p className="text-warning text-[11px] leading-relaxed">
            {t('localdev.db.wpMismatch', { db: wp.dbName ?? '?', host: wp.dbHost ?? '?' })}
          </p>
          <Button
            variant="primary"
            className="mt-1.5 !px-2 !py-1 !text-xs"
            disabled={busy}
            onClick={() => void run(() => writeWpConfig(site.id))}
          >
            {busy ? '…' : t('localdev.db.wpWrite')}
          </Button>
        </div>
      )}
      {wp?.tables === 0 && (
        <div className="border-edge bg-hover/30 mt-1 rounded border px-2 py-1.5">
          <p className="text-subtle text-[11px] leading-relaxed">{t('localdev.db.empty')}</p>
          <Button className="mt-1.5 !px-2 !py-1 !text-xs" disabled={busy} onClick={() => void run(() => importDb(site.id))}>
            {t('localdev.db.import')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-subtle max-w-[55%] text-[10px] leading-relaxed">{t('localdev.db.plaintextNote')}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button className="!px-2 !py-1 !text-xs" disabled={busy} onClick={() => void run(() => openAdminer(site.id))}>
            {t('localdev.db.adminer')}
          </Button>
          {pmaInstalled && (
            <Button
              className="!px-2 !py-1 !text-xs"
              disabled={busy}
              onClick={() => void run(() => openPhpMyAdmin(site.id))}
            >
              {t('localdev.db.pma')}
            </Button>
          )}
          {wp?.tables !== 0 && (
            <Button className="!px-2 !py-1 !text-xs" disabled={busy} onClick={() => void run(() => importDb(site.id))}>
              {t('localdev.db.import')}
            </Button>
          )}
          <Button className="!px-2 !py-1 !text-xs" disabled={busy} onClick={() => void run(() => dumpDb(site.id))}>
            {t('localdev.db.dump')}
          </Button>
        </div>
      </div>
      {wp?.exists === true && wp.tables !== undefined && wp.tables > 0 && wp.matches === true && (
        <p className="text-success text-[10px]">
          {t('localdev.db.wpOk', { n: String(wp.tables) })}
        </p>
      )}
    </div>
  )
}
