import { describe, expect, test } from 'vitest'
import {
  decodeXmlEntities,
  normalizeS3Prefix,
  parseS3ListKeys,
  s3KeyBasename,
  s3ListUrl,
  s3ObjectUrl
} from './s3Api'
import { PROPFIND_BODY, parsePropfindNames, webdavJoin } from './webdavApi'

describe('S3 URL', () => {
  const target = { endpoint: 'https://s3.example.net:9000', bucket: 'my-bucket', prefix: 'backup/infra' }

  test('path-style, prefix tự thêm /, key được encode nhưng giữ /', () => {
    expect(s3ObjectUrl(target, 'infra-companion-vault.blob')).toEqual({
      host: 's3.example.net:9000',
      path: '/my-bucket/backup/infra/infra-companion-vault.blob'
    })
  })

  test('endpoint có path con (MinIO sau reverse proxy) không bị nuốt', () => {
    expect(s3ObjectUrl({ ...target, endpoint: 'https://s3.example.net/minio/' }, 'x.blob').path).toBe(
      '/minio/my-bucket/backup/infra/x.blob'
    )
  })

  test('list: query prefix ghép từ prefix kênh + stem', () => {
    const list = s3ListUrl(target, 'infra-companion-vault')
    expect(list.query).toEqual({ 'list-type': '2', prefix: 'backup/infra/infra-companion-vault', 'max-keys': '100' })
    expect(list.path).toBe('/my-bucket')
  })

  test('normalizeS3Prefix: rỗng giữ rỗng, có gì thì luôn kết thúc bằng /', () => {
    expect(normalizeS3Prefix('')).toBe('')
    expect(normalizeS3Prefix('  ')).toBe('')
    expect(normalizeS3Prefix('/a/b')).toBe('a/b/')
    expect(normalizeS3Prefix('a/b/')).toBe('a/b/')
  })
})

describe('parseS3ListKeys', () => {
  test('đọc mọi <Key>, decode entity', () => {
    const xml =
      '<?xml version="1.0"?><ListBucketResult><Contents><Key>backup/infra-companion-vault.blob</Key></Contents>' +
      '<Contents><Key>backup/infra-companion-vault (1).blob</Key></Contents>' +
      '<Contents><Key>a&amp;b.txt</Key></Contents></ListBucketResult>'
    expect(parseS3ListKeys(xml)).toEqual([
      'backup/infra-companion-vault.blob',
      'backup/infra-companion-vault (1).blob',
      'a&b.txt'
    ])
  })

  test('XML không có Contents → rỗng', () => {
    expect(parseS3ListKeys('<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>')).toEqual([])
  })

  test('s3KeyBasename bỏ đúng prefix của kênh', () => {
    expect(s3KeyBasename('backup/infra/x.blob', 'backup/infra')).toBe('x.blob')
    expect(s3KeyBasename('khac/x.blob', 'backup/infra')).toBe('khac/x.blob')
  })
})

describe('WebDAV', () => {
  test('webdavJoin: không nhân đôi /, encode tên file', () => {
    expect(webdavJoin('https://dav.example.net/sync/', 'infra-companion-vault.blob')).toBe(
      'https://dav.example.net/sync/infra-companion-vault.blob'
    )
    expect(webdavJoin('https://dav.example.net/sync', 'a b.blob')).toBe('https://dav.example.net/sync/a%20b.blob')
  })

  test('PROPFIND body là XML một dòng hỏi displayname', () => {
    expect(PROPFIND_BODY).toContain('propfind')
    expect(PROPFIND_BODY).toContain('displayname')
  })

  test('parsePropfindNames: lấy basename từ href, bỏ entry thư mục, decode percent-encoding', () => {
    const xml =
      '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
      '<D:response><D:href>/remote.php/dav/files/deploy/sync/</D:href></D:response>' +
      '<D:response><D:href>/remote.php/dav/files/deploy/sync/infra-companion-vault.blob</D:href></D:response>' +
      '<D:response><D:href>/sync/infra-companion-vault%20(1).blob</D:href></D:response>' +
      '</D:multistatus>'
    expect(parsePropfindNames(xml)).toEqual(['infra-companion-vault.blob', 'infra-companion-vault (1).blob'])
  })

  test('namespace prefix khác (d:, lp1:, không prefix) vẫn đọc được', () => {
    expect(parsePropfindNames('<d:href>/a/x.blob</d:href>')).toEqual(['x.blob'])
    expect(parsePropfindNames('<href>/a/y.blob</href>')).toEqual(['y.blob'])
  })
})

describe('decodeXmlEntities', () => {
  test('decode 5 entity chuẩn, &amp; sau cùng để không decode kép', () => {
    expect(decodeXmlEntities('a&amp;lt;b')).toBe('a&lt;b')
    expect(decodeXmlEntities('&lt;x&gt; &quot;y&quot; &apos;z&apos;')).toBe(`<x> "y" 'z'`)
  })
})
