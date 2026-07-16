import type { ITheme } from '@xterm/xterm'
import type { ThemeMode } from '../../stores/settings'

/** Theme tối — tông đồng bộ với nền app (#0b0e14). */
export const darkTerminalTheme: ITheme = {
  background: '#0b0e14',
  foreground: '#cdd6f4',
  cursor: '#7aa2f7',
  cursorAccent: '#0b0e14',
  selectionBackground: '#2d3f76',
  // Màu slider của scrollbar overlay (xterm ≥6). Mờ, rõ hơn khi hover/kéo.
  scrollbarSliderBackground: 'rgba(148,163,184,0.22)',
  scrollbarSliderHoverBackground: 'rgba(148,163,184,0.42)',
  scrollbarSliderActiveBackground: 'rgba(148,163,184,0.6)',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5'
}

/** Theme sáng — nền off-white dịu mắt (hoà với nền app), chữ xám đậm (tông GitHub Light). */
export const lightTerminalTheme: ITheme = {
  background: '#fafbfc',
  foreground: '#22262d',
  cursor: '#2560d8',
  cursorAccent: '#fafbfc',
  selectionBackground: '#cfe0fb',
  scrollbarSliderBackground: 'rgba(71,85,105,0.22)',
  scrollbarSliderHoverBackground: 'rgba(71,85,105,0.42)',
  scrollbarSliderActiveBackground: 'rgba(71,85,105,0.6)',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#7d4e00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f'
}

export function terminalTheme(mode: ThemeMode, transparent = false): ITheme {
  const base = mode === 'light' ? lightTerminalTheme : darkTerminalTheme
  // Nền trong suốt khi có ảnh nền — cần allowTransparency=true ở Terminal
  return transparent ? { ...base, background: 'rgba(0,0,0,0)' } : base
}

/** @deprecated dùng terminalTheme(mode) — giữ lại để không vỡ import cũ. */
export const defaultTerminalTheme = darkTerminalTheme
