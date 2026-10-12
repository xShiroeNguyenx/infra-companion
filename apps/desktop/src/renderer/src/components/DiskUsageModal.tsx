import { useCallback, useEffect, useState } from 'react'
import {
  diskVerdict,
  isRealFilesystem,
  mountsAtOrBelow,
  mountsBelow,
  type DiskFilesResultDto,
  type DiskUsageDto,
  type DiskUsageResultDto,
  type FilesystemDto,
  type HostDto
} from '@infra/shared'
import { Button, ModalOrPanel, Select } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useDataStore } from '../stores/data'
import { useToastsStore } from '../stores/toasts'
import { useT, type I18nKey } from '../i18n'

/** KB → chuỗi đọc được. Bản nhỏ viết lại ở renderer vì không import được `@infra/core` (§5). */
function formatKb(sizeKb: number): string {
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = sizeKb
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Thư mục cha, null khi đã ở gốc. */
function parentOf(path: string): string | null {
  const clean = path.replace(/\/+$/, '')
  if (clean === '' || clean === '/') return null
  const idx = clean.lastIndexOf('/')
  return idx < 0 ? null : idx === 0 ? '/' : clean.slice(0, idx)
}

/** Câu gợi ý ứng với mỗi kết luận. Bảng tra tường minh, không ghép chuỗi khoá i18n. */
const ADVICE_KEY = {
  drillDown: 'disk.adviceDrillDown',
  filesHere: 'disk.adviceFilesHere',
  spread: 'disk.adviceSpread',
  wrongBranch: 'disk.adviceWrongBranch',
  leaf: 'disk.adviceLeaf',
  otherMount: 'disk.adviceOtherMount',
  hiddenUsage: 'disk.adviceHiddenUsage',
  inodesFull: 'disk.adviceInodesFull'
} as const satisfies Record<string, I18nKey>

/** Thời điểm sửa file → "5 phút trước". File vừa sửa = còn đang lớn lên, đáng để ý trước. */
function ago(ms: number, t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000))
  if (min < 60) return t('disk.agoMin', { n: min })
  const h = Math.round(min / 60)
  return h < 48 ? t('disk.agoHour', { n: h }) : t('disk.agoDay', { n: Math.round(h / 24) })
}

/** Lệnh chỉ-đọc kèm nút chép. App không tự chạy: cần sudo, và là quyết định của người trực. */
function CommandBox({ command, t }: { readonly command: string; readonly t: (key: I18nKey) => string }) {
  const push = useToastsStore((s) => s.push)
  return (
    <div className="border-edge bg-input mt-1.5 flex items-center gap-2 rounded border px-2 py-1">
      <code className="text-content min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap">
        {command}
      </code>
      <Button
        type="button"
        className="!px-2 !py-0.5 !text-[11px]"
        onClick={() => void navigator.clipboard.writeText(command).then(() => push(t('disk.copied'), 'info'))}
      >
        {t('disk.copy')}
      </Button>
    </div>
  )
}

/**
 * Khối kết luận đặt trên danh sách: *phân vùng còn bao nhiêu*, *thư mục này chiếm bao nhiêu
 * phần đã dùng*, và **một việc nên làm** — kèm nút làm luôn việc đó.
 *
 * Danh sách `du` một mình chỉ trả lời "cái gì chiếm chỗ". Câu người ta thật sự cần là "giờ làm
 * gì": đi tiếp vào đâu, hay là đang đào nhầm nhánh vì chỗ đầy nằm ở phân vùng khác.
 */
