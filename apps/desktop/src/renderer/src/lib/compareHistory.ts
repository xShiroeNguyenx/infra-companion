// Lịch sử đường dẫn file đã từng So sánh (per-máy, localStorage). Mới nhất đứng đầu, cap 15.
const KEY = 'infra.compare.history'
const MAX = 15

export function readCompareHistory(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string').slice(0, MAX)
  } catch {
    /* JSON hỏng → rỗng */
  }
  return []
}

/** Thêm 1 path lên đầu lịch sử (bỏ trùng), trả về danh sách mới. */
export function pushCompareHistory(path: string): string[] {
  const p = path.trim()
  if (!p) return readCompareHistory()
  const next = [p, ...readCompareHistory().filter((x) => x !== p)].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* localStorage đầy → chỉ mất persist */
  }
  return next
}

export function clearCompareHistory(): string[] {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* bỏ qua */
  }
  return []
}
