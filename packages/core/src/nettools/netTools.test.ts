import { describe, expect, test } from 'vitest'
import { normalizeImageUrl } from './netTools'

describe('normalizeImageUrl', () => {
  test('Google Drive: link xem file/d/<id> → link tải trực tiếp', () => {
    expect(normalizeImageUrl('https://drive.google.com/file/d/ABC123/view?usp=sharing')).toBe(
      'https://drive.google.com/uc?export=download&id=ABC123'
    )
  })

  test('Google Drive: link open?id=<id> → link tải trực tiếp', () => {
    expect(normalizeImageUrl('https://drive.google.com/open?id=XYZ789')).toBe(
      'https://drive.google.com/uc?export=download&id=XYZ789'
    )
  })

  test('Dropbox: dl=0 → dl=1', () => {
    expect(normalizeImageUrl('https://www.dropbox.com/s/abc/pic.jpg?dl=0')).toBe(
      'https://www.dropbox.com/s/abc/pic.jpg?dl=1'
    )
  })

  test('Dropbox: thiếu dl → thêm dl=1', () => {
    expect(normalizeImageUrl('https://www.dropbox.com/s/abc/pic.jpg')).toBe(
      'https://www.dropbox.com/s/abc/pic.jpg?dl=1'
    )
  })

  test('Dropbox: đã có dl=1 → giữ nguyên', () => {
    const url = 'https://www.dropbox.com/s/abc/pic.jpg?dl=1'
    expect(normalizeImageUrl(url)).toBe(url)
  })

  test('URL ảnh trực tiếp thông thường → giữ nguyên (chỉ trim)', () => {
    expect(normalizeImageUrl('  https://example.com/wallpaper.png  ')).toBe('https://example.com/wallpaper.png')
  })
})
