import { useMemo, useState } from 'react'
import { orderTools, toolScore } from '@infra/shared'
import { useT, type I18nKey } from '../../i18n'
import { useLocaldevStore } from '../../stores/localdev'
import { useTabsStore } from '../../stores/tabs'
import { useToolUsageStore, TOOL_GRID_SLOTS } from '../../stores/toolUsage'
import { useUiStore, type AppModal } from '../../stores/ui'
import { useWatcherStore } from '../../stores/watcher'
import { TOOLS, splitMenuLabel } from '../../lib/toolCatalog'

/**
 * Lưới công cụ ở đầu Dashboard — **MỘT hàng** gồm {@link TOOL_GRID_SLOTS} ô + ô "Tất cả".
 *
 * Trước đây là 2 hàng theo thứ tự khai trong danh mục: ai cũng thấy đúng những ô giống nhau,
 * kể cả công cụ chưa từng mở, và lưới chiếm gần nửa màn hình đầu của Dashboard. Hàng đơn thì
 * chỗ ít hơn hẳn nên chỗ đó phải thuộc về công cụ user thật sự dùng:
 *
 *  · **ghim** (`✎`) → user tự chốt công cụ nào luôn có ô, kéo thả sắp thứ tự;
 *  · phần ô còn lại → xếp theo **mức dùng có suy giảm theo thời gian** ({@link toolScore}),
 *    đếm ở `ui.setModal` + `tabs.openToolTab` nên tính cả lượt mở từ menu `⋯` và Palette;
 *  · quá chỗ thì **CẮT** — ô cuối luôn là "Tất cả", nên không công cụ nào biến mất.
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
  'menu.net': 'dashboard.toolNet',
  'menu.doImport': 'dashboard.toolDoImport'
}

interface GridItem {
  id: string
  icon: string
  label: string
  title: string
  active?: boolean
  run: () => void
}

function Tile({
  icon,
  label,
  title,
  active,
  pinned,
  onClick
}: {
  readonly icon: string
  readonly label: string
  readonly title: string
  readonly active?: boolean
  readonly pinned?: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`relative flex h-16 w-full min-w-0 flex-col items-center justify-center gap-1 rounded border px-1 ${
        active
          ? 'border-accent bg-accent-soft/40 text-content'
          : 'border-edge bg-panel text-muted hover:bg-hover hover:text-content'
      }`}
    >
      {/* Dấu ghim nhỏ ở góc: cho biết ô này ở đây vì user CHỐT, không phải vì đang dùng nhiều
          — nếu không thì thứ tự lưới trông như tự nhảy vô cớ. */}
      {pinned && <span className="text-warning absolute top-0.5 right-1 text-[9px] leading-none">📌</span>}
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
  const usage = useToolUsageStore((s) => s.usage)
  const pinned = useToolUsageStore((s) => s.pinned)
  const [customizing, setCustomizing] = useState(false)

  /** Icon + tên đầy đủ (tooltip) + tên ngắn (nhãn dưới icon) của một khoá menu. */
  const read = (key: I18nKey) => {
    const { icon, name } = splitMenuLabel(t(key))
    const short = SHORT_LABEL[key]
    return { icon, title: name, label: short ? t(short) : name }
  }

  // Dựng danh sách phẳng rồi mới xếp, để 2 mục đặc biệt (toggle watcher, tab Local dev)
  // có mặt đúng chỗ thay vì bị nhồi ra cuối
  const items: GridItem[] = []
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

  /**
   * `now` chốt MỘT lần cho mỗi lượt xếp: gọi `Date.now()` bên trong hàm so sánh thì hai ô
   * cùng điểm có thể được tính ở hai mốc thời gian khác nhau và sort mất tính bắc cầu.
   * Không đưa `items` vào deps: nó là mảng dựng mới mỗi lần render (đổi tham chiếu liên tục)
   * — `usage`/`pinned`/`localdevEnabled`/`watcherEnabled` đã bao đủ mọi thứ làm đổi thứ tự.
   */
  const ordered = useMemo(
    () => orderTools({ tools: items, id: (it) => it.id, usage, pinned, now: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usage, pinned, localdevEnabled, watcherEnabled, t]
  )

  const shown = ordered.slice(0, TOOL_GRID_SLOTS)
  const allFeatures = splitMenuLabel(t('menu.features'))
  const pinnedSet = new Set(pinned)

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-subtle text-[10px] font-semibold tracking-wider uppercase">{t('dashboard.tools')}</h2>
        <button
          type="button"
          className={`text-[11px] hover:underline ${customizing ? 'text-accent' : 'text-subtle hover:text-accent'}`}
          onClick={() => setCustomizing((v) => !v)}
          title={t('dashboard.toolCustomizeHint')}
        >
          {customizing ? t('dashboard.toolCustomizeDone') : `✎ ${t('dashboard.toolCustomize')}`}
        </button>
      </div>

      {/* ĐÚNG 1 hàng: `grid-cols-11` = 10 ô công cụ + ô "Tất cả". Cột cố định (không auto-fit)
          để ô "Tất cả" luôn ở đúng cuối hàng, kể cả khi số công cụ hiện có ít hơn 10. */}
      <div
        className="grid w-full gap-2"
        style={{ gridTemplateColumns: `repeat(${TOOL_GRID_SLOTS + 1}, minmax(0, 1fr))` }}
      >
        {shown.map((it) => (
          <Tile
            key={it.id}
            icon={it.icon}
            label={it.label}
            title={it.title}
            active={it.active}
            pinned={pinnedSet.has(it.id)}
            onClick={it.run}
          />
        ))}
        <Tile
          key="all-features"
          icon={allFeatures.icon}
          label={t('dashboard.toolAll')}
          title={allFeatures.name}
          onClick={() => useTabsStore.getState().openToolTab('features')}
        />
      </div>

      {customizing && <CustomizePanel items={ordered} />}
    </section>
  )
}

