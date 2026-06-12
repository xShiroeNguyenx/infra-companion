import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { RecordingInfoDto } from '@infra/shared'
import { defaultTerminalTheme } from '../features/terminal/theme'
import { formatSize, formatTime } from '../lib/paths'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { Button, ConfirmModal, Modal } from './ui'

interface CastEvent {
  t: number
  data: string
}

/** Danh sách bản ghi phiên (.cast) + player replay. */
export function RecordingsModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<RecordingInfoDto[]>([])
  const [playing, setPlaying] = useState<{ name: string; header: { width: number; height: number }; events: CastEvent[] } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const refresh = (): void => {
    void window.infra.recordings.list().then(setList)
  }
  useEffect(refresh, [])

  const open = async (name: string): Promise<void> => {
    try {
      const text = await window.infra.recordings.read(name)
      const lines = text.split('\n').filter((l) => l.trim())
      const header = JSON.parse(lines[0]!) as { width: number; height: number }
      const events: CastEvent[] = []
      for (const line of lines.slice(1)) {
        try {
          const [t, kind, data] = JSON.parse(line) as [number, string, string]
          if (kind === 'o') events.push({ t, data })
        } catch {
          // bỏ dòng hỏng
        }
      }
      setPlaying({ name, header, events })
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
  }

  const remove = async (name: string): Promise<void> => {
    try {
      await window.infra.recordings.delete(name)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    }
    refresh()
  }

  if (playing) {
    return <ReplayPlayer recording={playing} onBack={() => setPlaying(null)} onClose={onClose} />
  }

  return (
    <Modal title="Bản ghi phiên (Session Recordings)" onClose={onClose}>
      <div className="w-[560px] max-w-full">
        <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500">
          <span>{list.length} bản ghi (.cast — chuẩn asciinema)</span>
          <button className="hover:text-zinc-200" onClick={() => window.infra.recordings.openFolder()}>
            📂 Mở thư mục
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {list.length === 0 && (
            <p className="py-8 text-center text-xs text-zinc-500">
              Chưa có bản ghi. Bật <b>⏯ Ghi hình</b> trên thanh công cụ tab terminal để tạo.
            </p>
          )}
          {list.map((rec) => (
            <div key={rec.name} className="mb-1.5 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-zinc-200">{rec.name}</div>
                <div className="text-[10px] text-zinc-500">
                  {formatSize(rec.sizeBytes)} · {formatTime(rec.mtimeMs)}
                </div>
              </div>
              <Button className="!px-2 !py-1 !text-xs" variant="primary" onClick={() => void open(rec.name)}>
                ▶ Replay
              </Button>
              <Button className="!px-2 !py-1 !text-xs" variant="danger" onClick={() => setConfirmDelete(rec.name)}>
                Xoá
              </Button>
            </div>
          ))}
        </div>
      </div>
      {confirmDelete && (
        <ConfirmModal
          title="Xoá bản ghi"
          message={
            <>
              Xoá vĩnh viễn bản ghi <b>{confirmDelete}</b>? Không khôi phục được.
            </>
          }
          onConfirm={() => {
            void remove(confirmDelete)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </Modal>
  )
}

const SPEEDS = [1, 2, 4, 8]

function ReplayPlayer({
  recording,
  onBack,
  onClose
}: {
  recording: { name: string; header: { width: number; height: number }; events: CastEvent[] }
  onBack: () => void
  onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [time, setTime] = useState(0)
  const duration = recording.events.length > 0 ? recording.events[recording.events.length - 1]!.t : 0

  // refs cho vòng lặp replay
  const playingRef = useRef(true)
  const speedRef = useRef(1)
  const clockRef = useRef(0)
  const idxRef = useRef(0)
  useEffect(() => {
    playingRef.current = playing
  }, [playing])
  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      theme: defaultTerminalTheme,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      cols: recording.header.width || 80,
      rows: recording.header.height || 24,
      scrollback: 5000,
      disableStdin: true,
      convertEol: false
    })
    term.open(host)
    termRef.current = term

    let last = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const dt = (now - last) / 1000
      last = now
      if (playingRef.current) {
        clockRef.current += dt * speedRef.current
        // ghi mọi event tới thời điểm hiện tại
        while (idxRef.current < recording.events.length && recording.events[idxRef.current]!.t <= clockRef.current) {
          term.write(recording.events[idxRef.current]!.data)
          idxRef.current += 1
        }
        setTime(clockRef.current)
        if (idxRef.current >= recording.events.length) setPlaying(false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const restart = (): void => {
    const term = termRef.current
    if (!term) return
    term.reset()
    clockRef.current = 0
    idxRef.current = 0
    setTime(0)
    setPlaying(true)
  }

  const seek = (target: number): void => {
    const term = termRef.current
    if (!term) return
    term.reset()
    // tua: ghi nhanh toàn bộ event tới mốc target
    let i = 0
    while (i < recording.events.length && recording.events[i]!.t <= target) {
      term.write(recording.events[i]!.data)
      i += 1
    }
    idxRef.current = i
    clockRef.current = target
    setTime(target)
  }

  return (
    <Modal title={`Replay — ${recording.name}`} onClose={onClose}>
      <div className="w-[760px] max-w-full">
        {/* overflow-auto: bản ghi từ terminal to hơn khung vẫn cuộn xem được (fit sẽ đổi cols làm vỡ layout cast) */}
        <div ref={hostRef} className="mb-2 h-[420px] w-full overflow-auto rounded border border-zinc-800 bg-[#0b0e14] p-1" />

        {/* Thanh điều khiển */}
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <Button className="!px-2 !py-1 !text-xs" onClick={() => setPlaying((p) => !p)}>
            {playing ? '⏸' : '▶'}
          </Button>
          <Button className="!px-2 !py-1 !text-xs" onClick={restart}>
            ↺
          </Button>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.1)}
            step={0.1}
            value={Math.min(time, duration)}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="w-20 text-right font-mono text-[11px] text-zinc-500">
            {time.toFixed(1)}s / {duration.toFixed(1)}s
          </span>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-200 outline-none"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex justify-between">
          <Button onClick={onBack}>← Danh sách</Button>
          <Button onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </Modal>
  )
}
