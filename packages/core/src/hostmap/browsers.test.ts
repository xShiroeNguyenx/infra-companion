import { describe, expect, test } from 'vitest'
import { CHROMIUM_BROWSERS, detectChromiumBrowsers } from './browsers'

const ENV = {
  programFiles: 'C:\\Program Files',
  programFilesX86: 'C:\\Program Files (x86)',
  localAppData: 'C:\\Users\\me\\AppData\\Local'
}

const existsIn =
  (present: readonly string[]) =>
  (p: string): Promise<boolean> =>
    Promise.resolve(present.includes(p))

describe('detectChromiumBrowsers', () => {
  test('tìm được Chrome ở Program Files', async () => {
    const found = await detectChromiumBrowsers(
      ENV,
      existsIn(['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'])
    )
    expect(found).toEqual([
      { id: 'chrome', name: 'Google Chrome', exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }
    ])
  })

  test('Chrome cài per-user (LOCALAPPDATA) vẫn tìm ra — rất phổ biến ở máy không có quyền admin', async () => {
    const found = await detectChromiumBrowsers(
      ENV,
      existsIn(['C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'])
    )
    expect(found.map((b) => b.id)).toEqual(['chrome'])
  })

  test('mỗi browser chỉ trả 1 vị trí, dù có mặt ở nhiều nơi', async () => {
    const found = await detectChromiumBrowsers(
      ENV,
      existsIn([
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
      ])
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.exe).toContain('Program Files\\Google')
  })

  test('Edge thử Program Files (x86) TRƯỚC — đa số máy Edge nằm ở đó', async () => {
    const found = await detectChromiumBrowsers(
      ENV,
      existsIn([
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      ])
    )
    expect(found[0]!.exe).toBe('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
  })

  test('không có browser nào ⇒ danh sách rỗng (UI phải nói "chưa tìm thấy" chứ không im lặng)', async () => {
    expect(await detectChromiumBrowsers(ENV, existsIn([]))).toEqual([])
  })

  test('env thiếu biến (máy không có ProgramFiles(x86)) thì bỏ qua, không ghép path rỗng', async () => {
    const found = await detectChromiumBrowsers(
      { programFiles: 'C:\\Program Files' },
      existsIn(['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'])
    )
    expect(found.map((b) => b.id)).toEqual(['edge'])
  })

  test('id browser không trùng nhau (id là khoá user chọn, lưu vào cấu hình)', () => {
    const ids = CHROMIUM_BROWSERS.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
