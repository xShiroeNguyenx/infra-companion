import { useRef } from 'react'
import { useT } from '../i18n'
import {
  CURSOR_ACCEPT,
  CURSOR_CUSTOM_MAX,
  CURSOR_MAX_PX,
  CURSOR_PRESETS,
  currentAccent,
  cursorNameFromFile,
  customCursorCss,
  importCursorFile,
  isNativePreset,
  newCursorId,
  presetCss,
  type CursorPreset,
  type CursorPresetId
} from '../lib/cursors'
import { useSettingsStore } from '../stores/settings'
import { useToastsStore } from '../stores/toasts'
import { Button, TextInput } from './ui'

/** Khoá i18n cho nhãn từng preset. */
const PRESET_LABEL = {
  system: 'settings.cursor.system',
  pointer: 'settings.cursor.pointer',
  crosshair: 'settings.cursor.crosshair',
  cell: 'settings.cursor.cell',
  text: 'settings.cursor.text',
  grab: 'settings.cursor.grab',
  arrowLight: 'settings.cursor.arrowLight',
  arrowDark: 'settings.cursor.arrowDark',
  arrowAccent: 'settings.cursor.arrowAccent',
  ring: 'settings.cursor.ring',
  dot: 'settings.cursor.dot',
  retro: 'settings.cursor.retro',
  sword: 'settings.cursor.sword',
  heart: 'settings.cursor.heart',
  pine: 'settings.cursor.pine',
  rocket: 'settings.cursor.rocket',
  pencil: 'settings.cursor.pencil',
  bolt: 'settings.cursor.bolt',
  paw: 'settings.cursor.paw'
} as const satisfies Record<CursorPresetId, string>

/**
 * Ký tự minh hoạ cho preset dùng con trỏ của hệ điều hành — app không vẽ được hình thật
 * của chúng (mỗi OS một kiểu). Muốn xem thật thì rê chuột lên ô: ô nào cũng đang đặt
 * đúng `cursor` của chính nó.
 */
const NATIVE_GLYPH: Record<string, string> = {
  system: '↖',
  pointer: '☞',
  crosshair: '✛',
  cell: '✜',
  text: 'I',
  grab: '✋'
}

function PresetTile({
  preset,
  accent,
  selected,
  label,
  onSelect
}: {
  readonly preset: CursorPreset
  readonly accent: string
  readonly selected: boolean
  readonly label: string
  readonly onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={label}
      style={{ cursor: presetCss(preset, accent) }}
      className={`flex flex-col items-center gap-1 rounded border px-1 py-2 ${
        selected ? 'border-accent text-content bg-accent-soft/40' : 'border-edge text-muted hover:bg-hover'
      }`}
    >
      <span className="flex h-8 items-center justify-center">
        {preset.image ? (
          <img src={preset.image(accent)} alt="" className="max-h-8 max-w-6" />
        ) : (
          <span className="text-base leading-none">{NATIVE_GLYPH[preset.id] ?? '•'}</span>
        )}
      </span>
      <span className="w-full truncate text-center text-[10px] leading-tight">{label}</span>
    </button>
  )
}

/**
 * Vùng thử 3 trạng thái cạnh nhau. Cố ý KHÔNG đặt `cursor` inline ở đây để rule thật
 * trong main.css được áp — đó là cách duy nhất thấy được bản hover mà không phải đi
 * rê chuột khắp app.
 */
function DemoStrip() {
  const t = useT()
  return (
    <div className="border-edge mt-1.5 grid grid-cols-3 gap-1.5 rounded border p-1.5">
      <div className="bg-app text-subtle flex h-9 items-center justify-center rounded text-[10px]">
        {t('settings.cursorDemoNormal')}
      </div>
      <button type="button" className="bg-accent-soft/40 text-content h-9 rounded text-[10px]">
        {t('settings.cursorDemoHover')}
      </button>
      <input
        readOnly
        value={t('settings.cursorDemoText')}
        className="border-edge-strong bg-input text-subtle h-9 rounded border text-center text-[10px]"
      />
    </div>
  )
}

