import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { buildFontStack, isFontAvailable, isMonospaceFamily, primaryFontFamily } from '../lib/fontStack'
import { useFontsStore } from '../stores/fonts'
import { TERM_FONT_DEFAULT, useSettingsStore } from '../stores/settings'
import { useToastsStore } from '../stores/toasts'
import { Button, TextInput } from './ui'

/** Đuôi file cho hộp thoại chọn font. `.woff2` được vì Chromium đọc trực tiếp. */
const FONT_ACCEPT = '.ttf,.otf,.ttc,.otc,.woff,.woff2'

/**
 * Chọn font cho terminal: dropdown liệt kê **font thật có trên máy** (main quét thư mục font
 * của hệ điều hành rồi đọc tên họ từ bảng `name` trong file) + font **user tự thêm từ file**.
 * Ô nhập CSS thô vẫn giữ ở dưới cho ai muốn khai cả một stack nhiều lớp dự phòng.
 */
export function TermFontSection() {
  const t = useT()
  const push = useToastsStore((s) => s.push)
  const fileRef = useRef<HTMLInputElement>(null)
  const termFontFamily = useSettingsStore((s) => s.termFontFamily)
  const setTermFontFamily = useSettingsStore((s) => s.setTermFontFamily)
  const { system, custom, scanFailed, loading, loaded, broken, load, rescan, add, rename, remove } = useFontsStore()
  const [advanced, setAdvanced] = useState(false)

  // Mở Settings mà store chưa nạp (vd chưa đăng nhập vault ở phiên trước) → nạp tại đây
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const current = primaryFontFamily(termFontFamily)
  const known = new Set([...custom.map((f) => f.family), ...system])
  const available = isFontAvailable(current)
  const monospace = isMonospaceFamily(current)

  const onPick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    const res = await add(file)
    if (res.ok) {
      // Thêm xong dùng luôn — đó là ý định của user khi đi tải font về
      setTermFontFamily(buildFontStack(res.font.family))
      push(t('settings.fontAdded', { name: res.font.family }), 'info')
    } else {
      const key =
        res.reason === 'full'
          ? 'settings.fontErrFull'
          : res.reason === 'tooLarge'
            ? 'settings.fontErrTooLarge'
            : res.reason === 'notFont'
              ? 'settings.fontErrNotFont'
              : 'settings.fontErrIo'
      push(t(key))
    }
  }

  return (
    <div className="mb-2.5">
      <span className="text-muted mb-1 block text-[11px] font-medium tracking-wide uppercase">
        {t('settings.termFont')}
      </span>

      <div className="flex gap-2">
        <select
          value={known.has(current) ? current : ''}
          onChange={(e) => setTermFontFamily(buildFontStack(e.target.value))}
          className="border-edge-strong bg-input text-content focus:border-accent w-full rounded border px-2 py-1.5 text-sm outline-none"
        >
          {/* Giá trị hiện tại không nằm trong danh sách (stack tự khai, hoặc font đã bị xoá
              khỏi máy) → vẫn phải hiện ra, nếu không dropdown trông như đang chọn cái khác */}
          {!known.has(current) && <option value="">{current || t('settings.fontNone')}</option>}
          {custom.length > 0 && (
            <optgroup label={t('settings.fontGroupCustom')}>
              {custom.map((f) => (
                <option key={f.id} value={f.family}>
                  {f.family}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={t('settings.fontGroupSystem')}>
            {system.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </optgroup>
        </select>
        <button
          type="button"
          onClick={() => void rescan()}
          disabled={loading}
          className="border-edge text-muted hover:bg-hover shrink-0 rounded border px-3 text-sm disabled:opacity-50"
          title={t('settings.fontRescan')}
        >
          {loading ? '…' : '↻'}
        </button>
        <button
          type="button"
          onClick={() => setTermFontFamily(TERM_FONT_DEFAULT)}
          className="border-edge text-muted hover:bg-hover shrink-0 rounded border px-3 text-sm"
          title={t('settings.termFontReset')}
        >
          ↺
        </button>
      </div>

      {/* Xem thử ngay bằng chính font đang chọn — nhanh hơn đóng Settings ra terminal xem */}
      <div
        className="border-edge bg-app text-content mt-1.5 overflow-x-auto rounded border px-2 py-1.5 text-[13px] whitespace-pre"
        style={{ fontFamily: termFontFamily }}
      >
        {'ilI1 O0 {}[]() <=> --> 2×3 │├─┤\nroot@app-01:~# tail -f /var/log/syslog'}
      </div>

      {scanFailed && <p className="text-warning mt-1 text-[11px]">{t('settings.fontScanFailed')}</p>}
      {!available && current !== '' && (
        <p className="text-warning mt-1 text-[11px]">{t('settings.fontMissing', { name: current })}</p>
      )}
      {available && !monospace && (
        <p className="text-warning mt-1 text-[11px]">{t('settings.fontNotMono', { name: current })}</p>
      )}

      {/* Font user tự thêm */}
      {custom.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {custom.map((f) => (
            <div key={f.id} className="border-edge flex items-center gap-1.5 rounded border p-1.5">
              <TextInput
                value={f.family}
                onChange={(e) => void rename(f.id, e.target.value)}
                className="!py-1 !text-xs"
              />
              <span className="text-subtle shrink-0 text-[10px]">{Math.round(f.sizeBytes / 1024)} KB</span>
              {broken.includes(f.id) && (
                <span className="text-danger shrink-0 text-[10px]" title={t('settings.fontBroken')}>
                  ⚠
                </span>
              )}
              <button
                type="button"
                onClick={() => void remove(f.id)}
                title={t('common.delete')}
                className="text-subtle hover:text-danger shrink-0 px-1 text-sm"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={FONT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          void onPick(e.target.files?.[0])
          e.target.value = '' // cho phép chọn LẠI đúng file vừa chọn
        }}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Button onClick={() => fileRef.current?.click()}>{t('settings.fontAdd')}</Button>
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="text-subtle hover:text-content text-[11px] underline"
        >
          {t('settings.fontAdvanced')}
        </button>
      </div>
      <p className="text-subtle mt-1 text-[10px] leading-relaxed">{t('settings.fontAddHint')}</p>

      {advanced && (
        <div className="mt-1.5">
          <TextInput
            value={termFontFamily}
            onChange={(e) => setTermFontFamily(e.target.value)}
            placeholder={TERM_FONT_DEFAULT}
            className="!font-mono !text-xs"
          />
          <p className="text-subtle mt-1 text-[10px] leading-relaxed">{t('settings.termFontHint')}</p>
        </div>
      )}
    </div>
  )
}
