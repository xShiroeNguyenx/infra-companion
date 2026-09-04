import { useMemo, useState } from 'react'
import { DEFAULT_SIDEBAR_BLOCKS, type SidebarBlockId } from '@infra/shared'
import { useSidebarGroupsStore } from '../stores/sidebarGroups'
import { useT, type I18nKey } from '../i18n'

/**
 * Hộp cấu hình bố cục sidebar — mở bằng nút ⚙ ở hàng ô tìm.
 *
 * Sidebar từng cố định là "Yêu thích → nhóm host → gần đây". Ai không làm việc theo kiểu đó
 * (chủ yếu bật tắt tunnel, hoặc mở workspace) thì phần cột đắt giá nhất lại dành cho thứ họ
 * ít dùng. Hộp này cho tick khối nào hiện và **kéo thả** sắp thứ tự.
 *
 * MỘT danh sách duy nhất (không tách "đang bật / đang tắt" thành hai khu): thứ tự là thuộc
 * tính của cả danh sách, nên tick tắt một khối rồi bật lại phải thấy nó về đúng chỗ cũ, chứ
 * không nhảy xuống cuối một khu khác.
 */

const BLOCK_LABEL: Record<SidebarBlockId, I18nKey> = {
  favorites: 'sidebar.favorites',
  groups: 'sidebar.blockGroups',
  tunnels: 'sidebar.blockTunnels',
  snippets: 'sidebar.blockSnippets',
  workspaces: 'sidebar.blockWorkspaces',
  recent: 'sidebar.recentUnsaved'
}

const BLOCK_ICON: Record<SidebarBlockId, string> = {
  favorites: '★',
  groups: '🗂',
  tunnels: '🔀',
  snippets: '📝',
  workspaces: '🗂',
  recent: '🕒'
}

export function SidebarLayoutPanel({ onClose }: { readonly onClose: () => void }) {
  const t = useT()
  const blockOrder = useSidebarGroupsStore((s) => s.blockOrder)
  const blockEnabled = useSidebarGroupsStore((s) => s.blockEnabled)
  const toggleBlock = useSidebarGroupsStore((s) => s.toggleBlock)
  const moveBlock = useSidebarGroupsStore((s) => s.moveBlock)
  const resetBlocks = useSidebarGroupsStore((s) => s.resetBlocks)
  const [dragId, setDragId] = useState<SidebarBlockId | null>(null)

  /**
   * Danh sách đầy đủ theo thứ tự đang dùng — kể cả khối đang TẮT, vì đây là chỗ duy nhất bật
   * lại được chúng. Hợp nhất với mặc định để khối mới của bản sau không bị thiếu.
   */
  const rows = useMemo(() => {
    const seen = new Set<string>()
    const out: SidebarBlockId[] = []
    for (const id of blockOrder) {
      if (!DEFAULT_SIDEBAR_BLOCKS.includes(id) || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    for (const id of DEFAULT_SIDEBAR_BLOCKS) if (!seen.has(id)) out.push(id)
    return out
  }, [blockOrder])

  return (
    <div className="border-edge bg-elevated mt-1.5 rounded-md border p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-subtle text-[10px] font-semibold tracking-wider uppercase">
          {t('sidebar.layoutTitle')}
        </span>
        <button className="text-subtle hover:text-content text-[11px]" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
      </div>

      <div className="space-y-0.5">
        {rows.map((id, i) => {
          const on = blockEnabled.includes(id)
          return (
            <div
              key={id}
              draggable
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId && dragId !== id) moveBlock(dragId, i)
                setDragId(null)
              }}
              className={`hover:bg-hover flex cursor-grab items-center gap-1.5 rounded px-1 py-1 text-[11px] ${
                dragId === id ? 'opacity-40' : ''
              }`}
              title={t('sidebar.layoutDragHint')}
            >
              <span className="text-subtle shrink-0">⠿</span>
              {/* label bọc checkbox: bấm cả dòng là tick, không phải nhắm đúng ô vuông 12px */}
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={on} onChange={() => toggleBlock(id)} className="accent-accent" />
                <span className="shrink-0">{BLOCK_ICON[id]}</span>
                <span className={`min-w-0 truncate ${on ? 'text-content' : 'text-subtle'}`}>{t(BLOCK_LABEL[id])}</span>
              </label>
            </div>
          )
        })}
      </div>

      <button className="text-subtle hover:text-danger mt-1.5 text-[10px] hover:underline" onClick={resetBlocks}>
        {t('sidebar.layoutReset')}
      </button>
    </div>
  )
}
