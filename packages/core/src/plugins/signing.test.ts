import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import type { RegistryPluginEntry } from './registry'
import { pluginSigningPayload, signPluginEntry, verifyPluginEntry } from './signing'

function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  }
}

const entry: RegistryPluginEntry = {
  id: 'hello-world',
  name: 'Hello World',
  version: '1.0.0',
  description: null,
  author: null,
  files: [
    { name: 'manifest.json', url: 'https://x.com/m.json', sha256: 'a'.repeat(64) },
    { name: 'index.js', url: 'https://x.com/i.js', sha256: 'b'.repeat(64) }
  ],
  signature: null
}

describe('ký số entry marketplace (ed25519)', () => {
  test('ký rồi verify → true; đổi bất kỳ thành phần nào → false', () => {
    const { pub, priv } = makeKeys()
    const signed = { ...entry, signature: signPluginEntry(entry, priv) }
    expect(verifyPluginEntry(signed, pub)).toBe(true)

    // Đổi version
    expect(verifyPluginEntry({ ...signed, version: '1.0.1' }, pub)).toBe(false)
    // Đổi checksum 1 file (kịch bản CDN bị thay file + registry sửa sha256 nhưng giữ chữ ký)
    const tampered = {
      ...signed,
      files: [signed.files[0]!, { ...signed.files[1]!, sha256: 'c'.repeat(64) }]
    }
    expect(verifyPluginEntry(tampered, pub)).toBe(false)
    // Thêm file
    expect(
      verifyPluginEntry(
        { ...signed, files: [...signed.files, { name: 'extra.js', url: 'https://x.com/e.js', sha256: 'd'.repeat(64) }] },
        pub
      )
    ).toBe(false)
  })

  test('payload không phụ thuộc thứ tự files trong JSON (sort theo tên)', () => {
    const swapped = { ...entry, files: [entry.files[1]!, entry.files[0]!] }
    expect(pluginSigningPayload(swapped).equals(pluginSigningPayload(entry))).toBe(true)
  })

  test('khóa khác → false; thiếu/sai định dạng chữ ký → false, không throw', () => {
    const a = makeKeys()
    const b = makeKeys()
    const signed = { ...entry, signature: signPluginEntry(entry, a.priv) }
    expect(verifyPluginEntry(signed, b.pub)).toBe(false)
    expect(verifyPluginEntry({ ...entry, signature: null }, a.pub)).toBe(false)
    expect(verifyPluginEntry({ ...entry, signature: 'không-phải-base64!!' }, a.pub)).toBe(false)
    expect(verifyPluginEntry(signed, 'PEM rác')).toBe(false)
  })

  test('URL không nằm trong payload — đổi mirror không làm hỏng chữ ký (chủ ý: sha256 mới là danh tính file)', () => {
    const { pub, priv } = makeKeys()
    const signed = { ...entry, signature: signPluginEntry(entry, priv) }
    const mirrored = {
      ...signed,
      files: signed.files.map((f) => ({ ...f, url: `https://mirror.example.com/${f.name}` }))
    }
    expect(verifyPluginEntry(mirrored, pub)).toBe(true)
  })
})
