import { decodeXmlEntities } from '../sync/s3Api'

/**
 * XML tối giản cho phản hồi EC2 — KHÔNG phải parser XML tổng quát. Chỉ cần hai thao tác:
 * lấy các khối `<tag>…</tag>` (CÓ xử lý tag cùng tên lồng nhau — EC2 lồng `<item>` trong
 * `<item>` ở tagSet/instancesSet) và lấy text của tag đơn. Regex non-greedy trần sẽ cắt
 * nhầm ở tag lồng — nên đếm độ sâu bằng tay.
 */

/** Nội dung các khối `<tag>…</tag>` ở MỌI vị trí, ghép đúng cặp mở/đóng theo độ sâu. */
export function xmlBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = []
  const open = `<${tag}>`
  const openSp = `<${tag} `
  const close = `</${tag}>`
  let i = 0
  while (i < xml.length) {
    const start = findOpen(xml, i)
    if (start === -1) break
    const contentStart = xml.indexOf('>', start) + 1
    // tìm close khớp — đếm mọi lần mở/đóng cùng tên ở giữa
    let depth = 1
    let j = contentStart
    while (depth > 0) {
      const nextOpen = findOpen(xml, j)
      const nextClose = xml.indexOf(close, j)
      if (nextClose === -1) return blocks // XML cụt — trả những gì đã ghép được
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1
        j = xml.indexOf('>', nextOpen) + 1
      } else {
        depth -= 1
        j = nextClose + close.length
      }
    }
    blocks.push(xml.slice(contentStart, j - close.length))
    i = j
  }
  return blocks

  function findOpen(hay: string, from: number): number {
    const a = hay.indexOf(open, from)
    const b = hay.indexOf(openSp, from)
    if (a === -1) return b
    if (b === -1) return a
    return Math.min(a, b)
  }
}

/** Text của tag ĐƠN đầu tiên (không lồng), đã decode entity. null nếu không có. */
export function xmlText(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return match ? decodeXmlEntities(match[1]!) : null
}
