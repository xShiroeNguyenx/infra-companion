import { useRef, useState } from 'react'
import { useDataStore } from '../stores/data'
import { diffLines, type DiffResult, type DiffRow } from '../lib/lineDiff'
import { Button, Modal, Select } from './ui'
import { useT } from '../i18n'

/**
 * F49 — So sánh 1 file config giữa 2 host SSH. Đọc nội dung qua kênh exec riêng
 * (hostTools.readFile, không đụng terminal đang mở), diff theo dòng và hiển thị side-by-side.
 * Mặc định 2 bên dùng CHUNG đường dẫn (ca sử dụng phổ biến: cùng 1 file trên nhiều server).
 */
export function CompareModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const [hostA, setHostA] = useState('')
  const [hostB, setHostB] = useState('')
  const [pathA, setPathA] = useState('')
  const [pathB, setPathB] = useState('')
  const [samePath, setSamePath] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DiffResult | null>(null)
  // Đổi host/path giữa chừng → response cũ về muộn không đè kết quả mới
  const gen = useRef(0)

  const labelOf = (id: string): string => hosts.find((h) => h.id === id)?.label ?? id

  const effPathB = samePath ? pathA : pathB

  const run = async (): Promise<void> => {
    if (!hostA || !hostB) {
      setError(t('compare.needHosts'))
      return
    }
    const pa = pathA.trim()
    const pb = effPathB.trim()
    if (!pa || !pb) {
      setError(t('compare.needPath'))
      return
    }
    const my = ++gen.current
    setBusy(true)
    setError(null)
    setResult(null)
    const [ra, rb] = await Promise.all([
      window.infra.hostTools.readFile(hostA, pa),
      window.infra.hostTools.readFile(hostB, pb)
    ])
    if (my !== gen.current) return
    setBusy(false)
    if (!ra.ok) {
      setError(`A · ${labelOf(hostA)}: ${ra.error ?? 'lỗi đọc file'}`)
      return
    }
    if (!rb.ok) {
      setError(`B · ${labelOf(hostB)}: ${rb.error ?? 'lỗi đọc file'}`)
      return
    }
    setResult(diffLines(ra.stdout, rb.stdout))
  }

  const swap = (): void => {
    setHostA(hostB)
    setHostB(hostA)
    if (!samePath) {
      setPathA(pathB)
      setPathB(pathA)
    }
    setResult(null)
  }

  const canRun = !!hostA && !!hostB && !!pathA.trim() && !!effPathB.trim() && !busy

  return (
    <Modal title={t('compare.title')} onClose={onClose}>
      <div className="flex w-[min(1100px,90vw)] max-w-full flex-col">
        {/* Chọn host + đường dẫn 2 bên */}
        <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <SidePicker
            tag="A"
            host={hostA}
            onHost={(v) => {
              setHostA(v)
              setResult(null)
            }}
            path={pathA}
            onPath={(v) => {
              setPathA(v)
              setResult(null)
            }}
            hosts={hosts}
          />
          <button
            className="border-edge-strong text-muted hover:bg-hover hover:text-content mb-1 rounded border px-2 py-1.5 text-sm"
            title={t('compare.swap')}
            onClick={swap}
          >
            ⇄
          </button>
          <SidePicker
            tag="B"
            host={hostB}
            onHost={(v) => {
              setHostB(v)
              setResult(null)
            }}
            path={samePath ? pathA : pathB}
            onPath={(v) => {
              setPathB(v)
              setResult(null)
            }}
            pathDisabled={samePath}
            hosts={hosts}
          />
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-3">
          <label className="text-muted flex cursor-pointer items-center gap-1.5 text-xs select-none">
            <input
              type="checkbox"
              checked={samePath}
              onChange={(e) => {
                setSamePath(e.target.checked)
                setResult(null)
              }}
            />
            {t('compare.samePath')}
          </label>
          <Button variant="primary" className="!px-3 !py-1 !text-xs" disabled={!canRun} onClick={() => void run()}>
            {busy ? t('compare.reading') : t('compare.run')}
          </Button>
          {result && (
            <span className="text-xs">
              {result.identical ? (
                <span className="text-success">{t('compare.identical')}</span>
              ) : (
                <>
                  <span className="text-success">+{result.added}</span>{' '}
                  <span className="text-danger">−{result.removed}</span>{' '}
                  <span className="text-warning">~{result.changed}</span>
                </>
              )}
            </span>
          )}
          {result?.truncated && <span className="text-subtle text-[10px]">{t('compare.truncated')}</span>}
        </div>

        {error && <p className="text-danger mb-2 text-xs break-words">{error}</p>}

        {/* Bảng diff side-by-side — cuộn dọc, mỗi bên có số dòng riêng */}
        {result && (
          <div className="border-edge bg-app max-h-[60vh] overflow-auto rounded border font-mono text-[11px] leading-relaxed">
            <div className="bg-panel text-subtle sticky top-0 z-10 grid grid-cols-2 border-b text-[10px]">
              <div className="border-edge truncate border-r px-2 py-1" title={`${labelOf(hostA)} · ${pathA}`}>
                A · {labelOf(hostA) || '—'}
              </div>
              <div className="truncate px-2 py-1" title={`${labelOf(hostB)} · ${effPathB}`}>
                B · {labelOf(hostB) || '—'}
              </div>
            </div>
            {result.rows.map((row, i) => (
              <DiffRowView key={i} row={row} />
            ))}
          </div>
        )}

        {!result && !error && <p className="text-subtle py-6 text-center text-xs">{t('compare.hint')}</p>}
      </div>
    </Modal>
  )
}

