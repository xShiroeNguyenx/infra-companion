import { useMemo, useState } from 'react'
import {
  HIGHLIGHT_COLORS,
  MAX_HIGHLIGHT_RULES,
  checkHighlightPattern,
  highlightColors,
  highlightLine,
  type HighlightColor,
  type HighlightRule,
  type PatternProblem
} from '@infra/shared'
import { useT, type I18nKey } from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { newRuleId, useTermHighlightStore } from '../stores/termHighlight'
import { Button, Field, Select, TextInput } from './ui'

/**
 * F25 — Cài đặt → Tô màu & báo động: danh sách mẫu + ô thử.
 *
 * Ô thử tồn tại vì regex là thứ người ta viết sai trước rồi mới viết đúng: dán một dòng log
 * thật vào là thấy ngay mẫu nào khớp, tô ra sao, có báo động không — thay vì phải đợi đúng
 * dòng đó xuất hiện lại trên server.
 */

const PROBLEM_KEY: Record<PatternProblem, I18nKey> = {
  empty: 'hl.err.empty',
  'too-long': 'hl.err.tooLong',
  invalid: 'hl.err.invalid',
  'matches-empty': 'hl.err.matchesEmpty',
  risky: 'hl.err.risky'
}

const COLOR_KEY: Record<HighlightColor, I18nKey> = {
  red: 'hl.color.red',
  yellow: 'hl.color.yellow',
  green: 'hl.color.green',
  blue: 'hl.color.blue',
  purple: 'hl.color.purple'
}

