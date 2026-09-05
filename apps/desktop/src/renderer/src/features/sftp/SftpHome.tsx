import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { joinPath } from '../../lib/paths'
import { useSftpHomeStore, type SftpHomeSession } from '../../stores/sftpHome'
import { errorMessage, useToastsStore } from '../../stores/toasts'
import { Button } from '../../components/ui'
import { FilePane, usePane, type PaneState } from './FilePane'
import { SftpHostPicker } from './SftpHostPicker'
import { LOCAL_ADAPTER, TransferArrows, TransferList, remoteAdapter, useTransfers } from './sftpShared'
import { useT } from '../../i18n'

/**
 * Trang **SFTP** — mục riêng (Navigator → 📁 SFTP; theme Infra: menu `⋯` / lưới / palette mở tab).
 *
 * Khác tab SFTP theo host ở THỨ TỰ: mở trang trước, chọn host sau. Bên trái luôn là máy local;
 * bên phải là thẻ "Kết nối tới host → Chọn host" cho tới khi chọn xong, rồi thành pane remote
 * ngay tại chỗ. Đổi host / ngắt kết nối ở header. Phiên nằm trong `useSftpHomeStore` nên đổi
 * mục rồi quay lại vẫn đang nối.
 *
 * Nút SFTP trên từng hàng host vẫn mở tab riêng như trước — hai lối vào, một bộ component
 * (`sftpShared`), không có bản UI thứ hai phải bảo trì.
 */
export function SftpHome({ active }: { active: boolean }) {
  const t = useT()
  const session = useSftpHomeStore((s) => s.session)
  const connecting = useSftpHomeStore((s) => s.connecting)
  const connect = useSftpHomeStore((s) => s.connect)
  const disconnect = useSftpHomeStore((s) => s.disconnect)
  const [picking, setPicking] = useState(false)

  const local = usePane(LOCAL_ADAPTER)
  // Pane remote sống trong `RemoteSide` (mount theo phiên); nó gửi hàm refresh lên qua ref để
  // hàng đợi transfer ở đây refresh được pane đích sau khi upload xong
  const remoteRefresh = useRef<(() => Promise<void>) | null>(null)
  const transfers = useTransfers((kind) => {
    if (kind === 'download') void local.refresh()
    else void remoteRefresh.current?.()
  })

  const pickLabel = connecting ? t('sftp.connecting') : t('sftp.selectHost')

  return (
    <div className={`absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      <div className="border-edge bg-panel flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className="text-content text-sm font-medium">📁 {t('nav.sftp')}</span>
        {session && (
          <span className="text-subtle flex min-w-0 items-center gap-1.5 text-[11px]">
            · <span className="bg-success inline-block size-1.5 rounded-full" />
            <span className="truncate">{session.title}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {session ? (
            <>
              <Button className="!py-1 !text-xs" disabled={connecting} onClick={() => setPicking(true)}>
                {connecting ? t('sftp.connecting') : t('sftp.changeHost')}
              </Button>
              <Button className="!py-1 !text-xs" onClick={disconnect}>
                {t('sftp.disconnect')}
              </Button>
            </>
          ) : (
            <Button variant="primary" className="!py-1 !text-xs" disabled={connecting} onClick={() => setPicking(true)}>
              {pickLabel}
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-0 p-2">
        <FilePane title="Local" adapter={LOCAL_ADAPTER} pane={local} />
        {session ? (
          // key = sessionId: đổi host là dựng lại pane remote từ home của host mới
          <RemoteSide key={session.sessionId} session={session} local={local} refreshRef={remoteRefresh} />
        ) : (
          <div className="border-edge flex min-w-0 flex-1 flex-col items-center justify-center gap-3 border border-dashed text-center">
            <div className="border-edge-strong bg-elevated flex size-14 items-center justify-center rounded-xl border text-2xl">
              📁
            </div>
            <div className="text-content text-base font-semibold">{t('sftp.connectTitle')}</div>
            <p className="text-subtle max-w-xs text-xs leading-relaxed">{t('sftp.connectHint')}</p>
            <Button variant="primary" disabled={connecting} onClick={() => setPicking(true)}>
              {pickLabel}
            </Button>
          </div>
        )}
      </div>

      <TransferList transfers={transfers} />

      {picking && (
        <SftpHostPicker
          currentHostId={session?.hostId ?? null}
          onPick={(hostId) => {
            setPicking(false)
            void connect(hostId)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

/** Nửa phải khi đã nối: cột mũi tên + pane remote của phiên hiện tại. */
function RemoteSide({
  session,
  local,
  refreshRef
}: {
  readonly session: SftpHomeSession
  readonly local: PaneState
  readonly refreshRef: MutableRefObject<(() => Promise<void>) | null>
}) {
  const adapter = useMemo(() => remoteAdapter(session.sessionId, session.home), [session.sessionId, session.home])
  const remote = usePane(adapter)

  useEffect(() => {
    refreshRef.current = remote.refresh
    return () => {
      refreshRef.current = null
    }
  }, [refreshRef, remote.refresh])

  const upload = async (): Promise<void> => {
    if (!local.selected) return
    try {
      await window.infra.sftp.upload(session.sessionId, joinPath(local.path, local.selected.name), remote.path)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  const download = async (): Promise<void> => {
    if (!remote.selected) return
    try {
      await window.infra.sftp.download(session.sessionId, joinPath(remote.path, remote.selected.name), local.path)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  return (
    <>
      <TransferArrows
        canUpload={!!local.selected}
        canDownload={!!remote.selected}
        onUpload={() => void upload()}
        onDownload={() => void download()}
      />
      <FilePane title="Remote" adapter={adapter} pane={remote} />
    </>
  )
}
