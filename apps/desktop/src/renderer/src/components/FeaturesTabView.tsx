import { useState } from 'react'
import { TOOLS, TOOL_CATEGORIES, openTool, splitMenuLabel } from '../lib/toolCatalog'
import { useLocaldevStore } from '../stores/localdev'
import { useTabsStore } from '../stores/tabs'
import { useWatcherStore } from '../stores/watcher'
import { TextInput } from './ui'
import { useT } from '../i18n'

/**
 * Tab "Tất cả tính năng" — nơi ở chính thức của mọi công cụ.
 *
 * Menu `⋯` chỉ giữ những thứ dùng hằng ngày; danh sách đầy đủ ở đây, chia nhóm, có mô tả một
 * dòng và ô tìm kiếm. Một dropdown hai chục dòng là dropdown không ai đọc — chưa kể nó chỉ
 * dài thêm mãi. Công cụ MỚI vào thẳng đây, không chen vào menu.
 */
export function FeaturesTabView({ active }: { active: boolean }) {
  const t = useT()
  const openLocaldevTab = useTabsStore((s) => s.openLocaldevTab)
  const localdevEnabled = useLocaldevStore((s) => s.enabled)
  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const setWatcherEnabled = useWatcherStore((s) => s.setEnabled)
  const [query, setQuery] = useState('')

  const needle = query.trim().toLowerCase()
  const matches = (name: string, desc: string): boolean =>
    needle === '' || name.toLowerCase().includes(needle) || desc.toLowerCase().includes(needle)

  const groups = TOOL_CATEGORIES.map((category) => ({
    category,
    tools: TOOLS.filter((tool) => tool.category === category.id).filter((tool) => {
      const { name } = splitMenuLabel(t(tool.menuKey))
      return matches(name, t(tool.descKey))
    })
  })).filter((g) => g.tools.length > 0)

  const watcherName = splitMenuLabel(t('menu.watcher'))
  const showWatcher = matches(watcherName.name, t('features.dWatcher'))
  const localdevName = splitMenuLabel(t('menu.localdev'))
  const showLocaldev = localdevEnabled && matches(localdevName.name, t('features.dLocaldev'))

  return (
    <div className={`bg-app absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      <div className="border-edge bg-panel flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <span className="text-content text-sm font-medium">⊞ {t('features.title')}</span>
        <TextInput
          className="max-w-72"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('features.search')}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto max-w-[1200px]">
          {groups.length === 0 && !showWatcher && !showLocaldev ? (
            <p className="text-subtle py-10 text-center text-xs">{t('features.noMatch')}</p>
          ) : (
            groups.map(({ category, tools }) => (
              <section key={category.id} className="mb-5">
                <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
                  {t(category.titleKey)}
                </h2>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {tools.map((tool) => {
                    const { icon, name } = splitMenuLabel(t(tool.menuKey))
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => openTool(tool)}
                        className="border-edge bg-panel hover:border-accent/60 hover:bg-hover flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left"
                      >
                        <span className="shrink-0 text-xl leading-none">{icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="text-content block truncate text-xs font-medium">{name}</span>
                          <span className="text-subtle block text-[11px] leading-relaxed">{t(tool.descKey)}</span>
                        </span>
                      </button>
                    )
                  })}

                  {/* Hai mục đặc biệt: watcher là TOGGLE, local dev mở TAB — không phải modal
                      nên không nằm trong danh mục, nhưng vẫn phải tìm thấy được ở đây. */}
                  {category.id === 'fleet' && showWatcher && (
                    <button
                      type="button"
                      onClick={() => setWatcherEnabled(!watcherEnabled)}
                      className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left ${
                        watcherEnabled
                          ? 'border-accent bg-accent-soft/30'
                          : 'border-edge bg-panel hover:border-accent/60 hover:bg-hover'
                      }`}
                    >
                      <span className="shrink-0 text-xl leading-none">{watcherName.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="text-content block truncate text-xs font-medium">
                          {watcherName.name} {watcherEnabled && <span className="text-accent">✓</span>}
                        </span>
                        <span className="text-subtle block text-[11px] leading-relaxed">{t('features.dWatcher')}</span>
                      </span>
                    </button>
                  )}
                  {category.id === 'app' && showLocaldev && (
                    <button
                      type="button"
                      onClick={() => openLocaldevTab()}
                      className="border-edge bg-panel hover:border-accent/60 hover:bg-hover flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left"
                    >
                      <span className="shrink-0 text-xl leading-none">{localdevName.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="text-content block truncate text-xs font-medium">{localdevName.name}</span>
                        <span className="text-subtle block text-[11px] leading-relaxed">{t('features.dLocaldev')}</span>
                      </span>
                    </button>
                  )}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
