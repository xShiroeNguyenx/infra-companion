import { useEffect, useRef, useState } from 'react'
import type { ShellProfile, SnippetDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useTabsStore, type AppTab } from '../stores/tabs'
import { RunSnippetModal } from './RunSnippetModal'
import { useT } from '../i18n'

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
  if (tab.kind === 'sftp') return 'bg-success'
  const active = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
  const status = active?.status ?? 'connecting'
  if (status === 'connected') return 'bg-success'
  if (status === 'exited') return 'bg-danger'
  return 'bg-warning animate-pulse'
}

/** Thanh tab trên cùng: danh sách tab + nút snippet ⚡ + nút mở tab local mới. */
export function TabsBar() {
  const t = useT()
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
    <div className="border-edge bg-panel flex h-9 shrink-0 items-stretch gap-px border-b pl-1 select-none">
      <div className="flex flex-1 items-stretch gap-px overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            className={`group flex max-w-52 min-w-28 cursor-pointer items-center gap-2 rounded-t px-3 text-xs ${
              tab.id === activeId
                ? 'bg-app text-content'
                : 'text-muted hover:bg-hover hover:text-content'
            }`}
            onClick={() => setActive(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id) // middle click đóng tab
            }}
            title={tabSubtitle(tab) ?? tabTitle(tab)}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${statusDotClass(tab)}`} />
            {tab.kind === 'sftp' && <span className="text-subtle shrink-0">📁</span>}
            {tab.broadcast && <span className="text-warning shrink-0" title="Broadcast ON">📡</span>}
            <span className="truncate">{tabTitle(tab)}</span>
            <button
              className="text-subtle hover:bg-edge-strong hover:text-content ml-auto rounded p-0.5 opacity-0 group-hover:opacity-100"
              title={t('tabs.close')}
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
          className="text-muted hover:bg-hover hover:text-warning flex h-7 items-center px-2"
          title={t('tabs.runSnippet')}
          onClick={() => setSnippetMenuOpen((v) => !v)}
        >
          ⚡
        </button>
        {snippetMenuOpen && (
          <div className="border-edge-strong bg-elevated absolute top-8 right-0 z-50 min-w-48 rounded-md border py-1 shadow-xl">
            {snippets.map((snippet) => (
              <button
                key={snippet.id}
                className="text-muted hover:bg-hover hover:text-content block w-full px-3 py-1.5 text-left text-xs"
                onClick={() => {
                  setSnippetMenuOpen(false)
                  setRunSnippet(snippet)
                }}
              >
                {snippet.label}
              </button>
            ))}
            {snippets.length === 0 && (
              <p className="text-subtle px-3 py-1.5 text-xs">{t('tabs.noSnippet')}</p>
            )}
          </div>
        )}
      </div>

      <div className="relative flex items-center" ref={menuRef}>
        <button
          className="text-muted hover:bg-hover hover:text-content flex h-7 items-center rounded-l px-2"
          title={t('tabs.newLocal')}
          onClick={() => void openLocal()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="text-subtle hover:bg-hover hover:text-content flex h-7 items-center rounded-r px-1"
          title={t('tabs.chooseShell')}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {menuOpen && (
          <div className="border-edge-strong bg-elevated absolute top-8 right-1 z-50 min-w-48 rounded-md border py-1 shadow-xl">
            {shells.map((shell) => (
              <button
                key={shell.id}
                className="text-muted hover:bg-hover hover:text-content block w-full px-3 py-1.5 text-left text-xs"
                onClick={() => {
                  setMenuOpen(false)
                  void openLocal(shell.id)
                }}
              >
                {shell.label}
              </button>
            ))}
            {shells.length === 0 && (
              <p className="text-subtle px-3 py-1.5 text-xs">{t('tabs.noShell')}</p>
            )}
          </div>
        )}
      </div>

      {runSnippet && <RunSnippetModal snippet={runSnippet} onClose={() => setRunSnippet(null)} />}
    </div>
  )
}
