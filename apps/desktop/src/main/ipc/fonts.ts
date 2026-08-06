import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { IPC, type CustomFontDto, type FontListDto } from '@infra/shared'
import { isAddableFontBytes, systemFontDirs } from '@infra/core'
import { readFontFamily, scanFontFamilies } from '../lib/fontScan'

/**
 * F57 — danh sách font cho dropdown chọn font terminal.
 *
 * Hai nguồn:
 * - **Font trên máy**: quét thư mục font của hệ điều hành rồi đọc tên họ font THẬT từ bảng
 *   `name` trong file (tên file không nói được: `segoeui.ttf`, `CascadiaMono-Regular.ttf`).
 *   Cố ý KHÔNG dùng `queryLocalFonts()` của Chromium: API đó cần quyền `local-fonts` mà
 *   Electron không cấp qua permission handler mặc định, và cần cả user gesture — hỏng thì
 *   hỏng im lặng, đúng loại lỗi khó truy. Đọc file thì luôn xác định được vì sao thất bại.
 * - **Font user tự thêm**: file font copy vào `userData/fonts/`, index ở `fonts.json`.
 *   Renderer nhận về data URL rồi đăng ký bằng `FontFace` (CSP đã cho `font-src data:`).
 *
 * Chỉ đọc ĐÚNG vài KB mỗi file (header → bảng mục lục → bảng `name`), không nạp cả file:
 * máy Windows có ~500 font, nạp trọn là hàng trăm MB vô ích.
 */

/** Trần dung lượng 1 file font user thêm. Font mono thật thường < 600 KB. */
const MAX_FONT_BYTES = 2 * 1024 * 1024
/** Số font tự thêm tối đa — data URL của chúng đi qua IPC mỗi lần mở app. */
const MAX_CUSTOM_FONTS = 8
const FAMILY_MAX = 64

interface FontIndexEntry {
  id: string
  family: string
  file: string
}

/** Kết quả quét hệ thống được nhớ đệm: font cài/xoá là chuyện hiếm, quét lại theo yêu cầu. */
let systemCache: string[] | null = null
let scanFailed = false

function fontsDir(): string {
  return join(app.getPath('userData'), 'fonts')
}

function indexPath(): string {
  return join(fontsDir(), 'fonts.json')
}

async function readIndex(): Promise<FontIndexEntry[]> {
  try {
    const raw = JSON.parse(await readFile(indexPath(), 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (x): x is FontIndexEntry =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as FontIndexEntry).id === 'string' &&
        typeof (x as FontIndexEntry).family === 'string' &&
        typeof (x as FontIndexEntry).file === 'string'
    )
  } catch {
    return [] // chưa có file hoặc JSON hỏng → coi như chưa thêm font nào
  }
}

async function writeIndex(entries: FontIndexEntry[]): Promise<void> {
  await mkdir(fontsDir(), { recursive: true })
  await writeFile(indexPath(), JSON.stringify(entries, null, 2), 'utf8')
}

function scanSystemFonts(): Promise<string[]> {
  return scanFontFamilies(systemFontDirs(process.platform, process.env, app.getPath('home')))
}

async function customFonts(): Promise<CustomFontDto[]> {
  const entries = await readIndex()
  const out: CustomFontDto[] = []
  for (const e of entries) {
    try {
      const bytes = await readFile(join(fontsDir(), e.file))
      out.push({
        id: e.id,
        family: e.family,
        fileName: e.file,
        sizeBytes: bytes.length,
        dataUrl: `data:font/${mimeSuffix(e.file)};base64,${bytes.toString('base64')}`
      })
    } catch {
      // File bị xoá tay khỏi userData → bỏ qua, index sẽ được dọn ở lần xoá/thêm sau
    }
  }
  return out
}

/** Phần sau `font/` trong data URL. Trình duyệt tự nhận dạng thật, giá trị này chỉ để hợp lệ. */
function mimeSuffix(file: string): string {
  const ext = extname(file).toLowerCase()
  if (ext === '.woff2') return 'woff2'
  if (ext === '.woff') return 'woff'
  if (ext === '.otf' || ext === '.otc') return 'otf'
  return 'ttf'
}

