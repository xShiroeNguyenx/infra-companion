import { app } from 'electron'
import { spawn } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildChromiumArgs, detectChromiumBrowsers, type DetectedBrowser } from '@infra/core'

/**
 * Mở 1 cửa sổ browser Chromium có DNS override (`--host-resolver-rules`).
 *
 * Dùng CHUNG cho 2 tính năng: HostMap (trỏ domain sang server thật) và Local dev (mở site local
 * bằng URL không có `:port`). Trước đây code này chỉ nằm trong `ipc/hostmap.ts`; tách ra để hai
 * nơi không có 2 bản logic khác nhau về cùng một cơ chế (nhất là chi tiết `--user-data-dir`
 * BẮT BUỘC — thiếu nó thì browser đang mở sẽ bỏ qua cờ resolver, xem `hostMap.ts`).
 */

async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false
  )
}

/** Browser Chromium tìm thấy trên máy (thứ tự: Chrome → Edge → Brave → Vivaldi). */
export async function detectBrowsers(): Promise<DetectedBrowser[]> {
  return detectChromiumBrowsers(
    {
      programFiles: process.env['ProgramFiles'],
      programFilesX86: process.env['ProgramFiles(x86)'],
      localAppData: process.env['LOCALAPPDATA']
    },
    exists
  )
}

/** Gốc thư mục profile browser do app sinh. Mỗi (nhóm/site, đích) một profile. */
export function browserProfilesRoot(): string {
  return join(app.getPath('userData'), 'hostmap-profiles')
}

/** Id đi qua IPC có thể là chuỗi bất kỳ mà lại thành ĐƯỜNG DẪN → lọc ký tự. */
export function browserProfileDir(...parts: string[]): string {
  const safe = parts.map((s) => s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'x')
  return join(browserProfilesRoot(), safe.join('-'))
}

export interface MappedOpenInput {
  /** Giá trị cho --host-resolver-rules, dựng bằng `buildHostResolverRules`. */
  rules: string
  /** URL http/https muốn mở. */
  url: string
  /** Thư mục profile riêng (xem `browserProfileDir`). */
  profileDir: string
  /** Browser cụ thể; bỏ trống = lấy cái đầu tiên tìm thấy. */
  browser?: DetectedBrowser
}

/**
 * Spawn browser TÁCH HẲN khỏi app: `detached` + `unref` để đóng app không giết cửa sổ browser,
 * `stdio: 'ignore'` để pipe của browser không giữ tiến trình app sống.
 */
export async function openMappedBrowser(input: MappedOpenInput): Promise<{ ok: boolean; error?: string }> {
  const browser = input.browser ?? (await detectBrowsers())[0]
  if (!browser) {
    return {
      ok: false,
      error: 'Không tìm thấy Chrome/Edge/Brave/Vivaldi trên máy — cách này cần browser Chromium.'
    }
  }
  try {
    await mkdir(browserProfilesRoot(), { recursive: true })
    const args = buildChromiumArgs({ rules: input.rules, profileDir: input.profileDir, url: input.url })
    const child = spawn(browser.exe, args, { detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', (e) => {
      console.error('[browser] cannot launch:', e.message)
    })
    child.unref()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
