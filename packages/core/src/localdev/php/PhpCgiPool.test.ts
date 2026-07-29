import { describe, expect, test } from 'vitest'
import { PhpCgiPool } from './PhpCgiPool'
import type { PhpPoolInput } from './PhpBackend'

const INPUT: PhpPoolInput = {
  runtimeId: 'php-8.3',
  phpCgiExe: 'D:\\rt\\runtimes\\php-8.3\\php-cgi.exe',
  iniFile: 'D:\\rt\\localdev\\conf\\php\\php-8.3\\php.ini',
  cwd: 'D:\\rt\\runtimes\\php-8.3',
  logFile: 'D:\\rt\\localdev\\logs\\php-8.3.log',
  ports: [9000, 9001, 9002, 9003],
  tmpDir: 'D:\\rt\\localdev\\tmp\\php-8.3',
  pathEntries: ['D:\\rt\\runtimes\\php-8.3']
}

describe('PhpCgiPool', () => {
  const pool = new PhpCgiPool(INPUT.ports)
  const specs = pool.buildSpecs(INPUT)

  test('1 spec cho MỖI cổng (Windows không có fork nên phải nhiều process)', () => {
    expect(specs).toHaveLength(4)
    expect(specs.map((s) => s.id)).toEqual(['php-8.3#0', 'php-8.3#1', 'php-8.3#2', 'php-8.3#3'])
  })

  test('mọi worker cùng groupId để start/stop cả pool 1 lệnh', () => {
    expect(new Set(specs.map((s) => s.groupId))).toEqual(new Set(['php-8.3']))
  })

  test('args: -c <php.ini> -b 127.0.0.1:<port> (mỗi worker 1 cổng riêng)', () => {
    expect(specs[0]!.args).toEqual(['-c', INPUT.iniFile, '-b', '127.0.0.1:9000'])
    expect(specs[3]!.args).toEqual(['-c', INPUT.iniFile, '-b', '127.0.0.1:9003'])
  })

  test('CẠM BẪY 1: PHP_FCGI_MAX_REQUESTS=0 — mặc định 500 làm worker tự chết giữa lúc phục vụ', () => {
    for (const s of specs) expect(s.env.PHP_FCGI_MAX_REQUESTS).toBe('0')
  })

  test('lưới an toàn: restartOnCleanExit=true (php-cgi thoát code 0 là bình thường)', () => {
    for (const s of specs) expect(s.restartOnCleanExit).toBe(true)
  })

  test('env TRẮNG: chỉ PATH/SystemRoot/TEMP/TMP + biến php — không kế thừa process.env', () => {
    const keys = Object.keys(specs[0]!.env).sort()
    expect(keys).toEqual(['PATH', 'PHP_FCGI_MAX_REQUESTS', 'SystemRoot', 'TEMP', 'TMP'])
    // Không được rò token AI/AWS của app sang process con
    expect(specs[0]!.env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
  })

  test('PATH có thư mục runtime để php tìm DLL nằm cạnh nó (ICU cho ext intl)', () => {
    expect(specs[0]!.env.PATH).toContain('runtimes\\php-8.3')
  })

  test('TEMP/TMP trỏ thư mục riêng của app, không phải C:\\Windows\\Temp', () => {
    expect(specs[0]!.env.TEMP).toBe(INPUT.tmpDir)
    expect(specs[0]!.env.TMP).toBe(INPUT.tmpDir)
  })

  test('healthPort = đúng cổng của worker đó', () => {
    expect(specs.map((s) => s.healthPort)).toEqual([9000, 9001, 9002, 9003])
  })

  test('upstream name hợp lệ cho nginx', () => {
    expect(pool.upstream('php-8.3')).toBe('php_8_3')
    expect(/^[A-Za-z0-9_]+$/.test(pool.upstream('php-8.3'))).toBe(true)
  })

  test('ports() trả bản copy (không cho sửa state bên trong)', () => {
    const p = pool.ports()
    p.push(9999)
    expect(pool.ports()).toHaveLength(4)
  })

  test('pool 1 worker vẫn dựng được (nhưng đây là cấu hình dễ deadlock — xem doc)', () => {
    const one = new PhpCgiPool([9000]).buildSpecs({ ...INPUT, ports: [9000] })
    expect(one).toHaveLength(1)
    expect(one[0]!.id).toBe('php-8.3#0')
  })

  test('label dễ đọc cho UI', () => {
    expect(specs[0]!.label).toBe('PHP 8.3 · worker 1')
  })
})
