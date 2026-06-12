import { useEffect, useState } from 'react'
import { useT } from '../i18n'

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }

export function UpdateBanner() {
  const t = useT()
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })

  useEffect(() => {
    const offAvailable = window.infra.update.onAvailable((version) =>
      setState({ phase: 'available', version })
    )
    const offProgress = window.infra.update.onProgress((percent) =>
      setState((s) => s.phase === 'downloading' ? { ...s, percent } : s)
    )
    const offDownloaded = window.infra.update.onDownloaded((version) =>
      setState({ phase: 'ready', version })
    )
    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
    }
  }, [])

  if (state.phase === 'idle') return null

  return (
    <div className="border-warning/40 bg-warning/15 text-warning flex items-center gap-3 border-b px-4 py-1.5 text-xs">
      {state.phase === 'available' && (
        <>
          <span>{t('update.available', { version: state.version })}</span>
          <button
            className="bg-warning/25 hover:bg-warning/40 rounded px-2 py-0.5"
            onClick={() => {
              setState({ phase: 'downloading', version: state.version, percent: 0 })
              void window.infra.update.download()
            }}
          >
            {t('update.download')}
          </button>
          <button
            className="hover:text-content ml-auto"
            onClick={() => setState({ phase: 'idle' })}
          >
            ✕
          </button>
        </>
      )}

      {state.phase === 'downloading' && (
        <>
          <span>{t('update.downloading', { version: state.version })}</span>
          <div className="bg-warning/20 h-1.5 w-32 overflow-hidden rounded-full">
            <div
              className="bg-warning h-full rounded-full transition-all"
              style={{ width: `${state.percent}%` }}
            />
          </div>
          <span>{state.percent}%</span>
        </>
      )}

      {state.phase === 'ready' && (
        <>
          <span>{t('update.ready', { version: state.version })}</span>
          <button
            className="bg-warning/25 hover:bg-warning/40 rounded px-2 py-0.5"
            onClick={() => window.infra.update.install()}
          >
            {t('update.restart')}
          </button>
          <button
            className="hover:text-content ml-auto"
            onClick={() => setState({ phase: 'idle' })}
          >
            {t('update.later')}
          </button>
        </>
      )}
    </div>
  )
}
