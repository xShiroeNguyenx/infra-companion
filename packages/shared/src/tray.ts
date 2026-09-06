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
  | { kind: 'quit'; label: string }

/**
 * Mô hình menu khay. `rules === null` nghĩa là vault đang KHOÁ (không đọc được danh sách) → chỉ
 * có dòng ghi chú; bật/tắt tunnel cần vault mở vì `prepareConnection` phải đọc credential.
 * Thứ tự rule giữ nguyên như đầu vào (main đã xếp theo tên/ghim như UI).
 */
export function trayMenuModel(
  rules: readonly TunnelRuleDto[] | null,
  states: readonly TunnelStateDto[],
  lang: UiLanguage
): TrayMenuItem[] {
  const s = trayStrings(lang)
  const byId = new Map(states.map((st) => [st.ruleId, st]))
  const items: TrayMenuItem[] = [{ kind: 'open', label: s.open }, { kind: 'separator' }]
  if (rules === null) {
    items.push({ kind: 'note', label: s.locked })
  } else if (rules.length === 0) {
    items.push({ kind: 'note', label: s.noTunnels })
  } else {
    items.push({ kind: 'tunnels-header', label: s.tunnels })
    for (const rule of rules) {
      const st = byId.get(rule.id)
      const status = st?.status ?? 'stopped'
      const name = rule.label || `:${rule.bindPort}`
      const mark = status === 'error' ? '⚠ ' : ''
      const suffix = status === 'error' && st?.detail ? ` — ${st.detail}` : status === 'starting' ? ' …' : ''
      items.push({ kind: 'tunnel', label: `${mark}${name}${suffix}`, ruleId: rule.id, checked: isTunnelUp(status), status })
    }
  }
  items.push({ kind: 'separator' }, { kind: 'quit', label: s.quit })
  return items
}
