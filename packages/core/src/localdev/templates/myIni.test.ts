import { describe, expect, test } from 'vitest'
import { MARIADB_BIN_CANDIDATES, renderClientCnf, renderMyIni, type MyIniModel } from './myIni'

const M: MyIniModel = {
  basedir: 'D:\\infra\\runtimes\\mariadb-11.4',
  datadir: 'D:\\infra\\localdev\\data\\mariadb',
  tmpdir: 'D:\\infra\\localdev\\tmp\\mariadb',
  logError: 'D:\\infra\\localdev\\logs\\mariadb.log',
  port: 3307
}

describe('renderMyIni', () => {
  const out = renderMyIni(M)

  test('path forward slash + quote, không còn backslash', () => {
    expect(out).toContain('basedir = "D:/infra/runtimes/mariadb-11.4"')
    expect(out).toContain('datadir = "D:/infra/localdev/data/mariadb"')
    for (const m of out.match(/"[^"]*"/g) ?? []) expect(m, m).not.toContain('\\')
  })

  test('CHỈ nghe loopback — DB local không được phơi ra LAN', () => {
    expect(out).toContain('bind_address = 127.0.0.1')
  })

  test('cổng theo tham số (mặc định 3307 để không đụng MySQL/XAMPP ở 3306)', () => {
    expect(out).toContain('port = 3307')
  })

  test('utf8mb4 cho cả server (WordPress cần emoji/tiếng Việt)', () => {
    expect(out).toContain('character_set_server = utf8mb4')
    expect(out).toContain('collation_server = utf8mb4_general_ci')
  })

  test('max_allowed_packet lớn — import dump WordPress hay vượt mặc định', () => {
    expect(out).toContain('max_allowed_packet = 256M')
  })

  test('innodb_flush_method = normal (Windows không hỗ trợ O_DIRECT đầy đủ)', () => {
    expect(out).toContain('innodb_flush_method = normal')
  })

  test('có [client] để CLI nối đúng cổng mà không cần truyền tay', () => {
    expect(out).toContain('[client]')
    const clientBlock = out.slice(out.indexOf('[client]'))
    expect(clientBlock).toContain('port = 3307')
    expect(clientBlock).toContain('protocol = tcp')
  })

  test('buffer pool cấu hình được', () => {
    expect(renderMyIni({ ...M, innodbBufferPool: '512M' })).toContain('innodb_buffer_pool_size = 512M')
  })

  test('từ chối cổng không hợp lệ', () => {
    expect(() => renderMyIni({ ...M, port: 0 })).toThrow()
    expect(() => renderMyIni({ ...M, port: 70_000 })).toThrow()
  })

  test('path có dấu cách vẫn quote đúng', () => {
    const o = renderMyIni({ ...M, datadir: 'C:\\Program Files\\Infra\\data' })
    expect(o).toContain('datadir = "C:/Program Files/Infra/data"')
  })

  test('datadir KHÔNG được nằm trong basedir (gỡ runtime là mất sạch DB) — kiểm ở mức dữ liệu', () => {
    // Đây là bất biến của caller (ManagedStackProvider), test này chốt kỳ vọng
    expect(M.datadir.startsWith(M.basedir)).toBe(false)
  })
})

describe('renderClientCnf', () => {
  test('chứa credential để KHÔNG phải truyền -p trên command line', () => {
    // -p<pass> hiện trong Task Manager / wmic → mọi process trên máy đọc được
    const out = renderClientCnf({ port: 3307, user: 'root', password: 'S3cret!' })
    expect(out).toContain('[client]')
    expect(out).toContain('port = 3307')
    expect(out).toContain('user = root')
    expect(out).toContain('password = S3cret!')
  })

  test('luôn đi qua TCP loopback', () => {
    const out = renderClientCnf({ port: 3307, user: 'root', password: 'x' })
    expect(out).toContain('host = 127.0.0.1')
    expect(out).toContain('protocol = tcp')
  })
})

describe('MARIADB_BIN_CANDIDATES', () => {
  test('ưu tiên tên mariadb-* trước mysql-* (MariaDB ≥11 đã bỏ dần alias mysql)', () => {
    expect(MARIADB_BIN_CANDIDATES.client[0]).toBe('bin/mariadb.exe')
    expect(MARIADB_BIN_CANDIDATES.server[0]).toBe('bin/mariadbd.exe')
    expect(MARIADB_BIN_CANDIDATES.dump[0]).toBe('bin/mariadb-dump.exe')
    expect(MARIADB_BIN_CANDIDATES.admin[0]).toBe('bin/mariadb-admin.exe')
    expect(MARIADB_BIN_CANDIDATES.installDb[0]).toBe('bin/mariadb-install-db.exe')
  })

  test('vẫn có fallback tên cũ cho bản MariaDB thấp hơn', () => {
    for (const list of Object.values(MARIADB_BIN_CANDIDATES)) {
      expect(list.length).toBeGreaterThanOrEqual(2)
      expect(list.some((p) => p.includes('mysql'))).toBe(true)
    }
  })
})
