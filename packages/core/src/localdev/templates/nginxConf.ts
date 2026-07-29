import { assertSafeDomain, assertSafePort, nginxPath, toFwd } from './escape'

/**
 * Sinh nginx.conf + file vhost mỗi site. Thuần → golden-string test.
 *
 * NGUYÊN TẮC BẤT BIẾN: config THAM CHIẾU đường dẫn tuyệt đối vào runtimes/<id>/ (vd
 * include mime.types). Nâng nginx 1.28 → 1.30 làm đường dẫn đó chết ⇒ **config phải là kết
 * quả SUY DẪN, regenerate mỗi lần start**, user chỉ sửa ở conf/nginx/extra/ (include sau cùng).
 */

export interface NginxUpstream {
  /** Tên upstream trong nginx (chỉ [A-Za-z0-9_]) — sinh từ id runtime php. */
  name: string
  /** Các cổng của pool php-cgi (mỗi process 1 cổng — Windows không có php-fpm). */
  ports: number[]
}

export interface NginxConfModel {
  /** Thư mục runtime nginx (để include mime.types / fastcgi_params của đúng version). */
  nginxRoot: string
  /** Thư mục prefix chạy nginx (-p): phải writable cho logs/ + temp/. */
  prefix: string
  confDir: string
  logDir: string
  runDir: string
  tempDir: string
  phpUpstreams: NginxUpstream[]
}

const UPSTREAM_RE = /^[A-Za-z0-9_]+$/

/** Tên upstream an toàn từ id runtime: 'php-8.3' → 'php_8_3'. */
export function upstreamName(runtimeId: string): string {
  return `php_${runtimeId.replace(/^php-/, '').replace(/[^A-Za-z0-9]/g, '_')}`
}

