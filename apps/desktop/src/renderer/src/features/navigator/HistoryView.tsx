import { useDataStore } from '../../stores/data'
import { useSettingsStore } from '../../stores/settings'
import { useTabsStore } from '../../stores/tabs'
import { useT } from '../../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

/**
 * Mục **History** của theme Navigator — toàn bộ lịch sử kết nối (vault giữ tối đa 50, mỗi đích
 * một dòng) ở vùng chính. Dashboard chỉ hiện 10 dòng đầu, cột host ở theme Infra chỉ hiện 4
 * dòng chưa lưu; đây là chỗ duy nhất xem được hết.
 *
 * Dòng trỏ về host đã lưu hiện TÊN host (bấm là mở đúng host, kể cả khi địa chỉ đã đổi); dòng
 * quick-connect chưa lưu hiện nguyên chuỗi đích và nói rõ nó chưa được lưu — đó là gợi ý ngầm
 * "cái này hay dùng thì lưu thành host đi".
 */
export function HistoryView() {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const history = useDataStore((s) => s.history)
  const hosts = useDataStore((s) => s.hosts)
  const openSsh = useTabsStore((s) => s.openSsh)
  const openQuick = useTabsStore((s) => s.openQuick)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div className="mx-auto max-w-[1000px]">
        <p className="text-subtle mb-3 text-[11px] leading-relaxed">{t('history.hint')}</p>
        {history.length === 0 ? (
          <p className="text-subtle py-10 text-center text-xs">{t('dashboard.noRecent')}</p>
        ) : (
          <div className="border-edge bg-panel divide-edge/70 divide-y rounded border">
            {history.map((entry) => {
              const host = entry.hostId ? hosts.find((h) => h.id === entry.hostId) : undefined
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="hover:bg-hover flex w-full items-center gap-3 px-3 py-2 text-left"
                  title={t('sidebar.connectTo', { target: host?.label ?? entry.target })}
                  onClick={() => {
                    if (entry.hostId) void openSsh(entry.hostId)
                    else void openQuick(entry.target.replace(/:22$/, ''))
                  }}
                >
                  <span className={`size-1.5 shrink-0 rounded-full ${host ? 'bg-accent' : 'bg-edge-strong'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="text-content block truncate text-xs font-medium">{host?.label ?? entry.target}</span>
                    <span className="text-subtle block truncate font-mono text-[10px]">
                      {host ? entry.target : t('history.quick')}
                    </span>
                  </span>
                  <span className="text-subtle shrink-0 text-[11px]">
                    {new Date(entry.connectedAt).toLocaleString(locale, {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
