import type { PaneLayout } from '../stores/settings'

/**
 * Icon mô phỏng bố cục pane (dùng chung ở toolbar split + picker trong Settings).
 * Vẽ bằng SVG (không phụ thuộc font) trên khung 16×16, các ô cách nhau 1px.
 * Toạ độ: [x, y, w, h].
 */
const RECTS: Record<PaneLayout, Array<[number, number, number, number]>> = {
  auto: [
    [1, 1, 6, 6],
    [9, 1, 6, 6],
    [1, 9, 6, 6],
    [9, 9, 6, 6]
  ],
  columns: [
    [1, 1, 4, 14],
    [6, 1, 4, 14],
    [11, 1, 4, 14]
  ],
  rows: [
    [1, 1, 14, 4],
    [1, 6, 14, 4],
    [1, 11, 14, 4]
  ],
  'main-left': [
    [1, 1, 9, 14],
    [11, 1, 4, 6],
    [11, 9, 4, 6]
  ],
  'main-top': [
    [1, 1, 14, 9],
    [1, 11, 6, 4],
    [9, 11, 6, 4]
  ]
}

export function LayoutGlyph({ kind, className }: { kind: PaneLayout; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className ?? 'size-4'} aria-hidden="true">
      {RECTS[kind].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx={1} fill="currentColor" />
      ))}
    </svg>
  )
}
