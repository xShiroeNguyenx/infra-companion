import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { saveTermSnapshot, subscribeTermData, takeTermSnapshot } from '../../lib/termBus'
import { useTabsStore, type Pane } from '../../stores/tabs'
import { useSettingsStore } from '../../stores/settings'
import { useT } from '../../i18n'
import { terminalTheme } from './theme'

/** Pane còn tồn tại trong store không (phân biệt remount do gộp/tách tab với đóng hẳn). */
function paneStillOpen(sessionId: string): boolean {
  return useTabsStore.getState().tabs.some((t) => t.panes.some((p) => p.sessionId === sessionId))
}

interface TerminalPaneProps {
  tabId: string
  pane: Pane
  /** Pane này có đang được focus trong tab không. */
  paneActive: boolean
  /** Tab chứa pane có đang hiển thị không (để fit khi chuyển tab). */
  tabVisible: boolean
}

/**
 * Một instance xterm.js gắn với một phiên terminal trong 1 pane.
 * Khi tab bật broadcast: phím gõ ở pane này được gửi tới MỌI pane trong tab.
 */
export function TerminalPane({ tabId, pane, paneActive, tabVisible }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const findInputRef = useRef<HTMLInputElement>(null)
  const closePane = useTabsStore((s) => s.closePane)
  const themeMode = useSettingsStore((s) => s.theme)
  const hasBackground = useSettingsStore((s) => s.backgroundImage !== null)
  const t = useT()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      theme: terminalTheme(
        useSettingsStore.getState().theme,
        useSettingsStore.getState().backgroundImage !== null
      ),
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true,
      // Luôn bật để có thể đổi nền trong suốt khi bật/tắt ảnh nền mà không phải tạo lại terminal
      allowTransparency: true
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    const serialize = new SerializeAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(serialize)
    term.loadAddon(new Unicode11Addon())
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault()
        window.open(uri)
      })
    )
    term.unicode.activeVersion = '11'

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        const selection = term.getSelection()
        if (selection) void navigator.clipboard.writeText(selection)
        return false
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
        void navigator.clipboard.readText().then((text) => {
          if (text) handleInput(text)
        })
        return false
      }
      if (event.ctrlKey && !event.shiftKey && event.code === 'KeyF') {
        setFindOpen(true)
        setTimeout(() => findInputRef.current?.focus(), 0)
        return false
      }
      return true
    })

    term.open(host)
    // Dùng DOM renderer mặc định (không WebGL): đổi theme light/dark repaint nền tin cậy,
    // không bị "khung đen" do WebGL cache nền. Đủ mượt cho phiên SSH.

    fit.fit()
    window.infra.terminal.resize(pane.sessionId, term.cols, term.rows)

    // Pane bị remount khi gộp/tách tab → ghi lại buffer đã chụp TRƯỚC khi subscribe
    // (data mới đến trong lúc unmount nằm ở hàng đợi pending, flush sau snapshot là đúng thứ tự)
    const snapshot = takeTermSnapshot(pane.sessionId)
    if (snapshot) term.write(snapshot)

    const unsubscribeData = subscribeTermData(pane.sessionId, (data) => term.write(data))
    const dataDisposable = term.onData(handleInput)
    const resizeDisposable = term.onResize(({ cols, rows }) =>
      window.infra.terminal.resize(pane.sessionId, cols, rows)
    )

    const resizeObserver = new ResizeObserver(() => {
      if (host.offsetParent !== null) fit.fit()
    })
    resizeObserver.observe(host)

    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    return () => {
      unsubscribeData()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      resizeObserver.disconnect()
      // Chỉ chụp buffer khi pane còn sống trong store (đang gộp/tách tab);
      // pane đã đóng thì clearTermSession dọn rồi — chụp lại sẽ rò bộ nhớ
      if (paneStillOpen(pane.sessionId)) saveTermSnapshot(pane.sessionId, serialize.serialize())
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.sessionId])

  /** Gửi input: broadcast → mọi pane trong tab; không thì chỉ pane này. */
  function handleInput(data: string): void {
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
    if (tab?.broadcast && tab.panes.length > 1) {
      for (const p of tab.panes) {
        if (p.status !== 'exited') window.infra.terminal.write(p.sessionId, data)
      }
    } else {
      window.infra.terminal.write(pane.sessionId, data)
    }
  }

  useEffect(() => {
    if (!tabVisible || !paneActive) return
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit()
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [tabVisible, paneActive])

  // Đổi theme khi user chuyển light/dark hoặc bật/tắt ảnh nền — DOM renderer repaint nền ngay
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = terminalTheme(themeMode, hasBackground)
  }, [themeMode, hasBackground])

  const findNext = (backward: boolean): void => {
    if (!findText) return
    if (backward) searchRef.current?.findPrevious(findText)
    else searchRef.current?.findNext(findText)
  }

  const closeFind = (): void => {
    setFindOpen(false)
    setFindText('')
    termRef.current?.clearSelection()
    termRef.current?.focus()
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={hostRef} className="terminal-host h-full w-full" />

      {findOpen && (
        <div className="absolute top-2 right-3 z-30 flex items-center gap-1 rounded border border-edge-strong bg-elevated px-2 py-1 shadow-lg">
          <input
            ref={findInputRef}
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') findNext(e.shiftKey)
              if (e.key === 'Escape') closeFind()
            }}
            placeholder={t('terminal.findPlaceholder')}
            className="w-36 bg-transparent text-xs text-content placeholder-subtle outline-none"
          />
          <button className="px-1 text-xs text-muted hover:text-content" onClick={() => findNext(true)}>↑</button>
          <button className="px-1 text-xs text-muted hover:text-content" onClick={() => findNext(false)}>↓</button>
          <button className="px-1 text-xs text-subtle hover:text-content" onClick={closeFind}>✕</button>
        </div>
      )}

      {pane.status === 'connecting' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-app/80">
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="size-2 animate-pulse rounded-full bg-warning" />
            {pane.subtitle ?? pane.title}…
          </div>
        </div>
      )}

      {pane.status === 'exited' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
          <div className="bg-elevated border-edge-strong max-w-[90%] rounded-lg border px-5 py-3 text-center shadow-xl">
            <p className="text-content text-xs">
              {pane.exitReason ?? `exit code ${pane.exitCode ?? '?'}`}
            </p>
            <button
              className="bg-hover text-content hover:bg-edge-strong mt-2.5 rounded px-4 py-1 text-xs"
              onClick={() => closePane(tabId, pane.id)}
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
