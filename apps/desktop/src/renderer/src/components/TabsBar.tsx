import { useEffect, useRef, useState } from 'react'
import type { ShellProfile, SnippetDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useTabsStore, type AppTab } from '../stores/tabs'
import { RunSnippetModal } from './RunSnippetModal'

/** Tiêu đề tab: SFTP → sftpTitle; terminal → pane active (hoặc "N panes"). */
function tabTitle(tab: AppTab): string {
  if (tab.kind === 'sftp') return tab.sftpTitle ?? 'SFTP'
  const active = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
  if (tab.panes.length > 1) return `${active?.title ?? 'terminal'} +${tab.panes.length - 1}`
  return active?.title ?? 'terminal'
}

function tabSubtitle(tab: AppTab): string | undefined {
  if (tab.kind === 'sftp') return tab.sftpTitle
  const active = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
  return active?.subtitle
}

/** Chấm trạng thái: terminal lấy theo pane active; sftp luôn xanh. */
function statusDotClass(tab: AppTab): string {
  if (tab.kind === 'sftp') return 'bg-emerald-500'
  const active = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
  const status = active?.status ?? 'connecting'
  if (status === 'connected') return 'bg-emerald-500'
  if (status === 'exited') return 'bg-red-500'
  return 'bg-amber-400 animate-pulse'
}

/** Thanh tab trên cùng: danh sách tab + nút snippet ⚡ + nút mở tab local mới. */
export function TabsBar() {
  const { tabs, activeId, openLocal, closeTab, setActive } = useTabsStore()
  const snippets = useDataStore((s) => s.snippets)
  const [menuOpen, setMenuOpen] = useState(false)
  const [snippetMenuOpen, setSnippetMenuOpen] = useState(false)
  const [runSnippet, setRunSnippet] = useState<SnippetDto | null>(null)
  const [shells, setShells] = useState<ShellProfile[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const snippetMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!snippetMenuOpen) return
    const onClickOutside = (event: MouseEvent): void => {
      if (snippetMenuRef.current && !snippetMenuRef.current.contains(event.target as Node)) {
        setSnippetMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [snippetMenuOpen])

  useEffect(() => {
    void window.infra.data.listShells().then(setShells)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  return (
    <div className="flex h-9 shrink-0 items-stretch gap-px border-b border-zinc-800 bg-[#11151f] pl-1 select-none">
      <div className="flex flex-1 items-stretch gap-px overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            className={`group flex max-w-52 min-w-28 cursor-pointer items-center gap-2 rounded-t px-3 text-xs ${
              tab.id === activeId
                ? 'bg-[#0b0e14] text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
            }`}
            onClick={() => setActive(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id) // middle click đóng tab
            }}
            title={tabSubtitle(tab) ?? tabTitle(tab)}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${statusDotClass(tab)}`} />
            {tab.kind === 'sftp' && <span className="shrink-0 text-zinc-500">📁</span>}
            {tab.broadcast && <span className="shrink-0 text-amber-400" title="Broadcast ON">📡</span>}
            <span className="truncate">{tabTitle(tab)}</span>
            <button
              className="ml-auto rounded p-0.5 text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200"
              title="Đóng tab (Ctrl+Shift+W)"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="relative flex items-center" ref={snippetMenuRef}>
        <button
          className="flex h-7 items-center px-2 text-zinc-400 hover:bg-zinc-800 hover:text-amber-300"
          title="Chạy snippet trên phiên đang mở"
          onClick={() => setSnippetMenuOpen((v) => !v)}
        >
          ⚡
        </button>
        {snippetMenuOpen && (
          <div className="absolute top-8 right-0 z-50 min-w-48 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
            {snippets.map((snippet) => (
              <button
                key={snippet.id}
                className="block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700/60 hover:text-zinc-100"
                onClick={() => {
                  setSnippetMenuOpen(false)
                  setRunSnippet(snippet)
                }}
              >
                {snippet.label}
              </button>
            ))}
            {snippets.length === 0 && (
              <p className="px-3 py-1.5 text-xs text-zinc-500">Chưa có snippet (tạo trong menu ⋯ ở sidebar)</p>
            )}
          </div>
        )}
      </div>

      <div className="relative flex items-center" ref={menuRef}>
        <button
          className="flex h-7 items-center rounded-l px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title="Tab terminal local mới (Ctrl+Shift+T)"
          onClick={() => void openLocal()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="flex h-7 items-center rounded-r px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
          title="Chọn shell"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute top-8 right-1 z-50 min-w-48 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
            {shells.map((shell) => (
              <button
                key={shell.id}
                className="block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700/60 hover:text-zinc-100"
                onClick={() => {
                  setMenuOpen(false)
                  void openLocal(shell.id)
                }}
              >
                {shell.label}
              </button>
            ))}
            {shells.length === 0 && (
              <p className="px-3 py-1.5 text-xs text-zinc-500">Không tìm thấy shell nào</p>
            )}
          </div>
        )}
      </div>

      {runSnippet && <RunSnippetModal snippet={runSnippet} onClose={() => setRunSnippet(null)} />}
    </div>
  )
}
