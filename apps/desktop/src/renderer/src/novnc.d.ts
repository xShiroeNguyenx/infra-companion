/** Type shim tối thiểu cho noVNC (@novnc/novnc không kèm .d.ts). Chỉ khai báo phần dùng. */
declare module '@novnc/novnc' {
  export interface RFBCredentials {
    username?: string
    password?: string
    target?: string
  }
  export interface RFBOptions {
    shared?: boolean
    credentials?: RFBCredentials
    repeaterID?: string
    wsProtocols?: string[]
  }
  /** RFB kế thừa EventTarget — sự kiện: connect, disconnect, credentialsrequired, securityfailure, desktopname. */
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrDataChannel: string, options?: RFBOptions)
    viewOnly: boolean
    focusOnClick: boolean
    clipViewport: boolean
    scaleViewport: boolean
    resizeSession: boolean
    showDotCursor: boolean
    background: string
    qualityLevel: number
    compressionLevel: number
    disconnect(): void
    sendCredentials(credentials: RFBCredentials): void
    sendCtrlAltDel(): void
    focus(): void
    blur(): void
  }
}
