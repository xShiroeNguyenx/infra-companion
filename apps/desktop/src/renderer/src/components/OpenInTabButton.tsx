import { useTabsStore, type ToolTabKind } from '../stores/tabs'
import { useT } from '../i18n'

/**
 * Nút "⊞ Mở ở tab" trên header của các công cụ dạng popup.
 *
 * Lý do tồn tại: popup là modal — mở lên là KHOÁ cả app, không làm được việc khác trong lúc công
 * cụ chạy dài (AI chẩn đoán từng bước, theo dõi tunnel, xem tiến trình). Bấm nút này chuyển đúng
 * công cụ đó sang một tab rồi đóng popup, state giữ nguyên vì cả hai đọc chung store.
 */
export function OpenInTabButton({ kind, onDone }: { kind: ToolTabKind; onDone?: () => void }) {
  const t = useT()
  const openToolTab = useTabsStore((s) => s.openToolTab)
  return (
    <button
      type="button"
      className="border-edge-strong text-muted hover:bg-hover hover:text-content shrink-0 rounded border px-2 py-0.5 text-[11px] font-normal"
      title={t('tabs.openInTabHint')}
      onClick={() => {
        openToolTab(kind)
        onDone?.()
      }}
    >
      ⊞ {t('tabs.openInTab')}
    </button>
  )
}
