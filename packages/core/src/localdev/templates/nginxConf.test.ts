import { describe, expect, test } from 'vitest'
import { renderNginxConf, renderSiteConf, upstreamName, type NginxConfModel, type NginxSiteModel } from './nginxConf'

const BASE: NginxConfModel = {
  nginxRoot: 'D:\\infra\\runtimes\\nginx-1.28',
  prefix: 'D:\\infra\\localdev\\run\\nginx-prefix',
  confDir: 'D:\\infra\\localdev\\conf\\nginx',
  logDir: 'D:\\infra\\localdev\\logs',
  runDir: 'D:\\infra\\localdev\\run',
  tempDir: 'D:\\infra\\localdev\\tmp\\nginx',
  phpUpstreams: [{ name: 'php_8_3', ports: [9000, 9001, 9002, 9003] }]
}

const SITE: NginxSiteModel = {
  domain: 'demo.localhost',
  docRoot: 'D:\\www\\demo',
  httpPort: 8081,
  phpUpstream: 'php_8_3',
  fastcgiParams: 'D:\\infra\\runtimes\\nginx-1.28\\conf\\fastcgi_params',
  logDir: 'D:\\infra\\localdev\\sites\\demo\\logs',
  indexFiles: ['index.php', 'index.html'],
  tryFilesFallback: '/index.php?$query_string'
}

describe('upstreamName', () => {
  test('sinh tên hợp lệ cho nginx từ id runtime', () => {
    expect(upstreamName('php-8.3')).toBe('php_8_3')
    expect(upstreamName('php-8.4')).toBe('php_8_4')
    expect(/^[A-Za-z0-9_]+$/.test(upstreamName('php-8.3'))).toBe(true)
  })
})

describe('renderNginxConf', () => {
  const out = renderNginxConf(BASE)

  test('worker_processes = 1 (nginx Windows dùng select)', () => {
    expect(out).toContain('worker_processes 1;')
  })

  test('mọi đường dẫn đều forward slash + quote, KHÔNG còn backslash', () => {
    // Backslash trong config nginx là ký tự escape → còn sót là hỏng config
    const paths = out.match(/"[^"]*"/g) ?? []
    expect(paths.length).toBeGreaterThan(5)
    for (const p of paths) expect(p, p).not.toMatch(/\\(?!")/)
  })

  test('include mime.types theo ĐÚNG runtime đang dùng', () => {
    expect(out).toContain('include "D:/infra/runtimes/nginx-1.28/conf/mime.types";')
  })

  test('khai báo đủ 5 temp path (nếu thiếu nginx ghi vào runtimes/ đang read-only)', () => {
    for (const key of [
      'client_body_temp_path',
      'proxy_temp_path',
      'fastcgi_temp_path',
      'uwsgi_temp_path',
      'scgi_temp_path'
    ]) {
      expect(out, key).toContain(key)
    }
  })

  test('upstream có đủ mọi cổng của pool php', () => {
    expect(out).toContain('upstream php_8_3 {')
    for (const p of [9000, 9001, 9002, 9003]) expect(out).toContain(`server 127.0.0.1:${p};`)
  })

  test('có default_server trả 444 để Host lạ không rơi vào site đầu tiên', () => {
    expect(out).toContain('default_server')
    expect(out).toContain('return 444;')
  })

  test('include sites/ TRƯỚC extra/ để user override thắng', () => {
    const iSites = out.indexOf('/sites/*.conf')
    const iExtra = out.indexOf('/extra/*.conf')
    expect(iSites).toBeGreaterThan(0)
    expect(iExtra).toBeGreaterThan(iSites)
  })

  test('từ chối tên upstream không hợp lệ', () => {
    expect(() => renderNginxConf({ ...BASE, phpUpstreams: [{ name: 'php-8.3', ports: [9000] }] })).toThrow()
  })

  test('từ chối cổng không hợp lệ', () => {
    expect(() => renderNginxConf({ ...BASE, phpUpstreams: [{ name: 'php_8_3', ports: [0] }] })).toThrow()
  })

  test('path có dấu cách vẫn sinh được config quote đúng', () => {
    const out2 = renderNginxConf({ ...BASE, logDir: 'C:\\Program Files\\Infra Companion\\logs' })
    expect(out2).toContain('"C:/Program Files/Infra Companion/logs/nginx-error.log"')
  })
})

describe('renderSiteConf', () => {
  const out = renderSiteConf(SITE)

  test('listen CẢ IPv4 và IPv6 (localhost trên Windows hay resolve ::1 trước)', () => {
    expect(out).toContain('listen 127.0.0.1:8081;')
    expect(out).toContain('listen [::1]:8081;')
  })

  test('server_name gồm cả alias', () => {
    const o = renderSiteConf({ ...SITE, aliases: ['demo.test'] })
    expect(o).toContain('server_name demo.localhost demo.test;')
  })

  test('block PHP có try_files chặn thực thi qua path-info', () => {
    // Không có dòng này thì cgi.fix_pathinfo=1 cho phép /up/evil.jpg/x.php chạy được
    const php = out.slice(out.indexOf('location ~ \\.php$'))
    expect(php).toContain('try_files $uri =404;')
    expect(php).toContain('fastcgi_pass php_8_3;')
    expect(php).toContain('SCRIPT_FILENAME $document_root$fastcgi_script_name;')
    expect(php).toContain('include "D:/infra/runtimes/nginx-1.28/conf/fastcgi_params";')
  })

  test('site tĩnh: không có block PHP và không cần fastcgiParams', () => {
    const o = renderSiteConf({
      ...SITE,
      phpUpstream: null,
      fastcgiParams: undefined,
      indexFiles: ['index.html'],
      tryFilesFallback: null
    })
    expect(o).not.toContain('fastcgi_pass')
    expect(o).toContain('try_files $uri $uri/ =404;')
  })

  test('site PHP mà thiếu fastcgiParams thì THROW (thay vì sinh config hỏng)', () => {
    expect(() => renderSiteConf({ ...SITE, fastcgiParams: undefined })).toThrow(/fastcgiParams/)
  })

  test('CHẶN domain injection — không cho ghi thêm directive vào config', () => {
    expect(() => renderSiteConf({ ...SITE, domain: 'a.test;\n  root /etc;' })).toThrow()
    expect(() => renderSiteConf({ ...SITE, aliases: ['ok.test', 'bad .test'] })).toThrow()
  })

  test('từ chối cổng ngoài khoảng', () => {
    expect(() => renderSiteConf({ ...SITE, httpPort: 70_000 })).toThrow()
  })

  test('docRoot có dấu cách được quote', () => {
    const o = renderSiteConf({ ...SITE, docRoot: 'C:\\My Sites\\demo' })
    expect(o).toContain('root "C:/My Sites/demo";')
  })
})