/**
 * Hộp cấu hình lưới — mở bằng nút `✎`, đóng lại thì lưới về đúng chỗ cũ.
 *
 * Hai phần, cố ý tách rời:
 *  · **Đã ghim** — kéo thả sắp thứ tự, đây là phần user toàn quyền;
 *  · **Mọi công cụ** — tick để ghim, kèm số lượt đã dùng để user thấy TẠI SAO lưới đang xếp
 *    như vậy. Không nói ra con số thì thứ tự tự đổi trông như lỗi.
 */
function CustomizePanel({ items }: { readonly items: readonly GridItem[] }) {
  const t = useT()
  const usage = useToolUsageStore((s) => s.usage)
  const pinned = useToolUsageStore((s) => s.pinned)
  const togglePin = useToolUsageStore((s) => s.togglePin)
  const movePin = useToolUsageStore((s) => s.movePin)
  const reset = useToolUsageStore((s) => s.reset)
  const [dragId, setDragId] = useState<string | null>(null)

  const byId = new Map(items.map((it) => [it.id, it]))
  const pinnedItems = pinned.flatMap((id) => {
    const it = byId.get(id)
    return it ? [it] : []
  })
  const pinnedSet = new Set(pinned)

  return (
    <div className="border-edge bg-panel mt-2 space-y-3 rounded border p-3">
      <div>
        <div className="text-subtle mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
          📌 {t('dashboard.toolPinned')}
        </div>
        {pinnedItems.length === 0 ? (
          <p className="text-subtle text-[11px]">{t('dashboard.toolNoPins')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pinnedItems.map((it, i) => (
              <div
                key={it.id}
                draggable
                onDragStart={() => setDragId(it.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragId && dragId !== it.id) movePin(dragId, i)
                  setDragId(null)
                }}
                className={`border-edge bg-app text-content flex cursor-grab items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${
                  dragId === it.id ? 'opacity-40' : ''
                }`}
                title={t('dashboard.toolDragHint')}
              >
                <span className="text-subtle">⠿</span>
                <span>{it.icon}</span>
                <span className="max-w-[10rem] truncate">{it.label}</span>
                <button
                  type="button"
                  className="text-subtle hover:text-danger"
                  onClick={() => togglePin(it.id)}
                  title={t('dashboard.toolUnpin')}
                  aria-label={t('dashboard.toolUnpin')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-subtle mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
          {t('dashboard.toolAllTools')}
        </div>
        {/* Danh sách theo ĐÚNG thứ tự lưới đang dùng: user đọc từ trên xuống là thấy ngay
            công cụ nào đang được ưu tiên và cái nào đã rơi khỏi hàng.
            Mục KHÔNG có ô thì làm MỜ — dùng được ở mọi số cột, khác với một vạch ngăn ở
            mục thứ 10 (lưới 2–3 cột thì vạch đó rơi vào giữa cột và không chỉ ra điều gì). */}
        <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((it, i) => {
            const uses = usage[it.id]?.count ?? 0
            const inRow = i < TOOL_GRID_SLOTS
            return (
              <label
                key={it.id}
                title={inRow ? undefined : t('dashboard.toolNotInRow')}
                className={`hover:bg-hover flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] ${
                  inRow ? '' : 'opacity-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={pinnedSet.has(it.id)}
                  onChange={() => togglePin(it.id)}
                  className="accent-accent"
                />
                <span>{it.icon}</span>
                <span className="text-content min-w-0 flex-1 truncate">{it.label}</span>
                <span className="text-subtle shrink-0 tabular-nums">
                  {uses > 0 ? t('dashboard.toolUses', { n: uses }) : '—'}
                </span>
              </label>
            )
          })}
        </div>
      </div>

      <button type="button" className="text-subtle hover:text-danger text-[10px] hover:underline" onClick={reset}>
        {t('dashboard.toolResetUsage')}
      </button>
    </div>
  )
}
