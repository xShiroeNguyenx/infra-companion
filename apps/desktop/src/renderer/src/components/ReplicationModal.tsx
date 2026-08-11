import { useEffect, useState } from 'react'
import type { ReplCmdDto, ReplDiagnosisDto, ReplSampleDto, ReplSnapshotDto } from '@infra/shared'
import { useReplicationStore } from '../stores/replication'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { Button, ConfirmModal, ModalOrPanel, Select } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { ReplicationCompareView } from './ReplicationCompareView'
import { ReplicationHistoryView } from './ReplicationHistoryView'
import { ReplicationPairEditor } from './ReplicationPairEditor'
import { ReplicationSettingsModal } from './ReplicationSettingsModal'
import { useT } from '../i18n'

/**
 * F55 — Panel theo dõi bất đồng bộ master ↔ slave.
 *
 * App CHỈ ĐỌC trạng thái và đưa runbook — không có nút nào chạy lệnh sửa lên server. Lệnh hiện
 * ra kèm nút copy; lệnh `destructive` phải xác nhận trước khi copy để không ai lỡ tay dán
 * `sql_slave_skip_counter` vào production lúc 3 giờ sáng.
 */
export function ReplicationModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const pairs = useReplicationStore((s) => s.pairs)
  const runtime = useReplicationStore((s) => s.runtime)
  const loaded = useReplicationStore((s) => s.loaded)
  const error = useReplicationStore((s) => s.error)
  const loadPairs = useReplicationStore((s) => s.loadPairs)
  const deletePair = useReplicationStore((s) => s.deletePair)
  const pollNow = useReplicationStore((s) => s.pollNow)
  const watch = useReplicationStore((s) => s.watch)
  const unwatch = useReplicationStore((s) => s.unwatch)

  const [selectedId, setSelectedId] = useState('')
  const [editing, setEditing] = useState<{ open: true; id: string | null } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [view, setView] = useState<'status' | 'compare' | 'history'>('status')

  useEffect(() => {
    if (!loaded) void loadPairs()
  }, [loaded, loadPairs])

  // Chọn sẵn cặp đầu tiên để mở panel là thấy ngay, khỏi phải bấm thêm
  useEffect(() => {
    if (!selectedId && pairs.length > 0) setSelectedId(pairs[0].id)
    if (selectedId && !pairs.some((p) => p.id === selectedId)) setSelectedId(pairs[0]?.id ?? '')
  }, [pairs, selectedId])

  const pair = pairs.find((p) => p.id === selectedId) ?? null
  const state = selectedId ? runtime[selectedId] : undefined
  /** Xếp theo đúng thứ tự slave user đã sắp, kèm kết quả đo mới nhất (nếu đã có). */
  const measured = (pair?.replicas ?? []).map((r) => ({
    replica: r,
    snapshot: state?.replicas[r.id]?.snapshot ?? null
  }))
  /** Master đọc một lần cho cả cụm → lấy từ sample bất kỳ đã đo được. */
  const masterSample = measured.find((m) => m.snapshot?.sample.master)?.snapshot?.sample ?? null
  const anyMeasured = measured.some((m) => m.snapshot)
  /** Slave chọn để so lệch (tab Data drift chạy trên 1 slave). */
  const [compareReplicaId, setCompareReplicaId] = useState('')
  const compareId = compareReplicaId || pair?.replicas[0]?.id || ''

  const test = async (): Promise<void> => {
    if (!pair) return
    setTesting(true)
    try {
      const res = await window.infra.replication.testPair(pair.id)
      useToastsStore.getState().push(res.message, res.ok ? 'info' : 'error')
    } catch (err) {
      useToastsStore.getState().push(errorMessage(err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <ModalOrPanel
      embedded={embedded}
      title={t('repl.title')}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="replication" onDone={onClose} />}
    >
      <div className="w-[820px] max-w-full">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select className="!w-64" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">{t('repl.choosePair')}</option>
            {pairs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button className="!px-2 !py-1 !text-xs" onClick={() => setEditing({ open: true, id: null })}>
            + {t('repl.addPair')}
          </Button>
          <Button className="!px-2 !py-1 !text-xs" title={t('repl.settings.title')} onClick={() => setSettingsOpen(true)}>
            ⚙
          </Button>
          {pair && (
            <>
              <Button className="!px-2 !py-1 !text-xs" onClick={() => setEditing({ open: true, id: pair.id })}>
                {t('repl.edit')}
              </Button>
              <Button className="!px-2 !py-1 !text-xs" onClick={() => setConfirmDelete(pair.id)}>
                {t('common.delete')}
              </Button>
              <Button className="!px-2 !py-1 !text-xs" disabled={testing} onClick={() => void test()}>
                {testing ? '…' : t('repl.testConn')}
              </Button>
              <label className="text-muted flex shrink-0 cursor-pointer items-center gap-1.5 text-xs select-none">
                <input
                  type="checkbox"
                  checked={state?.watching ?? false}
                  onChange={(e) => (e.target.checked ? void watch(pair.id) : unwatch(pair.id))}
                />
                {t('repl.watch')}
              </label>
              <Button
                className="!px-2 !py-1 !text-xs"
                disabled={state?.busy}
                onClick={() => void pollNow(pair.id)}
              >
                {state?.busy ? '…' : '↻'}
              </Button>
            </>
          )}
        </div>

        {error && <p className="text-danger mb-2 text-xs">{error}</p>}

        {!pair && <p className="text-subtle px-2 py-10 text-center text-sm">{t('repl.noPair')}</p>}

        {pair && (
          <div className="border-edge-strong mb-3 flex w-fit overflow-hidden rounded border text-xs">
            {(['status', 'compare', 'history'] as const).map((k) => (
              <button
                key={k}
                className={`px-3 py-1 ${view === k ? 'bg-accent-soft/60 text-accent-fg' : 'text-muted hover:bg-hover'}`}
                onClick={() => setView(k)}
              >
                {t(`repl.view.${k}` as const)}
              </button>
            ))}
          </div>
        )}

        {pair && view === 'status' && !anyMeasured && (
          <p className="text-subtle px-2 py-10 text-center text-sm">
            {state?.busy ? '…' : t('repl.notMeasured')}
          </p>
        )}

        {pair && view === 'status' && anyMeasured && (
          <>
            <MasterStrip sample={masterSample} />
            <div className="flex flex-col gap-2">
              {measured.map(({ replica, snapshot }) => (
                <ReplicaCard
                  key={replica.id}
                  label={replica.label || snapshot?.sample.replicaLabel || replica.hostId}
                  snapshot={snapshot}
                  soloInCluster={measured.length === 1}
                />
              ))}
            </div>
          </>
        )}

        {pair && view === 'compare' && (
          <>
            {pair.replicas.length > 1 && (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-subtle text-[10px] tracking-wide uppercase">{t('repl.cmp.forReplica')}</span>
                <Select
                  className="!w-56"
                  value={compareId}
                  onChange={(e) => setCompareReplicaId(e.target.value)}
                >
                  {pair.replicas.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label || r.hostId}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <ReplicationCompareView key={compareId} pairId={pair.id} replicaId={compareId} />
          </>
        )}

        {pair && view === 'history' && (
          <ReplicationHistoryView key={pair.id} pairId={pair.id} pairName={pair.name} />
        )}

        <p className="text-subtle mt-3 text-[10px] leading-relaxed">{t('repl.footNote')}</p>
      </div>

      {editing && (
        <ReplicationPairEditor
          pair={editing.id ? (pairs.find((p) => p.id === editing.id) ?? null) : null}
          onClose={() => setEditing(null)}
        />
      )}

      {settingsOpen && <ReplicationSettingsModal onClose={() => setSettingsOpen(false)} />}

      {confirmDelete && (
        <ConfirmModal
          title={t('repl.deletePair')}
          message={t('repl.deleteConfirm', { name: pairs.find((p) => p.id === confirmDelete)?.name ?? '' })}
          onConfirm={() => {
            const id = confirmDelete
            setConfirmDelete(null)
            void deletePair(id)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </ModalOrPanel>
  )
}

// ---------------------------------------------------------------------------
// Thẻ trạng thái
// ---------------------------------------------------------------------------

/**
 * Master hiện MỘT lần ở trên cùng — nó đọc một lần cho cả cụm, lặp lại trong từng thẻ slave
 * vừa thừa vừa dễ khiến người đọc tưởng mỗi slave so với một mốc khác nhau.
 */
function MasterStrip({ sample }: { sample: ReplSampleDto | null }) {
  const t = useT()
  if (!sample) return null
  return (
    <div className="border-edge bg-panel mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded border px-3 py-2">
      <span className="text-subtle text-[10px] font-medium tracking-wide uppercase">{t('repl.masterLabel')}</span>
      <Stat label={t('repl.stat.masterPos')} value={posText(sample.master?.file ?? null, sample.master?.position ?? null)} />
      {sample.masterVars?.binlogFormat && <Stat label="binlog_format" value={sample.masterVars.binlogFormat} />}
      {sample.masterVars?.serverId !== null && sample.masterVars?.serverId !== undefined && (
        <Stat label="server_id" value={String(sample.masterVars.serverId)} />
      )}
      <span className="text-subtle ml-auto text-[10px]">
        {t('repl.measuredAt', { time: new Date(sample.ts).toLocaleTimeString() })}
      </span>
      {sample.masterError && (
        <p className="text-warning w-full text-[10px]">{t('repl.masterUnreadable', { error: sample.masterError })}</p>
      )}
    </div>
  )
}

/** Một slave: hàng tóm tắt luôn hiện, bấm để bung chẩn đoán + runbook của riêng nó. */
function ReplicaCard({
  label,
  snapshot,
  soloInCluster
}: {
  label: string
  snapshot: ReplSnapshotDto | null
  soloInCluster: boolean
}) {
  const t = useT()
  const worst = snapshot?.diagnoses[0]?.severity
  // Cụm 1 slave thì bung sẵn (không có gì để so nên đóng lại chỉ tốn thêm 1 cú bấm);
  // nhiều slave thì chỉ bung con đang có sự cố nặng.
  const [open, setOpen] = useState(soloInCluster || worst === 'critical')

  const tone =
    worst === 'critical'
      ? 'border-danger/60 bg-danger/5'
      : worst === 'warn'
        ? 'border-warning/60 bg-warning/5'
        : 'border-edge bg-panel'

  if (!snapshot) {
    return (
      <div className="border-edge bg-panel rounded border px-3 py-2">
        <span className="text-content text-sm font-medium">{label}</span>
        <span className="text-subtle ml-2 text-xs">{t('repl.notMeasuredYet')}</span>
      </div>
    )
  }

  const { sample } = snapshot
  return (
    <div className={`rounded border ${tone}`}>
      <button className="hover:bg-hover/40 flex w-full flex-col gap-1 px-3 py-2 text-left" onClick={() => setOpen((v) => !v)}>
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-content text-sm font-semibold">{label}</span>
          <span className="text-muted text-xs">{headline(sample, t)}</span>
          {/* CLI đắt hơn driver rõ rệt: mỗi chu kỳ phải spawn tiến trình mysql trên server
              (host login-script còn là ssh lồng + su) → tô nhắc để user biết mà mở đường driver. */}
          {sample.mode === 'cli' && (
            <span
              className="border-warning/60 text-warning rounded border px-1.5 py-0.5 text-[10px]"
              title={t('repl.viaCliCost')}
            >
              {t('repl.viaCli')}
            </span>
          )}
          {sample.mode === 'driver' && (
            <span className="border-edge text-subtle rounded border px-1.5 py-0.5 text-[10px]">
              {t('repl.viaDriver')}
            </span>
          )}
          {snapshot.diagnoses.length > 0 && (
            <span className="text-subtle text-[10px]">{t('repl.issueCount', { n: snapshot.diagnoses.length })}</span>
          )}
          <span className="text-subtle ml-auto text-xs">{open ? '▾' : '▸'}</span>
        </div>

        {sample.error && <p className="text-danger w-full text-xs">{sample.error}</p>}

        {sample.replica && (
          <div className="grid w-full grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            <Stat label="IO thread" value={sample.replica.ioRunning} bad={sample.replica.ioRunning !== 'yes'} />
            <Stat label="SQL thread" value={sample.replica.sqlRunning} bad={sample.replica.sqlRunning !== 'yes'} />
            <Stat
              label={t('repl.stat.lag')}
              value={
                sample.drift?.effectiveLagSec === null || sample.drift === null
                  ? '—'
                  : fmtDuration(sample.drift.effectiveLagSec)
              }
              bad={(sample.drift?.effectiveLagSec ?? 0) >= 60}
            />
            <Stat
              label={t('repl.stat.fetchGap')}
              value={fmtGap(sample.drift?.fetchGapBytes ?? null, sample.drift?.fetchFilesBehind ?? null, t)}
            />
            <Stat
              label={t('repl.stat.applyGap')}
              value={fmtGap(sample.drift?.applyGapBytes ?? null, sample.drift?.applyFilesBehind ?? null, t)}
            />
            <Stat
              label={t('repl.stat.readOnly')}
              value={boolText(sample.replicaVars?.readOnly, t)}
              bad={sample.replicaVars?.readOnly === false}
            />
            <Stat label={t('repl.stat.readPos')} value={posText(sample.replica.readFile, sample.replica.readPos)} />
            <Stat label={t('repl.stat.execPos')} value={posText(sample.replica.execFile, sample.replica.execPos)} />
          </div>
        )}
      </button>

      {open && (
        <div className="border-edge/60 border-t px-3 py-2">
          {sample.replica?.sqlRunningState && (
            <p className="text-subtle mb-2 text-[10px]">{t('repl.sqlState', { state: sample.replica.sqlRunningState })}</p>
          )}
          <DiagnosisList diagnoses={snapshot.diagnoses} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-subtle shrink-0 text-[10px] tracking-wide uppercase">{label}</span>
      <span className={`truncate font-mono text-xs ${bad ? 'text-danger font-semibold' : 'text-content'}`} title={value}>
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Danh sách chẩn đoán + runbook
// ---------------------------------------------------------------------------

function DiagnosisList({ diagnoses }: { diagnoses: ReplDiagnosisDto[] }) {
  const t = useT()
  if (diagnoses.length === 0) {
    return <p className="text-subtle px-2 py-4 text-center text-xs">{t('repl.allGood')}</p>
  }
  return (
    <div className="flex flex-col gap-2">
      {diagnoses.map((d) => (
        <DiagnosisCard key={d.id} diagnosis={d} />
      ))}
    </div>
  )
}

const SEVERITY_STYLE: Record<ReplDiagnosisDto['severity'], { border: string; badge: string; icon: string }> = {
  critical: { border: 'border-danger/60', badge: 'bg-danger text-white', icon: '🔴' },
  warn: { border: 'border-warning/60', badge: 'bg-warning text-black', icon: '⚠' },
  info: { border: 'border-edge', badge: 'bg-hover text-muted', icon: 'ℹ' }
}

function DiagnosisCard({ diagnosis }: { diagnosis: ReplDiagnosisDto }) {
  const t = useT()
  const [open, setOpen] = useState(diagnosis.severity === 'critical')
  const style = SEVERITY_STYLE[diagnosis.severity]
  const total = diagnosis.checks.length + diagnosis.fixes.length

  return (
    <div className={`rounded border ${style.border}`}>
      <button
        className="hover:bg-hover flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.badge}`}>{style.icon}</span>
        <span className="text-content min-w-0 flex-1 text-sm font-medium">{diagnosis.title}</span>
        {total > 0 && <span className="text-subtle text-[10px]">{t('repl.cmdCount', { n: total })}</span>}
        <span className="text-subtle text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-edge/60 border-t px-3 py-2">
          <p className="text-muted mb-2 text-xs leading-relaxed whitespace-pre-wrap">{diagnosis.why}</p>
          {diagnosis.checks.length > 0 && <CmdGroup title={t('repl.checks')} cmds={diagnosis.checks} />}
          {diagnosis.fixes.length > 0 && <CmdGroup title={t('repl.fixes')} cmds={diagnosis.fixes} />}
        </div>
      )}
    </div>
  )
}

function CmdGroup({ title, cmds }: { title: string; cmds: ReplCmdDto[] }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="text-subtle mb-1 text-[10px] font-medium tracking-wide uppercase">{title}</p>
      <div className="flex flex-col gap-1.5">
        {cmds.map((cmd, i) => (
          <CmdBlock key={`${cmd.label}-${i}`} cmd={cmd} />
        ))}
      </div>
    </div>
  )
}

const DANGER_STYLE: Record<ReplCmdDto['danger'], string> = {
  safe: 'text-muted',
  caution: 'text-warning',
  destructive: 'text-danger font-semibold'
}

function CmdBlock({ cmd }: { cmd: ReplCmdDto }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(cmd.text)
    useToastsStore.getState().push(t('repl.copied'), 'info')
  }

  return (
    <div className="border-edge/60 rounded border">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="border-edge text-subtle shrink-0 rounded border px-1 py-0.5 text-[9px] uppercase">
          {cmd.on === 'master' ? 'master' : 'replica'}
        </span>
        <span className={`min-w-0 flex-1 text-[11px] ${DANGER_STYLE[cmd.danger]}`}>{cmd.label}</span>
        <button
          className="text-subtle hover:text-accent-fg shrink-0 rounded px-1.5 text-[10px]"
          title={t('repl.copy')}
          onClick={() => (cmd.danger === 'destructive' ? setConfirming(true) : copy())}
        >
          ⧉
        </button>
      </div>
      <pre className="bg-input text-content overflow-x-auto px-2 py-1.5 font-mono text-[10.5px] leading-relaxed whitespace-pre">
        {cmd.text}
      </pre>
      {cmd.note && <p className="text-subtle px-2 pb-1.5 text-[10px] leading-relaxed">{cmd.note}</p>}

      {confirming && (
        <ConfirmModal
          title={t('repl.dangerTitle')}
          message={
            <>
              <p className="mb-2">{cmd.note ?? t('repl.dangerGeneric')}</p>
              <p>{t('repl.dangerAsk')}</p>
            </>
          }
          confirmLabel={t('repl.copy')}
          onConfirm={() => {
            setConfirming(false)
            copy()
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Định dạng
// ---------------------------------------------------------------------------

type Translate = ReturnType<typeof useT>

function headline(sample: ReplSampleDto, t: Translate): string {
  if (!sample.ok) return t('repl.head.unreadable')
  if (!sample.replica) return t('repl.head.notReplica')
  if (!sample.drift?.healthy) return t('repl.head.broken')
  const lag = sample.drift.effectiveLagSec
  if (lag === null) return t('repl.head.runningUnknownLag')
  if (lag === 0) return t('repl.head.inSync')
  return t('repl.head.behind', { lag: fmtDuration(lag) })
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60 ? ` ${sec % 60}s` : ''}`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h${m ? ` ${m}m` : ''}`
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/** Khác file binlog thì KHÔNG suy ra được số byte — hiện số file thay vì bịa một con số. */
function fmtGap(bytes: number | null, filesBehind: number | null, t: Translate): string {
  if (bytes !== null) return fmtBytes(bytes)
  if (filesBehind !== null && filesBehind > 0) return t('repl.filesBehind', { n: filesBehind })
  return '—'
}

function boolText(value: boolean | null | undefined, t: Translate): string {
  if (value === true) return 'ON'
  if (value === false) return 'OFF'
  return t('repl.unknown')
}

function posText(file: string | null, pos: number | null): string {
  if (!file) return '—'
  return `${file}:${pos ?? '?'}`
}