function Verdict({
  usage,
  filesystems,
  t,
  onGo,
  onUp,
  onFiles,
  busy
}: {
  readonly usage: DiskUsageDto
  readonly filesystems: readonly FilesystemDto[]
  readonly t: (key: I18nKey, params?: Record<string, string | number>) => string
  readonly onGo: (path: string) => void
  readonly onUp: () => void
  readonly onFiles: () => void
  readonly busy: boolean
}) {
  const v = diskVerdict(usage, filesystems)
  const tint =
    v.level === 'critical'
      ? 'border-danger/50 bg-danger/10'
      : v.level === 'warn'
        ? 'border-warning/40 bg-warning/10'
        : 'border-edge bg-hover'

  return (
    <div className={`mb-2 rounded border px-3 py-2 ${tint}`}>
      <div className="text-content text-xs font-medium">
        {v.filesystem
          ? t('disk.verdictFs', {
              mount: v.filesystem.mountedOn,
              percent: v.filesystem.usePercent,
              free: formatKb(v.filesystem.availKb)
            })
          : t('disk.verdictNoFs', { size: formatKb(usage.totalKb) })}
        {v.filesystem?.inodeUsePercent != null && v.filesystem.inodeUsePercent >= 75 && (
          <span className={v.filesystem.inodeUsePercent >= 90 ? 'text-danger' : 'text-warning'}>
            {' · '}
            {t('disk.inodeShort', { percent: v.filesystem.inodeUsePercent })}
          </span>
        )}
        {v.shareOfUsedPercent !== null && (
          <span className="text-muted font-normal">
            {' · '}
            {t('disk.verdictShare', { size: formatKb(usage.totalKb), percent: v.shareOfUsedPercent })}
          </span>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-muted min-w-0 flex-1 text-[11px] leading-relaxed">
          →{' '}
          {t(ADVICE_KEY[v.advice], {
            name: v.top?.name ?? '',
            percent: v.top?.percent ?? 0,
            size: formatKb(v.looseKb),
            loose: v.loosePercent,
            mount: v.fullMountBelow?.mountedOn ?? '',
            mountPercent: v.fullMountBelow?.usePercent ?? 0,
            free: formatKb(v.fullMountBelow?.availKb ?? 0),
            hidden: formatKb(v.hiddenKb),
            inodePercent: v.filesystem?.inodeUsePercent ?? 0
          })}
        </span>
        {v.advice === 'filesHere' && (
          <Button type="button" className="!px-2 !py-1 !text-xs" disabled={busy} onClick={onFiles}>
            {t('disk.findFiles')}
          </Button>
        )}
        {/* Gợi ý mà bấm được luôn: đọc xong không phải tự tìm lại dòng đó trong danh sách */}
        {v.advice === 'drillDown' && v.top && (
          <Button type="button" className="!px-2 !py-1 !text-xs" disabled={busy} onClick={() => onGo(v.top!.path)}>
            {t('disk.goInto', { name: v.top.name })}
          </Button>
        )}
        {v.advice === 'otherMount' && v.fullMountBelow && (
          <Button
            type="button"
            className="!px-2 !py-1 !text-xs"
            disabled={busy}
            onClick={() => onGo(v.fullMountBelow!.mountedOn)}
          >
            {t('disk.goInto', { name: v.fullMountBelow.mountedOn })}
          </Button>
        )}
        {v.advice === 'wrongBranch' && (
          <Button type="button" className="!px-2 !py-1 !text-xs" disabled={busy} onClick={onUp}>
            {t('disk.goUp')}
          </Button>
        )}
      </div>
      {v.command && <CommandBox command={v.command} t={t} />}
    </div>
  )
}

/**
 * F36 — "thư mục nào đang ăn dung lượng", kiểu ncdu.
 *
 * Đi từng cấp một (`du -d 1`) chứ không quét cả cây: trên máy production cây `/` có thể mất
 * nhiều phút và phần lớn kết quả không ai đọc. Bấm vào một dòng là đi xuống, có nút lên cấp.
 */
export function DiskUsageModal({
  host,
  onClose,
  embedded
}: {
  readonly host: HostDto | null
  readonly onClose?: () => void
  readonly embedded?: boolean
}) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts)
  // Rỗng = CHƯA chọn máy. Cố ý không lấy host đầu tiên: mở hộp thoại lên mà tự chạy `du` trên
  // một máy mình không chọn vừa tốn kết nối SSH vừa có thể là máy production.
  const [hostId, setHostId] = useState(host?.id ?? '')
  const [path, setPath] = useState('/')
  const [result, setResult] = useState<DiskUsageResultDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** File lớn nhất của thư mục đang xem. Chỉ quét khi user bấm — `find` cả cây có thể lâu. */
  const [files, setFiles] = useState<(DiskFilesResultDto & { path: string }) | null>(null)
  const [filesBusy, setFilesBusy] = useState(false)
  const push = useToastsStore((s) => s.push)

  const findFiles = async (target: string): Promise<void> => {
    if (!hostId) return
    setFilesBusy(true)
    try {
      setFiles({ ...(await window.infra.diag.diskFiles(hostId, target)), path: target })
    } catch (err) {
      setFiles({ ok: false, files: [], minKb: 0, path: target, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setFilesBusy(false)
    }
  }

  /**
   * ⚠️ KHÔNG đưa `t` vào dependency: `useT()` trả hàm MỚI mỗi render, nên `scan` sẽ đổi
   * identity liên tục và effect bên dưới chạy lại sau mỗi `setState` → quét `du`/`df` qua SSH
   * trong vòng lặp vô hạn. Lỗi vì thế lưu dạng THÔ ('' = không có mô tả), dịch lúc render.
   */
  const scan = useCallback(
    async (targetPath: string): Promise<void> => {
      if (!hostId) return
      setError(null)
      setBusy(true)
      try {
        const res = await window.infra.diag.disk(hostId, targetPath)
        if (res.ok) {
          setResult(res)
          setPath(res.usage?.path ?? targetPath)
          // Danh sách file thuộc thư mục cũ — giữ lại là hiện file của chỗ khác dưới tiêu đề chỗ này
          setFiles(null)
        } else {
          setError(res.error ?? '')
        }
      } catch (err) {
        // invoke có thể reject (huỷ nhập mật khẩu login-script, host không nối được…)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [hostId]
  )

  // Đổi host thì quét lại từ gốc — giữ path cũ của máy khác là vô nghĩa.
  // Chưa chọn host thì KHÔNG nối gì cả (xem ghi chú ở khai báo `hostId`).
  useEffect(() => {
    if (!hostId) {
      setResult(null)
      return
    }
    void scan('/')
  }, [hostId, scan])

  const parent = parentOf(path)
  const usage = result?.usage ?? null
  // `du -x` không sang phân vùng khác → lấy từ `df` những ổ gắn bên dưới để không bị "mất tích"
  const below = usage ? mountsBelow(usage.path, result?.filesystems ?? []) : []

  return (
    <ModalOrPanel
      embedded={embedded}
      title={t('disk.title')}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="disk-usage" onDone={onClose} />}
    >
      <div className={embedded ? 'w-full' : 'w-[640px] max-w-full'}>
        <div className="mb-2 flex items-center gap-2">
          <Select value={hostId} onChange={(e) => setHostId(e.target.value)} className="max-w-56">
            <option value="">{t('common.pickHost')}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </Select>
          <code className="text-content min-w-0 flex-1 truncate font-mono text-xs">{path}</code>
          <Button type="button" disabled={busy || !parent} onClick={() => void scan(parent ?? '/')}>
            ↑
          </Button>
          <Button type="button" disabled={busy} onClick={() => void scan(path)}>
            ↻
          </Button>
        </div>

        {/* df trước du: câu hỏi thật là "phân vùng nào sắp đầy", rồi mới tới "trong đó cái gì to" */}
        {result && result.filesystems.length > 0 && (
          <div className="border-edge bg-input mb-2 rounded border px-3 py-2">
            <div className="text-subtle mb-1 text-[10px] font-semibold tracking-wider uppercase">
              {t('disk.filesystems')}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {result.filesystems.map((fs) => {
                const body = (
                  <>
                    <span className="text-muted font-mono">{fs.mountedOn}</span>{' '}
                    <span className={fs.usePercent >= 90 ? 'text-danger font-medium' : 'text-subtle'}>
                      {fs.usePercent}%
                    </span>{' '}
                    <span className="text-subtle">({t('disk.free', { size: formatKb(fs.availKb) })})</span>
                    {/* Chỉ hiện inode khi đáng lo — 9 phân vùng × thêm một con số là nhiễu */}
                    {fs.inodeUsePercent != null && fs.inodeUsePercent >= 75 && (
                      <span className={fs.inodeUsePercent >= 90 ? 'text-danger font-medium' : 'text-warning'}>
                        {' '}
                        {t('disk.inodeShort', { percent: fs.inodeUsePercent })}
                      </span>
                    )}
                  </>
                )
                // Phân vùng thật bấm được để quét thẳng — tmpfs/overlay thì quét cũng vô nghĩa
                return isRealFilesystem(fs) ? (
                  <button
                    key={fs.mountedOn}
                    type="button"
                    disabled={busy}
                    onClick={() => void scan(fs.mountedOn)}
                    className="hover:bg-hover rounded text-left text-[11px]"
                  >
                    {body}
                  </button>
                ) : (
                  <span key={fs.mountedOn} className="text-[11px]">
                    {body}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* '' = lỗi không kèm mô tả → dịch lúc render (xem ghi chú ở `scan`) */}
        {error !== null && <p className="text-danger mb-2 text-xs leading-relaxed">{error || t('disk.failed')}</p>}

        {!hostId ? (
          <p className="text-subtle py-6 text-center text-xs">{t('common.pickHostHint')}</p>
        ) : busy && !usage ? (
          <p className="text-subtle py-6 text-center text-xs">{t('disk.scanning')}</p>
        ) : usage ? (
          <>
            {/* Kết luận TRƯỚC danh sách: câu đầu tiên phải là "làm gì", không phải cột số */}
            <Verdict
              usage={usage}
              filesystems={result?.filesystems ?? []}
              t={t}
              busy={busy}
              onGo={(p) => void scan(p)}
              onUp={() => void scan(parent ?? '/')}
              onFiles={() => void findFiles(usage.path)}
            />
            {below.length > 0 && (
              <div className="border-edge mb-2 rounded border px-3 py-2">
                <div className="text-subtle mb-1 text-[10px] font-semibold tracking-wider uppercase">
                  {t('disk.mountsBelow')}
                </div>
                {below.map((fs) => (
                  <button
                    key={fs.mountedOn}
                    type="button"
                    disabled={busy}
                    onClick={() => void scan(fs.mountedOn)}
                    className="hover:bg-hover flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs"
                  >
                    <span className="text-content min-w-0 flex-1 truncate font-mono">{fs.mountedOn}</span>
                    <span className={fs.usePercent >= 90 ? 'text-danger font-medium' : 'text-subtle'}>
                      {fs.usePercent}%
                    </span>
                    <span className="text-content w-20 shrink-0 text-right">{formatKb(fs.usedKb)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="text-subtle mb-1.5 text-[11px]">
              {t('disk.total', { size: formatKb(usage.totalKb) })}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {usage.entries.length === 0 ? (
                <p className="text-subtle py-6 text-center text-xs">{t('disk.empty')}</p>
              ) : (
                usage.entries.map((entry) => {
                  // Dòng `/mnt` 4 KB mà bên dưới là ổ 495 GB: nói ra ngay trên dòng, đừng để nó trông như rỗng
                  const inside = mountsAtOrBelow(entry.path, below)
                  const insideKb = inside.reduce((n, fs) => n + fs.usedKb, 0)
                  const insideFull = inside.some((fs) => fs.usePercent >= 90)
                  return (
                  <button
                    key={entry.path}
                    type="button"
                    disabled={busy}
                    onClick={() => void scan(entry.path)}
                    className="border-edge bg-input hover:bg-hover hover:border-accent/60 relative mb-1 flex w-full items-center gap-2 overflow-hidden rounded border px-3 py-1.5 text-left"
                  >
                    {/* Thanh nền theo tỉ lệ — đọc bằng mắt nhanh hơn đọc con số */}
                    <span
                      className="bg-accent/15 absolute inset-y-0 left-0"
                      style={{ width: `${Math.min(100, entry.percent)}%` }}
                    />
                    <span className="text-content relative min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
                    {inside.length > 0 && (
                      <span
                        className={`relative shrink-0 rounded border px-1.5 text-[10px] ${
                          insideFull ? 'border-danger/50 text-danger' : 'border-edge text-subtle'
                        }`}
                        title={inside.map((fs) => `${fs.mountedOn} ${fs.usePercent}%`).join('\n')}
                      >
                        {t('disk.entryMounts', { count: inside.length, size: formatKb(insideKb) })}
                      </span>
                    )}
                    <span className="text-subtle relative shrink-0 text-[11px]">{entry.percent}%</span>
                    <span className="text-content relative w-20 shrink-0 text-right text-xs">
                      {formatKb(entry.sizeKb)}
                    </span>
                  </button>
                  )
                })
              )}
            </div>

            {/* File lớn nhất: chỗ cụt của `du -d 1` là "dung lượng nằm ở file ngay đây" */}
            <div className="border-edge mt-2 rounded border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-subtle min-w-0 flex-1 text-[10px] font-semibold tracking-wider uppercase">
                  {t('disk.bigFiles')}
                </span>
                <Button
                  type="button"
                  className="!px-2 !py-0.5 !text-[11px]"
                  disabled={filesBusy || busy}
                  onClick={() => void findFiles(usage.path)}
                >
                  {filesBusy ? t('disk.findingFiles') : files ? t('disk.refindFiles') : t('disk.findFiles')}
                </Button>
              </div>
              {files && !files.ok && (
                <p className="text-danger mt-1 text-xs">{files.error || t('disk.failed')}</p>
              )}
              {files?.ok && files.files.length === 0 && (
                <p className="text-subtle mt-1 text-[11px] leading-relaxed">
                  {t('disk.noBigFiles', { size: formatKb(files.minKb) })}
                </p>
              )}
              {files?.ok && files.files.length > 0 && (
                <div className="mt-1 max-h-64 overflow-y-auto">
                  {files.files.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      title={t('disk.copyPathHint')}
                      onClick={() =>
                        void navigator.clipboard.writeText(f.path).then(() => push(t('disk.copied'), 'info'))
                      }
                      className="hover:bg-hover flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs"
                    >
                      <span className="text-content min-w-0 flex-1 truncate font-mono">{f.name}</span>
                      <span className="text-subtle shrink-0 text-[11px]">{ago(f.mtimeMs, t)}</span>
                      <span className="text-content w-20 shrink-0 text-right">{formatKb(f.sizeKb)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="text-subtle mt-2 text-[10px] leading-relaxed">{t('disk.note')}</p>
          </>
        ) : null}
      </div>
    </ModalOrPanel>
  )
}
