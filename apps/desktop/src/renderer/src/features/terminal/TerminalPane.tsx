import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { saveTermSnapshot, subscribeTermData, takeTermSnapshot } from '../../lib/termBus'
import { matchGuard } from '../../lib/commandGuard'
import { useTabsStore, type Pane } from '../../stores/tabs'
import { useAiExplainStore } from '../../stores/aiExplain'
import { useSettingsStore } from '../../stores/settings'
import { useT } from '../../i18n'
import { Button, Modal } from '../../components/ui'
import { terminalTheme } from './theme'

/**
 * Đọc lệnh đang gõ tại con trỏ, nối cả các dòng bị wrap (lệnh dài tràn nhiều dòng hiển thị).
 * Trả '' khi đang ở alt-screen (vim/less/htop…) — không phải prompt shell nên không guard.
 */
function readCurrentCommand(term: Terminal): string {
  const buf = term.buffer.active
  if (buf.type === 'alternate') return ''
  const cursorRow = buf.baseY + buf.cursorY
  let start = cursorRow
  while (start > 0 && buf.getLine(start)?.isWrapped) start--
  let text = ''
  for (let r = start; r <= cursorRow; r++) {
    // translateToString(false): giữ đủ bề rộng dòng để nối đúng chỗ wrap (không chèn thừa dấu cách)
    text += buf.getLine(r)?.translateToString(false) ?? ''
  }
  return text.replace(/\s+$/, '')
}

/** sessionId HIỆN TẠI của pane trong store (null = pane đã đóng hẳn).
 *  Tra theo paneId thay vì sessionId: reconnectPane thay sessionId tại chỗ — cleanup phải
 *  chụp snapshot theo id MỚI để phiên mới nối tiếp scrollback cũ. */
