import type { LayoutTheme } from '../stores/settings'

/**
 * Hình xem trước NHỎ của một theme bố cục trong Settings — vẽ bằng div, không phải ảnh chụp:
 * nó đổi màu theo dark/light và accent đang chọn, nên luôn khớp với app đang chạy.
 *
 *  · `infra`     — cột trái là cây host (ô tìm, ★ yêu thích, nhóm sổ ra), vùng chính là Dashboard
 *                  (hàng ô công cụ + card nhóm);
 *  · `navigator` — cột trái là dãy mục icon + nhãn (mục thứ hai đang chọn), vùng chính là trang
 *                  Hosts (header + thẻ thư mục nhóm).
 */
export function LayoutPreview({ layout }: { layout: LayoutTheme }) {
  const navigator = layout === 'navigator'
  return (
    <div className="border-edge-strong bg-app flex aspect-[16/9] w-full overflow-hidden rounded border" aria-hidden>
      {/* Cột trái */}
      <div className={`bg-panel border-edge flex flex-col gap-[3px] border-r p-1.5 ${navigator ? 'w-[30%]' : 'w-[36%]'}`}>
        {navigator ? (
          ['w-3/5', 'w-1/2', 'w-2/3', 'w-3/5', 'w-1/2', 'w-2/3'].map((w, i) => (
            <div
              key={i}
              className={`flex items-center gap-1 rounded-sm px-0.5 py-[2px] ${i === 1 ? 'bg-accent-soft/60' : ''}`}
              style={i === 1 ? { boxShadow: 'inset 1px 0 0 var(--c-accent)' } : undefined}
            >
              <span className={`size-1.5 shrink-0 rounded-sm ${i === 1 ? 'bg-accent' : 'bg-subtle/70'}`} />
              <span className={`h-1 rounded-sm ${w} ${i === 1 ? 'bg-content/70' : 'bg-edge-strong'}`} />
            </div>
          ))
        ) : (
          <>
            <div className="bg-input border-edge h-2 rounded-sm border" />
            <div className="bg-warning/70 mt-0.5 h-1 w-1/2 rounded-sm" />
            <div className="bg-edge-strong ml-1.5 h-1 w-3/4 rounded-sm" />
            <div className="bg-edge-strong ml-1.5 h-1 w-2/3 rounded-sm" />
            <div className="bg-subtle/70 mt-0.5 h-1 w-2/5 rounded-sm" />
            <div className="bg-edge-strong ml-1.5 h-1 w-3/4 rounded-sm" />
            <div className="bg-edge-strong ml-1.5 h-1 w-1/2 rounded-sm" />
            <div className="bg-edge-strong ml-1.5 h-1 w-2/3 rounded-sm" />
            <div className="bg-subtle/70 mt-0.5 h-1 w-1/3 rounded-sm" />
            <div className="bg-edge-strong ml-1.5 h-1 w-3/5 rounded-sm" />
          </>
        )}
      </div>
      {/* Vùng chính */}
      <div className="flex flex-1 flex-col gap-1.5 p-1.5">
        {navigator ? (
          <>
            <div className="flex items-center gap-1">
              <span className="bg-content/60 h-1.5 w-1/4 rounded-sm" />
              <span className="bg-input border-edge ml-auto h-2 w-2/5 rounded-sm border" />
              <span className="bg-accent h-2 w-[12%] rounded-sm" />
            </div>
            <div className="grid flex-1 grid-cols-3 gap-1">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="border-edge-strong bg-elevated relative overflow-hidden rounded-sm border pl-1.5">
                  <span
                    className="absolute inset-y-0 left-0 w-[3px]"
                    style={{ background: ['var(--c-accent)', 'var(--c-warning)', 'var(--c-success)'][i % 3] }}
                  />
                  <span className="bg-content/50 mt-1 block h-1 w-2/3 rounded-sm" />
                  <span className="bg-edge-strong mt-0.5 block h-[3px] w-1/2 rounded-sm" />
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <span className="bg-content/60 h-1.5 w-1/3 rounded-sm" />
            <div className="grid grid-cols-6 gap-1">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="border-edge-strong bg-panel aspect-square rounded-sm border" />
              ))}
            </div>
            <div className="grid flex-1 grid-cols-2 gap-1">
              {[0, 1].map((i) => (
                <div key={i} className="border-edge-strong bg-elevated relative overflow-hidden rounded-sm border pl-1.5">
                  <span
                    className="absolute inset-y-0 left-0 w-[3px]"
                    style={{ background: i === 0 ? 'var(--c-accent)' : 'var(--c-warning)' }}
                  />
                  <span className="bg-content/50 mt-1 block h-1 w-1/2 rounded-sm" />
                  <span className="mt-0.5 flex gap-0.5">
                    <span className="bg-edge-strong h-[3px] w-1/4 rounded-sm" />
                    <span className="bg-edge-strong h-[3px] w-1/4 rounded-sm" />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
