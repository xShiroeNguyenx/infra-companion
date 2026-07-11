import { useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc'
import { useT } from '../../i18n'
import type { AppTab } from '../../stores/tabs'
import { Button, Field, TextInput } from '../../components/ui'

type VncStatus = 'connecting' | 'connected' | 'disconnected'

/** F13 — Tab VNC: noVNC (RFB) render màn hình remote vào canvas, nối tới cầu ws↔tcp của main
 *  (ws://127.0.0.1:<wsPort>/?token=…). Layout theo khuôn SftpView (absolute inset-0, ẩn bằng hidden). */
export function VncView({ tab, active }: { tab: AppTab; active: boolean }) {
  const t = useT()
  const screenRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const [status, setStatus] = useState<VncStatus>('connecting')
  const [errCode, setErrCode] = useState<'' | 'lost' | 'authfail'>('')
  const [needCreds, setNeedCreds] = useState(false)
  const [password, setPassword] = useState('')
  /** Tăng để nối lại (Reconnect). */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const el = screenRef.current
    if (!el || tab.vncWsPort == null) return
    setStatus('connecting')
    setErrCode('')
    const url = `ws://127.0.0.1:${tab.vncWsPort}/?token=${encodeURIComponent(tab.vncToken ?? '')}`
    const rfb = new RFB(el, url, { shared: true })
    rfb.scaleViewport = true
    rfb.background = '#000'
    rfbRef.current = rfb

    const onConnect = (): void => setStatus('connected')
    const onDisconnect = (): void => {
      setStatus('disconnected')
      setErrCode((prev) => (prev === 'authfail' ? prev : 'lost'))
    }
    const onCreds = (): void => setNeedCreds(true)
    const onSecFail = (): void => {
      setErrCode('authfail')
      setStatus('disconnected')
    }
    rfb.addEventListener('connect', onConnect)
    rfb.addEventListener('disconnect', onDisconnect)
    rfb.addEventListener('credentialsrequired', onCreds)
    rfb.addEventListener('securityfailure', onSecFail)

    return () => {
      rfb.removeEventListener('connect', onConnect)
      rfb.removeEventListener('disconnect', onDisconnect)
      rfb.removeEventListener('credentialsrequired', onCreds)
      rfb.removeEventListener('securityfailure', onSecFail)
      try {
        rfb.disconnect()
      } catch {
        /* đã ngắt */
      }
      rfbRef.current = null
    }
  }, [tab.vncWsPort, tab.vncToken, attempt])

  const submitCreds = (): void => {
    rfbRef.current?.sendCredentials({ password })
    setNeedCreds(false)
    setPassword('')
  }

  return (
    <div className={`absolute inset-0 flex flex-col bg-black ${active ? '' : 'hidden'}`}>
      <div ref={screenRef} className="min-h-0 flex-1 overflow-hidden" />

      {status !== 'connected' && !needCreds && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="bg-elevated/95 border-edge-strong pointer-events-auto rounded-lg border px-4 py-3 text-center shadow-2xl">
            {status === 'connecting' && (
              <div className="text-muted flex items-center gap-2 text-xs">
                <span className="bg-warning size-2 animate-pulse rounded-full" />
                {t('vnc.connecting')}
              </div>
            )}
            {status === 'disconnected' && (
              <div className="space-y-2">
                <p className="text-danger text-xs">
                  {errCode === 'authfail' ? t('vnc.authFail') : t('vnc.lost')}
                </p>
                <Button className="!px-2 !py-1 !text-xs" onClick={() => setAttempt((a) => a + 1)}>
                  {t('vnc.reconnect')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {needCreds && (
        <div className="absolute inset-0 flex items-center justify-center">
          <form
            className="bg-elevated border-edge-strong w-72 rounded-lg border p-4 shadow-2xl"
            onSubmit={(e) => {
              e.preventDefault()
              submitCreds()
            }}
          >
            <Field label={t('vnc.password')}>
              <TextInput type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" className="!px-2 !py-1 !text-xs">
                {t('vnc.connect')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
