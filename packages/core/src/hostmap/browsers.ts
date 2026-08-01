import { win32 } from 'node:path'

/**
 * Dò browser Chromium đã cài trên máy (Chrome/Edge/Brave/Vivaldi) — chỉ những browser này hiểu
 * cờ `--host-resolver-rules` mà tính năng HostMap dựa vào (xem `hostMap.ts`).
 *
 * Dò theo ĐƯỜNG DẪN CHUẨN chứ không đọc registry: registry của browser nằm ở nhiều nhánh
 * (HKLM/HKCU, `StartMenuInternet`, `App Paths`) và mỗi hãng ghi một kiểu, còn thư mục cài thì
 * gần như không đổi qua các bản. Dò sai đường dẫn cũng vô hại: app chỉ mất 1 dòng trong danh
 * sách chọn, và user luôn có ô "đường dẫn tuỳ chọn".
 *
 * THUẦN theo nghĩa: env + hàm `exists` được inject ⇒ test không cần cài browser thật.
 *
 * Ghép đường dẫn bằng `win32.join` chứ KHÔNG phải `join` của nền tảng đang chạy: đây là đường
 * dẫn Windows (`%ProgramFiles%`, `.exe`) nên phải luôn dùng `\` — dùng `join` thì cùng một input
 * sẽ ra `C:\Program Files/Google\Chrome\...` khi chạy trên Linux/macOS (CI build 3 OS đã đỏ
 * đúng vì lý do này), và hàm mất tính xác định giữa các nền tảng.
 */

/** Gốc thư mục cài — tên biến môi trường khác nhau giữa 32/64-bit và per-user. */
export type BrowserBase = 'programFiles' | 'programFilesX86' | 'localAppData'

export interface BrowserCandidate {
  id: string
  name: string
  /** Các vị trí có thể có, thử theo thứ tự. */
  paths: ReadonlyArray<{ base: BrowserBase; rel: string }>
}

export interface DetectedBrowser {
  id: string
  name: string
  exe: string
}

export interface BrowserEnv {
  programFiles?: string | undefined
  programFilesX86?: string | undefined
  localAppData?: string | undefined
}

export const CHROMIUM_BROWSERS: readonly BrowserCandidate[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    paths: [
      { base: 'programFiles', rel: 'Google\\Chrome\\Application\\chrome.exe' },
      { base: 'programFilesX86', rel: 'Google\\Chrome\\Application\\chrome.exe' },
      { base: 'localAppData', rel: 'Google\\Chrome\\Application\\chrome.exe' }
    ]
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    paths: [
      // Edge 64-bit vẫn cài vào Program Files (x86) trên đa số máy — thử cả hai
      { base: 'programFilesX86', rel: 'Microsoft\\Edge\\Application\\msedge.exe' },
      { base: 'programFiles', rel: 'Microsoft\\Edge\\Application\\msedge.exe' }
    ]
  },
  {
    id: 'brave',
    name: 'Brave',
    paths: [
      { base: 'programFiles', rel: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
      { base: 'programFilesX86', rel: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
      { base: 'localAppData', rel: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe' }
    ]
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    paths: [
      { base: 'localAppData', rel: 'Vivaldi\\Application\\vivaldi.exe' },
      { base: 'programFiles', rel: 'Vivaldi\\Application\\vivaldi.exe' }
    ]
  }
]

/** Danh sách browser Chromium tìm thấy, theo thứ tự trong `CHROMIUM_BROWSERS`. */
export async function detectChromiumBrowsers(
  env: BrowserEnv,
  exists: (p: string) => Promise<boolean>
): Promise<DetectedBrowser[]> {
  const out: DetectedBrowser[] = []
  for (const cand of CHROMIUM_BROWSERS) {
    for (const p of cand.paths) {
      const base = env[p.base]
      if (base === undefined || base === '') continue
      const exe = win32.join(base, p.rel)
      if (await exists(exe)) {
        out.push({ id: cand.id, name: cand.name, exe })
        break // mỗi browser chỉ lấy 1 vị trí đầu tiên tìm thấy
      }
    }
  }
  return out
}