export function renderNginxConf(m: NginxConfModel): string {
  for (const u of m.phpUpstreams) {
    if (!UPSTREAM_RE.test(u.name)) throw new Error(`Tên upstream không hợp lệ: ${u.name}`)
    for (const p of u.ports) assertSafePort(p)
  }
  const L: string[] = []
  L.push('# File này do Infra Companion SINH RA — mọi thay đổi sẽ bị ghi đè.')
  L.push('# Muốn thêm cấu hình riêng: đặt file .conf trong conf/nginx/extra/ (được include cuối cùng).')
  L.push('')
  // nginx trên Windows dùng select() → nhiều worker không phân phối tải tốt; local dev thừa dùng 1.
  L.push('worker_processes 1;')
  L.push(`error_log ${nginxPath(`${toFwd(m.logDir)}/nginx-error.log`)} warn;`)
  L.push(`pid ${nginxPath(`${toFwd(m.runDir)}/nginx.pid`)};`)
  L.push('')
  L.push('events {')
  L.push('    worker_connections 1024;')
  L.push('}')
  L.push('')
  L.push('http {')
  L.push(`    include ${nginxPath(`${toFwd(m.nginxRoot)}/conf/mime.types`)};`)
  L.push('    default_type application/octet-stream;')
  L.push(`    access_log ${nginxPath(`${toFwd(m.logDir)}/nginx-access.log`)};`)
  L.push('    sendfile off;') // sendfile trên Windows + file đang sửa hay trả nội dung cũ
  L.push('    tcp_nodelay on;')
  L.push('    keepalive_timeout 65;')
  L.push('    client_max_body_size 256M;')
  L.push('    server_names_hash_bucket_size 128;')
  L.push('')
  // Khai báo tường minh mọi temp path: nếu không, nginx cố ghi vào runtimes/ (đang coi read-only)
  L.push(`    client_body_temp_path ${nginxPath(`${toFwd(m.tempDir)}/client_body`)};`)
  L.push(`    proxy_temp_path ${nginxPath(`${toFwd(m.tempDir)}/proxy`)};`)
  L.push(`    fastcgi_temp_path ${nginxPath(`${toFwd(m.tempDir)}/fastcgi`)};`)
  L.push(`    uwsgi_temp_path ${nginxPath(`${toFwd(m.tempDir)}/uwsgi`)};`)
  L.push(`    scgi_temp_path ${nginxPath(`${toFwd(m.tempDir)}/scgi`)};`)
  L.push('')
  for (const u of m.phpUpstreams) {
    L.push(`    upstream ${u.name} {`)
    for (const p of u.ports) L.push(`        server 127.0.0.1:${p};`)
    L.push('    }')
    L.push('')
  }
  // Chặn request tới domain lạ (Host header không khớp site nào) — tránh rơi vào site đầu tiên
  L.push('    server {')
  L.push('        listen 127.0.0.1:80 default_server;')
  L.push('        server_name _;')
  L.push('        return 444;')
  L.push('    }')
  L.push('')
  L.push(`    include ${nginxPath(`${toFwd(m.confDir)}/sites/*.conf`)};`)
  L.push(`    include ${nginxPath(`${toFwd(m.confDir)}/extra/*.conf`)};`)
  L.push('}')
  L.push('')
  return L.join('\n')
}

export interface NginxSiteModel {
  domain: string
  /** Domain phụ cũng trỏ về site này (vd cả .localhost lẫn .test). */
  aliases?: string[]
  docRoot: string
  httpPort: number
  /** Tên upstream php; null = site tĩnh (không chạy PHP). */
  phpUpstream: string | null
  /** Đường dẫn conf/fastcgi_params của ĐÚNG version nginx đang dùng (chỉ cần khi có PHP). */
  fastcgiParams?: string
  logDir: string
  indexFiles: string[]
  /** Laravel/WordPress: '/index.php?$query_string'; site tĩnh: null. */
  tryFilesFallback: string | null
}

export function renderSiteConf(s: NginxSiteModel): string {
  assertSafeDomain(s.domain)
  for (const a of s.aliases ?? []) assertSafeDomain(a)
  assertSafePort(s.httpPort)
  if (s.phpUpstream !== null && !UPSTREAM_RE.test(s.phpUpstream)) {
    throw new Error(`Tên upstream không hợp lệ: ${s.phpUpstream}`)
  }
  const names = [s.domain, ...(s.aliases ?? [])].join(' ')
  const L: string[] = []
  L.push(`# ${s.domain} — do Infra Companion sinh ra, sẽ bị ghi đè.`)
  L.push('server {')
  L.push(`    listen 127.0.0.1:${s.httpPort};`)
  // Thiếu dòng ::1 là nguyên nhân lỗi "không vào được" khó hiểu nhất: 'localhost' trên
  // Windows thường resolve ra ::1 TRƯỚC 127.0.0.1.
  L.push(`    listen [::1]:${s.httpPort};`)
  L.push(`    server_name ${names};`)
  L.push(`    root ${nginxPath(s.docRoot)};`)
  L.push(`    index ${s.indexFiles.join(' ')};`)
  L.push(`    access_log ${nginxPath(`${toFwd(s.logDir)}/access.log`)};`)
  L.push(`    error_log ${nginxPath(`${toFwd(s.logDir)}/error.log`)};`)
  L.push('    charset utf-8;')
  L.push('')
  L.push('    location / {')
  L.push(`        try_files $uri $uri/ ${s.tryFilesFallback ?? '=404'};`)
  L.push('    }')
  if (s.phpUpstream) {
    if (!s.fastcgiParams) throw new Error('Site có PHP phải cấp fastcgiParams (conf/fastcgi_params của nginx)')
    L.push('')
    L.push('    location ~ \\.php$ {')
    // BẮT BUỘC: không có dòng này thì cgi.fix_pathinfo=1 mở đường thực thi file tuỳ ý qua
    // path-info (vd /uploads/evil.jpg/x.php). Local nhưng vẫn giữ.
    L.push('        try_files $uri =404;')
    L.push(`        include ${nginxPath(s.fastcgiParams)};`)
    L.push(`        fastcgi_pass ${s.phpUpstream};`)
    L.push('        fastcgi_index index.php;')
    L.push('        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;')
    // Cần dài để debugger step-through không bị nginx cắt giữa phiên
    L.push('        fastcgi_read_timeout 300s;')
    L.push('    }')
  }
  L.push('}')
  L.push('')
  return L.join('\n')
}
