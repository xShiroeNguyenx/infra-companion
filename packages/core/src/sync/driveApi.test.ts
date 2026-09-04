import { describe, expect, test } from 'vitest'
import {
  buildDriveListByNameUrl,
  buildDriveListContainsUrl,
  buildMultipartUpload,
  driveEscapeQuery,
  parseDriveFileList
} from './driveApi'

describe('driveEscapeQuery', () => {
  test("escape ' và \\ — tên file chứa nháy đơn không phá được query", () => {
    expect(driveEscapeQuery("infra's file")).toBe("infra\\'s file")
    expect(driveEscapeQuery('a\\b')).toBe('a\\\\b')
    expect(driveEscapeQuery('infra-companion-vault.blob')).toBe('infra-companion-vault.blob')
  })
})

describe('buildDriveList*Url', () => {
  test('tìm đúng tên: q = name = ... and trashed = false, có fields id/name', () => {
    const url = new URL(buildDriveListByNameUrl('infra-companion-vault.blob'))
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files')
    expect(url.searchParams.get('q')).toBe("name = 'infra-companion-vault.blob' and trashed = false")
    expect(url.searchParams.get('fields')).toBe('files(id,name)')
  })

  test('tìm gần giống: name contains — cho listNearMisses', () => {
    const url = new URL(buildDriveListContainsUrl('infra-companion-vault'))
    expect(url.searchParams.get('q')).toBe("name contains 'infra-companion-vault' and trashed = false")
  })
})

describe('parseDriveFileList', () => {
  test('đọc id + name, bỏ entry thiếu trường thay vì hỏng cả danh sách', () => {
    const parsed = parseDriveFileList({
      files: [{ id: 'f1', name: 'infra-companion-vault.blob' }, { id: 42 }, null, { name: 'x' }]
    })
    expect(parsed).toEqual({ ok: true, files: [{ id: 'f1', name: 'infra-companion-vault.blob' }] })
  })

  test('files rỗng là hợp lệ (Drive chưa có gì) — khác với phản hồi sai dạng', () => {
    expect(parseDriveFileList({ files: [] })).toEqual({ ok: true, files: [] })
    expect(parseDriveFileList({}).ok).toBe(false)
    expect(parseDriveFileList(null).ok).toBe(false)
    expect(parseDriveFileList({ files: 'x' }).ok).toBe(false)
  })
})

describe('buildMultipartUpload', () => {
  test('đúng khung multipart/related: metadata JSON + nội dung + boundary đóng', () => {
    const { body, contentType } = buildMultipartUpload('BOUND', { name: 'infra-companion-vault.blob' }, 'salt|payload')
    expect(contentType).toBe('multipart/related; boundary=BOUND')
    // Thứ tự phần: metadata trước, content sau, kết bằng --BOUND--
    expect(body).toMatch(/^--BOUND\r\n/)
    expect(body).toContain('Content-Type: application/json; charset=UTF-8')
    expect(body).toContain('{"name":"infra-companion-vault.blob"}')
    expect(body).toContain('salt|payload')
    expect(body.trimEnd().endsWith('--BOUND--')).toBe(true)
    // CRLF thuần — multipart tách phần bằng \r\n, lẫn \n trần là server từ chối
    expect(body.includes('\n')).toBe(true)
    expect(body.replaceAll('\r\n', '').includes('\n')).toBe(false)
  })
})
