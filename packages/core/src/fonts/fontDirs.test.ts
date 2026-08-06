import { describe, expect, it } from 'vitest'
import { buildFontStack, primaryFontFamily, quoteFontFamily, systemFontDirs } from './fontDirs'

describe('systemFontDirs', () => {
  // Test này là LƯỚI AN TOÀN cho bài học v0.2.0: ghép path Windows bằng `join` của nền tảng
  // đang chạy làm 2 job CI (macOS/Linux) đỏ ở bước Test và release thiếu installer.
  it('Windows: dùng dấu gạch chéo ngược KỂ CẢ khi test chạy trên Linux/macOS', () => {
    const dirs = systemFontDirs('win32', { WINDIR: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, '/home/me')
    expect(dirs[0]).toBe('C:\\Windows\\Fonts')
    expect(dirs[1]).toBe('C:\\Users\\me\\AppData\\Local\\Microsoft\\Windows\\Fonts')
    expect(dirs.join('|')).not.toContain('/')
  })

  it('Windows: thiếu WINDIR thì dùng C:\\Windows; thiếu LOCALAPPDATA thì bỏ thư mục per-user', () => {
    const dirs = systemFontDirs('win32', {}, '/home/me')
    expect(dirs).toEqual(['C:\\Windows\\Fonts'])
  })

  it('macOS: có cả thư mục hệ thống, Supplemental và của user', () => {
    const dirs = systemFontDirs('darwin', {}, '/Users/me')
    expect(dirs).toContain('/System/Library/Fonts')
    expect(dirs).toContain('/System/Library/Fonts/Supplemental')
    expect(dirs).toContain('/Users/me/Library/Fonts')
  })

  it('Linux: có cả ~/.local/share/fonts và ~/.fonts', () => {
    const dirs = systemFontDirs('linux', {}, '/home/me')
    expect(dirs).toContain('/usr/share/fonts')
    expect(dirs).toContain('/home/me/.local/share/fonts')
    expect(dirs).toContain('/home/me/.fonts')
  })
})

describe('quoteFontFamily', () => {
  it('tên một từ để trần, tên có khoảng trắng thì bọc nháy', () => {
    expect(quoteFontFamily('Consolas')).toBe('Consolas')
    expect(quoteFontFamily('Cascadia Mono')).toBe('"Cascadia Mono"')
  })

  it('bỏ nháy kép có sẵn trong tên để không phá cú pháp CSS', () => {
    expect(quoteFontFamily('Weird"Name')).toBe('"WeirdName"')
  })

  it('tên bắt đầu bằng số phải bọc nháy (định danh CSS không cho)', () => {
    expect(quoteFontFamily('3270Medium')).toBe('"3270Medium"')
  })
})

describe('buildFontStack', () => {
  it('luôn có monospace làm lưới an toàn', () => {
    expect(buildFontStack('Cascadia Mono')).toBe('"Cascadia Mono", monospace')
    expect(buildFontStack('Consolas')).toBe('Consolas, monospace')
  })

  it('tên rỗng → chỉ monospace', () => {
    expect(buildFontStack('')).toBe('monospace')
    expect(buildFontStack('   ')).toBe('monospace')
  })
})

describe('primaryFontFamily', () => {
  it('lấy mục đầu của stack và bỏ nháy', () => {
    expect(primaryFontFamily('"Cascadia Mono", "Cascadia Code", Consolas, monospace')).toBe('Cascadia Mono')
    expect(primaryFontFamily('Consolas, monospace')).toBe('Consolas')
    expect(primaryFontFamily("'Fira Code', monospace")).toBe('Fira Code')
  })

  it('chuỗi rỗng hoặc chỉ khoảng trắng → rỗng', () => {
    expect(primaryFontFamily('')).toBe('')
    expect(primaryFontFamily('   ')).toBe('')
  })

  it('đi vòng được với buildFontStack', () => {
    for (const name of ['Cascadia Mono', 'Consolas', 'JetBrains Mono', 'Phông Việt']) {
      expect(primaryFontFamily(buildFontStack(name))).toBe(name)
    }
  })
})
