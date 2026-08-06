/**
 * Đọc TÊN HỌ FONT từ file font (sfnt: TTF/OTF/TTC).
 *
 * Vì sao phải tự parse: muốn có dropdown chọn font thì phải biết tên họ font THẬT
 * ("Cascadia Mono"), mà tên file thì không nói được điều đó (`CascadiaMono-Regular.ttf`,
 * `segoeui.ttf`, `NotoSansCJK-Regular.ttc`…). Tên họ nằm trong bảng `name` của file.
 *
 * Cố ý tách thành các hàm nhỏ theo từng phần cần đọc, thay vì một hàm nhận cả file:
 * máy Windows có ~500 file font, đọc trọn từng file là hàng trăm MB vô ích. Bên gọi chỉ
 * cần đọc header (12B) → bảng mục lục (16B/bảng) → đúng bảng `name` (vài KB).
 *
 * Mọi hàm ở đây phải **chịu được file rác**: trả null / mảng rỗng chứ không bao giờ ném,
 * vì thư mục font của hệ điều hành có cả file hỏng, file tạm, `.fon` bitmap thời DOS.
 */

/** Số byte đầu tiên cần đọc để biết file thuộc loại nào. */
export const SFNT_HEADER_BYTES = 12
/** Mỗi mục trong bảng mục lục sfnt dài 16 byte. */
export const SFNT_TABLE_ENTRY_BYTES = 16

export type FontContainer = 'sfnt' | 'ttc' | 'woff' | 'woff2' | 'unknown'

export interface SfntTable {
  tag: string
  offset: number
  length: number
}

function u16(b: Uint8Array, at: number): number {
  if (at + 1 >= b.length) return 0
  return (b[at] << 8) | b[at + 1]
}

function u32(b: Uint8Array, at: number): number {
  if (at + 3 >= b.length) return 0
  // `>>> 0` để không ra số âm khi bit cao bằng 1
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
}

function tagAt(b: Uint8Array, at: number): string {
  if (at + 3 >= b.length) return ''
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
}

/**
 * Nhận dạng loại container từ 12 byte đầu.
 * `woff`/`woff2` nhận ra để **bỏ qua khi quét hệ thống** (bảng bên trong đã nén, không đọc
 * trực tiếp được) nhưng vẫn cho phép ở font user tự thêm — chỗ đó không cần parse tên.
 */
export function detectFontContainer(b: Uint8Array): FontContainer {
  const tag = tagAt(b, 0)
  if (tag === 'ttcf') return 'ttc'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'OTTO' || tag === 'true' || tag === 'typ1') return 'sfnt'
  // TrueType kinh điển: version 1.0 dạng fixed-point
  if (u32(b, 0) === 0x00010000) return 'sfnt'
  return 'unknown'
}

/** Số bảng trong một font sfnt (đọc từ 12 byte đầu của font đó). */
export function sfntNumTables(b: Uint8Array): number {
  const n = u16(b, 4)
  // Chặn số vô lý từ file rác: không font thật nào có ngần này bảng
  return n > 0 && n <= 512 ? n : 0
}

/** Số font bên trong một collection `.ttc` (đọc từ header collection). */
export function ttcNumFonts(b: Uint8Array): number {
  const n = u32(b, 8)
  return n > 0 && n <= 256 ? n : 0
}

/**
 * Offset của từng font trong collection. Cần `12 + 4*numFonts` byte đầu.
 * Chỉ font đầu là đủ cho việc liệt kê họ font, nhưng trả cả mảng để bên gọi tự chọn.
 */
export function ttcFontOffsets(b: Uint8Array, numFonts: number): number[] {
  const out: number[] = []
  for (let i = 0; i < numFonts; i++) {
    const off = u32(b, 12 + i * 4)
    if (off > 0) out.push(off)
  }
  return out
}

/** Bảng mục lục sfnt. `b` là vùng byte BẮT ĐẦU từ header của font (không phải đầu file .ttc). */
export function parseTableDirectory(b: Uint8Array, numTables: number): SfntTable[] {
  const out: SfntTable[] = []
  for (let i = 0; i < numTables; i++) {
    const at = SFNT_HEADER_BYTES + i * SFNT_TABLE_ENTRY_BYTES
    const tag = tagAt(b, at)
    if (!tag) break
    const offset = u32(b, at + 8)
    const length = u32(b, at + 12)
    if (offset > 0 && length > 0) out.push({ tag, offset, length })
  }
  return out
}