export function HighlightRulesSection() {
  const t = useT()
  const theme = useSettingsStore((s) => (s.theme === 'light' ? 'light' : 'dark'))
  const enabled = useTermHighlightStore((s) => s.enabled)
  const rules = useTermHighlightStore((s) => s.rules)
  const compiled = useTermHighlightStore((s) => s.compiled)
  const setEnabled = useTermHighlightStore((s) => s.setEnabled)
  const setRules = useTermHighlightStore((s) => s.setRules)
  const resetRules = useTermHighlightStore((s) => s.resetRules)
  const [sample, setSample] = useState('')

  const update = (id: string, patch: Partial<HighlightRule>): void => setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const remove = (id: string): void => setRules(rules.filter((r) => r.id !== id))
  const move = (index: number, delta: -1 | 1): void => {
    const to = index + delta
    if (to < 0 || to >= rules.length) return
    const next = [...rules]
    ;[next[index], next[to]] = [next[to]!, next[index]!]
    setRules(next)
  }
  const add = (): void =>
    setRules([...rules, { id: newRuleId(), pattern: '', color: 'red', scope: 'match', notify: false, enabled: true }])

  const preview = useMemo(() => (sample.trim() ? highlightLine(sample, compiled) : null), [sample, compiled])

  return (
    <>
      <Field label={t('hl.enable')}>
        <div className="grid grid-cols-2 gap-2">
          {([true, false] as const).map((on) => (
            <button
              key={String(on)}
              onClick={() => setEnabled(on)}
              className={`rounded border px-2 py-2 text-sm ${
                enabled === on ? 'border-accent text-content bg-accent-soft/40' : 'border-edge text-muted hover:bg-hover'
              }`}
            >
              {on ? t('plugins.enable') : t('plugins.disable')}
            </button>
          ))}
        </div>
      </Field>
      <p className="text-subtle mb-1.5 text-[11px] leading-relaxed">{t('hl.hint')}</p>
      <p className="text-subtle mb-4 text-[11px] leading-relaxed">{t('hl.notifyHint')}</p>

      <div className={enabled ? '' : 'pointer-events-none opacity-50'}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-muted text-[11px] font-medium tracking-wide uppercase">{t('hl.rules')}</span>
          <span className="text-subtle text-[10px]">{t('hl.orderHint')}</span>
        </div>

        <div className="space-y-2">
          {rules.map((rule, i) => {
            const problem = checkHighlightPattern(rule.pattern)
            const c = highlightColors(theme, rule.color)
            return (
              <div key={rule.id} className={`border-edge rounded border p-2 ${rule.enabled ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => update(rule.id, { enabled: e.target.checked })}
                    title={t('hl.enabledTitle')}
                    className="accent-accent shrink-0"
                  />
                  <TextInput
                    value={rule.pattern}
                    spellCheck={false}
                    onChange={(e) => update(rule.id, { pattern: e.target.value })}
                    placeholder={t('hl.patternPh')}
                    className={`!font-mono !text-xs ${problem && rule.pattern !== '' ? '!border-danger/60' : ''}`}
                  />
                  <button
                    onClick={() => remove(rule.id)}
                    className="border-edge text-subtle hover:text-danger hover:border-danger/50 shrink-0 rounded border px-2 py-1 text-sm"
                    title={t('hl.remove')}
                  >
                    🗑
                  </button>
                </div>
                {problem && rule.pattern !== '' && <p className="text-danger mt-1 pl-6 text-[11px]">{t(PROBLEM_KEY[problem])}</p>}

                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
                  {/* Mẫu màu vẽ đúng màu sẽ tô trên terminal, theo theme đang dùng */}
                  <div className="flex items-center gap-1" role="radiogroup" aria-label={t('hl.colorLabel')}>
                    {HIGHLIGHT_COLORS.map((color) => {
                      const cc = highlightColors(theme, color)
                      return (
                        <button
                          key={color}
                          role="radio"
                          aria-checked={rule.color === color}
                          title={t(COLOR_KEY[color])}
                          onClick={() => update(rule.id, { color })}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            rule.color === color ? 'ring-accent ring-2 ring-offset-1 ring-offset-transparent' : 'opacity-70 hover:opacity-100'
                          }`}
                          style={{ backgroundColor: cc.bg, color: cc.fg }}
                        >
                          Ab
                        </button>
                      )
                    })}
                  </div>
                  <Select
                    value={rule.scope}
                    onChange={(e) => update(rule.id, { scope: e.target.value === 'line' ? 'line' : 'match' })}
                    className="!w-auto !py-0.5 !text-xs"
                  >
                    <option value="match">{t('hl.scope.match')}</option>
                    <option value="line">{t('hl.scope.line')}</option>
                  </Select>
                  <label className="text-muted flex cursor-pointer items-center gap-1 text-xs" title={t('hl.notifyTitle')}>
                    <input
                      type="checkbox"
                      checked={rule.notify}
                      onChange={(e) => update(rule.id, { notify: e.target.checked })}
                      className="accent-accent"
                    />
                    {t('hl.notify')}
                  </label>
                  <div className="flex-1" />
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                    style={rule.scope === 'line' ? { backgroundColor: c.lineBg } : { backgroundColor: c.bg, color: c.fg }}
                  >
                    {t('hl.sampleChip')}
                  </span>
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="text-subtle hover:text-content px-1 text-xs disabled:opacity-30"
                    title={t('hl.moveUp')}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === rules.length - 1}
                    className="text-subtle hover:text-content px-1 text-xs disabled:opacity-30"
                    title={t('hl.moveDown')}
                  >
                    ▼
                  </button>
                </div>
              </div>
            )
          })}
          {rules.length === 0 && <p className="text-subtle py-2 text-center text-xs">{t('hl.empty')}</p>}
          <button
            onClick={add}
            disabled={rules.length >= MAX_HIGHLIGHT_RULES}
            className="border-edge text-muted hover:bg-hover w-full rounded border border-dashed px-2 py-1.5 text-xs disabled:opacity-40"
          >
            + {t('hl.add')}
          </button>
        </div>

        <div className="mt-2 flex justify-end">
          <Button onClick={resetRules} className="!py-1 !text-xs">
            {t('hl.reset')}
          </Button>
        </div>

        {/* Ô thử: dán một dòng log thật để xem mẫu nào khớp */}
        <div className="mt-4">
          <span className="text-muted mb-1 block text-[11px] font-medium tracking-wide uppercase">{t('hl.test')}</span>
          <TextInput
            value={sample}
            spellCheck={false}
            onChange={(e) => setSample(e.target.value)}
            placeholder={t('hl.testPh')}
            className="!font-mono !text-xs"
          />
          {sample.trim() !== '' && (
            <div className="mt-1.5">
              <HighlightPreview text={sample} theme={theme} preview={preview} />
              <p className="text-subtle mt-1 text-[11px]">
                {preview === null
                  ? t('hl.testNone')
                  : preview.triggered.length > 0
                    ? t('hl.testNotify', { list: preview.triggered.map((r) => r.pattern).join(', ') })
                    : t('hl.testNoNotify')}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** Dòng thử vẽ bằng đúng màu terminal sẽ dùng. */
function HighlightPreview({
  text,
  theme,
  preview
}: {
  text: string
  theme: 'dark' | 'light'
  preview: ReturnType<typeof highlightLine>
}) {
  const parts: Array<{ text: string; color: HighlightColor | null }> = []
  let last = 0
  for (const span of preview?.spans ?? []) {
    if (span.start > last) parts.push({ text: text.slice(last, span.start), color: null })
    parts.push({ text: text.slice(span.start, span.end), color: span.color })
    last = span.end
  }
  if (last < text.length) parts.push({ text: text.slice(last), color: null })
  const lineBg = preview?.lineColor ? highlightColors(theme, preview.lineColor).lineBg : undefined
  return (
    // Màu nền/chữ lấy đúng của terminal (theme.ts) để ô thử trông như chính terminal
    <div
      className="border-edge overflow-x-auto rounded border px-2 py-1 font-mono text-xs whitespace-pre"
      style={{
        backgroundColor: lineBg ?? (theme === 'light' ? '#fafbfc' : '#0b0e14'),
        color: theme === 'light' ? '#22262d' : '#cdd6f4'
      }}
    >
      {parts.map((p, i) =>
        p.color ? (
          <span key={i} style={{ backgroundColor: highlightColors(theme, p.color).bg, color: highlightColors(theme, p.color).fg }}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </div>
  )
}
