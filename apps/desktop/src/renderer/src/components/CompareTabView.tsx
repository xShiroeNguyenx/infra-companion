import { CompareView } from './CompareView'
import { useT } from '../i18n'

/**
 * So sánh config trong 1 TAB riêng (toàn màn hình, không giới hạn như popup). Dùng chung CompareView.
 * Ẩn bằng `hidden` khi không active (theo khuôn các tab view khác) — KHÔNG unmount để giữ kết quả.
 */
export function CompareTabView({ active }: { active: boolean }) {
  const t = useT()
  return (
    <div className={`bg-app absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      <div className="border-edge bg-panel flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className="text-content text-sm font-medium">🔍 {t('compare.title')}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <CompareView />
      </div>
    </div>
  )
}
