/**
 * Google Drive API v3 — phần THUẦN (dựng URL/body, phân tích phản hồi), test không cần mạng.
 * Phần gọi mạng nằm ở `apps/desktop/src/main/lib/googleDrive.ts` (cần net.fetch của Electron).
 *
 * Scope `drive.file` tự giới hạn mọi lệnh vào những file DO CHÍNH APP TẠO — `files.list`
 * không bao giờ trả về file khác của user, nên query ở đây không cần (và không thể) lọc thêm.
 */

export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

/** Escape giá trị chuỗi trong query của Drive (`name = '...'`): \ và ' phải có backslash. */
export function driveEscapeQuery(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

/** URL files.list tìm đúng tên file (blob chuẩn). */
export function buildDriveListByNameUrl(name: string): string {
  const q = `name = '${driveEscapeQuery(name)}' and trashed = false`
  return `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name)')}&pageSize=10`
}

/** URL files.list tìm file GẦN GIỐNG blob (đổi tên khi tải trùng, bản conflict…). */
export function buildDriveListContainsUrl(stem: string): string {
  const q = `name contains '${driveEscapeQuery(stem)}' and trashed = false`
  return `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name)')}&pageSize=100`
}

export interface DriveFileRef {
  id: string
  name: string
}

export type DriveListParse = { ok: true; files: DriveFileRef[] } | { ok: false; error: string }

export function parseDriveFileList(json: unknown): DriveListParse {
  const data = json as { files?: unknown } | null
  if (typeof data !== 'object' || data === null || !Array.isArray(data.files)) {
    return { ok: false, error: 'Phản hồi không đúng dạng files.list của Drive' }
  }
  const files: DriveFileRef[] = []
  for (const raw of data.files) {
    const f = raw as Record<string, unknown>
    if (f && typeof f.id === 'string' && typeof f.name === 'string') files.push({ id: f.id, name: f.name })
  }
  return { ok: true, files }
}

/**
 * Body multipart cho files.create (metadata + nội dung trong MỘT request).
 * Blob là text base64-ish vài trăm KB nên gói thẳng, không cần resumable upload.
 */
export function buildMultipartUpload(
  boundary: string,
  metadata: { name: string },
  content: string
): { body: string; contentType: string } {
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    ''
  ].join('\r\n')
  return { body, contentType: `multipart/related; boundary=${boundary}` }
}