function cleanFamily(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/["\\]/g, '')
  return s.length >= 1 && s.length <= FAMILY_MAX ? s : null
}

/** Tên gợi ý khi không đọc được tên họ từ file (woff/woff2 đã nén bảng). */
function familyFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  return base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, FAMILY_MAX) || 'Custom font'
}

export function registerFontsIpc(): () => void {
  ipcMain.handle(IPC.FONTS_LIST, async (): Promise<FontListDto> => {
    if (systemCache === null) {
      try {
        systemCache = await scanSystemFonts()
        scanFailed = systemCache.length === 0
      } catch {
        systemCache = []
        scanFailed = true
      }
    }
    return { system: systemCache, custom: await customFonts(), scanFailed }
  })

  ipcMain.handle(IPC.FONTS_RESCAN, async (): Promise<FontListDto> => {
    systemCache = null
    scanFailed = false
    try {
      systemCache = await scanSystemFonts()
      scanFailed = systemCache.length === 0
    } catch {
      systemCache = []
      scanFailed = true
    }
    return { system: systemCache, custom: await customFonts(), scanFailed }
  })

  /**
   * Thêm font từ file user chọn. Renderer gửi bytes (không gửi đường dẫn) — nhất quán với
   * cách thêm con trỏ chuột, và main không phải tin một path tuỳ ý từ renderer.
   */
  ipcMain.handle(
    IPC.FONTS_ADD,
    async (_e, input: { name: string; bytes: Uint8Array }): Promise<{ ok: true; font: CustomFontDto } | { ok: false; reason: 'full' | 'tooLarge' | 'notFont' | 'io' }> => {
      const bytes = Buffer.from(input?.bytes ?? [])
      if (bytes.length === 0 || bytes.length > MAX_FONT_BYTES) return { ok: false, reason: 'tooLarge' }
      // Tin MAGIC BYTE chứ không tin đuôi file: chặn ghi file tuỳ ý vào userData
      if (!isAddableFontBytes(bytes)) return { ok: false, reason: 'notFont' }

      const entries = await readIndex()
      if (entries.length >= MAX_CUSTOM_FONTS) return { ok: false, reason: 'full' }

      const rawName = typeof input?.name === 'string' ? input.name : 'font.ttf'
      // Chỉ giữ đuôi file, TỰ sinh tên file để tên do user cung cấp không thoát khỏi thư mục
      const ext = ['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'].find((x) => rawName.toLowerCase().endsWith(x)) ?? '.ttf'
      const id = randomUUID()
      const file = `${id}${ext}`

      try {
        await mkdir(fontsDir(), { recursive: true })
        await writeFile(join(fontsDir(), file), bytes)
      } catch {
        return { ok: false, reason: 'io' }
      }

      // Tên họ thật đọc được từ file thì dùng, không thì suy từ tên file (woff/woff2)
      const parsed = await readFontFamily(join(fontsDir(), file))
      const family = cleanFamily(parsed) ?? familyFromFileName(rawName)
      const next = [...entries, { id, family, file }]
      await writeIndex(next)

      return {
        ok: true,
        font: {
          id,
          family,
          fileName: file,
          sizeBytes: bytes.length,
          dataUrl: `data:font/${mimeSuffix(file)};base64,${bytes.toString('base64')}`
        }
      }
    }
  )

  ipcMain.handle(IPC.FONTS_RENAME, async (_e, id: string, family: string): Promise<boolean> => {
    const name = cleanFamily(family)
    if (!name) return false
    const entries = await readIndex()
    if (!entries.some((e) => e.id === id)) return false
    await writeIndex(entries.map((e) => (e.id === id ? { ...e, family: name } : e)))
    return true
  })

  ipcMain.handle(IPC.FONTS_REMOVE, async (_e, id: string): Promise<boolean> => {
    const entries = await readIndex()
    const hit = entries.find((e) => e.id === id)
    if (!hit) return false
    await writeIndex(entries.filter((e) => e.id !== id))
    await rm(join(fontsDir(), hit.file), { force: true }).catch(() => {})
    return true
  })

  return () => {
    ipcMain.removeHandler(IPC.FONTS_LIST)
    ipcMain.removeHandler(IPC.FONTS_RESCAN)
    ipcMain.removeHandler(IPC.FONTS_ADD)
    ipcMain.removeHandler(IPC.FONTS_RENAME)
    ipcMain.removeHandler(IPC.FONTS_REMOVE)
  }
}
