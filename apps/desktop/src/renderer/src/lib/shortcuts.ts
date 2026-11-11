/**
 * Phím tắt tuỳ biến cho terminal (copy/paste/find/explain).
 * Combo được chuẩn hoá thành chuỗi "Ctrl+Shift+V" từ KeyboardEvent (dùng `code` = vị trí phím
 * vật lý nên không lệ thuộc layout/IME). So khớp = dựng lại chuỗi từ event rồi so bằng.
 */

export type ShortcutAction = 'copy' | 'paste' | 'find' | 'explain' | 'prevPrompt' | 'nextPrompt'

export const SHORTCUT_ACTIONS: ShortcutAction[] = ['copy', 'paste', 'find', 'explain', 'prevPrompt', 'nextPrompt']

/**
 * Giá trị mặc định — GIỮ nguyên hành vi cũ đã hardcode trong TerminalPane.
 *
 * Nhảy prompt dùng Ctrl+↑/↓ như VS Code. Bash mặc định không gán gì cho tổ hợp này (bấm vào
 * thường chỉ in ra rác kiểu `;5A`), nên lấy nó không cướp phím của shell. Pane chỉ chặn phím khi
 * thật sự có mốc prompt để nhảy; chưa bật shell integration thì phím đi thẳng xuống terminal.
 */
export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  copy: 'Ctrl+Shift+C',
  paste: 'Ctrl+Shift+V',
  find: 'Ctrl+F',
  explain: 'Ctrl+Shift+E',
  prevPrompt: 'Ctrl+ArrowUp',
  nextPrompt: 'Ctrl+ArrowDown'
}

/** Nhãn để HIỂN THỊ một phím trong combo: `ArrowUp` → `↑`. Chuỗi lưu vẫn giữ tên gốc. */
export function displayKey(key: string): string {
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
  return arrows[key] ?? key
}

/** Combo để hiển thị: `Ctrl+ArrowUp` → `Ctrl+↑`. */
export function displayCombo(combo: string): string {
  return combo.split('+').map(displayKey).join('+')
}

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
])

/** KeyboardEvent.code → nhãn gọn: KeyV→V, Digit1→1, Numpad5→Num5, giữ nguyên F1/Enter/Space… */
function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`
  return code
}

export interface KeyLike {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  code: string
}

/**
 * Chuẩn hoá combo từ event; null nếu chỉ bấm phím bổ trợ (chưa có phím chính).
 * Thứ tự modifier CỐ ĐỊNH (Ctrl→Alt→Shift→Meta) để so khớp và hiển thị nhất quán.
 */
export function eventToCombo(e: KeyLike): string | null {
  if (MODIFIER_CODES.has(e.code)) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  parts.push(keyLabel(e.code))
  return parts.join('+')
}

/**
 * Combo hợp lệ để gán: phải có Ctrl/Alt/Meta (không nhận Shift-đơn vì Shift+chữ = gõ hoa,
 * sẽ nuốt phím thường), HOẶC là phím chức năng F1–F12.
 */
export function isValidShortcut(combo: string | null): combo is string {
  if (!combo) return false
  const isFn = /(^|\+)F([1-9]|1[0-2])$/.test(combo)
  const hasStrongMod = /(?:Ctrl|Alt|Meta)\+/.test(combo)
  return isFn || hasStrongMod
}

/** event có khớp combo đã lưu không. */
export function matchesCombo(e: KeyLike, combo: string): boolean {
  return eventToCombo(e) === combo
}
