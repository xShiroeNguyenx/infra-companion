/**
 * Đọc/ghi khối cấu hình database trong `wp-config.php`. THUẦN → golden-string test.
 *
 * Đây là file QUAN TRỌNG NHẤT của một site WordPress: nó chứa salt, prefix bảng, và mọi hằng
 * số người dùng tự thêm. Nguyên tắc bất biến của module này:
 *
 *  1. **Chỉ thay 4 dòng `define` của DB**, giữ nguyên byte-for-byte mọi thứ khác — kể cả
 *     comment, thứ tự, khoảng trắng, CRLF và BOM. TUYỆT ĐỐI không sinh lại file từ template:
 *     làm vậy là xoá cấu hình user tự thêm (WP_DEBUG, plugin constants, memory limit…).
 *  2. Không tìm được `define` nào cho một hằng số ⇒ CHÈN THÊM, không im lặng bỏ qua.
 *  3. Giá trị được escape để không bao giờ thoát ra khỏi literal PHP.
 */

/** 4 hằng số DB mà WordPress đọc. */
export const WP_DB_CONSTANTS = ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST'] as const
export type WpDbConstant = (typeof WP_DB_CONSTANTS)[number]

export interface WpDbConfig {
  dbName: string
  dbUser: string
  dbPassword: string
  /** 'host' hoặc 'host:port' — WordPress tự tách cổng sau dấu hai chấm. */
  dbHost: string
}

/**
 * Regex 1 dòng `define`. Bắt cả 4 biến thể ngoài đời:
 *   define('DB_NAME', 'x');            define( "DB_NAME", "x" );
 *   define('DB_NAME','x') ;            define ('DB_NAME', 'x');
 * Nhóm: 1=phần mở đầu tới dấu nháy mở của giá trị · 2=giá trị · 3=phần đuôi.
 */
function defineRe(name: string): RegExp {
  return new RegExp(
    // mở đầu: define ( 'NAME' , <quote>
    `(define\\s*\\(\\s*(['"])${name}\\2\\s*,\\s*(['"]))` +
      // giá trị: cho phép ký tự escape \' và \\
      `((?:\\\\.|(?!\\3)[^\\\\])*)` +
      // đuôi: <quote> ) ;
      `(\\3\\s*\\))`,
    'g'
  )
}

