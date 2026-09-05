import { useEffect, useRef, useState } from 'react'
import type { TransferEvent } from '@infra/shared'
import { formatSize } from '../../lib/paths'
import { useToastsStore } from '../../stores/toasts'
import type { PaneAdapter } from './FilePane'
import { useT } from '../../i18n'

/**
 * Mảnh dùng chung giữa hai lối vào SFTP:
 *  · **tab theo host** (`SftpView`, mở từ nút SFTP trên một hàng host — có từ đầu);
 *  · **trang SFTP** (`SftpHome`, mục riêng: mở trước, chọn host sau — v0.2.18).
 *
 * Tách ra để hai nơi không giữ hai bản adapter / hàng đợi transfer song song rồi lệch nhau.
 */

/** Adapter hệ file LOCAL — không phụ thuộc phiên nào nên là hằng module. */
export const LOCAL_ADAPTER: PaneAdapter = {
  initialPath: () => window.infra.fs.home(),
  list: (path) => window.infra.fs.list(path),
  mkdir: (path) => window.infra.fs.mkdir(path),
  rename: (from, to) => window.infra.fs.rename(from, to),
  delete: (path) => window.infra.fs.delete(path)
}

/** Adapter REMOTE cho một phiên SFTP đã mở (`sid`), bắt đầu ở thư mục home của server. */
export function remoteAdapter(sid: string, home: string): PaneAdapter {
  return {
    initialPath: () => Promise.resolve(home || '/'),
    list: (path) => window.infra.sftp.list(sid, path),
    mkdir: (path) => window.infra.sftp.mkdir(sid, path),
    rename: (from, to) => window.infra.sftp.rename(sid, from, to),
    delete: (path, isDir) => window.infra.sftp.delete(sid, path, isDir),
    chmod: (path, mode) => window.infra.sftp.chmod(sid, path, mode),
    edit: (path) => window.infra.sftp.edit(sid, path)
  }
}

/** Số dòng transfer giữ lại trong hàng đợi hiển thị. */
const TRANSFER_KEEP = 20

/**
 * Nghe sự kiện transfer (main phát cho MỌI phiên), giữ 20 mục gần nhất; báo `onDone(kind)` để
 * nơi gọi refresh đúng pane đích, và toast khi lỗi. `onDone` đọc qua ref nên không phải đăng ký
 * lại mỗi lần pane đổi.
 */
export function useTransfers(onDone: (kind: TransferEvent['kind']) => void): TransferEvent[] {
  const [transfers, setTransfers] = useState<TransferEvent[]>([])
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    return window.infra.sftp.onTransfer((event) => {
      setTransfers((prev) => {
        const idx = prev.findIndex((t) => t.id === event.id)
        const next = idx >= 0 ? [...prev.slice(0, idx), event, ...prev.slice(idx + 1)] : [...prev, event]
        return next.slice(-TRANSFER_KEEP)
      })
      if (event.status === 'done') onDoneRef.current(event.kind)
      if (event.status === 'error' && event.error) {
        useToastsStore.getState().push(`${event.label}: ${event.error}`)
      }
    })
  }, [])

  return transfers
}

/** Cột hai mũi tên → (upload) / ← (download) đứng giữa hai pane. */
export function TransferArrows({
  canUpload,
  canDownload,
  onUpload,
  onDownload
}: {
  readonly canUpload: boolean
  readonly canDownload: boolean
  readonly onUpload: () => void
  readonly onDownload: () => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-1.5">
      <button
        className="border-edge-strong text-content hover:bg-hover rounded border px-2 py-1 text-sm disabled:opacity-40"
        title={t('sftp.uploadTip')}
        disabled={!canUpload}
        onClick={onUpload}
      >
        →
      </button>
      <button
        className="border-edge-strong text-content hover:bg-hover rounded border px-2 py-1 text-sm disabled:opacity-40"
        title={t('sftp.downloadTip')}
        disabled={!canDownload}
        onClick={onDownload}
      >
        ←
      </button>
    </div>
  )
}

/** Hàng đợi transfer ở đáy — tự ẩn khi chưa có gì. */
export function TransferList({ transfers }: { readonly transfers: TransferEvent[] }) {
  const t = useT()
  if (transfers.length === 0) return null
  const running = transfers.filter((x) => x.status === 'running')
  return (
    <div className="border-edge bg-panel max-h-28 shrink-0 overflow-y-auto border-t px-3 py-1.5">
      <div className="text-subtle mb-1 text-[10px] font-semibold tracking-wider uppercase">
        {t('sftp.transfers')} {running.length > 0 ? t('sftp.running', { n: running.length }) : ''}
      </div>
      {[...transfers].reverse().map((transfer) => (
        <div key={transfer.id} className="mb-1 flex items-center gap-2 text-[11px]">
          <span
            className={
              transfer.status === 'error' ? 'text-danger' : transfer.status === 'done' ? 'text-success' : 'text-warning'
            }
          >
            {transfer.kind === 'download' ? '↓' : '↑'}
          </span>
          <span className="text-muted min-w-0 flex-1 truncate">{transfer.label}</span>
          {transfer.status === 'running' && transfer.total > 0 && (
            <div className="bg-hover h-1 w-32 overflow-hidden rounded">
              <div
                className="bg-accent-hover h-full"
                style={{ width: `${Math.min(100, (transfer.transferred / transfer.total) * 100)}%` }}
              />
            </div>
          )}
          <span className="text-subtle w-20 text-right">
            {transfer.status === 'done'
              ? t('sftp.done')
              : transfer.status === 'error'
                ? t('sftp.error')
                : `${formatSize(transfer.transferred)}/${formatSize(transfer.total)}`}
          </span>
        </div>
      ))}
    </div>
  )
}
