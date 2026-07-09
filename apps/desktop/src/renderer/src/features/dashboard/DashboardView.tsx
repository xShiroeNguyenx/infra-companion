import { useEffect, useMemo, useState } from 'react'
import type { MetricHistoryHostDto, MetricHistoryPointDto } from '@infra/shared'
import type { WorkspaceTab } from '../../stores/tabs'
import { useDataStore } from '../../stores/data'
import { useFavoritesStore } from '../../stores/favorites'
import { useMonitorStore } from '../../stores/monitor'
import { useSettingsStore } from '../../stores/settings'
import { useTabsStore } from '../../stores/tabs'
import { useUiStore } from '../../stores/ui'
import { useWorkspacesStore } from '../../stores/workspaces'
import { Button } from '../../components/ui'
import { MetricChart } from '../../components/MetricsHistoryModal'
import { useT } from '../../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

// Giống Sidebar: user@host hoặc user@host:port thì coi là quick-connect target
const QUICK_PATTERN = /^[^@\s]+@[^@\s]+$/
const QUICK_PORT_PATTERN = /^[^@\s]+@.+:\d+$/

/** Thời điểm kết nối: hôm nay → giờ:phút, cũ hơn → ngày/tháng. */
function formatWhen(ts: number, locale: string): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
}

/** Tóm tắt workspace "n tab · n pane" — cùng cách tính với WorkspacesModal. */
function summarize(tabs: WorkspaceTab[], t: ReturnType<typeof useT>): string {
  const panes = tabs.reduce((n, tab) => n + (tab.kind === 'terminal' ? tab.panes.length : 0), 0)
  const sftp = tabs.filter((tab) => tab.kind === 'sftp').length
  const parts = [t('ws.summaryTabs', { n: tabs.length }), t('ws.summaryPanes', { n: panes })]
  if (sftp > 0) parts.push(t('ws.summarySftp', { n: sftp }))
  return parts.join(' · ')
}

/**
 * Trang Dashboard — màn hình home nằm dưới các tab (activeId=null), mở qua nút 🏠.
 * Đọc dữ liệu có sẵn ở renderer (hosts/history/favorites/tunnels/workspaces); riêng mục
 * "Lịch sử monitoring" query metrics.db qua IPC (chỉ khi Dashboard đang hiện).
 * Card dùng bg-panel: khi bật ảnh nền, --c-panel đã bán trong suốt.
 * Trạng thái realtime vẫn là việc của MonitorDock góc phải — ở đây chỉ có LỊCH SỬ.
 */
