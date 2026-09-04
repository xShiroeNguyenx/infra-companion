import { decodeXmlEntities } from './s3Api'

/**
 * WebDAV — phần THUẦN: ghép URL và parse phản hồi PROPFIND. Chạy với Nextcloud, Seafile,
 * Nginx dav_module, Synology… Phần gọi mạng (Basic auth qua net.fetch) ở main.
 */

/** Ghép URL thư mục + tên file, encode tên file, không nhân đôi dấu '/'. */
export function webdavJoin(baseUrl: string, name: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(name)}`
}

/** Body PROPFIND tối thiểu — chỉ hỏi tên (Depth: 1 đặt ở header). */
export const PROPFIND_BODY = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>'

/**
 * Lấy TÊN FILE từ phản hồi PROPFIND (multistatus): đọc các thẻ `<D:href>`, decode, lấy
 * basename. Không parse displayname vì nhiều server bỏ trống nó; href thì luôn có.
 * Bỏ entry là chính thư mục (href kết thúc bằng '/').
 */
export function parsePropfindNames(xml: string): string[] {
  const names: string[] = []
  for (const match of xml.matchAll(/<[a-zA-Z]*:?href>([^<]+)<\/[a-zA-Z]*:?href>/gi)) {
    const href = decodeXmlEntities(match[1]!.trim())
    if (href.endsWith('/')) continue // collection (chính thư mục cha)
    const base = href.split('/').pop() ?? ''
    if (base === '') continue
    try {
      names.push(decodeURIComponent(base))
    } catch {
      names.push(base) // href không phải percent-encoding hợp lệ — giữ nguyên
    }
  }
  return names
}
