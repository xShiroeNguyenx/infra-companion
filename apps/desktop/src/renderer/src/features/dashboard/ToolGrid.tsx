import { useT, type I18nKey } from '../../i18n'
import { useLocaldevStore } from '../../stores/localdev'
import { useTabsStore } from '../../stores/tabs'
import { useUiStore, type AppModal } from '../../stores/ui'
import { useWatcherStore } from '../../stores/watcher'
import { TOOLS, splitMenuLabel } from '../../lib/toolCatalog'

/**
 * Lưới công cụ ở đầu Dashboard — cùng danh sách với menu `⋯` của Sidebar, xếp đúng **2 hàng**,
 * mỗi ô là icon + **tên ngắn** ở dưới. Menu vẫn giữ nguyên: nó là đường vào duy nhất khi đang
 * ở tab terminal (không thấy Dashboard).
 *
 * Nhãn lấy từ chính khoá i18n của menu (`menu.*`) rồi **tách icon ra khỏi tên** — không khai
 * lại emoji ở đây, để đổi emoji trong `dict.ts` là dashboard đổi theo, không lệch hai nơi.
 */

/**
 * Danh sách công cụ lấy từ `lib/toolCatalog` — CÙNG nguồn với menu `⋯` và tab "Tất cả tính
 * năng". Trước đây file này khai danh sách riêng, nên thêm một công cụ là phải nhớ sửa hai chỗ.
 */
const MODAL_TOOLS: ReadonlyArray<{ key: I18nKey; modal: AppModal }> = TOOLS.map((tool) => ({
  key: tool.menuKey,
  modal: tool.modal
}))

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

  // Dàn đều hết chiều rộng dashboard (cột `1fr` + `w-full`), nhưng KHÔNG ép cứng 2 hàng nữa:
  // danh sách công cụ chỉ dài thêm, mà 2 hàng thì mỗi thêm một công cụ là mọi ô hẹp lại. Quá
  // 24 mục thì xuống 3 hàng — ô giữ được bề ngang đọc được thay vì teo dần theo thời gian.
  const rows = items.length > 24 ? 3 : 2
  const cols = Math.ceil(items.length / rows)

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