/**
 * Chọn con trỏ chuột cho toàn app. Mỗi con trỏ là một CẶP: trạng thái thường + trạng thái
 * hover (khi trỏ vào thứ bấm được). Preset tự sinh bản hover từ chính hình của nó; con trỏ
 * tự thêm thì user nạp ảnh hover riêng (tuỳ chọn, dùng chung điểm nhấn).
 * Giới hạn của Chromium (trần 128px, không chạy `.ani`) giải thích ở `lib/cursors.ts`.
 */
export function MouseCursorSection() {
  const t = useT()
  const push = useToastsStore((s) => s.push)
  const fileRef = useRef<HTMLInputElement>(null)
  const hoverFileRef = useRef<HTMLInputElement>(null)
  /** Con trỏ nào đang chờ nạp ảnh hover (dùng chung 1 input file cho mọi dòng). */
  const hoverTargetRef = useRef<string | null>(null)
  // Không dùng selector: subscribe cả store để đổi theme/accent cũng render lại,
  // nhờ vậy `currentAccent()` đọc được CSS var mới cho ảnh xem trước.
  const {
    mouseCursor,
    customCursors,
    setMouseCursor,
    addCustomCursor,
    updateCustomCursor,
    setCustomCursorHover,
    removeCustomCursor
  } = useSettingsStore()
  const accent = currentAccent()
  const full = customCursors.length >= CURSOR_CUSTOM_MAX

  /** Báo kết quả chung cho cả 2 luồng nạp ảnh. */
  const reportImport = (resized: boolean): void => {
    if (resized) push(t('settings.cursorResized', { max: CURSOR_MAX_PX }), 'info')
  }

  const onPick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const img = await importCursorFile(file)
      const result = addCustomCursor({
        id: newCursorId(),
        name: cursorNameFromFile(file.name),
        dataUrl: img.dataUrl,
        // Điểm nhấn mặc định là góc trên-trái: đúng cho mũi tên, user tự chỉnh nếu là vòng/chấm
        hotX: 0,
        hotY: 0,
        width: img.width,
        height: img.height
      })
      if (result === 'full') push(t('settings.cursorFull', { n: CURSOR_CUSTOM_MAX }))
      else if (result === 'quota') push(t('settings.cursorQuota'))
      else reportImport(img.resized)
    } catch (e) {
      push(t((e as Error).message === 'Animated' ? 'settings.cursorErrAnimated' : 'settings.cursorErrDecode'))
    }
  }

  const onPickHover = async (file: File | undefined): Promise<void> => {
    const id = hoverTargetRef.current
    hoverTargetRef.current = null
    if (!file || !id) return
    try {
      const img = await importCursorFile(file)
      const ok = setCustomCursorHover(id, { dataUrl: img.dataUrl, width: img.width, height: img.height })
      if (!ok) push(t('settings.cursorQuota'))
      else reportImport(img.resized)
    } catch (e) {
      push(t((e as Error).message === 'Animated' ? 'settings.cursorErrAnimated' : 'settings.cursorErrDecode'))
    }
  }

  return (
    <>
      <div className="mb-2.5">
        <span className="text-muted mb-1 block text-[11px] font-medium tracking-wide uppercase">
          {t('settings.cursorMouse')}
        </span>
        {/* Tách 2 nhóm: gộp 19 ô vào một lưới thì rối, mà hai nhóm cũng khác bản chất —
            một bên là con trỏ của OS (mỗi máy một hình), một bên là ảnh app tự vẽ. */}
        {(
          [
            ['settings.cursorGroupNative', CURSOR_PRESETS.filter(isNativePreset)],
            ['settings.cursorGroupDrawn', CURSOR_PRESETS.filter((p) => !isNativePreset(p))]
          ] as const
        ).map(([heading, presets]) => (
          <div key={heading} className="mb-2">
            <span className="text-subtle mb-1 block text-[10px]">{t(heading)}</span>
            <div className="grid grid-cols-6 gap-1.5">
              {presets.map((p) => (
                <PresetTile
                  key={p.id}
                  preset={p}
                  accent={accent}
                  selected={mouseCursor === p.id}
                  label={t(PRESET_LABEL[p.id])}
                  onSelect={() => setMouseCursor(p.id)}
                />
              ))}
            </div>
          </div>
        ))}
        <p className="text-subtle mt-1 text-[11px] leading-relaxed">{t('settings.cursorMouseHint')}</p>
        <DemoStrip />
      </div>

      {/* Cố ý KHÔNG bọc <Field>: Field là <label>, mà khối này có nhiều ô nhập nên bấm
          vào nhãn sẽ nhảy focus lung tung. */}
      <div className="mb-2.5">
        <span className="text-muted mb-1 block text-[11px] font-medium tracking-wide uppercase">
          {t('settings.cursorCustom')}
        </span>

        {customCursors.length > 0 && (
          <div className="mb-1.5 flex flex-col gap-1.5">
            {customCursors.map((c) => {
              const selection = `custom:${c.id}`
              const css = customCursorCss(c)
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-1.5 rounded border p-1.5 ${
                    mouseCursor === selection ? 'border-accent bg-accent-soft/30' : 'border-edge'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setMouseCursor(selection)}
                    title={t('settings.cursorUse')}
                    style={css ? { cursor: css } : undefined}
                    className="border-edge bg-app flex size-9 shrink-0 items-center justify-center rounded border"
                  >
                    <img src={c.dataUrl} alt="" className="max-h-7 max-w-7" />
                  </button>
                  {/* Ô ảnh hover: có ảnh thì hiện, chưa có thì dấu + để nạp */}
                  <button
                    type="button"
                    onClick={() => {
                      hoverTargetRef.current = c.id
                      hoverFileRef.current?.click()
                    }}
                    title={t('settings.cursorHoverSlot')}
                    className="border-edge text-subtle bg-app hover:bg-hover flex size-9 shrink-0 items-center justify-center rounded border border-dashed"
                  >
                    {c.hoverDataUrl ? (
                      <img src={c.hoverDataUrl} alt="" className="max-h-7 max-w-7" />
                    ) : (
                      <span className="text-xs">＋</span>
                    )}
                  </button>
                  {c.hoverDataUrl && (
                    <button
                      type="button"
                      onClick={() => setCustomCursorHover(c.id, null)}
                      title={t('settings.cursorHoverClear')}
                      className="text-subtle hover:text-danger shrink-0 text-[10px]"
                    >
                      ↺
                    </button>
                  )}
                  <TextInput
                    value={c.name}
                    onChange={(e) => updateCustomCursor(c.id, { name: e.target.value })}
                    className="!py-1 !text-xs"
                  />
                  {/* Điểm nhấn: pixel nào trong ảnh là "đầu mũi tên"; 0,0 = góc trên-trái */}
                  <span className="text-subtle flex shrink-0 items-center gap-1 text-[10px]">
                    <span>X</span>
                    <input
                      type="number"
                      min={0}
                      max={c.width - 1}
                      value={c.hotX}
                      onChange={(e) => updateCustomCursor(c.id, { hotX: Number(e.target.value) })}
                      className="border-edge-strong bg-input text-content w-12 rounded border px-1 py-1 text-xs outline-none"
                    />
                  </span>
                  <span className="text-subtle flex shrink-0 items-center gap-1 text-[10px]">
                    <span>Y</span>
                    <input
                      type="number"
                      min={0}
                      max={c.height - 1}
                      value={c.hotY}
                      onChange={(e) => updateCustomCursor(c.id, { hotY: Number(e.target.value) })}
                      className="border-edge-strong bg-input text-content w-12 rounded border px-1 py-1 text-xs outline-none"
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCustomCursor(c.id)}
                    title={t('common.delete')}
                    className="text-subtle hover:text-danger shrink-0 px-1 text-sm"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={CURSOR_ACCEPT}
          className="hidden"
          onChange={(e) => {
            void onPick(e.target.files?.[0])
            e.target.value = '' // cho phép chọn LẠI đúng file vừa chọn
          }}
        />
        <input
          ref={hoverFileRef}
          type="file"
          accept={CURSOR_ACCEPT}
          className="hidden"
          onChange={(e) => {
            void onPickHover(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={full}>
          {t('settings.cursorAdd')}
        </Button>
        <p className="text-subtle mt-1 text-[10px] leading-relaxed">
          {t('settings.cursorAddHint', { max: CURSOR_MAX_PX, n: CURSOR_CUSTOM_MAX })}
        </p>
      </div>
    </>
  )
}
