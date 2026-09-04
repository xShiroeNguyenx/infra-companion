import { describe, expect, test } from 'vitest'
import { awsUriEncode, sha256Hex, signAwsRequest } from './awsSig'

/** sha256('') — hằng nổi tiếng, dùng cho body rỗng. */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/**
 * Vector CHÍNH THỨC từ docs AWS "Authenticating Requests (AWS Signature Version 4)" —
 * ví dụ GET object của examplebucket. Khớp vector này = thuật toán đúng từng byte.
 */
const EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
  date: new Date('2013-05-24T00:00:00Z')
}

describe('signAwsRequest — vector chính thức của AWS (S3 GET object)', () => {
  test('canonical request và chữ ký khớp docs', () => {
    const signed = signAwsRequest({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
      ...EXAMPLE
    })

    expect(signed.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        '',
        'host:examplebucket.s3.amazonaws.com',
        'range:bytes=0-9',
        `x-amz-content-sha256:${EMPTY_SHA256}`,
        'x-amz-date:20130524T000000Z',
        '',
        'host;range;x-amz-content-sha256;x-amz-date',
        EMPTY_SHA256
      ].join('\n')
    )
    // Chữ ký kỳ vọng ghi NGUYÊN VĂN trong docs AWS cho ví dụ này
    expect(signed.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
    expect(signed.headers['x-amz-date']).toBe('20130524T000000Z')
  })

  test('query được encode + sắp xếp theo key (ví dụ list objects của docs)', () => {
    const signed = signAwsRequest({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/',
      query: { prefix: 'J', 'max-keys': '2' },
      payloadHash: EMPTY_SHA256,
      ...EXAMPLE
    })
    expect(signed.queryString).toBe('max-keys=2&prefix=J')
    expect(signed.headers.Authorization).toContain(
      'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7'
    )
  })
})

describe('awsUriEncode', () => {
  test("encode cả !'()* và giữ '/' khi keepSlash", () => {
    expect(awsUriEncode("a b!'()*")).toBe('a%20b%21%27%28%29%2A')
    expect(awsUriEncode('a/b c', true)).toBe('a/b%20c')
    expect(awsUriEncode('a/b')).toBe('a%2Fb')
  })
})

describe('sha256Hex', () => {
  test('chuỗi rỗng ra đúng hằng quen thuộc', () => {
    expect(sha256Hex('')).toBe(EMPTY_SHA256)
  })
})
