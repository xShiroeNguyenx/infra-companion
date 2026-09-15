import { useEffect, type ReactNode } from 'react'
import { SETTINGS_HEADER_H, type SettingsFrameBox } from '@infra/shared'

/**
 * Khung CÀI ĐẶT lớn — hai cột, nhân vật đứng ở khe giữa.
 *
 * ⚠️ PHẢI là **ANH EM** của thẻ nhân vật trong cây DOM, không được là con của nó.
 *
 * Bản đầu đặt khung bên trong thẻ nhân vật cho tiện. Thẻ đó có `transform: scale()` (co nhân vật
 * cho vừa khe) và `opacity` (làm mờ dưới chữ) — mà con `position: fixed` của một cha có
 * `transform` thì tính toạ độ theo **cha** và co theo cha. Hệ quả user chụp được ba lần liền:
 * bảng văng khỏi tâm màn hình, kéo thanh cỡ thì bảng to nhỏ theo, bảng mờ 55% như nhân vật.
 * Không dòng lỗi nào được báo. Đặt làm anh em (cùng cha `App`, thẻ đó `relative isolate` ở 0,0
 * và không có transform) thì `fixed` là màn hình thật, và không thuộc tính nào của thẻ nhân vật
 * lan sang được.
 *
 * HAI LỚP tách rời, cùng một hộp `box`:
 *  - lớp NỀN `z-30` — **dưới** nhân vật (`z-40`): tấm kính, viền, bóng.
 *  - lớp NỘI DUNG `z-50` — **trên** nhân vật: tiêu đề + hai cột chữ. User yêu cầu nhân vật to quá
 *    thì chữ đè lên người chứ đừng đẩy người ra ngoài. Một thẻ duy nhất không làm được việc này:
 *    `fixed` luôn tạo stacking context riêng, nên `z-50` bên trong nó chỉ so với nhau, không so
 *    được với nhân vật bên ngoài.
 *  Khe giữa của lớp nội dung **không nhận chuột** → kéo / xoay nhân vật vẫn chạy khi bảng đang mở.
 *
 * `box` do **nơi gọi** tính (`settingsFrameBox`) và cũng là thứ nó dùng để đặt nhân vật — một
 * nguồn, không tính lại ở đây: tính hai nơi thì lệch nhau vài px là nhân vật chệch khe.
 *
 * File riêng, chỉ phụ thuộc `react` + `@infra/shared`: để harness bundle được **đúng component
 * này** bằng esbuild và chụp ảnh kiểm — `VrmRadialMenu.tsx` kéo theo store/i18n nên không bundle
 * rời được.
 */