/** Escape giá trị để nhúng vào literal PHP nháy đơn: chỉ `\` và `'` có ý nghĩa. */
export function phpSingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Giải escape giá trị đọc ra từ literal nháy đơn. */
function unescapeSingle(value: string): string {
  return value.replace(/\\(['\\])/g, '$1')
}

/** Đọc giá trị 1 hằng số (null = không có dòng define nào cho nó). */
export function readDefine(text: string, name: string): string | null {
  const m = defineRe(name).exec(text)
  return m ? unescapeSingle(m[4] ?? '') : null
}

/** Đọc cả 4 hằng số DB — dùng để hiện "hiện tại đang trỏ vào đâu" trước khi ghi. */
export function readWpDbConfig(text: string): Partial<WpDbConfig> {
  const out: Partial<WpDbConfig> = {}
  const name = readDefine(text, 'DB_NAME')
  const user = readDefine(text, 'DB_USER')
  const pass = readDefine(text, 'DB_PASSWORD')
  const host = readDefine(text, 'DB_HOST')
  if (name !== null) out.dbName = name
  if (user !== null) out.dbUser = user
  if (pass !== null) out.dbPassword = pass
  if (host !== null) out.dbHost = host
  return out
}

/**
 * Thay giá trị 1 hằng số, GIỮ NGUYÊN kiểu nháy và khoảng trắng gốc.
 * Trả `{ text, replaced }` — `replaced=0` nghĩa là chưa có dòng nào, caller phải chèn.
 */
export function replaceDefine(text: string, name: string, value: string): { text: string; replaced: number } {
  let replaced = 0
  const out = text.replace(defineRe(name), (_all, head: string, _q1: string, q: string, _old: string, tail: string) => {
    replaced += 1
    // Nháy đôi trong PHP nội suy `$` và `\` → dùng escape của nháy đơn thì có thể sai.
    // Đơn giản và luôn đúng: giữ đúng loại nháy gốc nhưng escape theo loại đó.
    const escaped = q === "'" ? phpSingleQuoted(value) : value.replace(/\\/g, '\\\\').replace(/(["$])/g, '\\$1')
    return `${head}${escaped}${tail}`
  })
  return { text: out, replaced }
}

/** Dòng define chuẩn để chèn khi file thiếu hằng số đó. */
function defineLine(name: string, value: string): string {
  return `define( '${name}', '${phpSingleQuoted(value)}' );`
}

/**
 * Chèn các dòng define còn thiếu.
 *
 * Vị trí chèn: NGAY TRƯỚC `$table_prefix` nếu có (WordPress đặt khối DB ở trên đó), nếu không
 * thì trước mốc `That's all, stop editing`, cuối cùng mới là sau `<?php`. Chèn sai chỗ vẫn chạy
 * (PHP không quan tâm thứ tự) nhưng đặt đúng chỗ để file còn đọc được như bản gốc.
 */
function insertDefines(text: string, lines: string[], eol: string): string {
  if (lines.length === 0) return text
  const block = lines.join(eol) + eol
  const prefixIdx = /^[^\S\r\n]*\$table_prefix\s*=/m.exec(text)?.index
  if (prefixIdx !== undefined) return text.slice(0, prefixIdx) + block + text.slice(prefixIdx)

  const stopIdx = /^[^\S\r\n]*\/\*.*stop editing/im.exec(text)?.index
  if (stopIdx !== undefined) return text.slice(0, stopIdx) + block + text.slice(stopIdx)

  const openIdx = text.indexOf('<?php')
  if (openIdx >= 0) {
    const after = openIdx + '<?php'.length
    return text.slice(0, after) + eol + block + text.slice(after)
  }
  return block + text
}

/** Đoán ký tự xuống dòng đang dùng — giữ nguyên để git không báo đổi cả file. */
export function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

export interface ApplyWpDbResult {
  text: string
  /** Hằng số đã thay giá trị. */
  replaced: WpDbConstant[]
  /** Hằng số chưa có trong file nên phải chèn thêm. */
  inserted: WpDbConstant[]
}

/**
 * Ghi 4 hằng số DB vào nội dung `wp-config.php`. Idempotent: chạy lại trên kết quả của chính
 * nó cho ra đúng cùng một chuỗi.
 */
export function applyWpDbConfig(text: string, cfg: WpDbConfig): ApplyWpDbResult {
  const eol = detectEol(text)
  const values: Record<WpDbConstant, string> = {
    DB_NAME: cfg.dbName,
    DB_USER: cfg.dbUser,
    DB_PASSWORD: cfg.dbPassword,
    DB_HOST: cfg.dbHost
  }
  let out = text
  const replaced: WpDbConstant[] = []
  const missing: WpDbConstant[] = []
  for (const name of WP_DB_CONSTANTS) {
    const res = replaceDefine(out, name, values[name])
    out = res.text
    if (res.replaced > 0) replaced.push(name)
    else missing.push(name)
  }
  out = insertDefines(
    out,
    missing.map((n) => defineLine(n, values[n])),
    eol
  )
  return { text: out, replaced, inserted: missing }
}

/**
 * `DB_HOST` cho MariaDB do app quản.
 *
 * Dùng `127.0.0.1:<port>` chứ KHÔNG `localhost`: trên Windows, driver mysql của PHP hiểu
 * `localhost` là "thử named pipe / cổng mặc định 3306" và bỏ qua cổng ta chỉ định — nên site
 * sẽ đi tìm MySQL của XAMPP ở 3306 thay vì MariaDB của app.
 */
export function wpDbHost(port: number): string {
  return `127.0.0.1:${String(port)}`
}

/** File này có phải wp-config.php của WordPress? (chống ghi vào file trùng tên) */
export function looksLikeWpConfig(text: string): boolean {
  return /\$table_prefix\s*=/.test(text) || /define\s*\(\s*(['"])DB_NAME\1/.test(text)
}
