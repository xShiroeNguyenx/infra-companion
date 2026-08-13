import { useT, type I18nKey } from '../../i18n'
import { useLocaldevStore } from '../../stores/localdev'
import { useTabsStore } from '../../stores/tabs'
import { useUiStore, type AppModal } from '../../stores/ui'
import { useWatcherStore } from '../../stores/watcher'

/**
 * Lưới công cụ ở đầu Dashboard — cùng danh sách với menu `⋯` của Sidebar, xếp đúng **2 hàng**,
 * mỗi ô là icon + **tên ngắn** ở dưới. Menu vẫn giữ nguyên: nó là đường vào duy nhất khi đang
 * ở tab terminal (không thấy Dashboard).
 *
 * Nhãn lấy từ chính khoá i18n của menu (`menu.*`) rồi **tách icon ra khỏi tên** — không khai
 * lại emoji ở đây, để đổi emoji trong `dict.ts` là dashboard đổi theo, không lệch hai nơi.
 */

/** Tách nhãn dạng "<icon> <tên>". Icon luôn là cụm đầu tiên trước dấu cách. */
function splitMenuLabel(label: string): { icon: string; name: string } {
  const at = label.indexOf(' ')
  if (at <= 0) return { icon: label, name: label }
  return { icon: label.slice(0, at), name: label.slice(at + 1).trim() }
}

/** Công cụ mở bằng modal/panel — phần lớn danh sách. */
const MODAL_TOOLS: ReadonlyArray<{ key: I18nKey; modal: AppModal }> = [
  { key: 'menu.workspaces', modal: 'workspaces' },
  { key: 'menu.bulk', modal: 'bulk' },
  { key: 'menu.monitor', modal: 'monitor' },
  { key: 'menu.processes', modal: 'processes' },
  { key: 'menu.services', modal: 'services' },
  { key: 'menu.compare', modal: 'compare' },
  { key: 'menu.replication', modal: 'replication' },
  { key: 'menu.hostmap', modal: 'hostmap' },
  { key: 'menu.tunnels', modal: 'tunnels' },
  { key: 'menu.ai', modal: 'ai' },
  { key: 'menu.aiDiagnose', modal: 'ai-diagnose' },
  { key: 'menu.recordings', modal: 'recordings' },
  { key: 'menu.net', modal: 'net' },
  { key: 'menu.sync', modal: 'sync' },
  { key: 'menu.snippets', modal: 'snippets' },
  { key: 'menu.plugins', modal: 'plugins' },
  { key: 'menu.keys', modal: 'keys' },
  { key: 'menu.settings', modal: 'settings' },
  { key: 'menu.help', modal: 'help' }
]

/**
 * Vài công cụ có tên menu quá dài cho một ô (dropdown thì rộng bao nhiêu cũng được, ô này thì
 * không) → khai bản NGẮN riêng. Mục không có trong bảng này dùng thẳng tên trong `menu.*`.
 */
const SHORT_LABEL: Partial<Record<I18nKey, I18nKey>> = {
  'menu.watcher': 'dashboard.toolWatcher',
  'menu.compare': 'dashboard.toolCompare',
  'menu.hostmap': 'dashboard.toolHostmap',
  'menu.aiDiagnose': 'dashboard.toolAiDiagnose',
  'menu.recordings': 'dashboard.toolRecordings',
  'menu.net': 'dashboard.toolNet'
}

function Tile({
  icon,
  label,
  title,
  active,
  onClick
}: {
  readonly icon: string
  readonly label: string
  readonly title: string
  readonly active?: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-16 w-full min-w-0 flex-col items-center justify-center gap-1 rounded border px-1 ${
        active
          ? 'border-accent bg-accent-soft/40 text-content'
          : 'border-edge bg-panel text-muted hover:bg-hover hover:text-content'
      }`}
    >
      <span className="text-2xl leading-none">{icon}</span>
      {/* Ô hẹp thì cắt bớt — tooltip/aria vẫn giữ tên đầy đủ của menu */}
      <span className="w-full truncate text-center text-[10px] leading-tight">{label}</span>
    </button>
  )
}

export function ToolGrid() {
  const t = useT()
  const setModal = useUiStore((s) => s.setModal)
  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const setWatcherEnabled = useWatcherStore((s) => s.setEnabled)
  const localdevEnabled = useLocaldevStore((s) => s.enabled)

  // Dựng danh sách phẳng rồi mới chia cột, để 2 mục đặc biệt (toggle watcher, tab Local dev)
  // nằm đúng vị trí mong muốn thay vì bị nhồi ra cuối
  const items: Array<{
    id: string
    icon: string
    label: string
    title: string
    active?: boolean
    run: () => void
  }> = []
  /** Icon + tên đầy đủ (tooltip) + tên ngắn (nhãn dưới icon) của một khoá menu. */
  const read = (key: I18nKey) => {
    const { icon, name } = splitMenuLabel(t(key))
    const short = SHORT_LABEL[key]
    return { icon, title: name, label: short ? t(short) : name }
  }
  for (const tool of MODAL_TOOLS) {
    items.push({ id: tool.modal ?? tool.key, ...read(tool.key), run: () => setModal(tool.modal) })
    // Watcher là TOGGLE chứ không mở gì — chèn ngay sau Monitoring cho cùng nhóm "theo dõi"
    if (tool.modal === 'monitor') {
      const w = read('menu.watcher')
      items.push({
        id: 'watcher',
        ...w,
        title: watcherEnabled ? `✓ ${w.title}` : w.title,
        active: watcherEnabled,
        run: () => setWatcherEnabled(!watcherEnabled)
      })
    }
  }
  // Local dev chỉ hiện khi user đã bật ở Cài đặt (giống menu ⋯); nó mở TAB, không phải modal
  if (localdevEnabled) {
    items.push({
      id: 'localdev',
      ...read('menu.localdev'),
      run: () => useTabsStore.getState().openLocaldevTab()
    })
  }

  // Ép đúng 2 hàng: số cột = nửa số mục (làm tròn lên). Cột `1fr` + `w-full` để các ô
  // DÀN ĐỀU hết chiều rộng dashboard, không dồn cục về một bên.
  const cols = Math.ceil(items.length / 2)

  return (
    <section>
      <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">{t('dashboard.tools')}</h2>
      <div className="grid w-full gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {items.map((it) => (
          <Tile
            key={it.id}
            icon={it.icon}
            label={it.label}
            title={it.title}
            active={it.active}
            onClick={it.run}
          />
        ))}
      </div>
    </section>
  )
}
