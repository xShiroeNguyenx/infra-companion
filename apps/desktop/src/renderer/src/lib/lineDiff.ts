/**
 * Diff 2 văn bản theo DÒNG, căn lề cho hiển thị side-by-side (dùng cho so sánh config F49).
 * Dùng LCS (quy hoạch động) để tìm dòng chung; khi file quá lớn thì rơi về căn theo chỉ số
 * (coarse) để không nổ bộ nhớ. Không phụ thuộc thư viện ngoài.
 */

export type DiffRowType = 'same' | 'add' | 'del' | 'change'

export interface DiffRow {
  type: DiffRowType
  /** Nội dung/ số dòng bên trái (A) — undefined nếu là dòng chỉ có bên phải (thêm mới). */
  left?: string
  leftNo?: number
  /** Nội dung/ số dòng bên phải (B) — undefined nếu là dòng chỉ có bên trái (bị xoá). */
  right?: string
  rightNo?: number
}

export interface DiffResult {
  rows: DiffRow[]
  added: number
  removed: number
  changed: number
  /** true khi file quá lớn → dùng căn lề thô (không tối ưu LCS). */
  truncated: boolean
  identical: boolean
}

/** Cắt \r cuối dòng (CRLF) và bỏ 1 dòng rỗng cuối do newline kết thúc file tạo ra. */
function splitLines(text: string): string[] {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

type Op = { kind: 'eq'; a: number; b: number } | { kind: 'del'; a: number } | { kind: 'ins'; b: number }

/** Trần ô bảng DP — trên ngưỡng này (~n*m) thì rơi về căn thô để tránh tốn RAM. */
const MAX_CELLS = 6_000_000

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j] ? dp[(i + 1) * w + (j + 1)]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + (j + 1)]!)
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'eq', a: i, b: j })
      i++
      j++
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + (j + 1)]!) {
      ops.push({ kind: 'del', a: i })
      i++
    } else {
      ops.push({ kind: 'ins', b: j })
      j++
    }
  }
  while (i < n) ops.push({ kind: 'del', a: i++ })
  while (j < m) ops.push({ kind: 'ins', b: j++ })
  return ops
}

/** Ghép chuỗi op thành hàng side-by-side: khối del liền khối ins được ghép cặp thành 'change'. */
function rowsFromOps(a: string[], b: string[], ops: Op[]): Omit<DiffResult, 'truncated'> {
  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  let changed = 0
  let k = 0
  while (k < ops.length) {
    const op = ops[k]!
    if (op.kind === 'eq') {
      rows.push({ type: 'same', left: a[op.a], leftNo: op.a + 1, right: b[op.b], rightNo: op.b + 1 })
      k++
      continue
    }
    // Gom cả 1 khối liên tiếp không-eq rồi tách del/ins để ghép cặp thành 'change'
    const dels: number[] = []
    const ins: number[] = []
    while (k < ops.length && ops[k]!.kind !== 'eq') {
      const o = ops[k]!
      if (o.kind === 'del') dels.push(o.a)
      else if (o.kind === 'ins') ins.push(o.b)
      k++
    }
    const pairs = Math.min(dels.length, ins.length)
    for (let x = 0; x < pairs; x++) {
      rows.push({ type: 'change', left: a[dels[x]!], leftNo: dels[x]! + 1, right: b[ins[x]!], rightNo: ins[x]! + 1 })
      changed++
    }
    for (let x = pairs; x < dels.length; x++) {
      rows.push({ type: 'del', left: a[dels[x]!], leftNo: dels[x]! + 1 })
      removed++
    }
    for (let x = pairs; x < ins.length; x++) {
      rows.push({ type: 'add', right: b[ins[x]!], rightNo: ins[x]! + 1 })
      added++
    }
  }
  return { rows, added, removed, changed, identical: added + removed + changed === 0 }
}

/** Căn lề thô theo chỉ số dòng (cho file rất lớn) — không tối ưu nhưng vẫn thấy khác biệt. */
function coarseRows(a: string[], b: string[]): Omit<DiffResult, 'truncated'> {
  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  let changed = 0
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    const la = i < a.length ? a[i] : undefined
    const lb = i < b.length ? b[i] : undefined
    if (la !== undefined && lb !== undefined) {
      if (la === lb) rows.push({ type: 'same', left: la, leftNo: i + 1, right: lb, rightNo: i + 1 })
      else {
        rows.push({ type: 'change', left: la, leftNo: i + 1, right: lb, rightNo: i + 1 })
        changed++
      }
    } else if (la !== undefined) {
      rows.push({ type: 'del', left: la, leftNo: i + 1 })
      removed++
    } else if (lb !== undefined) {
      rows.push({ type: 'add', right: lb, rightNo: i + 1 })
      added++
    }
  }
  return { rows, added, removed, changed, identical: added + removed + changed === 0 }
}

export function diffLines(textA: string, textB: string): DiffResult {
  const a = splitLines(textA)
  const b = splitLines(textB)
  if (a.length * b.length > MAX_CELLS) return { ...coarseRows(a, b), truncated: true }
  return { ...rowsFromOps(a, b, lcsOps(a, b)), truncated: false }
}
