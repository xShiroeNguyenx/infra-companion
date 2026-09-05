import { useMemo } from 'react'
import { joinPath } from '../../lib/paths'
import { errorMessage, useToastsStore } from '../../stores/toasts'
import type { AppTab } from '../../stores/tabs'
import { FilePane, usePane } from './FilePane'
import { LOCAL_ADAPTER, TransferArrows, TransferList, remoteAdapter, useTransfers } from './sftpShared'

/**
 * Tab SFTP theo HOST (mở từ nút SFTP trên hàng host): dual-pane local ↔ remote + hàng đợi transfer.
 * Phiên đã được mở khi tạo tab (`tab.sftpSessionId`). Trang SFTP "chọn host sau" là `SftpHome`.
 */
export function SftpView({ tab, active }: { tab: AppTab; active: boolean }) {
  const sid = tab.sftpSessionId ?? ''
  const remoteAd = useMemo(() => remoteAdapter(sid, tab.sftpHome ?? '/'), [sid, tab.sftpHome])

  const local = usePane(LOCAL_ADAPTER)
  const remote = usePane(remoteAd)

  // Transfer xong → refresh pane ĐÍCH (download về local, upload lên remote)
  const transfers = useTransfers((kind) => void (kind === 'download' ? local.refresh() : remote.refresh()))

  const upload = async (): Promise<void> => {
    if (!local.selected) return
    try {
      await window.infra.sftp.upload(sid, joinPath(local.path, local.selected.name), remote.path)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  const download = async (): Promise<void> => {
    if (!remote.selected) return
    try {
      await window.infra.sftp.download(sid, joinPath(remote.path, remote.selected.name), local.path)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  return (
    <div className={`absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      <div className="flex min-h-0 flex-1 gap-0 p-2">
        <FilePane title="Local" adapter={LOCAL_ADAPTER} pane={local} />
        <TransferArrows
          canUpload={!!local.selected}
          canDownload={!!remote.selected}
          onUpload={() => void upload()}
          onDownload={() => void download()}
        />
        <FilePane title="Remote" adapter={remoteAd} pane={remote} />
      </div>
      <TransferList transfers={transfers} />
    </div>
  )
}