function currentSessionIdOf(paneId: string): string | null {
  for (const tab of useTabsStore.getState().tabs) {
    const pane = tab.panes.find((p) => p.id === paneId)
    if (pane) return pane.sessionId
  }
  return null
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
  const webglRef = useRef<WebglAddon | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [hasSelection, setHasSelection] = useState(false)
  const [copied, setCopied] = useState(false)
  /** Lệnh nhạy cảm đang chờ xác nhận (guard đã chặn Enter); null = không có. */
  const [guardPrompt, setGuardPrompt] = useState<{ command: string; pattern: string } | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const closePane = useTabsStore((s) => s.closePane)
  const reconnectPane = useTabsStore((s) => s.reconnectPane)
  const themeMode = useSettingsStore((s) => s.theme)
  const hasBackground = useSettingsStore((s) => s.backgroundImage !== null)
  const fontFamily = useSettingsStore((s) => s.termFontFamily)
  const fontSize = useSettingsStore((s) => s.termFontSize)
  const lineHeight = useSettingsStore((s) => s.termLineHeight)
  const cursorStyle = useSettingsStore((s) => s.termCursor)
  const webglOn = useSettingsStore((s) => s.termWebgl)
  const t = useT()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const s0 = useSettingsStore.getState()
    const term = new Terminal({
      theme: terminalTheme(s0.theme, s0.backgroundImage !== null),
      fontFamily: s0.termFontFamily,
      fontSize: s0.termFontSize,
      lineHeight: s0.termLineHeight,
      cursorStyle: s0.termCursor,
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
          // paste() của xterm (không phải handleInput thô): chuẩn hoá \r\n & \n → \r — clipboard
          // Windows mang \r\n, gửi thô thì vim/nano tính CR và LF là 2 lần xuống dòng → chèn thêm
          // dòng trống giữa các dòng; kèm bracketed-paste nếu app trên remote có bật.
          // Broadcast vẫn ăn: paste() đi qua onData → handleInput như gõ phím.
          if (text) term.paste(text)
        })
        return false
      }
      if (event.ctrlKey && !event.shiftKey && event.code === 'KeyF') {
        setFindOpen(true)
        setTimeout(() => findInputRef.current?.focus(), 0)
        return false
      }
      // F46: AI giải thích đoạn output đang bôi chọn
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyE') {
        const selection = term.getSelection().trim()
        if (selection) void useAiExplainStore.getState().explain(selection)
        return false
      }
      return true
    })

    term.open(host)
    // Renderer: WebglAddon nạp/gỡ ở effect riêng theo setting termWebgl (GPU mượt hơn hẳn
    // DOM renderer khi gõ/cuộn). Vụ "khung đen" WebGL cache nền khi đổi theme ngày trước
    // được xử lý bằng clearTextureAtlas() trong effect đổi theme. Gỡ addon = tự về DOM renderer.

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
    // F46: nút ✨ Giải thích chỉ hiện khi đang có selection
    const selectionDisposable = term.onSelectionChange(() =>
      setHasSelection(term.getSelection().trim().length > 0)
    )

    const resizeObserver = new ResizeObserver(() => {
      if (host.offsetParent !== null) fit.fit()
    })
    resizeObserver.observe(host)

    // ── Copy bằng click trái vào vùng đã tô khối; dán bằng click phải ──────────
    // Mọi handler chuột đặt ở pha capture: mousedown chạy TRƯỚC khi xterm xoá
    // selection (đọc được đoạn đang bôi đen), và không bị xterm stopPropagation.
    const mouseEl = term.element
    let downSel = ''
    let downX = 0
    let downY = 0
    let downInSel = false

    /** Quy toạ độ pixel của con trỏ về ô (col, row tuyệt đối trong buffer). */
    const cellFromEvent = (ev: MouseEvent): { col: number; row: number } | null => {
      const screen = mouseEl?.querySelector('.xterm-screen') as HTMLElement | null
      if (!screen || term.cols < 1 || term.rows < 1) return null
      const rect = screen.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return null
      const col = Math.floor((ev.clientX - rect.left) / (rect.width / term.cols))
      const vrow = Math.floor((ev.clientY - rect.top) / (rect.height / term.rows))
      if (col < 0 || col >= term.cols || vrow < 0 || vrow >= term.rows) return null
      return { col, row: vrow + term.buffer.active.viewportY }
    }

    /** Con trỏ có rơi trong vùng đang được tô khối không. */
    const pointInSelection = (ev: MouseEvent): boolean => {
      const pos = term.getSelectionPosition()
      if (!pos) return false
      const cell = cellFromEvent(ev)
      if (!cell) return true // không tính được toạ độ → cứ coi như nằm trong vùng
      // Toạ độ trả về là 0-based, tuyệt đối trong buffer, end.x exclusive;
      // start/end có thể đảo chiều nếu bôi từ dưới lên → chuẩn hoá trước.
      let [sX, sY, eX, eY] = [pos.start.x, pos.start.y, pos.end.x, pos.end.y]
      if (sY > eY || (sY === eY && sX > eX)) [sX, sY, eX, eY] = [eX, eY, sX, sY]
      const { col: c, row: r } = cell
      if (r < sY || r > eY) return false
      if (sY === eY) return c >= sX && c < eX
      if (r === sY) return c >= sX
      if (r === eY) return c < eX
      return true
    }

    const flashCopied = (): void => {
      setCopied(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopied(false), 900)
    }

    const onMouseDown = (ev: MouseEvent): void => {
      if (ev.button !== 0) return
      downSel = term.getSelection()
      downX = ev.clientX
      downY = ev.clientY
      downInSel = downSel.length > 0 && pointInSelection(ev)
    }

    const onMouseUp = (ev: MouseEvent): void => {
      if (ev.button !== 0) return
      const moved = Math.abs(ev.clientX - downX) > 3 || Math.abs(ev.clientY - downY) > 3
      if (!moved && downInSel && downSel) {
        void navigator.clipboard.writeText(downSel)
        flashCopied()
      }
      downSel = ''
      downInSel = false
    }

    const onContextMenu = (ev: MouseEvent): void => {
      ev.preventDefault()
      void navigator.clipboard.readText().then((text) => {
        // term.paste thay vì handleInput thô — như Ctrl+Shift+V (chuẩn hoá \r\n, bracketed paste)
        if (text) term.paste(text)
      })
    }

    mouseEl?.addEventListener('mousedown', onMouseDown, true)
    mouseEl?.addEventListener('mouseup', onMouseUp, true)
    mouseEl?.addEventListener('contextmenu', onContextMenu, true)

    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    return () => {
      unsubscribeData()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      selectionDisposable.dispose()
      resizeObserver.disconnect()
      mouseEl?.removeEventListener('mousedown', onMouseDown, true)
      mouseEl?.removeEventListener('mouseup', onMouseUp, true)
      mouseEl?.removeEventListener('contextmenu', onContextMenu, true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      // Chỉ chụp buffer khi pane còn sống trong store (gộp/tách tab: sessionId giữ nguyên;
      // reconnect: sessionId ĐÃ đổi → chụp theo id mới để phiên mới viết tiếp buffer cũ);
      // pane đã đóng thì clearTermSession dọn rồi — chụp lại sẽ rò bộ nhớ
      const liveSessionId = currentSessionIdOf(pane.id)
      if (liveSessionId) saveTermSnapshot(liveSessionId, serialize.serialize())
      term.dispose() // dispose cả WebglAddon đã nạp
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
      webglRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.sessionId])

  /** Gửi input thô: broadcast → mọi pane trong tab; không thì chỉ pane này. */
  function sendData(data: string): void {
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
    if (tab?.broadcast && tab.panes.length > 1) {
      for (const p of tab.panes) {
        if (p.status !== 'exited') window.infra.terminal.write(p.sessionId, data)
      }
    } else {
      window.infra.terminal.write(pane.sessionId, data)
    }
  }

  /** Input từ xterm. Guard lệnh nhạy cảm chặn Enter đơn (\r) nếu dòng lệnh khớp whitelist. */
  function handleInput(data: string): void {
    if (data === '\r') {
      const { commandGuardEnabled, commandGuardPatterns } = useSettingsStore.getState()
      const term = termRef.current
      if (commandGuardEnabled && term) {
        const command = readCurrentCommand(term)
        const matched = command ? matchGuard(command, commandGuardPatterns) : null
        if (matched) {
          // Chưa gửi \r — server chưa nhận Enter, lệnh còn nguyên ở prompt để user sửa nếu huỷ
          setGuardPrompt({ command: command.trim(), pattern: matched })
          return
        }
      }
    }
    sendData(data)
  }

  /** Xác nhận chạy lệnh nhạy cảm: gửi Enter đã bị hoãn rồi trả focus về terminal. */
  function confirmGuard(): void {
    setGuardPrompt(null)
    sendData('\r')
    termRef.current?.focus()
  }

  /** Huỷ: không gửi gì, lệnh vẫn ở prompt để user chỉnh; trả focus về terminal. */
  function cancelGuard(): void {
    setGuardPrompt(null)
    termRef.current?.focus()
  }

  useEffect(() => {
    if (!tabVisible || !paneActive) return
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit()
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [tabVisible, paneActive])

  // GPU render (WebGL): nạp/gỡ addon theo setting — áp LIVE cho terminal đang mở
  // (gỡ addon là xterm tự quay về DOM renderer). Deps có pane.sessionId để terminal
  // TẠO LẠI (reconnect) cũng được nạp lại addon (effect chính chạy trước theo thứ tự khai báo).
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (webglOn && !webglRef.current) {
      try {
        const addon = new WebglAddon()
        term.loadAddon(addon)
        // GPU context bị thu hồi (driver reset, quá nhiều context WebGL…) → gỡ addon,
        // terminal tự quay về DOM renderer thay vì đơ khung trắng
        addon.onContextLoss(() => {
          addon.dispose()
          if (webglRef.current === addon) webglRef.current = null
        })
        webglRef.current = addon
      } catch {
        webglRef.current = null // máy không có WebGL → giữ DOM renderer như cũ
      }
    } else if (!webglOn && webglRef.current) {
      webglRef.current.dispose()
      webglRef.current = null
    }
  }, [webglOn, pane.sessionId])

  // Đổi theme khi user chuyển light/dark hoặc bật/tắt ảnh nền
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = terminalTheme(themeMode, hasBackground)
    // WebGL cache glyph theo màu cũ — không xoá atlas thì đổi theme dính "khung đen"/màu cũ
    // (chính là lý do ngày trước phải bỏ WebGL; giờ xử lý đúng cách ở đây)
    webglRef.current?.clearTextureAtlas()
  }, [themeMode, hasBackground])

  // Áp font/cỡ chữ/giãn dòng/con trỏ ngay khi đổi trong Settings; fit lại để PTY nhận cols/rows mới
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = fontFamily
    term.options.fontSize = fontSize
    term.options.lineHeight = lineHeight
    term.options.cursorStyle = cursorStyle
    const frame = requestAnimationFrame(() => {
      const fit = fitRef.current
      if (fit && hostRef.current?.offsetParent !== null) fit.fit()
    })
    return () => cancelAnimationFrame(frame)
  }, [fontFamily, fontSize, lineHeight, cursorStyle])

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

      {copied && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-30 rounded border border-edge-strong bg-elevated/95 px-2.5 py-1 text-xs text-content shadow-lg">
          {t('terminal.copied')}
        </div>
      )}

      {/* Guard lệnh nhạy cảm: Enter đã bị hoãn, chờ user xác nhận. Nút Huỷ autoFocus →
          bấm Enter theo phản xạ sẽ HUỶ (an toàn), muốn chạy phải chủ động chọn "Vẫn chạy". */}
      {guardPrompt && (
        <Modal title={t('guard.title')} danger onClose={cancelGuard} closeOnBackdrop={false}>
          <p className="text-muted mb-2 max-w-96 text-xs leading-relaxed">{t('guard.desc')}</p>
          <div className="border-danger/50 bg-input text-content mb-2 max-w-96 rounded border px-3 py-2 font-mono text-xs break-all">
            {guardPrompt.command}
          </div>
          <p className="text-subtle mb-3 text-[11px]">{t('guard.matched', { pattern: guardPrompt.pattern })}</p>
          <div className="flex justify-end gap-2">
            <Button autoFocus onClick={cancelGuard}>
              {t('guard.cancel')}
            </Button>
            <Button variant="danger" onClick={confirmGuard}>
              {t('guard.run')}
            </Button>
          </div>
        </Modal>
      )}

      {/* F46: nút giải thích selection — cùng slot với thanh Tìm, Tìm mở thì nhường chỗ */}
      {hasSelection && !findOpen && (
        <button
          className="border-edge-strong bg-elevated/95 text-content hover:bg-hover absolute top-2 right-3 z-30 rounded border px-2.5 py-1 text-xs shadow-lg"
          onClick={() => {
            const selection = termRef.current?.getSelection().trim()
            if (selection) void useAiExplainStore.getState().explain(selection)
          }}
        >
          ✨ {t('terminal.explainSelection')}
        </button>
      )}

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
            <div className="mt-2.5 flex items-center justify-center gap-2">
              {/* Thử lại thủ công sau khi auto-retry 3 lần thất bại — mở phiên mới vào cùng pane */}
              {pane.origin && (
                <button
                  className="bg-accent hover:bg-accent-hover rounded px-4 py-1 text-xs text-white"
                  onClick={() => void reconnectPane(tabId, pane.id)}
                >
                  ↻ {t('terminal.reconnect')}
                </button>
              )}
              <button
                className="bg-hover text-content hover:bg-edge-strong rounded px-4 py-1 text-xs"
                onClick={() => closePane(tabId, pane.id)}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