export function VrmSettingsFrame({
  box,
  children,
  right,
  footer,
  onClose
}: {
  readonly box: SettingsFrameBox
  /** Cột TRÁI. */
  readonly children: ReactNode
  /** Cột PHẢI — hai thuộc tính riêng, không tách một `children` gộp: tách gộp thì nơi gọi phải
   *  nhớ đúng thứ tự phần tử, mà quên thứ tự thì lỗi im lặng (một cột trống). */
  readonly right: ReactNode
  /**
   * Thanh CHÂN cố định — các nút phải luôn nhìn thấy dù cột có cuộn.
   *
   * Trước đây "Chọn model khác" và "Tắt trợ lý ảo" nằm cuối cột phải, mà cột đó dài ra theo số
   * clip user nạp nên hai nút bị đẩy xuống dưới vùng cuộn. Nút hành động không được trốn sau một
   * thanh cuộn.
   */
  readonly footer?: ReactNode
  readonly onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { left, top, width, height, gap } = box
  const place = { left, top, width, height }

  return (
    <>
      {/* Lớp NỀN — dưới nhân vật. `pointer-events-auto` để bấm vào tấm kính không lọt xuống Dashboard */}
      <div
        data-vrm-overlay
        data-vrm-settings-bg
        aria-hidden
        style={place}
        className="bg-elevated/95 border-edge-strong pointer-events-auto fixed z-30 rounded-xl border shadow-2xl"
      />
      {/* Lớp NỘI DUNG — trên nhân vật. Cả lớp không nhận chuột; chỉ tiêu đề và hai cột bật lại */}
      <div
        data-vrm-overlay
        data-vrm-settings-content
        role="dialog"
        aria-label="Cài đặt trợ lý ảo"
        style={place}
        className="pointer-events-none fixed z-50 flex flex-col"
      >
        {/* Cao cố định `SETTINGS_HEADER_H`: `characterSlotInSettings` trừ đúng con số này để đặt
            nhân vật, hai bên lệch nhau là nhân vật đè lên tiêu đề hoặc thò ra ngoài */}
        <div
          className="border-edge pointer-events-auto flex shrink-0 items-center justify-between border-b px-4"
          style={{ height: SETTINGS_HEADER_H }}
        >
          <span className="text-content text-sm font-semibold">⚙ Cài đặt trợ lý ảo</span>
          <button
            className="text-subtle hover:bg-hover hover:text-content rounded px-1.5 py-0.5 text-sm leading-none"
            aria-label="Đóng"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {/**
         * HAI KHE THẬT, không phải `columns` của CSS: `column-count: 2` chỉ chia khi nội dung đủ cao
         * để tràn — bảng cài đặt ngắn nên nó dồn hết vào cột trái và chừa cột phải trống (user chụp
         * được). Ở đây chia tay, khe giữa đúng bề ngang nhân vật.
         *
         * `gridTemplateRows: minmax(0, 1fr)` để mỗi CỘT tự cuộn trong chiều cao khung — cuộn ở
         * cột (nhận chuột) thì thanh cuộn kéo được; cuộn ở lưới (không nhận chuột) thì không.
         *
         * KHÔNG `backdrop-blur` trên cột: blur đè lên canvas WebGL vẽ liên tục là mỗi khung hình
         * phải tính lại blur — đã có model lag vì GPU. Nền cột 70% + nhân vật mờ 55% là đủ đọc.
         */}
        <div
          className="grid min-h-0 flex-1 px-4 py-3"
          style={{ gridTemplateColumns: `1fr ${gap}px 1fr`, gridTemplateRows: 'minmax(0, 1fr)' }}
        >
          <div className={COL_CLASS}>{children}</div>
          {/* Khe giữa để trống — nhân vật đứng ở đây, chuột xuyên qua tới nhân vật */}
          <div aria-hidden data-vrm-settings-gap />
          <div className={COL_CLASS}>{right}</div>
        </div>
        {footer && (
          <div className="border-edge pointer-events-auto flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5">
            {footer}
          </div>
        )}
      </div>
    </>
  )
}

/**
 * Cột kính: viền + bo + nền mờ, đủ để mắt thấy "đây là một vùng" thay vì chữ trôi trên nền 3D.
 *
 * Mượn cách của `desktop-companion` (`.set-col`) nhưng **bỏ `backdrop-filter`**: blur đè lên canvas
 * WebGL vẽ liên tục là mỗi khung hình phải tính lại blur — đã có model lag vì GPU. Nền đục 70% +
 * nhân vật mờ 55% là đủ đọc mà không tốn gì.
 */
const COL_CLASS =
  'bg-elevated/70 border-edge/60 pointer-events-auto flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl border p-3'

/**
 * Một NHÓM trong cột: tiêu đề nhỏ in hoa + đường kẻ, rồi tới nội dung.
 *
 * Mượn `.set-group > h3` của `desktop-companion`. Lý do nó đáng có: bảng cũ để mọi thứ trôi nổi
 * cạnh nhau — bốn checkbox, một thanh trượt, một dropdown, một bảng phím — mắt không có mốc nào
 * để biết cái nào thuộc cái nào. Tiêu đề in hoa cỡ nhỏ tạo mốc mà gần như không tốn chiều cao.
 *
 * Màu theo `--c-accent` của app chứ không lấy tông hồng của bên kia: bảng này sống trong theme
 * user đã chọn, một màu cứng sẽ chọi với mọi theme khác.
 */
export function SettingsGroup({
  title,
  children
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-accent border-edge/50 flex items-center gap-1.5 border-b pb-1 text-[10px] font-bold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </div>
  )
}

/**
 * Hàng công tắc: nhãn bên trái, ô tick bên phải, cả hàng có khung.
 *
 * Khung là thứ tạo khác biệt lớn nhất so với bản cũ: checkbox trần nằm cạnh nhau trông như một
 * đám chữ rời, còn mỗi cái một khung thì thành một danh sách đọc được. Cả hàng là `<label>` nên
 * bấm vào chữ cũng tick — vùng bấm rộng gấp mấy lần cái ô 13px.
 */
export function SettingsToggle({
  label,
  checked,
  disabled,
  title,
  onChange
}: {
  readonly label: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly title?: string
  readonly onChange: (v: boolean) => void
}) {
  return (
    <label
      className={`border-edge/40 flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${
        disabled ? 'opacity-50' : 'hover:border-edge hover:bg-hover/40 cursor-pointer'
      }`}
      title={title}
    >
      <span className="text-content min-w-0 flex-1">{label}</span>
      <input
        type="checkbox"
        className="accent-accent shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

/** Một trường có nhãn nhỏ phía trên — dùng cho dropdown, thanh trượt, ô nhập. */
export function SettingsField({
  label,
  children
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-subtle text-[11px]">{label}</span>
      {children}
    </div>
  )
}
