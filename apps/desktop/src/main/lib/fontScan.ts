import type { Dirent } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  FONT_SCAN_MAX_DEPTH,
  FONT_SCAN_MAX_FILES,
  SFNT_HEADER_BYTES,
  SFNT_TABLE_ENTRY_BYTES,
  detectFontContainer,
  isScannableFontFile,
  parseFamilyFromNameTable,
  parseTableDirectory,
  sfntNumTables,
  ttcFontOffsets,
  ttcNumFonts
} from '@infra/core'

/**
 * Quét thư mục font của hệ điều hành → danh sách TÊN HỌ FONT.
 *
 * Cố ý tách khỏi `ipc/fonts.ts`: file này **không import `electron`** nên chạy được bằng
 * Node thuần, tức kiểm chứng được trên máy thật mà không phải mở cả app. Phần quản file
 * trong `userData` (cần `app.getPath`) vẫn nằm ở module IPC.
 *
 * Chỉ đọc ĐÚNG vài KB mỗi file (header → bảng mục lục → bảng `name`), không nạp cả file:
 * máy Windows có ~500 font, nạp trọn là hàng trăm MB vô ích.
 */

/** Bảng `name` lớn hơn mức này thì bỏ — font thật chỉ vài KB, số to là dấu hiệu file hỏng. */
const MAX_NAME_TABLE_BYTES = 1024 * 1024
/** Số file mở đồng thời — đủ nhanh mà không cạn file handle. */
const READ_BATCH = 32

/**
 * Đọc tên họ font từ một file, chỉ bằng các lần đọc có mục tiêu.
 * Trả null với MỌI file không đọc được: thư mục font của OS có cả file hỏng, file tạm,
 * `.fon` bitmap thời DOS — một file lạ không được làm chết cả lần quét.
 */
export async function readFontFamily(path: string): Promise<string | null> {
  let fh: Awaited<ReturnType<typeof open>> | null = null
  try {
    fh = await open(path, 'r')
    const head = Buffer.alloc(SFNT_HEADER_BYTES)
    await fh.read(head, 0, SFNT_HEADER_BYTES, 0)

    // Collection (.ttc/.otc): lấy font đầu là đủ để biết họ font
    let base = 0
    if (detectFontContainer(head) === 'ttc') {
      const numFonts = ttcNumFonts(head)
      if (numFonts === 0) return null
      const collHead = Buffer.alloc(SFNT_HEADER_BYTES + 4 * numFonts)
      await fh.read(collHead, 0, collHead.length, 0)
      base = ttcFontOffsets(collHead, numFonts)[0] ?? 0
      if (base === 0) return null
    }

    const fontHead = base === 0 ? head : Buffer.alloc(SFNT_HEADER_BYTES)
    if (base !== 0) await fh.read(fontHead, 0, SFNT_HEADER_BYTES, base)
    const numTables = sfntNumTables(fontHead)
    if (numTables === 0) return null

    const dirLen = SFNT_HEADER_BYTES + numTables * SFNT_TABLE_ENTRY_BYTES
    const dir = Buffer.alloc(dirLen)
    await fh.read(dir, 0, dirLen, base)
    const nameTable = parseTableDirectory(dir, numTables).find((t) => t.tag === 'name')
    // Offset trong bảng mục lục là TUYỆT ĐỐI từ đầu file, kể cả bên trong collection
    if (!nameTable || nameTable.length > MAX_NAME_TABLE_BYTES) return null

    const buf = Buffer.alloc(nameTable.length)
    await fh.read(buf, 0, nameTable.length, nameTable.offset)
    return parseFamilyFromNameTable(buf)
  } catch {
    return null
  } finally {
    await fh?.close().catch(() => {})
  }
}

/** Đi hết cây thư mục font, thu đường dẫn các file quét được (có trần độ sâu + số file). */
export async function collectFontFiles(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > FONT_SCAN_MAX_DEPTH || out.length >= FONT_SCAN_MAX_FILES) return out
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out // thư mục không tồn tại trên máy này (vd ~/.fonts) — chuyện bình thường
  }
  for (const e of entries) {
    if (out.length >= FONT_SCAN_MAX_FILES) return out
    // Bỏ symlink để không đi vòng vô tận trong cây font của Linux
    if (e.isSymbolicLink()) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) await collectFontFiles(full, depth + 1, out)
    else if (e.isFile() && isScannableFontFile(e.name)) out.push(full)
  }
  return out
}

/** Tên họ font trong các thư mục cho trước: đã loại trùng và sắp theo bảng chữ cái. */
export async function scanFontFamilies(dirs: string[]): Promise<string[]> {
  const files: string[] = []
  for (const d of dirs) await collectFontFiles(d, 0, files)

  const families = new Set<string>()
  for (let i = 0; i < files.length; i += READ_BATCH) {
    const names = await Promise.all(files.slice(i, i + READ_BATCH).map(readFontFamily))
    for (const n of names) if (n) families.add(n)
  }
  return [...families].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