function SidePicker({
  tag,
  host,
  onHost,
  path,
  onPath,
  pathDisabled,
  hosts
}: {
  tag: string
  host: string
  onHost: (v: string) => void
  path: string
  onPath: (v: string) => void
  pathDisabled?: boolean
  hosts: { id: string; label: string }[]
}) {
  const t = useT()
  return (
    <div className="min-w-0">
      <div className="text-subtle mb-1 text-[10px] font-semibold tracking-wide uppercase">
        {t('compare.side')} {tag}
      </div>
      <Select className="mb-1.5" value={host} onChange={(e) => onHost(e.target.value)}>
        <option value="">{t('compare.chooseHost')}</option>
        {hosts.map((h) => (
          <option key={h.id} value={h.id}>
            {h.label}
          </option>
        ))}
      </Select>
      <input
        value={path}
        disabled={pathDisabled}
        onChange={(e) => onPath(e.target.value)}
        placeholder={t('compare.pathPh')}
        className="border-edge-strong bg-input text-content placeholder-subtle focus:border-accent w-full rounded border px-2 py-1.5 font-mono text-xs outline-none disabled:opacity-50"
      />
    </div>
  )
}

function DiffRowView({ row }: { row: DiffRow }) {
  // Màu nền theo loại: xoá đỏ (trái), thêm xanh (phải), đổi = đỏ trái + xanh phải
  const leftBg = row.type === 'del' || row.type === 'change' ? 'bg-danger/15' : ''
  const rightBg = row.type === 'add' || row.type === 'change' ? 'bg-success/15' : ''
  return (
    <div className={`grid grid-cols-2 ${row.type === 'same' ? '' : ''}`}>
      <Cell no={row.leftNo} text={row.left} bg={leftBg} border />
      <Cell no={row.rightNo} text={row.right} bg={rightBg} />
    </div>
  )
}

function Cell({ no, text, bg, border }: { no?: number; text?: string; bg: string; border?: boolean }) {
  return (
    <div className={`flex ${border ? 'border-edge border-r' : ''} ${bg}`}>
      <span className="text-subtle w-10 shrink-0 border-edge/60 border-r px-1 text-right select-none">{no ?? ''}</span>
      <span className="text-content min-w-0 flex-1 px-2 whitespace-pre-wrap break-all">
        {text ?? ''}
      </span>
    </div>
  )
}
