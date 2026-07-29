import { describe, expect, test } from 'vitest'
import { renderCmdShim } from './cmdShim'

const OUT = renderCmdShim({
  phpExe: 'D:\\infra\\runtimes\\php-8.3\\php.exe',
  iniFile: 'D:\\infra\\conf\\php\\php-8.3\\php.ini',
  phar: 'D:\\infra\\runtimes\\composer-2.10\\composer.phar'
})

describe('renderCmdShim', () => {
  test('gọi php.exe của app với ĐÚNG php.ini đã sinh (ini rỗng ⇒ Composer chết vì thiếu openssl/zip)', () => {
    expect(OUT).toContain('"D:\\infra\\runtimes\\php-8.3\\php.exe" -c "D:\\infra\\conf\\php\\php-8.3\\php.ini"')
  })

  test('mọi path đều được bọc nháy (thư mục người dùng rất hay có dấu cách)', () => {
    const cmdLine = OUT.split('\r\n').find((l) => l.includes('php.exe'))!
    expect(cmdLine.match(/"/g)?.length).toBe(6)
  })

  test('%* chứ không %1 %2 — giữ nguyên toàn bộ tham số kể cả có dấu cách', () => {
    expect(OUT).toContain('%*')
    expect(OUT).not.toContain('%1')
  })

  test('trả đúng exit code (thiếu thì script CI của user luôn thấy thành công)', () => {
    expect(OUT.trimEnd().endsWith('exit /b %ERRORLEVEL%')).toBe(true)
  })

  test('CRLF — file .cmd dùng LF có thể bị cmd.exe hiểu sai dòng cuối', () => {
    expect(OUT).toContain('\r\n')
    expect(OUT.startsWith('@echo off\r\n')).toBe(true)
  })
})
