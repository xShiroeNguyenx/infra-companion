import type {
  ReplChecksumRowDto,
  ReplSchemaDiffDto,
  ReplTableDiffDto,
  ReplVarDiffDto
} from '@infra/shared'

/**
 * F59 — LỊCH SỬ so lệch master ↔ slave: mỗi lần quét/đếm/checksum ghi lại một bản.
 *
 * Vì sao cần: sửa dữ liệu lệch là việc kéo dài nhiều ngày (tìm ra bảng lệch hôm nay, vá dữ liệu
 * hôm sau, kiểm lại hôm sau nữa). Không có lịch sử thì lần quét sau XOÁ SẠCH kết quả lần trước
 * và không ai trả lời được "bảng này hôm qua lệch bao nhiêu, đã bớt chưa".
 *
 * TOÀN BỘ FILE LÀ HÀM THUẦN: rút gọn kết quả và đếm. Caller (main) lo phần lưu vault.
 *
 * Hai nguyên tắc khi rút gọn:
 *  1. **Chỉ giữ mục LỆCH.** Bảng khớp có thể tới hàng nghìn dòng và không mang thông tin gì cho
 *     lần đọc lại — giữ hết thì file vault phình theo mỗi lần bấm quét.
 *  2. **Cắt thì phải nói.** Vượt trần thì đánh dấu `truncated` để UI ghi rõ "đã cắt bớt", không
 *     bao giờ để người đọc tưởng danh sách là đầy đủ.
 */

/** Trần số mục MỖI NHÓM cho một bản ghi lịch sử. Vượt thì cắt và bật `truncated`. */
export const RUN_ENTRY_CAP = 500

/** Con số tóm tắt hiện thẳng trên danh sách lịch sử — không cần giải mã payload. */
export interface ReplRunCounts {
  /** Bảng lệch, KHÔNG tính bảng ngoài phạm vi replication (chênh ở đó là cố ý). */
  tableDiffs: number
  columnDiffs: number
  indexDiffs: number
  /** Biến cấu hình lệch, KHÔNG tính những biến vốn phải khác nhau (server_id, read_only…). */
  varDiffs: number
  /** Số bảng đã đếm/checksum ở lần chạy nặng. */
  checked: number
  /** Số bảng LỆCH thật trong lần đếm/checksum đó. */
  mismatches: number
}

/** Phần chi tiết được mã hoá rồi cất vào vault. */
export interface ReplRunPayload {
  tables: ReplTableDiffDto[]
  columns: ReplSchemaDiffDto[]
  indexes: ReplSchemaDiffDto[]
  variables: ReplVarDiffDto[]
  rows: ReplChecksumRowDto[]
  hasFilters: boolean
  /** Có nhóm nào bị cắt bớt vì vượt trần không. */
  truncated: boolean
}

export interface ReplRunBuild {
  counts: ReplRunCounts
  payload: ReplRunPayload
}

const EMPTY_COUNTS: ReplRunCounts = {
  tableDiffs: 0,
  columnDiffs: 0,
  indexDiffs: 0,
  varDiffs: 0,
  checked: 0,
  mismatches: 0
}

/** Cắt theo trần, trả kèm cờ "đã cắt" để caller gộp lại. */
function cap<T>(items: readonly T[], limit: number): { list: T[]; cut: boolean } {
  const list = items.slice(0, Math.max(0, limit))
  return { list, cut: items.length > list.length }
}

/**
 * Một dòng đếm/checksum có lệch không.
 *
 * `null` ở một bên nghĩa là KHÔNG ĐỌC ĐƯỢC (engine không hỗ trợ CHECKSUM, hoặc câu lệnh lỗi) —
 * không đọc được thì không kết luận được, nên KHÔNG tính là lệch. Dòng đó đã có `error` riêng.
 */
export function isChecksumMismatch(row: ReplChecksumRowDto): boolean {
  const countDiffers = row.masterCount !== null && row.replicaCount !== null && row.masterCount !== row.replicaCount
  const sumDiffers =
    row.masterChecksum !== null && row.replicaChecksum !== null && row.masterChecksum !== row.replicaChecksum
  return countDiffers || sumDiffers
}

/** Kết quả "Quét nhanh" (information_schema) → bản ghi lịch sử. */
export function buildScanRun(
  result: {
    tables: readonly ReplTableDiffDto[]
    columns: readonly ReplSchemaDiffDto[]
    indexes: readonly ReplSchemaDiffDto[]
    variables: readonly ReplVarDiffDto[]
    hasFilters?: boolean
  },
  limit = RUN_ENTRY_CAP
): ReplRunBuild {
  // Bảng khớp không lưu. Bảng bị lọc VẪN lưu (để đọc lại còn biết vì sao chênh) nhưng không đếm.
  const differing = (result.tables ?? []).filter((t) => t.status !== 'same')
  const tables = cap(differing, limit)
  const columns = cap(result.columns ?? [], limit)
  const indexes = cap(result.indexes ?? [], limit)
  const variables = cap(result.variables ?? [], limit)

  return {
    counts: {
      ...EMPTY_COUNTS,
      tableDiffs: differing.filter((t) => !t.filtered).length,
      columnDiffs: (result.columns ?? []).length,
      indexDiffs: (result.indexes ?? []).length,
      varDiffs: (result.variables ?? []).filter((v) => !v.expected).length
    },
    payload: {
      tables: tables.list,
      columns: columns.list,
      indexes: indexes.list,
      variables: variables.list,
      rows: [],
      hasFilters: result.hasFilters ?? false,
      truncated: tables.cut || columns.cut || indexes.cut || variables.cut
    }
  }
}

/**
 * Kết quả đếm chính xác / CHECKSUM → bản ghi lịch sử.
 *
 * Ở đây giữ CẢ dòng khớp: số bảng đã kiểm ít (trần 50) và "bảng này đã kiểm và khớp" chính là
 * thông tin cần nhất khi đối chiếu với lần quét trước.
 */
export function buildChecksumRun(rows: readonly ReplChecksumRowDto[], limit = RUN_ENTRY_CAP): ReplRunBuild {
  const all = rows ?? []
  const kept = cap(all, limit)
  return {
    counts: {
      ...EMPTY_COUNTS,
      checked: all.length,
      mismatches: all.filter(isChecksumMismatch).length
    },
    payload: {
      tables: [],
      columns: [],
      indexes: [],
      variables: [],
      rows: kept.list,
      hasFilters: false,
      truncated: kept.cut
    }
  }
}

/** Bản ghi này có phát hiện lệch gì không — quyết định màu/nhãn trên danh sách. */
export function runHasFindings(counts: ReplRunCounts): boolean {
  return (
    counts.tableDiffs > 0 ||
    counts.columnDiffs > 0 ||
    counts.indexDiffs > 0 ||
    counts.varDiffs > 0 ||
    counts.mismatches > 0
  )
}
