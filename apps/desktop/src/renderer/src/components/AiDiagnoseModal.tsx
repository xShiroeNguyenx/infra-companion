import { useState } from 'react'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { useAiDiagnoseStore, type DiagnoseStep } from '../stores/aiDiagnose'
import { useDataStore } from '../stores/data'
import { useTabsStore } from '../stores/tabs'
import { Button, Field, Modal, Select, TextArea } from './ui'

/** F48 — AI chẩn đoán sự cố: mô tả triệu chứng → AI đề xuất lệnh read-only từng bước,
 *  user duyệt → chạy qua kênh exec riêng → AI đọc output đề xuất tiếp → kết luận. */
export function AiDiagnoseModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const session = useAiDiagnoseStore((s) => s.session)
  const start = useAiDiagnoseStore((s) => s.start)
  const approve = useAiDiagnoseStore((s) => s.approve)
  const skip = useAiDiagnoseStore((s) => s.skip)
  const stop = useAiDiagnoseStore((s) => s.stop)
  const reset = useAiDiagnoseStore((s) => s.close)

  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  const activeHostId = useTabsStore((s) => {
    const tab = s.tabs.find((tb) => tb.id === s.activeId)
    if (tab?.kind !== 'terminal') return null
    const pane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
    return pane?.origin?.kind === 'host' ? pane.origin.hostId : null
  })

  const [hostId, setHostId] = useState(activeHostId ?? hosts[0]?.id ?? '')
  const [symptom, setSymptom] = useState('')

  const begin = (): void => {
    const host = hosts.find((h) => h.id === hostId)
    if (!host || !symptom.trim()) return
    void start(host.id, host.label, symptom.trim())
  }

  return (
    <Modal title={`🩺 ${t('ai.diagnose.title')}`} onClose={onClose} closeOnBackdrop={false}>
      <div className="w-[min(620px,88vw)]">
        {!session ? (
          <>
            <Field label={t('ai.diagnose.hostLabel')}>
              <Select value={hostId} onChange={(e) => setHostId(e.target.value)}>
                {hosts.length === 0 && <option value="">{t('ai.diagnose.noHosts')}</option>}
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('ai.diagnose.symptomLabel')}>
              <TextArea
                rows={3}
                autoFocus
                value={symptom}
                placeholder={t('ai.diagnose.symptomPlaceholder')}
                onChange={(e) => setSymptom(e.target.value)}
              />
            </Field>
            <p className="text-subtle mb-3 text-[11px] leading-relaxed">{t('ai.diagnose.readonlyNote')}</p>
            <div className="flex justify-end">
              <Button variant="primary" disabled={!hostId || !symptom.trim()} onClick={begin}>
                {t('ai.diagnose.start')}
              </Button>
            </div>
          </>
        ) : (
          <SessionView
            onApprove={() => void approve()}
            onSkip={() => void skip()}
            onStop={stop}
            onNew={reset}
          />
        )}
      </div>
    </Modal>
  )
}

function SessionView({
  onApprove,
  onSkip,
  onStop,
  onNew
}: {
  onApprove: () => void
  onSkip: () => void
  onStop: () => void
  onNew: () => void
}) {
  const t = useT()
  const session = useAiDiagnoseStore((s) => s.session)
  if (!session) return null
  const busy = session.status === 'thinking' || session.status === 'running'

  return (
    <div className="space-y-3">
      <div className="border-edge bg-input rounded border px-3 py-2 text-xs">
        <span className="text-subtle">{session.hostLabel}</span>
        <p className="text-content mt-0.5">{session.symptom}</p>
      </div>

      <div className="max-h-[46vh] space-y-2 overflow-y-auto">
        {session.steps.map((step, i) => (
          <StepCard key={i} index={i} step={step} onApprove={onApprove} onSkip={onSkip} />
        ))}

        {session.status === 'thinking' && (
          <div className="text-muted flex items-center gap-2 py-1 text-xs">
            <span className="bg-warning size-2 animate-pulse rounded-full" />
            {t('ai.diagnose.thinking')}
          </div>
        )}

        {session.status === 'done' && session.conclusion && (
          <div className="border-success/40 bg-success/5 rounded border px-3 py-2">
            <div className="text-success mb-1 text-[11px] font-semibold tracking-wide uppercase">
              {t('ai.diagnose.conclusion')}
            </div>
            <MiniMarkdown source={session.conclusion} />
          </div>
        )}

        {session.status === 'error' && (
          <p className="text-danger text-xs break-words">{session.error}</p>
        )}

        {session.status === 'stopped' && (
          <p className="text-subtle text-xs">{t('ai.diagnose.stopped')}</p>
        )}
      </div>

      <div className="flex justify-between gap-2">
        <Button className="!text-xs" onClick={onNew}>
          {t('ai.diagnose.new')}
        </Button>
        {(session.status === 'awaiting' || busy) && (
          <Button className="!text-xs" onClick={onStop}>
            {t('ai.diagnose.stop')}
          </Button>
        )}
      </div>
    </div>
  )
}

function StepCard({
  index,
  step,
  onApprove,
  onSkip
}: {
  index: number
  step: DiagnoseStep
  onApprove: () => void
  onSkip: () => void
}) {
  const t = useT()
  return (
    <div className="border-edge rounded border px-3 py-2">
      <div className="text-subtle mb-1 text-[10px] tracking-wide uppercase">
        {t('ai.diagnose.step')} {index + 1}
      </div>
      {step.reasoning && (
        <div className="mb-1.5 text-xs">
          <MiniMarkdown source={step.reasoning} />
        </div>
      )}
      <pre className="border-edge-strong bg-input text-content overflow-x-auto rounded border px-2 py-1 font-mono text-[11px]">
        {step.command}
      </pre>

      {step.status === 'proposed' && (
        <div className="mt-2 flex gap-2">
          <Button variant="primary" className="!px-2 !py-1 !text-xs" onClick={onApprove}>
            {t('ai.diagnose.approve')}
          </Button>
          <Button className="!px-2 !py-1 !text-xs" onClick={onSkip}>
            {t('ai.diagnose.skip')}
          </Button>
        </div>
      )}
      {step.status === 'running' && <p className="text-muted mt-1.5 text-[11px]">{t('ai.diagnose.running')}</p>}
      {step.status === 'skipped' && <p className="text-subtle mt-1.5 text-[11px]">{t('ai.diagnose.skipped')}</p>}
      {step.status === 'blocked' && (
        <p className="text-danger mt-1.5 text-[11px]">⛔ {t('ai.diagnose.blocked')}: {step.blockedReason}</p>
      )}
      {step.status === 'error' && <p className="text-danger mt-1.5 text-[11px] break-words">{step.error}</p>}
      {step.status === 'done' && step.output !== undefined && (
        <pre className="border-edge/70 text-muted mt-1.5 max-h-40 overflow-auto border-t pt-1.5 font-mono text-[10px] whitespace-pre-wrap">
          {step.output || t('ai.diagnose.emptyOutput')}
        </pre>
      )}
    </div>
  )
}