/** Giải mã UTF-16BE (platform 0 và 3 dùng mã này). */
function decodeUtf16Be(b: Uint8Array, at: number, len: number): string {
  let s = ''
  for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(u16(b, at + i))
  return s
}

/** Giải mã Mac Roman ở mức ASCII — đủ cho tên họ font, ký tự lạ sẽ bị hàm gọi loại. */
function decodeLatin1(b: Uint8Array, at: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[at + i])
  return s
}

/**
 * Thứ tự ưu tiên khi một font khai tên ở nhiều bản ghi.
 * Điểm CAO hơn thì thắng. Ưu tiên:
 * - nameID **16** (Typographic Family) hơn **1** (Family): với họ nhiều nét, nameID 1 bị cắt
 *   thành "Roboto Light" còn 16 mới là "Roboto" — dropdown cần cái sau.
 * - platform 3 (Windows) và 0 (Unicode) hơn platform 1 (Mac, bảng mã cũ).
 */
function nameScore(platformId: number, nameId: number): number {
  const idScore = nameId === 16 ? 2 : nameId === 1 ? 1 : 0
  if (idScore === 0) return 0
  const platScore = platformId === 3 ? 3 : platformId === 0 ? 2 : platformId === 1 ? 1 : 0
  if (platScore === 0) return 0
  return idScore * 10 + platScore
}

/** Chỉ nhận tên "trông như tên font" — chặn chuỗi rác từ file hỏng. */
function isUsableFamily(s: string): boolean {
  const t = s.trim()
  if (t.length < 2 || t.length > 64) return false
  // Cho phép chữ (kể cả Unicode), số, khoảng trắng và vài dấu hay gặp trong tên font
  return /^[\p{L}\p{N} ._+\-&']+$/u.test(t)
}

/**
 * Lấy tên họ font từ **bảng `name`** (truyền đúng vùng byte của bảng đó).
 * Trả null nếu bảng hỏng hoặc không có bản ghi nào dùng được.
 */
export function parseFamilyFromNameTable(table: Uint8Array): string | null {
  const count = u16(table, 2)
  const stringOffset = u16(table, 4)
  if (count === 0 || count > 4096) return null

  let best = 0
  let bestName: string | null = null
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12
    if (at + 12 > table.length) break
    const platformId = u16(table, at)
    const encodingId = u16(table, at + 2)
    const nameId = u16(table, at + 6)
    const score = nameScore(platformId, nameId)
    if (score <= best) continue

    const len = u16(table, at + 8)
    const off = stringOffset + u16(table, at + 10)
    if (len === 0 || off + len > table.length) continue

    // platform 1 (Mac) encoding 0 là byte đơn; còn lại trong nhóm ta nhận đều là UTF-16BE
    const raw = platformId === 1 && encodingId === 0 ? decodeLatin1(table, off, len) : decodeUtf16Be(table, off, len)
    if (!isUsableFamily(raw)) continue
    best = score
    bestName = raw.trim()
  }
  return bestName
}

/** Đuôi file font mà việc quét hệ thống sẽ mở ra đọc. */
export const SCANNABLE_FONT_EXT = ['.ttf', '.otf', '.ttc', '.otc'] as const

/** Đuôi file cho phép user tự thêm — rộng hơn vì không cần parse tên. */
export const ADDABLE_FONT_EXT = ['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'] as const

/** true = đuôi file nằm trong danh sách quét được. */
export function isScannableFontFile(name: string): boolean {
  const lower = name.toLowerCase()
  return SCANNABLE_FONT_EXT.some((e) => lower.endsWith(e))
}

/**
 * Font user tự thêm có dùng được không: kiểm **magic byte**, không tin đuôi file.
 * Chặn việc ghi một file tuỳ ý vào userData chỉ vì nó tên `.ttf`.
 */
export function isAddableFontBytes(b: Uint8Array): boolean {
  const c = detectFontContainer(b)
  return c === 'sfnt' || c === 'ttc' || c === 'woff' || c === 'woff2'
}
