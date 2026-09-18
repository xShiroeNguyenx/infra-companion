import type { TunnelRuleDto, TunnelStateDto, TunnelStatus, UiLanguage } from './types'

/**
 * F53 — khay hệ thống: phần "quyết định menu khay hiện gì" tách khỏi Electron để test được.
 *
 * Main process không có từ điển i18n của renderer, nên vài chuỗi menu khay nằm ở đây (3 ngôn
 * ngữ) và renderer gửi ngôn ngữ đang dùng qua `TrayPrefsDto`. Chuỗi cố ý ngắn: menu khay là
 * chỗ liếc một giây, không phải chỗ đọc.
 */

const STRINGS = {
  vi: {
    open: 'Mở Infra Companion',
    tunnels: 'Tunnels',
    noTunnels: 'Chưa có tunnel nào',
    locked: 'Vault đang khoá — mở app để mở khoá',
    quit: 'Thoát',
    allTunnels: 'Tất cả tunnel',
    stopAll: (n: number) => `Dừng tất cả tunnel (${n})`,
    pinHint: 'Ghim ⭐ tunnel để hiện ở đây',
    summary: (n: number, total: number) => `${n}/${total} đang chạy`,
    unlock: 'Vault đang khoá — bấm để mở khoá',
    running: (n: number, total: number) => `${n}/${total} tunnel đang chạy`,
    idle: 'Không có tunnel đang chạy',
    hiddenTitle: 'Infra Companion vẫn đang chạy',
    hiddenBody: 'Tunnel và theo dõi vẫn hoạt động trong khay hệ thống. Bấm icon để mở lại, chuột phải → Thoát để tắt hẳn.'
  },
  en: {
    open: 'Open Infra Companion',
    tunnels: 'Tunnels',
    noTunnels: 'No tunnels yet',
    locked: 'Vault is locked — open the app to unlock',
    quit: 'Quit',
    allTunnels: 'All tunnels',
    stopAll: (n: number) => `Stop all tunnels (${n})`,
    pinHint: 'Star ⭐ a tunnel to show it here',
    summary: (n: number, total: number) => `${n}/${total} running`,
    unlock: 'Vault is locked — click to unlock',
    running: (n: number, total: number) => `${n}/${total} tunnels running`,
    idle: 'No tunnel running',
    hiddenTitle: 'Infra Companion is still running',
    hiddenBody: 'Tunnels and monitoring keep working from the system tray. Click the icon to reopen, right-click → Quit to exit.'
  },
  ja: {
    open: 'Infra Companion を開く',
    tunnels: 'トンネル',
    noTunnels: 'トンネルはありません',
    locked: 'Vault はロック中 — アプリを開いて解除',
    quit: '終了',
    allTunnels: 'すべてのトンネル',
    stopAll: (n: number) => `すべてのトンネルを停止 (${n})`,
    pinHint: '⭐ を付けるとここに表示されます',
    summary: (n: number, total: number) => `${n}/${total} 稼働中`,
    unlock: 'Vault はロック中 — クリックで解除',
    running: (n: number, total: number) => `${n}/${total} トンネル稼働中`,
    idle: '稼働中のトンネルはありません',
    hiddenTitle: 'Infra Companion は動作中です',
    hiddenBody: 'トンネルと監視はシステムトレイで動き続けます。アイコンをクリックで再表示、右クリック → 終了で完全に終了します。'
  }
} as const

export type TrayStrings = (typeof STRINGS)[UiLanguage]

export function trayStrings(lang: UiLanguage): TrayStrings {
  return STRINGS[lang] ?? STRINGS.vi
}

/** Rule cần bật lúc mở app: có cờ `autoStart`. Tách ra để test và để main không lặp lại filter. */
export function pickAutoStartRules(rules: readonly TunnelRuleDto[]): TunnelRuleDto[] {
  return rules.filter((r) => r.autoStart)
}

/** Tunnel "đang chạy" theo nghĩa hiện trên khay: active hoặc đang nối. */
export function isTunnelUp(status: TunnelStatus | undefined): boolean {
  return status === 'active' || status === 'starting'
}

/** Tooltip khay: "Infra Companion · 2/9 tunnel đang chạy" — tổng chỉ tính khi vault mở (mới biết danh sách). */
export function trayTooltip(rules: readonly TunnelRuleDto[] | null, states: readonly TunnelStateDto[], lang: UiLanguage): string {
  const s = trayStrings(lang)
  const running = states.filter((st) => isTunnelUp(st.status)).length
  if (rules === null || rules.length === 0) return `Infra Companion · ${running > 0 ? s.running(running, running) : s.idle}`
  return `Infra Companion · ${running > 0 ? s.running(running, rules.length) : s.idle}`
}

