import type { IBufferCell, IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm'
import {
  highlightColors,
  highlightLine,
  indexCells,
  spansToSegments,
  type CellLike,
  type CompiledRule,
  type HighlightRule
} from '@infra/shared'

/**
 * F25 — quét output của một terminal, tô màu dòng khớp mẫu và báo khi mẫu có bật báo động.
 *
 * Phần quyết định (khớp gì, tô ô nào, có báo không) là hàm thuần ở `shared/termHighlight.ts`.
 * File này chỉ lo phần dính tới xterm: đọc buffer, đặt marker/decoration, và hẹn giờ quét.
 *
 * Những quyết định chính:
 *  · **Chỉ quét dòng đã hoàn chỉnh** (nằm trên hàng con trỏ, không phải phần đầu của một dòng
 *    wrap còn đang viết tiếp). Dòng đang viết dở mà quét ngay thì `ERR` + `OR` tới thành hai
 *    khúc sẽ không bao giờ khớp `ERROR`.
 *  · **Nhớ chỗ đã quét bằng marker**, không bằng số dòng: khi scrollback đầy, xterm xoá dòng ở
 *    đầu và mọi số dòng tụt xuống; marker tự đi theo.
 *  · **Dòng user tự gõ không bị tô cũng không báo động** — `grep -i error app.log` không được
 *    tự kích hoạt mẫu `error`. Pane báo các dòng đó lúc bấm Enter ({@link Highlighter.markInputLine}).
 *  · **Không quét ở màn hình phụ** (vim, less, htop): app ở đó tự vẽ lại cả màn hình liên tục,
 *    tô màu chỉ là nhiễu.
 *  · **Dòng bị ghi đè tại chỗ thì tô lại.** Decoration bám theo marker của dòng, không theo chữ.
 *    Xoá màn hình (`ESC[J`, lệnh `clear`, Ctrl+L) thì xterm tự huỷ marker của dòng bị reset nên
 *    màu đi theo. Nhưng xoá dòng (`ESC[K` — thanh tiến trình nhiều dòng kiểu `docker pull`,
 *    `apt`) thì xterm KHÔNG huỷ marker: không tự xử lý thì màu `ERROR` cũ dính lên chữ mới,
 *    còn dòng vừa được ghi đè thành lỗi thì không được tô. Đã đo bằng xterm thật.
 *  · **Tô và báo đều idempotent**: quét lại một dòng (sau khi bị ghi đè, sau khi mốc quét bị
 *    huỷ) thay màu cũ chứ không chồng thêm lớp, và một dòng đã báo thì không báo lần hai trừ
 *    khi chính dòng đó bị xoá rồi ghi lại.
 */

/** Gom các lần ghi liên tiếp thành một lần quét. setTimeout chứ không rAF: rAF ngừng khi cửa sổ ẩn xuống khay, mà báo động phải chạy cả lúc đó. */
const SCAN_DELAY_MS = 40
/** Mỗi lượt quét tối đa bấy nhiêu hàng — `cat` một file 200 nghìn dòng chỉ quét phần cuối. */
const MAX_SCAN_ROWS = 3000
/** Số hàng quét lại khi đổi mẫu/đổi theme. */
const RESCAN_ROWS = 2000
/** Trần decoration sống cùng lúc; vượt thì gỡ cái cũ nhất. */
const MAX_DECORATIONS = 4000
/** Trần số marker sổ sách (dòng tự gõ, dòng đã báo, dòng chờ quét lại). */
const MAX_BOOK_MARKERS = 500

export interface HighlighterOptions {
  getRules: () => { enabled: boolean; compiled: readonly CompiledRule[] }
  getTheme: () => 'dark' | 'light'
  /** Một dòng MỚI khớp mẫu có bật báo động. Không gọi khi quét lại hay khi khôi phục buffer. */
  onTrigger: (rule: HighlightRule, lineText: string) => void
}

export interface Highlighter {
  /** Dòng tại con trỏ (kèm các hàng wrap phía trên) là dòng user tự gõ — gọi lúc bấm Enter. */
  markInputLine: () => void
  /** Bật/tắt báo động (tắt trong lúc ghi lại buffer cũ khi pane được dựng lại). */
  setNotify: (on: boolean) => void
  /** Quét ngay phần chưa quét, không báo động — dùng sau khi ghi lại buffer cũ. */
  catchUp: () => void
  /** Gỡ hết màu đã tô và quét lại phần gần đây (đổi mẫu, đổi theme) — có trễ ~200ms để gom. */
  rescan: () => void
  dispose: () => void
}

interface Painted {
  marker: IMarker
  decorations: IDecoration[]
}

/** Danh sách marker có trần; marker bị xterm huỷ (dòng bị cắt/xoá) tự rơi khỏi danh sách. */
class MarkerBook {
  private items: IMarker[] = []
  add(m: IMarker): void {
    this.items.push(m)
    this.prune()
  }
  lines(): Set<number> {
    this.prune()
    return new Set(this.items.map((m) => m.line))
  }
  /** Huỷ các marker nằm trên dòng `row`. */
  dropRow(row: number): void {
    this.items = this.items.filter((m) => {
      if (m.isDisposed) return false
      if (m.line !== row) return true
      m.dispose()
      return false
    })
  }
  take(): IMarker[] {
    const out = this.items.filter((m) => !m.isDisposed)
    this.items = []
    return out
  }
  dispose(): void {
    for (const m of this.items) m.dispose()
    this.items = []
  }
  private prune(): void {
    this.items = this.items.filter((m) => !m.isDisposed)
    while (this.items.length > MAX_BOOK_MARKERS) this.items.shift()!.dispose()
  }
}

export function attachHighlighter(term: Terminal, opts: HighlighterOptions): Highlighter {
  /** Hàng đầu tiên CHƯA quét. null = chưa quét lần nào (terminal mới). */
  let scanMarker: IMarker | null = null
  let notifyOn = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const inputRows = new MarkerBook()
  /** Dòng đã báo động — để quét lại không báo lần hai. */
  const notifiedRows = new MarkerBook()
  /** Dòng đã quét nhưng vừa bị ghi đè (`ESC[K`) — chờ quét lại khi nó hoàn chỉnh. */
  const dirtyRows = new MarkerBook()
  const painted: Painted[] = []
  let decorationCount = 0
  let reusableCell: IBufferCell | undefined

  const cursorRow = (): number => {
    const buf = term.buffer.active
    return buf.baseY + buf.cursorY
  }

  /** Marker tại dòng tuyệt đối `row` của buffer chính. `registerMarker` nhận offset so với con trỏ. */
  const markerAt = (row: number): IMarker | undefined => {
    // Kiểu khai báo nói luôn trả IMarker, nhưng tài liệu nói "or undefined" (màn hình phụ đang bật)
    const m = term.registerMarker(row - cursorRow()) as IMarker | undefined
    return m && !m.isDisposed ? m : undefined
  }

  const disposePainted = (p: Painted): void => {
    for (const d of p.decorations) d.dispose()
    decorationCount -= p.decorations.length
    p.marker.dispose()
  }

  const clearAll = (): void => {
    for (const p of painted.splice(0)) disposePainted(p)
    decorationCount = 0
  }

  /** Gỡ màu trên các dòng [from, to]. */
  const unpaintRows = (from: number, to: number): void => {
    for (let i = painted.length - 1; i >= 0; i--) {
      const p = painted[i]!
      if (p.marker.isDisposed || (p.marker.line >= from && p.marker.line <= to)) {
        disposePainted(p)
        painted.splice(i, 1)
      }
    }
  }

  const trimDecorations = (): void => {
    // Marker bị xoá theo scrollback thì xterm tự gỡ decoration của nó; ở đây dọn sổ sách + trần
    while (painted.length > 0 && (painted[0]!.marker.isDisposed || decorationCount > MAX_DECORATIONS)) {
      disposePainted(painted.shift()!)
    }
  }

  const readCells = (row: number): CellLike[] => {
    const line = term.buffer.active.getLine(row)
    if (!line) return []
    reusableCell ??= term.buffer.active.getNullCell()
    const out: CellLike[] = []
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x, reusableCell)
      if (!cell) break
      out.push({ chars: cell.getChars(), width: cell.getWidth() })
    }
    return out
  }

  /** Tô một dòng logic (thay màu cũ nếu có). Trả các mẫu báo động đã khớp. */
  const paintLine = (firstRow: number, lastRow: number, text: string, compiled: readonly CompiledRule[], hadPaint: boolean): HighlightRule[] => {
    if (hadPaint) unpaintRows(firstRow, lastRow)
    const quick = highlightLine(text, compiled)
    if (!quick) return []
    const theme = opts.getTheme()
    const rowCells: CellLike[][] = []
    for (let r = firstRow; r <= lastRow; r++) rowCells.push(readCells(r))
    const index = indexCells(rowCells)
    // Khớp lại trên văn bản dựng từ ô: thường y hệt `text`, nhưng vị trí ô phải đi theo đúng nó
    const exact = highlightLine(index.text, compiled)
    if (!exact) return quick.triggered
    const byRow = new Map<number, IDecoration[]>()
    const markers = new Map<number, IMarker>()
    const decorate = (row: number, x: number, width: number, bg: string, fg?: string): void => {
      if (width <= 0) return
      let marker = markers.get(row)
      if (!marker) {
        marker = markerAt(firstRow + row)
        if (!marker) return
        markers.set(row, marker)
      }
      const d = term.registerDecoration({ marker, x, width, backgroundColor: bg, ...(fg ? { foregroundColor: fg } : {}), layer: 'bottom' })
      if (!d) return
      const list = byRow.get(row) ?? []
      list.push(d)
      byRow.set(row, list)
    }
    // Nền cả dòng đăng ký TRƯỚC: decoration đăng ký sau thắng ở ô chồng nhau, nên đoạn khớp
    // của mẫu `match` vẫn nổi lên trên nền nhạt của mẫu `line`.
    if (exact.lineColor) {
      const c = highlightColors(theme, exact.lineColor)
      for (let r = 0; r <= lastRow - firstRow; r++) decorate(r, 0, term.cols, c.lineBg)
    }
    for (const seg of spansToSegments(exact.spans, index)) {
      const c = highlightColors(theme, seg.color)
      decorate(seg.row, seg.col, Math.min(seg.width, term.cols - seg.col), c.bg, c.fg)
    }
    for (const [row, marker] of markers) {
      const decorations = byRow.get(row) ?? []
      if (decorations.length === 0) {
        marker.dispose()
        continue
      }
      painted.push({ marker, decorations })
      decorationCount += decorations.length
    }
    trimDecorations()
    return quick.triggered
  }

  /**
   * Quét từ `fromRow` (hoặc chỗ đã quét tới) đến hết các dòng đã hoàn chỉnh, cộng các dòng chờ
   * quét lại. `notify` = được phép báo động cho dòng khớp (chỉ với output mới).
   */
  const scan = (notify: boolean, fromRow?: number): void => {
    if (disposed) return
    const buf = term.buffer.active
    if (buf.type !== 'normal') return
    const end = cursorRow()
    let start: number
    if (fromRow !== undefined) start = fromRow
    else if (scanMarker === null) start = 0
    else if (!scanMarker.isDisposed) start = scanMarker.line
    // Mốc bị xterm huỷ: hoặc dòng của nó bị xoá màn hình (clear, Ctrl+L, `ESC[J`) — chỉ xảy ra
    // trong vùng đang hiện — hoặc bị cắt khỏi scrollback vì output tới quá nhiều một lúc. Cả hai
    // trường hợp, quét lại từ đầu vùng đang hiện là đủ; tô/báo đều idempotent nên quét trùng vô hại.
    else start = buf.baseY
    if (end - start > MAX_SCAN_ROWS) start = end - MAX_SCAN_ROWS
    start = Math.max(0, start)
    // Lùi về đầu dòng logic nếu `start` rơi vào giữa một dòng bị wrap
    while (start > 0 && buf.getLine(start)?.isWrapped) start--

    const { enabled, compiled } = opts.getRules()
    const active = enabled && compiled.length > 0
    const typed = active ? inputRows.lines() : new Set<number>()
    const notified = active ? notifiedRows.lines() : new Set<number>()
    const paintedRows = new Set<number>()
    if (active) for (const p of painted) if (!p.marker.isDisposed) paintedRows.add(p.marker.line)

    /** Xử lý dòng logic bắt đầu ở `row`. Trả hàng cuối của nó, hoặc null nếu dòng chưa xong. */
    const processLine = (row: number): number | null => {
      let last = row
      while (buf.getLine(last + 1)?.isWrapped) last++
      // Đuôi của dòng còn nằm ở hàng con trỏ → dòng chưa xong, để lượt sau
      if (last >= end) return null
      if (!active) return last
      let isTyped = false
      let hadPaint = false
      let alreadyNotified = false
      for (let r = row; r <= last; r++) {
        isTyped ||= typed.has(r)
        hadPaint ||= paintedRows.has(r)
        alreadyNotified ||= notified.has(r)
      }
      if (isTyped) return last
      let text = ''
      for (let r = row; r <= last; r++) text += buf.getLine(r)?.translateToString(r === last) ?? ''
      const triggered = paintLine(row, last, text, compiled, hadPaint)
      if (triggered.length > 0 && notify && notifyOn && !alreadyNotified) {
        const m = markerAt(row)
        if (m) notifiedRows.add(m)
        for (const rule of triggered) opts.onTrigger(rule, text)
      }
      return last
    }

    // Dòng đã quét nhưng vừa bị ghi đè tại chỗ — quét lại khi đã hoàn chỉnh
    const keep: IMarker[] = []
    for (const m of dirtyRows.take()) {
      let first = m.line
      if (first >= start) {
        m.dispose() // vòng chính bên dưới sẽ đi qua nó
        continue
      }
      while (first > 0 && buf.getLine(first)?.isWrapped) first--
      if (processLine(first) === null) keep.push(m)
      else m.dispose()
    }
    for (const m of keep) dirtyRows.add(m)

    let row = start
    let resumeAt = end
    while (row < end) {
      const last = processLine(row)
      if (last === null) {
        resumeAt = row
        break
      }
      row = last + 1
    }

    // Đặt lại mốc "đã quét tới đây"
    const next = markerAt(resumeAt)
    if (next) {
      scanMarker?.dispose()
      scanMarker = next
    }
  }

  const schedule = (): void => {
    if (timer !== null || disposed) return
    timer = setTimeout(() => {
      timer = null
      scan(true)
    }, SCAN_DELAY_MS)
  }

  /**
   * Hàng con trỏ vừa bị xoá một phần/toàn bộ để ghi lại (`ESC[K`, hoặc `ESC[0J`/`ESC[1J` trên
   * hàng con trỏ — xterm chỉ huỷ marker ở các hàng bị reset NGUYÊN hàng, không ở hàng này).
   */
  const onRowErased = (): void => {
    if (disposed || term.buffer.active.type !== 'normal') return
    const row = cursorRow()
    unpaintRows(row, row)
    notifiedRows.dropRow(row)
    // Hàng đã quét rồi mới bị ghi đè → chờ quét lại. Hàng con trỏ bình thường (thanh tiến trình
    // một dòng ghi lại liên tục) chưa quét, vòng chính tự lo khi nó xuống dòng.
    if (scanMarker && !scanMarker.isDisposed && row < scanMarker.line) {
      dirtyRows.dropRow(row)
      const m = markerAt(row)
      if (m) dirtyRows.add(m)
    }
  }

  /**
   * Quét lại có trễ. Hai nơi gọi:
   *  · đổi mẫu/theme — gõ một mẫu trong Cài đặt đổi danh sách theo TỪNG PHÍM, mà mỗi lần đổi
   *    mọi pane đang mở phải quét lại; không gom thì gõ một chữ là khựng cả app;
   *  · đổi số cột — xterm wrap lại các dòng dài, marker đi theo dòng nhưng cột của decoration
   *    thì không, nên đoạn tô nằm lệch khỏi chữ cho tới khi quét lại.
   */
  let rescanTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleRescan = (onlyIfPainted: boolean): void => {
    if (rescanTimer !== null) clearTimeout(rescanTimer)
    rescanTimer = setTimeout(() => {
      rescanTimer = null
      if (disposed || (onlyIfPainted && painted.length === 0)) return
      clearAll()
      scan(false, cursorRow() - RESCAN_ROWS)
    }, 200)
  }

  const subs: IDisposable[] = [
    term.onWriteParsed(schedule),
    term.onResize(() => scheduleRescan(true)),
    // Trả false để xterm vẫn xử lý chuỗi như bình thường — ở đây chỉ nghe
    term.parser.registerCsiHandler({ final: 'K' }, () => {
      onRowErased()
      return false
    }),
    term.parser.registerCsiHandler({ final: 'J' }, (params) => {
      const mode = typeof params[0] === 'number' ? params[0] : 0
      if (mode === 0 || mode === 1) onRowErased()
      return false
    })
  ]

  return {
    markInputLine: () => {
      const buf = term.buffer.active
      if (buf.type !== 'normal') return
      const cur = cursorRow()
      let first = cur
      while (first > 0 && buf.getLine(first)?.isWrapped) first--
      for (let r = first; r <= cur; r++) {
        const m = markerAt(r)
        if (m) inputRows.add(m)
      }
    },
    setNotify: (on) => {
      notifyOn = on
    },
    catchUp: () => scan(false),
    rescan: () => scheduleRescan(false),
    dispose: () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      if (rescanTimer !== null) clearTimeout(rescanTimer)
      for (const s of subs) s.dispose()
      clearAll()
      scanMarker?.dispose()
      inputRows.dispose()
      notifiedRows.dispose()
      dirtyRows.dispose()
    }
  }
}
