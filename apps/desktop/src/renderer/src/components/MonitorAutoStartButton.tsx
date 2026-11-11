import { monitorAutoStartState } from '@infra/shared'
import { useMonitorStore } from '../stores/monitor'
import { useMonitorAutoStartStore } from '../stores/monitorAutoStart'
import { useToastsStore } from '../stores/toasts'
import { BoltIcon } from './icons'
import { useT } from '../i18n'

/**
 * Nút ⚡ "Tự bật khi mở app" cho monitoring — đặt CẠNH nút Dừng ở cả ba nơi hiện monitoring (dock
 * nổi, tab Monitoring, panel đáy Workbench), vì đó là chỗ user đang nhìn đúng tập host muốn giữ.
 *
 * Cùng icon ⚡ và cùng câu chữ với nút tự bật của tunnel: một khái niệm, một hình — đừng đặt ra
 * biểu tượng thứ hai (📌 trong app đã mang nghĩa "ghim lên Dashboard").
 *
 * Bấm = lưu tập ĐANG theo dõi. Ba trạng thái (`monitorAutoStartState`): chưa bật · đang bật đúng
 * tập này (bấm để tắt) · đang bật một tập KHÁC (bấm để đổi sang tập này). Trạng thái thứ ba phải
 * nhìn ra được: chỉ có bật/tắt thì nút trông như "đang bật" mà lần sau mở app lại ra tập cũ.
 */
export function MonitorAutoStartButton({
  compact = false,
  className = ''
}: {
  /** Chỉ hiện icon — cho header hẹp của dock nổi (320px). */
  readonly compact?: boolean
  readonly className?: string
}) {
  const t = useT()
  const push = useToastsStore((s) => s.push)
  const data = useMonitorStore((s) => s.data)
  const saved = useMonitorAutoStartStore((s) => s.ids)
  const save = useMonitorAutoStartStore((s) => s.save)
  // Thứ tự card đang hiện (thứ tự lúc bắt đầu) — lưu đúng thứ tự này để lần sau ra y như vậy
  const current = Object.keys(data)
  if (current.length === 0) return null
  const state = monitorAutoStartState(saved, current)

  const title =
    state === 'same'
      ? t('monitor.autoStartOffTitle', { n: current.length })
      : state === 'different'
        ? t('monitor.autoStartUpdateTitle', { m: saved.length, n: current.length })
        : t('monitor.autoStartOnTitle', { n: current.length })
  const label = state === 'different' ? t('monitor.autoStartUpdate') : t('monitor.autoStart')

  const onClick = (): void => {
    if (state === 'same') {
      save([])
      push(t('monitor.autoStartCleared'), 'info')
      return
    }
    save(current)
    push(t('monitor.autoStartSaved', { n: current.length }), 'info')
  }

  return (
    <button
      type="button"
      aria-pressed={state === 'same'}
      aria-label={title}
      title={title}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded border ${
        state === 'same'
          ? 'border-warning/60 text-warning hover:bg-hover'
          : state === 'different'
            ? 'border-warning/40 text-warning hover:bg-hover border-dashed'
            : 'border-edge-strong text-muted hover:bg-hover hover:text-warning'
      } ${className}`}
    >
      <BoltIcon filled={state === 'same'} />
      {!compact && <span>{label}</span>}
    </button>
  )
}
