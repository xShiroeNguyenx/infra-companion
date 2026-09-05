import { create } from 'zustand'
import { errorMessage, useToastsStore } from './toasts'

/** Phiên SFTP đang mở trên trang SFTP (mục riêng), kèm host để hiện tên và đánh dấu trong hộp chọn. */
export interface SftpHomeSession {
  sessionId: string
  hostId: string
  title: string
  home: string
}

interface SftpHomeState {
  session: SftpHomeSession | null
  connecting: boolean
  /** Mở phiên tới host; đang có phiên khác thì thay (đóng phiên cũ SAU khi phiên mới mở được). */
  connect: (hostId: string) => Promise<void>
  disconnect: () => void
}

/**
 * Phiên của TRANG SFTP nằm ở store, không ở state component: ở theme Navigator, đổi sang mục
 * khác rồi quay lại vẫn đang nối đúng host, không phải chọn lại; và trang SFTP cùng tab
 * "SFTP" (theme Infra) dùng chung một phiên thay vì mỗi nơi mở một kết nối.
 *
 * Không persist: khởi động lại app thì phiên SSH phía main cũng không còn.
 */
export const useSftpHomeStore = create<SftpHomeState>((set, get) => ({
  session: null,
  connecting: false,
  connect: async (hostId) => {
    const prev = get().session
    set({ connecting: true })
    try {
      const res = await window.infra.sftp.open(hostId)
      // Đóng phiên cũ sau khi phiên mới đã mở: mở lỗi thì phiên cũ vẫn còn để làm việc tiếp
      if (prev) window.infra.sftp.close(prev.sessionId)
      set({ session: { sessionId: res.sessionId, hostId, title: res.title, home: res.home }, connecting: false })
    } catch (error) {
      set({ connecting: false })
      useToastsStore.getState().push(errorMessage(error))
    }
  },
  disconnect: () => {
    const cur = get().session
    if (cur) window.infra.sftp.close(cur.sessionId)
    set({ session: null })
  }
}))
