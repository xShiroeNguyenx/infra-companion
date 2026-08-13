/**
 * Cắt một mục version ra khỏi CHANGELOG.md.
 *
 * Dùng lúc BUILD (`electron.vite.config.ts` nhúng kết quả vào `__RELEASE_NOTES__`) chứ không
 * phải lúc chạy: CHANGELOG.md không nằm trong `files` của electron-builder nên bản đã cài
 * không có file này để đọc. Chỉ nhúng ĐÚNG một mục (~2-5KB) thay vì cả file (86KB).
 *
 * ⚠️ File này phải TỰ ĐỨNG (không import gì) vì vite config nạp nó bằng đường dẫn tương đối,
 * ngoài luồng resolve của workspace.
 */

/**
 * Heading một version: `## [0.2.6] — 2026-08-13`.
 * Phải khớp HẾT DÒNG (`.*$`) chứ không dừng ở `]` — nếu không, phần ngày tháng còn lại của
 * dòng sẽ bị tính vào thân mục và hiện lên UI như một đoạn văn cụt.
 */
const VERSION_HEADING = /^##\s+\[([^\]]+)\].*$/gm

/**
 * Trả về phần thân của mục `version` (KHÔNG gồm dòng heading), đã bỏ đường kẻ `---` ngăn cách
 * cuối mục. Không tìm thấy version → chuỗi rỗng (nơi gọi hiện fallback + link changelog online).
 */
export function extractChangelogSection(markdown: string, version: string): string {
  if (!markdown || !version) return ''
  VERSION_HEADING.lastIndex = 0
  let start = -1
  let match: RegExpExecArray | null
  while ((match = VERSION_HEADING.exec(markdown)) !== null) {
    if (start >= 0) {
      // Đã vào mục cần tìm và gặp heading kế → thân mục kết thúc ngay trước heading này
      return trimSection(markdown.slice(start, match.index))
    }
    if (match[1] === version) start = match.index + match[0].length
  }
  // Mục cuối file: không có heading nào sau nó
  return start >= 0 ? trimSection(markdown.slice(start)) : ''
}

/** Bỏ khoảng trắng thừa hai đầu và đường kẻ ngang `---` mà CHANGELOG dùng để ngăn các mục. */
function trimSection(body: string): string {
  return body.replace(/\n+\s*-{3,}\s*$/, '').trim()
}
