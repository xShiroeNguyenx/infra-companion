import { useState } from 'react'
import type { SnippetDto } from '@infra/shared'
import { pinnedFirst, useTunnelFavoritesStore } from '../stores/favorites'
import { useDataStore } from '../stores/data'
import { useWorkspacesStore } from '../stores/workspaces'
import { RunSnippetModal } from './RunSnippetModal'
import { useT } from '../i18n'

/**
 * Ba khối tùy chọn của sidebar: Tunnels · Snippets · Workspaces.
 *
 * Chúng đọc dữ liệu renderer ĐÃ CÓ (`data`, `workspaces`) nên không thêm IPC nào; điểm khác
 * biệt so với việc mở modal tương ứng là ở chỗ **thao tác thường dùng nhất làm được ngay trong
 * cột**: bật/tắt một tunnel, chạy một snippet, mở lại một workspace. Sửa/xoá vẫn thuộc modal —
 * sidebar hẹp 240px không phải chỗ đặt form.
 *
 * Tách khỏi `Sidebar.tsx` vì file đó đã dài; mỗi khối tự lấy state của mình nên thêm khối mới
 * không phải luồn thêm prop qua Sidebar.
 */

/** Số dòng tối đa mỗi khối — sidebar là chỗ "đi tới nhanh", không phải nơi xem toàn bộ danh sách. */
const BLOCK_LIMIT = 8

/**
 * Khối Tunnels — chấm trạng thái + nút bật/tắt tại chỗ, cùng cách trình bày với Dashboard.
 * Tunnel được ghim nổi lên đầu (dùng lại `pinnedFirst`, cùng thứ tự với mọi nơi khác).
 */
export function TunnelsBlock() {
  const t = useT()
  const tunnels = useDataStore((s) => s.tunnels)
  const tunnelStates = useDataStore((s) => s.tunnelStates)
  const startTunnel = useDataStore((s) => s.startTunnel)
  const stopTunnel = useDataStore((s) => s.stopTunnel)
  const favIds = useTunnelFavoritesStore((s) => s.ids)

  if (tunnels.length === 0) return <BlockEmpty text={t('sidebar.blockNoTunnels')} />

  return (
    <>
      {pinnedFirst(tunnels, favIds)
        .slice(0, BLOCK_LIMIT)
        .map((rule) => {
          const state = tunnelStates[rule.id]?.status ?? 'stopped'
          const detail = tunnelStates[rule.id]?.detail
          const running = state === 'active' || state === 'starting'
          return (
            <div
              key={rule.id}
              className="group hover:bg-hover flex items-center gap-2 rounded px-2 py-1"
              title={state === 'error' && detail ? detail : undefined}
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  state === 'active'
                    ? 'bg-success'
                    : state === 'starting'
                      ? 'bg-warning animate-pulse'
                      : state === 'error'
                        ? 'bg-danger'
                        : 'bg-edge-strong'
                }`}
              />
              <span className="text-muted min-w-0 flex-1 truncate text-[11px]">
                {favIds.includes(rule.id) && <span className="text-warning">★ </span>}
                {rule.label || `:${rule.bindPort}`}
              </span>
              {/* Nút chỉ hiện khi hover: một cột host không nên có 8 cái nút "Dừng" luôn sáng */}
              <button
                className={`text-subtle hover:bg-edge-strong shrink-0 rounded px-1 text-[10px] group-hover:opacity-100 ${
                  running ? 'hover:text-danger' : 'hover:text-success'
                } opacity-0`}
                onClick={() => void (running ? stopTunnel(rule.id) : startTunnel(rule.id))}
              >
                {running ? t('tunnel.stop') : t('tunnel.start')}
              </button>
            </div>
          )
        })}
    </>
  )
}

/**
 * Khối Snippets — bấm là mở {@link RunSnippetModal}.
 *
 * KHÔNG tự ghi thẳng vào terminal: modal đó lo hai việc thật sự cần — điền biến `{{x}}` và
 * **chọn pane đích**. Chạy một snippet lên pane sai là tai nạn có thật, nên bước chọn đích
 * không được bỏ chỉ vì lối vào ngắn hơn.
 */
export function SnippetsBlock() {
  const t = useT()
  const snippets = useDataStore((s) => s.snippets)
  const [running, setRunning] = useState<SnippetDto | null>(null)

  if (snippets.length === 0) return <BlockEmpty text={t('sidebar.blockNoSnippets')} />

  return (
    <>
      {snippets.slice(0, BLOCK_LIMIT).map((snippet) => (
        <button
          key={snippet.id}
          className="text-muted hover:bg-hover hover:text-content block w-full truncate rounded px-2 py-1 text-left text-[11px]"
          title={snippet.script}
          onClick={() => setRunning(snippet)}
        >
          {snippet.label}
        </button>
      ))}
      {running && <RunSnippetModal snippet={running} onClose={() => setRunning(null)} />}
    </>
  )
}

/** Khối Workspaces — bấm là mở lại cả bộ tab/pane đã lưu. */
export function WorkspacesBlock() {
  const t = useT()
  const workspaces = useWorkspacesStore((s) => s.workspaces)
  const open = useWorkspacesStore((s) => s.open)

  if (workspaces.length === 0) return <BlockEmpty text={t('sidebar.blockNoWorkspaces')} />

  return (
    <>
      {workspaces.slice(0, BLOCK_LIMIT).map((ws) => (
        <button
          key={ws.id}
          className="text-muted hover:bg-hover hover:text-content flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px]"
          title={t('ws.open')}
          onClick={() => open(ws.id)}
        >
          <span className="min-w-0 flex-1 truncate">{ws.name}</span>
          <span className="text-subtle shrink-0 text-[10px]">{ws.tabs.length}</span>
        </button>
      ))}
    </>
  )
}

/**
 * Dòng "chưa có gì" của một khối.
 *
 * Khối đang BẬT mà rỗng thì phải nói ra, không được render thành khoảng trắng: user vừa tự bật
 * nó nên đang chờ thấy một thứ gì đó, và im lặng ở đây trông y như lỗi.
 */
function BlockEmpty({ text }: { readonly text: string }) {
  return <p className="text-subtle px-2 py-1 text-[10px] italic">{text}</p>
}

/** Số dòng mỗi khối hiện tối đa — export để hộp cấu hình nói đúng con số cho user. */
export { BLOCK_LIMIT }
