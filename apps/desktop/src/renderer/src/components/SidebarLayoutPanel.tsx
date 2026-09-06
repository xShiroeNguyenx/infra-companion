import { useMemo } from 'react'
import { DEFAULT_SIDEBAR_BLOCKS, mergeKnownOrder, type SidebarBlockId } from '@infra/shared'
import { useSidebarGroupsStore } from '../stores/sidebarGroups'
import { BlockLayoutPanel } from './BlockLayoutPanel'
import { useT, type I18nKey } from '../i18n'

/**
 * Hộp cấu hình bố cục sidebar (theme Infra) — mở bằng nút ⚙ ở hàng ô tìm.
 *
 * Sidebar từng cố định là "Yêu thích → nhóm host → gần đây". Ai không làm việc theo kiểu đó
 * (chủ yếu bật tắt tunnel, hoặc mở workspace) thì phần cột đắt giá nhất lại dành cho thứ họ
 * ít dùng. Hộp này cho tick khối nào hiện và **kéo thả** sắp thứ tự. Phần vẽ nằm ở
 * `BlockLayoutPanel` (dùng chung với menu theme Navigator); file này chỉ nối vào store khối.
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

  /**
   * Danh sách đầy đủ theo thứ tự đang dùng — kể cả khối đang TẮT, vì đây là chỗ duy nhất bật
   * lại được chúng. Hợp nhất với mặc định để khối mới của bản sau không bị thiếu.
   */
  const rows = useMemo(
    () =>
      mergeKnownOrder(blockOrder, DEFAULT_SIDEBAR_BLOCKS).map((id) => ({
        id,
        icon: BLOCK_ICON[id],
        label: t(BLOCK_LABEL[id]),
        on: blockEnabled.includes(id)
      })),
    [blockOrder, blockEnabled, t]
  )

  return (
    <BlockLayoutPanel
      title={t('sidebar.layoutTitle')}
      rows={rows}
      onToggle={toggleBlock}
      onMove={moveBlock}
      onReset={resetBlocks}
      onClose={onClose}
    />
  )
}