export function DashboardView({ active }: { active: boolean }) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const hosts = useDataStore((s) => s.hosts)
  const groups = useDataStore((s) => s.groups)
  const history = useDataStore((s) => s.history)
  const tunnels = useDataStore((s) => s.tunnels)
  const tunnelStates = useDataStore((s) => s.tunnelStates)
  const startTunnel = useDataStore((s) => s.startTunnel)
  const stopTunnel = useDataStore((s) => s.stopTunnel)
  const favIds = useFavoritesStore((s) => s.ids)
  const workspaces = useWorkspacesStore((s) => s.workspaces)
  const openWorkspace = useWorkspacesStore((s) => s.open)
  const { openLocal, openSsh, openSshGroup, openQuick } = useTabsStore()
  const setModal = useUiStore((s) => s.setModal)
  const [quick, setQuick] = useState('')

  // History bị vault dedup theo target → số đếm = "số target khác nhau", đủ dùng cho tổng quan
  const stats = useMemo(() => {
    const now = Date.now()
    const midnight = new Date().setHours(0, 0, 0, 0)
    return {
      today: history.filter((h) => h.connectedAt >= midnight).length,
      week: history.filter((h) => h.connectedAt >= now - 7 * 86_400_000).length
    }
  }, [history])

  const favHosts = useMemo(() => hosts.filter((h) => favIds.includes(h.id)), [hosts, favIds])

  // Chip nhóm: chỉ nhóm có host; bấm mở cả nhóm thành các pane split trong 1 tab
  const groupChips = useMemo(
    () =>
      groups
        .map((g) => ({ group: g, hostIds: hosts.filter((h) => h.groupId === g.id).map((h) => h.id) }))
        .filter((x) => x.hostIds.length > 0),
    [groups, hosts]
  )

  const isQuick = QUICK_PATTERN.test(quick.trim()) || QUICK_PORT_PATTERN.test(quick.trim())

  const connectQuick = (): void => {
    if (!isQuick) return
    void openQuick(quick.trim())
    setQuick('')
  }

  return (
    <div className={`absolute inset-0 overflow-y-auto ${active ? '' : 'hidden'}`}>
      <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-content text-lg font-semibold">{t('dashboard.title')}</h1>
            <p className="text-subtle text-xs">
              {new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <button
            className="border-edge-strong text-content hover:bg-hover shrink-0 rounded border px-3 py-1.5 text-xs"
            onClick={() => void openLocal()}
          >
            {t('dashboard.newTerminal')}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label={t('dashboard.stats.hosts')} value={hosts.length} />
          <StatTile label={t('dashboard.stats.groups')} value={groups.length} />
          <StatTile label={t('dashboard.stats.today')} value={stats.today} />
          <StatTile label={t('dashboard.stats.week')} value={stats.week} />
        </div>

        <section>
          <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
            {t('dashboard.quickConnect')}
          </h2>
          <input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') connectQuick()
            }}
            placeholder={t('dashboard.quickPlaceholder')}
            className="border-edge bg-input text-content placeholder-subtle focus:border-accent w-full rounded border px-2.5 py-1.5 text-xs outline-none"
          />
          {isQuick && (
            <button
              className="border-accent/40 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60 mt-1.5 flex w-full items-center gap-1.5 rounded border px-2.5 py-1.5 text-left text-xs"
              onClick={connectQuick}
            >
              <span className="text-accent">→</span> {t('sidebar.connectTo', { target: quick.trim() })}
            </button>
          )}
        </section>

        <section>
          <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
            ★ {t('dashboard.favorites')}
          </h2>
          {favHosts.length === 0 ? (
            <p className="text-subtle text-[11px]">{t('dashboard.noFavorites')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {favHosts.map((host) => (
                <button
                  key={host.id}
                  className="border-edge bg-panel hover:bg-hover rounded border p-3 text-left"
                  title={t('sidebar.connectTo', { target: host.label })}
                  onClick={() => void openSsh(host.id)}
                >
                  <div className="text-content truncate text-xs font-medium">
                    <span className="text-warning">★</span> {host.label}
                  </div>
                  <div className="text-subtle truncate text-[11px]">
                    {host.username ? `${host.username}@` : ''}
                    {host.hostname}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {groupChips.length > 0 && (
          <section>
            <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
              {t('dashboard.groups')}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {groupChips.map(({ group, hostIds }) => (
                <button
                  key={group.id}
                  className="border-edge bg-panel text-muted hover:bg-hover hover:text-content rounded-full border px-3 py-1.5 text-xs"
                  title={t('sidebar.openGroup', { n: hostIds.length })}
                  onClick={() => void openSshGroup(hostIds)}
                >
                  {group.name} <span className="text-subtle">· {hostIds.length}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <MonitorHistorySection active={active} locale={locale} />

        <section>
          <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
            {t('dashboard.recent')}
          </h2>
          {history.length === 0 ? (
            <p className="text-subtle text-[11px]">{t('dashboard.noRecent')}</p>
          ) : (
            <div className="border-edge bg-panel divide-edge/70 divide-y rounded border">
              {history.slice(0, 10).map((entry) => (
                <button
                  key={entry.id}
                  className="text-muted hover:bg-hover hover:text-content flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px]"
                  onClick={() => {
                    if (entry.hostId) void openSsh(entry.hostId)
                    else void openQuick(entry.target.replace(/:22$/, ''))
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.target}</span>
                  <span className="text-subtle shrink-0">{formatWhen(entry.connectedAt, locale)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-subtle text-[10px] font-semibold tracking-wider uppercase">
              🗂 {t('dashboard.workspaces')}
            </h2>
            <button className="text-accent text-[11px] hover:underline" onClick={() => setModal('workspaces')}>
              {t('dashboard.manage')}
            </button>
          </div>
          {workspaces.length === 0 ? (
            <p className="text-subtle text-[11px]">{t('dashboard.noWorkspaces')}</p>
          ) : (
            <div className="border-edge bg-panel divide-edge/70 divide-y rounded border">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  className="hover:bg-hover flex w-full items-center gap-2 px-3 py-1.5 text-left"
                  title={t('ws.open')}
                  onClick={() => openWorkspace(ws.id)}
                >
                  <span className="text-content min-w-0 flex-1 truncate text-xs">{ws.name}</span>
                  <span className="text-subtle shrink-0 text-[10px]">{summarize(ws.tabs, t)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-subtle text-[10px] font-semibold tracking-wider uppercase">
              🔀 {t('dashboard.tunnels')}
            </h2>
            <button className="text-accent text-[11px] hover:underline" onClick={() => setModal('tunnels')}>
              {t('dashboard.manage')}
            </button>
          </div>
          {tunnels.length === 0 ? (
            <p className="text-subtle text-[11px]">{t('dashboard.noTunnels')}</p>
          ) : (
            <div className="border-edge bg-panel divide-edge/70 divide-y rounded border">
              {tunnels.map((rule) => {
                const state = tunnelStates[rule.id]?.status ?? 'stopped'
                const detail = tunnelStates[rule.id]?.detail
                const running = state === 'active' || state === 'starting'
                return (
                  <div
                    key={rule.id}
                    className="flex items-center gap-2 px-3 py-1.5"
                    title={state === 'error' && detail ? detail : undefined}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        state === 'active'
                          ? 'bg-success'
                          : state === 'starting'
                            ? 'bg-warning animate-pulse'
                            : state === 'error'
                              ? 'bg-danger'
                              : 'bg-edge-strong'
                      }`}
                    />
                    <span className="text-content min-w-0 flex-1 truncate text-xs">
                      [{rule.type}] {rule.label || `:${rule.bindPort}`}
                    </span>
                    <Button
                      type="button"
                      variant={running ? 'default' : 'primary'}
                      className="!px-2 !py-0.5 !text-[11px]"
                      onClick={() => void (running ? stopTunnel(rule.id) : startTunnel(rule.id))}
                    >
                      {running ? t('tunnel.stop') : t('tunnel.start')}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
            ⌨ {t('dashboard.shortcuts')}
          </h2>
          <div className="border-edge bg-panel divide-edge/70 divide-y rounded border">
            <ShortcutRow label={t('dashboard.sc.palette')} keys={['Ctrl', 'Shift', 'P']} />
            <ShortcutRow label={t('dashboard.sc.newTab')} keys={['Ctrl', 'Shift', 'T']} />
            <ShortcutRow label={t('dashboard.sc.closeTab')} keys={['Ctrl', 'Shift', 'W']} />
            <ShortcutRow label={t('dashboard.sc.cycle')} keys={['Ctrl', 'Tab']} />
            <ShortcutRow label={t('dashboard.sc.split')} keys={['Ctrl', 'Shift', 'D']} />
            <ShortcutRow label={t('dashboard.sc.broadcast')} keys={['Ctrl', 'Shift', 'B']} />
            <ShortcutRow label={t('dashboard.sc.sidebar')} keys={['Ctrl', 'Shift', 'H']} />
            <ShortcutRow label={t('dashboard.sc.ai')} keys={['Ctrl', 'I']} />
            <ShortcutRow label={t('dashboard.sc.copyPaste')} keys={['Ctrl', 'Shift', 'C / V']} />
            <ShortcutRow label={t('dashboard.sc.find')} keys={['Ctrl', 'F']} />
          </div>
          <p className="text-subtle mt-1.5 text-[10px]">{t('dashboard.sc.mouseTip')}</p>
        </section>
      </div>
    </div>
  )
}

const MON_HISTORY_LIMIT = 6
const MON_REFRESH_MS = 60_000

/** Mục "Lịch sử monitoring": các host từng được monitor (dữ liệu metrics.db còn trong
 *  hạn giữ 30 ngày) + chart Load 24h thu gọn; bấm card mở modal lịch sử đầy đủ.
 *  Chỉ fetch khi Dashboard đang hiện (active) — tránh query nền vô ích. */
function MonitorHistorySection({ active, locale }: { active: boolean; locale: string }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts)
  const [monHosts, setMonHosts] = useState<MetricHistoryHostDto[] | null>(null)
  const [charts, setCharts] = useState<Record<string, MetricHistoryPointDto[]>>({})

  useEffect(() => {
    if (!active) return
    let alive = true
    const load = async (): Promise<void> => {
      const list = (await window.infra.monitor.historyHosts()).slice(0, MON_HISTORY_LIMIT)
      if (!alive) return
      setMonHosts(list)
      const now = Date.now()
      // Chart Load 24h (bucket 10') từng host — tuần tự cho nhẹ (tối đa 6 query SQLite local)
      for (const h of list) {
        const points = await window.infra.monitor.queryHistory(h.hostId, now - 24 * 3_600_000, now, 10)
        if (!alive) return
        setCharts((prev) => ({ ...prev, [h.hostId]: points }))
      }
    }
    void load()
    const timer = setInterval(() => void load(), MON_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active])

  // Chưa từng monitor host nào → không chiếm chỗ trên Dashboard (khác danh sách rỗng do đang load)
  if (monHosts !== null && monHosts.length === 0) {
    return (
      <section>
        <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
          📈 {t('dashboard.monHistory')}
        </h2>
        <p className="text-subtle text-[11px]">{t('dashboard.noMonHistory')}</p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
        📈 {t('dashboard.monHistory')}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(monHosts ?? []).map((mh) => {
          const label = hosts.find((h) => h.id === mh.hostId)?.label ?? `${mh.hostId.slice(0, 8)}…`
          const points = charts[mh.hostId]
          return (
            <button
              key={mh.hostId}
              className="border-edge bg-panel hover:bg-hover rounded border p-3 text-left"
              title={t('dashboard.monOpen')}
              onClick={() => useMonitorStore.getState().setHistoryHost(mh.hostId)}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-content min-w-0 truncate text-xs font-medium">{label}</span>
                <span className="text-subtle shrink-0 text-[10px]">
                  {t('dashboard.monLast', { when: formatWhen(mh.lastTs, locale) })}
                </span>
              </div>
              {points && points.length > 0 ? (
                <MetricChart
                  label={`Load 24h (${t('monitor.loadNorm')})`}
                  points={points}
                  field="loadPct"
                  resMs={600_000}
                  autoScale
                  compact
                />
              ) : (
                <div className="h-10" />
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-muted min-w-0 truncate text-[11px]">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="border-edge-strong bg-input text-muted rounded border px-1 py-0.5 font-mono text-[10px] leading-none"
          >
            {k}
          </kbd>
        ))}
      </span>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-edge bg-panel rounded border p-3">
      <div className="text-content text-lg font-semibold">{value}</div>
      <div className="text-subtle truncate text-[10px] tracking-wider uppercase">{label}</div>
    </div>
  )
}
