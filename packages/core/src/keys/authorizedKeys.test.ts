import { describe, expect, test } from 'vitest'
import {
  appendAuthorizedKeyCommand,
  authorizedKeysHas,
  planCopyId,
  publicKeyIdentity,
  readAuthorizedKeysCommand
} from './authorizedKeys'

// Blob bịa, KHÔNG phải key thật — chỉ cần đúng hình dạng `<type> <base64> <comment>`
const BLOB = 'AAAAC3NzaC1lZDI1NTE5AAAAILLDeMoKeyBlobForTestsOnly0000000000000'
const LINE = `ssh-ed25519 ${BLOB} deploy@app-01`

describe('publicKeyIdentity', () => {
  test('bỏ comment, giữ type + blob', () => {
    expect(publicKeyIdentity(LINE)).toBe(`ssh-ed25519 ${BLOB}`)
  })

  test('không có comment vẫn nhận', () => {
    expect(publicKeyIdentity(`ssh-rsa ${BLOB}`)).toBe(`ssh-rsa ${BLOB}`)
  })

  test('nhận cả ecdsa và sk- (hardware key)', () => {
    expect(publicKeyIdentity(`ecdsa-sha2-nistp256 ${BLOB}`)).not.toBeNull()
    expect(publicKeyIdentity(`sk-ssh-ed25519@openssh.com ${BLOB}`)).not.toBeNull()
  })

  test('dòng rác → null', () => {
    expect(publicKeyIdentity('')).toBeNull()
    expect(publicKeyIdentity('khong-phai-key')).toBeNull()
    expect(publicKeyIdentity('# comment')).toBeNull()
  })
})

describe('authorizedKeysHas', () => {
  test('cùng key nhưng KHÁC COMMENT vẫn tính là đã có', () => {
    // Không so cả dòng: bấm lại từ máy khác (comment đổi) sẽ ghi trùng mỗi lần
    expect(authorizedKeysHas(`ssh-ed25519 ${BLOB} deploy@may-cu`, LINE)).toBe(true)
  })

  test('file có nhiều key, key mình nằm giữa', () => {
    const content = `ssh-rsa AAAAsomethingelse a@b\n${LINE}\nssh-rsa AAAAanother c@d\n`
    expect(authorizedKeysHas(content, LINE)).toBe(true)
  })

  test('key khác → false', () => {
    expect(authorizedKeysHas(`ssh-ed25519 AAAAdifferentblob x@y`, LINE)).toBe(false)
  })

  test('file rỗng / chỉ có dòng trống → false', () => {
    expect(authorizedKeysHas('', LINE)).toBe(false)
    expect(authorizedKeysHas('\n\n  \n', LINE)).toBe(false)
  })

  test('dòng bị comment out KHÔNG tính là đã có', () => {
    expect(authorizedKeysHas(`# ${LINE}`, LINE)).toBe(false)
  })

  test('key cần đẩy mà rác thì không bao giờ báo "đã có"', () => {
    expect(authorizedKeysHas(`ssh-ed25519 ${BLOB} x`, 'rac')).toBe(false)
  })
})

describe('planCopyId', () => {
  test('chưa có → added, đã có → already-present', () => {
    expect(planCopyId('', LINE)).toBe('added')
    expect(planCopyId(LINE, LINE)).toBe('already-present')
  })
})

describe('lệnh shell', () => {
  test('lệnh đọc có chmod 700/600 — thiếu thì sshd im lặng từ chối', () => {
    const cmd = readAuthorizedKeysCommand()
    expect(cmd).toContain('chmod 700 ~/.ssh')
    expect(cmd).toContain('chmod 600 ~/.ssh/authorized_keys')
    expect(cmd).toContain('cat ~/.ssh/authorized_keys')
  })

  test('KHÔNG dùng $(…), backtick hay heredoc — mỗi hop login-script bóc mất một lớp quote', () => {
    for (const cmd of [readAuthorizedKeysCommand(), appendAuthorizedKeyCommand(LINE)]) {
      expect(cmd).not.toContain('$(')
      expect(cmd).not.toContain('`')
      expect(cmd).not.toContain('<<')
    }
  })

  test('append bọc nháy đơn và trung hoà được nháy đơn trong nội dung', () => {
    const cmd = appendAuthorizedKeyCommand(`ssh-ed25519 ${BLOB} it's-me`)
    expect(cmd).toContain(`'\\''`)
    expect(cmd.startsWith("printf '%s\\n' '")).toBe(true)
  })

  test('append cắt khoảng trắng thừa để không ghi dòng lệch', () => {
    expect(appendAuthorizedKeyCommand(`  ${LINE}  `)).toContain(`'${LINE}'`)
  })
})
