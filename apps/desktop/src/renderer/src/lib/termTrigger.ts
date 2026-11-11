import { decideTrigger, shortenCommand, triggerExcerpt, type HighlightRule, type TriggerState } from '@infra/shared'
import { translate } from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { useTabsStore } from '../stores/tabs'
import { useToastsStore } from '../stores/toasts'

/**
 * F25 — một dòng output mới khớp mẫu có bật báo động.
 *
 * Trạng thái hạ nhiệt giữ theo (pane, mẫu): một pane đang tail log lỗi dồn dập không được làm
 * câm báo động của pane khác, và một mẫu ồn không được làm câm mẫu khác trên cùng pane.
 */
const states = new Map<string, TriggerState>()

export interface TermTriggerInput {
  sessionId: string
  /** Tên hiện của pane (host label hoặc tiêu đề) — đi vào tiêu đề sự kiện. */
  paneTitle: string
  hostId: string | null
  rule: HighlightRule
  lineText: string
}

export function fireTermTrigger(input: TermTriggerInput): void {
  // Giống F26: "pane đang hiện" = tab của nó active VÀ cửa sổ đang focus
  const tabs = useTabsStore.getState()
  const activeTab = tabs.tabs.find((t) => t.id === tabs.activeId)
  const paneVisible = document.hasFocus() && !!activeTab?.panes.some((p) => p.sessionId === input.sessionId)

  const key = `${input.sessionId}|${input.rule.id}`
  const decision = decideTrigger({ prev: states.get(key), now: Date.now(), paneVisible })
  if (decision.next) states.set(key, decision.next)
  else states.delete(key)
  if (!decision.notify) return

  const lang = useSettingsStore.getState().language
  const more = decision.suppressed > 0 ? ` ${translate(lang, 'hl.triggerMore', { n: decision.suppressed })}` : ''
  // Toast có trích dòng log (chỉ nằm trong bộ nhớ, tự tắt sau vài giây)…
  useToastsStore
    .getState()
    .push(`${translate(lang, 'hl.triggerToast', { pane: input.paneTitle, line: triggerExcerpt(input.lineText) })}${more}`, input.rule.color === 'red' ? 'error' : 'info')
  // …còn bản ghi bền thì KHÔNG: `events.db` không mã hoá, một dòng log có thể chứa token.
  // Ghi tên pane + mẫu là đủ để biết chuyện gì xảy ra ở đâu; chi tiết nằm ngay trong terminal.
  const title = `${translate(lang, 'hl.triggerEvent', { pane: input.paneTitle, pattern: shortenCommand(input.rule.pattern, 60) })}${more}`
  void window.infra.events.addTrigger({ hostId: input.hostId, title }).catch(() => {
    /* kho sự kiện lỗi — toast đã hiện */
  })
}

/** Pane đóng → bỏ trạng thái hạ nhiệt của nó. */
export function forgetTermTriggers(sessionId: string): void {
  const prefix = `${sessionId}|`
  for (const key of states.keys()) if (key.startsWith(prefix)) states.delete(key)
}
