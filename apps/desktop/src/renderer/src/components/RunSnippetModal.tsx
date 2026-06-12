import { useState } from 'react'
import type { SnippetDto } from '@infra/shared'
import { useTabsStore } from '../stores/tabs'
import { useToastsStore } from '../stores/toasts'
import { Button, Field, Modal, TextInput } from './ui'
import { parseSnippetVars, substituteSnippet } from './SnippetsModal'
import { useT } from '../i18n'

/** Chạy snippet: điền biến {{x}} + chọn các pane đích (P42 — chạy đa session). */
export function RunSnippetModal({ snippet, onClose }: { snippet: SnippetDto; onClose: () => void }) {
  const t = useT()
  const { tabs, activeId } = useTabsStore()
  // Gom tất cả pane terminal đang kết nối (qua mọi tab) làm danh sách đích
  const panes = tabs
    .filter((t) => t.kind === 'terminal')
    .flatMap((t) =>
      t.panes
        .filter((p) => p.status === 'connected')
        .map((p) => ({ sessionId: p.sessionId, label: p.title, subtitle: p.subtitle, fromActive: t.id === activeId }))
    )
  const vars = parseSnippetVars(snippet.script)
  const [values, setValues] = useState<Record<string, string>>({})
  const [targets, setTargets] = useState<Set<string>>(
    () => new Set(panes.filter((p) => p.fromActive).map((p) => p.sessionId))
  )

  const toggleTarget = (id: string): void => {
    setTargets((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const run = (): void => {
    if (targets.size === 0) return
    const script = substituteSnippet(snippet.script, values)
    for (const id of targets) {
      window.infra.terminal.write(id, script.endsWith('\n') ? script : script + '\n')
    }
    useToastsStore.getState().push(t('runSnippet.done', { label: snippet.label, n: targets.size }), 'info')
    onClose()
  }

  return (
    <Modal title={t('runSnippet.title', { label: snippet.label })} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        {vars.map((name, index) => (
          <Field key={name} label={t('runSnippet.varLabel', { name })}>
            <TextInput
              autoFocus={index === 0}
              value={values[name] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
            />
          </Field>
        ))}

        <Field label={t('runSnippet.targets', { n: targets.size })}>
          <div className="border-edge bg-input max-h-40 overflow-y-auto rounded border p-1">
            {panes.length === 0 && (
              <p className="text-subtle px-2 py-3 text-center text-xs">{t('runSnippet.noSession')}</p>
            )}
            {panes.map((pane) => (
              <label
                key={pane.sessionId}
                className="text-muted hover:bg-hover flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs select-none"
              >
                <input
                  type="checkbox"
                  checked={targets.has(pane.sessionId)}
                  onChange={() => toggleTarget(pane.sessionId)}
                />
                <span className="truncate">
                  {pane.label}
                  {pane.subtitle ? ` (${pane.subtitle})` : ''}
                </span>
              </label>
            ))}
          </div>
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={targets.size === 0}>
            {t('runSnippet.run', { n: targets.size })}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
