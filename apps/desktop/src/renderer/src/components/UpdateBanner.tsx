import { useEffect, useState } from 'react'

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }

export function UpdateBanner() {
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
    <div className="flex items-center gap-3 border-b border-yellow-700/50 bg-yellow-950/60 px-4 py-1.5 text-xs text-yellow-200">
      {state.phase === 'available' && (
        <>
          <span>Update available — v{state.version}</span>
          <button
            className="rounded bg-yellow-700/60 px-2 py-0.5 hover:bg-yellow-600/70"
            onClick={() => {
              setState({ phase: 'downloading', version: state.version, percent: 0 })
              void window.infra.update.download()
            }}
          >
            Download
          </button>
          <button
            className="ml-auto text-yellow-500 hover:text-yellow-300"
            onClick={() => setState({ phase: 'idle' })}
          >
            ✕
          </button>
        </>
      )}

      {state.phase === 'downloading' && (
        <>
          <span>Downloading v{state.version}…</span>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-yellow-900">
            <div
              className="h-full rounded-full bg-yellow-400 transition-all"
              style={{ width: `${state.percent}%` }}
            />
          </div>
          <span className="text-yellow-400">{state.percent}%</span>
        </>
      )}

      {state.phase === 'ready' && (
        <>
          <span>v{state.version} ready to install</span>
          <button
            className="rounded bg-yellow-700/60 px-2 py-0.5 hover:bg-yellow-600/70"
            onClick={() => window.infra.update.install()}
          >
            Restart & Install
          </button>
          <button
            className="ml-auto text-yellow-500 hover:text-yellow-300"
            onClick={() => setState({ phase: 'idle' })}
          >
            Later
          </button>
        </>
      )}
    </div>
  )
}
