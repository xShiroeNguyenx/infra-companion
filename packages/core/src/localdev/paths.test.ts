import { resolve, sep } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  isSafeToDeleteRecursive,
  localDevPaths,
  runtimeDir,
  runtimeScopedPath,
  scopedPath,
  siteDir
} from './paths'

const ROOT = resolve('X:', 'infra-root')
const P = localDevPaths(ROOT)

describe('localDevPaths', () => {
  test('mọi thư mục nằm dưới root', () => {
    for (const [key, value] of Object.entries(P)) {
      if (key === 'root') continue
      expect(value.startsWith(ROOT + sep), `${key} = ${value}`).toBe(true)
    }
  })

  test('tách runtimes (read-only) khỏi localdev (state của user)', () => {
    // Nâng version runtime không được làm mất config/DB/site của user
    expect(P.runtimes.startsWith(P.localdev)).toBe(false)
    expect(P.localdev.startsWith(P.runtimes)).toBe(false)
    for (const p of [P.db, P.conf, P.logs, P.certs, P.sites, P.dataMariadb]) {
      expect(p.startsWith(P.localdev + sep)).toBe(true)
    }
  })

  test('datadir MariaDB KHÔNG nằm trong runtimes', () => {
    // Nếu nằm trong runtimes thì gỡ/nâng runtime là xoá sạch database của user
    expect(P.dataMariadb.startsWith(P.runtimes)).toBe(false)
  })

  test('nginx extra (user sửa tay) tách khỏi sites (app sinh ra)', () => {
    expect(P.confNginxExtra).not.toBe(P.confNginxSites)
    expect(P.confNginxSites.startsWith(P.confNginx + sep)).toBe(true)
    expect(P.confNginxExtra.startsWith(P.confNginx + sep)).toBe(true)
  })

  test('runtimesTmp nằm trong runtimes (dọn 1 lần là sạch)', () => {
    expect(P.runtimesTmp.startsWith(P.runtimes + sep)).toBe(true)
  })
})

describe('scopedPath', () => {
  const base = resolve('X:', 'base')

  test('cho phép đường dẫn nhiều cấp (khác pluginScopedPath)', () => {
    expect(scopedPath(base, 'bin/php.exe')).toBe(resolve(base, 'bin', 'php.exe'))
    expect(scopedPath(base, 'wp-content/themes/x/style.css')).toBe(
      resolve(base, 'wp-content', 'themes', 'x', 'style.css')
    )
  })

  test('chặn traversal bằng ..', () => {
    expect(scopedPath(base, '..')).toBeNull()
    expect(scopedPath(base, '../evil')).toBeNull()
    expect(scopedPath(base, 'a/../../evil')).toBeNull()
    expect(scopedPath(base, 'a\\..\\..\\evil')).toBeNull()
  })

  test('chặn đường dẫn tuyệt đối', () => {
    expect(scopedPath(base, resolve('X:', 'other', 'evil.exe'))).toBeNull()
    expect(scopedPath(base, '/etc/passwd')).toBeNull()
  })

  test('chặn rỗng', () => {
    expect(scopedPath(base, '')).toBeNull()
  })

  test('không bị lừa bởi prefix trùng tên (base-evil vs base)', () => {
    // resolve('X:/base', '../base-evil/x') phải bị loại vì không nằm trong 'X:/base'
    expect(scopedPath(base, '../base-evil/x')).toBeNull()
  })
})

describe('runtimeScopedPath / runtimeDir', () => {
  test('id hợp lệ có dấu chấm và gạch ngang', () => {
    expect(runtimeDir(P, 'php-8.3')).toBe(resolve(P.runtimes, 'php-8.3'))
    expect(runtimeScopedPath(P, 'php-8.3', 'php-cgi.exe')).toBe(resolve(P.runtimes, 'php-8.3', 'php-cgi.exe'))
    expect(runtimeScopedPath(P, 'mariadb-11.4', 'bin/mariadbd.exe')).toBe(
      resolve(P.runtimes, 'mariadb-11.4', 'bin', 'mariadbd.exe')
    )
  })

  test('loại id không hợp lệ', () => {
    for (const bad of ['../evil', 'PHP-8.3', 'php 8.3', 'php/8.3', 'php\\8.3', '', '-php', 'php-']) {
      expect(runtimeDir(P, bad), bad).toBeNull()
      expect(runtimeScopedPath(P, bad, 'php.exe'), bad).toBeNull()
    }
  })

  test('id hợp lệ nhưng relPath thoát ra ngoài vẫn bị loại', () => {
    expect(runtimeScopedPath(P, 'php-8.3', '../../evil.exe')).toBeNull()
  })
})

describe('siteDir', () => {
  test('slug hợp lệ', () => {
    expect(siteDir(P, 'my-shop')).toBe(resolve(P.sites, 'my-shop'))
  })
  test('loại slug không hợp lệ', () => {
    for (const bad of ['../x', 'My-Shop', 'a b', '']) expect(siteDir(P, bad), bad).toBeNull()
  })
})

describe('isSafeToDeleteRecursive', () => {
  const sites = P.sites

  test('cho xoá thư mục con thật sự', () => {
    expect(isSafeToDeleteRecursive(resolve(sites, 'my-shop'), sites)).toBe(true)
    expect(isSafeToDeleteRecursive(resolve(sites, 'my-shop', 'app'), sites)).toBe(true)
  })

  test('KHÔNG cho xoá chính root', () => {
    expect(isSafeToDeleteRecursive(sites, sites)).toBe(false)
  })

  test('KHÔNG cho xoá path ngoài root', () => {
    expect(isSafeToDeleteRecursive(resolve('X:', 'other'), sites)).toBe(false)
    expect(isSafeToDeleteRecursive(resolve(sites, '..', 'evil'), sites)).toBe(false)
  })

  test('KHÔNG cho xoá gốc ổ đĩa', () => {
    expect(isSafeToDeleteRecursive(resolve('X:', sep), sites)).toBe(false)
    expect(isSafeToDeleteRecursive('/', sites)).toBe(false)
  })

  test('KHÔNG cho khi thiếu tham số', () => {
    expect(isSafeToDeleteRecursive('', sites)).toBe(false)
    expect(isSafeToDeleteRecursive(resolve(sites, 'x'), '')).toBe(false)
  })

  test('không bị lừa bởi prefix trùng tên', () => {
    // '<sites>-evil' KHÔNG nằm trong '<sites>' dù chuỗi có cùng tiền tố
    expect(isSafeToDeleteRecursive(sites + '-evil', sites)).toBe(false)
  })
})