export type TrayMenuItem =
  | { kind: 'open'; label: string }
  | { kind: 'separator' }
  | { kind: 'tunnels-header'; label: string }
  /** Một rule: checkbox = đang chạy; bấm = bật/tắt. `detail` (lỗi) đưa vào nhãn để khay nói được vì sao đỏ. */
  | { kind: 'tunnel'; label: string; ruleId: string; checked: boolean; status: TunnelStatus }
  | { kind: 'note'; label: string }
  /** Vault khoá: dòng BẤM ĐƯỢC — hiện cửa sổ và nhảy vào ô nhập master password. */
  | { kind: 'unlock'; label: string }
  /** Dừng mọi tunnel đang chạy. Chỉ xuất hiện khi có cái để dừng (`count > 0`). */
  | { kind: 'stop-all'; label: string; count: number }
  /** Submenu "Tất cả tunnel ▸" — chứa các rule KHÔNG ghim, để menu chính gọn mà vẫn với tới được. */
  | { kind: 'submenu'; label: string; items: TrayMenuItem[] }
  | { kind: 'quit'; label: string }

/** Nhãn một rule trên khay: ⚠ + lý do khi lỗi, ` …` khi đang nối, `:port` khi rule không tên. */
function tunnelItem(rule: TunnelRuleDto, st: TunnelStateDto | undefined): TrayMenuItem {
  const status = st?.status ?? 'stopped'
  const name = rule.label || `:${rule.bindPort}`
  const mark = status === 'error' ? '⚠ ' : ''
  const suffix = status === 'error' && st?.detail ? ` — ${st.detail}` : status === 'starting' ? ' …' : ''
  return { kind: 'tunnel', label: `${mark}${name}${suffix}`, ruleId: rule.id, checked: isTunnelUp(status), status }
}

/**
 * Mô hình menu khay. `rules === null` nghĩa là vault đang KHOÁ (không đọc được danh sách) → chỉ
 * có dòng mở khoá; bật/tắt tunnel cần vault mở vì `prepareConnection` phải đọc credential.
 * Thứ tự rule giữ nguyên như đầu vào (main đã xếp theo tên/ghim như UI).
 *
 * `pinnedIds` = các tunnel user đã ghim ⭐ ở renderer (localStorage, gửi sang main qua
 * `TrayPrefsDto`). Có ghim thì menu CHÍNH chỉ hiện đúng những cái đó, phần còn lại lùi vào
 * submenu "Tất cả tunnel ▸" — người dùng cả chục tunnel DB mỗi ngày không phải cuộn một danh
 * sách dài quá màn hình chỉ để tắt một cái.
 *
 * Chưa ghim gì thì menu chính hiện các tunnel ĐANG CHẠY (thứ đáng tắt nhất) kèm một dòng gợi ý
 * ghim — cố ý KHÔNG để trống, vì khay trống trơn sau khi cập nhật trông như tính năng đã hỏng.
 */
export function trayMenuModel(
  rules: readonly TunnelRuleDto[] | null,
  states: readonly TunnelStateDto[],
  lang: UiLanguage,
  pinnedIds: readonly string[] = []
): TrayMenuItem[] {
  const s = trayStrings(lang)
  const byId = new Map(states.map((st) => [st.ruleId, st]))
  const items: TrayMenuItem[] = [{ kind: 'open', label: s.open }, { kind: 'separator' }]

  if (rules === null) {
    items.push({ kind: 'unlock', label: s.unlock })
    items.push({ kind: 'separator' }, { kind: 'quit', label: s.quit })
    return items
  }
  if (rules.length === 0) {
    items.push({ kind: 'note', label: s.noTunnels })
    items.push({ kind: 'separator' }, { kind: 'quit', label: s.quit })
    return items
  }

  const runningCount = rules.filter((r) => isTunnelUp(byId.get(r.id)?.status)).length
  items.push({ kind: 'tunnels-header', label: s.tunnels })
  items.push({ kind: 'note', label: s.summary(runningCount, rules.length) })

  const pinned = new Set(pinnedIds)
  // Chưa ghim gì → lấy tạm các tunnel đang chạy làm "đáng hiện". Ghim rồi thì ghim là nguồn duy nhất,
  // kể cả khi tunnel đã ghim đang tắt (user ghim chính là để bật nó từ khay).
  const hasPins = rules.some((r) => pinned.has(r.id))
  const primary = hasPins ? rules.filter((r) => pinned.has(r.id)) : rules.filter((r) => isTunnelUp(byId.get(r.id)?.status))
  const primaryIds = new Set(primary.map((r) => r.id))
  const rest = rules.filter((r) => !primaryIds.has(r.id))

  for (const rule of primary) items.push(tunnelItem(rule, byId.get(rule.id)))
  if (!hasPins) items.push({ kind: 'note', label: s.pinHint })
  if (rest.length > 0) {
    items.push({ kind: 'submenu', label: s.allTunnels, items: rest.map((r) => tunnelItem(r, byId.get(r.id))) })
  }
  if (runningCount > 0) items.push({ kind: 'stop-all', label: s.stopAll(runningCount), count: runningCount })

  items.push({ kind: 'separator' }, { kind: 'quit', label: s.quit })
  return items
}
