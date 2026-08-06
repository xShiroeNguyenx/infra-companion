import { create } from 'zustand'
import type { CustomFontDto, FontAddResultDto } from '@infra/shared'

/**
 * Nguồn font cho picker font terminal (Settings → Terminal).
 *
 * `system` do main quét từ thư mục font của hệ điều hành. `custom` là font user tự thêm —
 * store này chịu trách nhiệm **đăng ký chúng vào document** bằng `FontFace`, nếu không thì
 * CSS `font-family: "Tên font"` chẳng trỏ vào đâu cả.
 *
 * Phải `load()` NGAY khi app khởi động, không đợi mở Settings: terminal cần font đã đăng ký
 * để vẽ, mở app mà chưa vào Settings thì font tự thêm sẽ không hiện.
 */

/** FontFace đã đăng ký, theo id — giữ lại để đổi tên/xoá thì gỡ đúng cái cũ khỏi document. */
const registered = new Map<string, FontFace>()

async function registerFont(font: CustomFontDto): Promise<void> {
  const existing = registered.get(font.id)
  // Đổi tên họ font = phải đăng ký lại: FontFace.family là chỉ-đọc sau khi tạo
  if (existing && existing.family === font.family) return
  if (existing) {
    document.fonts.delete(existing)
    registered.delete(font.id)
  }
  try {
    const face = new FontFace(font.family, `url(${font.dataUrl})`)
    await face.load()
    document.fonts.add(face)
    registered.set(font.id, face)
  } catch {
    // File font hỏng / định dạng lạ → bỏ qua. Dropdown vẫn liệt kê nhưng terminal sẽ
    // rơi về monospace; UI có cờ `brokenIds` để nói thẳng chứ không im lặng.
    brokenIds.add(font.id)
  }
}

/** Id các font đăng ký thất bại — UI dùng để cảnh báo. */
const brokenIds = new Set<string>()

function unregister(id: string): void {
  const face = registered.get(id)
  if (face) {
    document.fonts.delete(face)
    registered.delete(id)
  }
  brokenIds.delete(id)
}

interface FontsState {
  /** Tên họ font đọc được từ thư mục font của hệ điều hành. */
  system: string[]
  custom: CustomFontDto[]
  /** true = quét hệ thống không ra font nào (UI phải chỉ user dùng ô nhập tay). */
  scanFailed: boolean
  loading: boolean
  loaded: boolean
  /** Id font đăng ký thất bại (file hỏng). */
  broken: string[]
  load: () => Promise<void>
  /** Quét lại thư mục font — dùng sau khi user vừa cài font mới mà không muốn mở lại app. */
  rescan: () => Promise<void>
  add: (file: File) => Promise<FontAddResultDto>
  rename: (id: string, family: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useFontsStore = create<FontsState>((set, get) => ({
  system: [],
  custom: [],
  scanFailed: false,
  loading: false,
  loaded: false,
  broken: [],
  load: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const list = await window.infra.fonts.list()
      for (const f of list.custom) await registerFont(f)
      set({ system: list.system, custom: list.custom, scanFailed: list.scanFailed, loaded: true, broken: [...brokenIds] })
    } catch {
      set({ scanFailed: true, loaded: true })
    } finally {
      set({ loading: false })
    }
  },
  rescan: async () => {
    set({ loading: true })
    try {
      const list = await window.infra.fonts.rescan()
      for (const f of list.custom) await registerFont(f)
      set({ system: list.system, custom: list.custom, scanFailed: list.scanFailed, broken: [...brokenIds] })
    } catch {
      /* giữ danh sách cũ — quét lại thất bại không nên xoá thứ đang dùng được */
    } finally {
      set({ loading: false })
    }
  },
  add: async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const res = await window.infra.fonts.add(file.name, bytes)
    if (res.ok) {
      await registerFont(res.font)
      set({ custom: [...get().custom, res.font], broken: [...brokenIds] })
    }
    return res
  },
  rename: async (id, family) => {
    const name = family.trim()
    if (!name) return
    // Cập nhật store trước để ô nhập không bị giật, IPC xác nhận sau
    const next = get().custom.map((f) => (f.id === id ? { ...f, family: name } : f))
    set({ custom: next })
    const hit = next.find((f) => f.id === id)
    if (hit) await registerFont(hit)
    await window.infra.fonts.rename(id, name)
    set({ broken: [...brokenIds] })
  },
  remove: async (id) => {
    await window.infra.fonts.remove(id)
    unregister(id)
    set({ custom: get().custom.filter((f) => f.id !== id), broken: [...brokenIds] })
  }
}))
