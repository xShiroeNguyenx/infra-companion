import { describe, expect, it } from 'vitest'
import { chooseLocalForwardRoute } from './TunnelService'
import { loginScriptEntersAnotherHost } from './loginScript'

const SSH_STEP = [{ send: 'ssh jpap06' }, { send: 'pw', secret: true }]
const SU_ONLY = [{ send: 'sudo -i' }]

describe('loginScriptEntersAnotherHost', () => {
  it('không có bước nào → false', () => {
    expect(loginScriptEntersAnotherHost([])).toBe(false)
  })

  it('chỉ su/sudo → false (máy sâu chính là endpoint SSH)', () => {
    expect(loginScriptEntersAnotherHost(SU_ONLY)).toBe(false)
    expect(loginScriptEntersAnotherHost([{ send: 'su - admin' }, { send: 'pw', secret: true }])).toBe(false)
  })

  it('có hop ssh → true', () => {
    expect(loginScriptEntersAnotherHost(SSH_STEP)).toBe(true)
    expect(loginScriptEntersAnotherHost([{ send: 'sudo -i' }, { send: 'ssh 10.0.0.5' }])).toBe(true)
  })
})

describe('chooseLocalForwardRoute', () => {
  it('không login script → native', () => {
    expect(chooseLocalForwardRoute('192.168.1.71', [])).toBe('native')
    expect(chooseLocalForwardRoute('127.0.0.1', [])).toBe('native')
  })

  it('login script chỉ su/sudo → native (cùng máy với endpoint SSH)', () => {
    expect(chooseLocalForwardRoute('192.168.1.71', SU_ONLY)).toBe('native')
  })

  it('hop ssh + đích cụ thể → nc trên máy sâu TRƯỚC, native là đường lui', () => {
    // Regression v0.1.31→v0.1.33: native-first khiến gate mở kết nối sang mạng của GATE
    // (192.168.x.x trùng dải) hoặc bị firewall drop SYN → tunnel xanh mà DB client chờ mãi.
    expect(chooseLocalForwardRoute('192.168.1.71', SSH_STEP)).toBe('script-then-native')
    expect(chooseLocalForwardRoute('db-internal', SSH_STEP)).toBe('script-then-native')
  })

  it('hop ssh + đích loopback → chỉ nc (localhost là của MÁY SÂU, không có đường lui)', () => {
    expect(chooseLocalForwardRoute('127.0.0.1', SSH_STEP)).toBe('script')
    expect(chooseLocalForwardRoute('localhost', SSH_STEP)).toBe('script')
    expect(chooseLocalForwardRoute('::1', SSH_STEP)).toBe('script')
  })

  it('đích không nhúng an toàn vào lệnh shell được → native', () => {
    expect(chooseLocalForwardRoute('db; rm -rf /', SSH_STEP)).toBe('native')
    expect(chooseLocalForwardRoute('$(whoami)', SSH_STEP)).toBe('native')
  })
})
