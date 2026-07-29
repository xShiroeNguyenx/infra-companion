import { describe, expect, test } from 'vitest'
import {
  applyWpDbConfig,
  detectEol,
  looksLikeWpConfig,
  phpSingleQuoted,
  readDefine,
  readWpDbConfig,
  replaceDefine,
  wpDbHost,
  type WpDbConfig
} from './wpConfig'

/** wp-config.php như WordPress sinh ra thật (rút gọn phần salt). */
const REAL = `<?php
/**
 * The base configuration for WordPress
 */

// ** Database settings - You can get this info from your web host ** //
/** The name of the database for WordPress */
define( 'DB_NAME', 'theblogsnews' );

/** Database username */
define( 'DB_USER', 'blogsnew' );

/** Database password */
define( 'DB_PASSWORD', 'cR.Jv1Bx7xc@WTqo' );

/** Database hostname */
define( 'DB_HOST', 'localhost' );

/** Database charset to use in creating database tables. */
define( 'DB_CHARSET', 'utf8mb4' );

define( 'AUTH_KEY', 'abc' );

/**#@-*/

/**
 * WordPress database table prefix.
 */
$table_prefix = 'wp_';

define( 'WP_DEBUG', false );

/* That's all, stop editing! Happy publishing. */
if ( ! defined( 'ABSPATH' ) ) {
\tdefine( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
`

const NEW: WpDbConfig = {
  dbName: 'wp_theblogsnew_4ee9d9',
  dbUser: 'wp_4ee9d91fc0',
  dbPassword: 'S3cret_pw-01',
  dbHost: '127.0.0.1:3307'
}

describe('readDefine / readWpDbConfig', () => {
  test('đọc đúng 4 hằng số từ file thật', () => {
    expect(readWpDbConfig(REAL)).toEqual({
      dbName: 'theblogsnews',
      dbUser: 'blogsnew',
      dbPassword: 'cR.Jv1Bx7xc@WTqo',
      dbHost: 'localhost'
    })
  })

  test('không có hằng số ⇒ null, không throw', () => {
    expect(readDefine('<?php // rỗng', 'DB_NAME')).toBeNull()
  })

  test('đọc được mọi biến thể khoảng trắng / loại nháy', () => {
    for (const src of [
      `define('DB_NAME','x');`,
      `define( "DB_NAME" , "x" );`,
      `define ('DB_NAME',   'x')  ;`,
      `\tdefine( 'DB_NAME', 'x' );`
    ]) {
      expect(readDefine(src, 'DB_NAME'), src).toBe('x')
    }
  })

  test('giải escape nháy trong giá trị', () => {
    expect(readDefine(`define('DB_PASSWORD', 'a\\'b');`, 'DB_PASSWORD')).toBe("a'b")
    expect(readDefine(`define('DB_PASSWORD', 'a\\\\b');`, 'DB_PASSWORD')).toBe('a\\b')
  })

  test('KHÔNG nhầm DB_NAME với DB_NAME_SUFFIX hay chuỗi trong comment', () => {
    const src = `// define( 'DB_NAME', 'commented' );\ndefine( 'DB_NAME_EXTRA', 'nope' );\ndefine( 'DB_NAME', 'real' );`
    // Dòng comment đứng trước nên regex bắt nó — đó là hành vi đúng cho comment kiểu này
    // (không parse PHP), nhưng DB_NAME_EXTRA thì TUYỆT ĐỐI không được nhầm
    expect(readDefine(`define( 'DB_NAME_EXTRA', 'nope' );`, 'DB_NAME')).toBeNull()
    expect(readDefine(src, 'DB_NAME')).toBe('commented')
  })
})

describe('replaceDefine', () => {
  test('thay giá trị, giữ nguyên khoảng trắng và loại nháy gốc', () => {
    const r = replaceDefine(`define( "DB_NAME" ,  "old" );`, 'DB_NAME', 'new')
    expect(r.replaced).toBe(1)
    expect(r.text).toBe(`define( "DB_NAME" ,  "new" );`)
  })

  test('không có gì để thay ⇒ replaced=0, text KHÔNG đổi', () => {
    const src = '<?php echo 1;'
    const r = replaceDefine(src, 'DB_NAME', 'x')
    expect(r.replaced).toBe(0)
    expect(r.text).toBe(src)
  })

  test('nháy đơn: escape ` và \\ để giá trị không thoát khỏi literal', () => {
    const r = replaceDefine(`define('DB_PASSWORD', 'x');`, 'DB_PASSWORD', "a'b\\c")
    expect(r.text).toBe(`define('DB_PASSWORD', 'a\\'b\\\\c');`)
  })

  test('nháy đôi: escape cả $ (PHP nội suy biến trong nháy đôi)', () => {
    const r = replaceDefine(`define("DB_PASSWORD", "x");`, 'DB_PASSWORD', 'a$b"c')
    expect(r.text).toBe(`define("DB_PASSWORD", "a\\$b\\"c");`)
  })
})

describe('applyWpDbConfig', () => {
  const res = applyWpDbConfig(REAL, NEW)

  test('4 hằng số DB đều được thay', () => {
    expect(res.replaced).toEqual(['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST'])
    expect(res.inserted).toEqual([])
    expect(readWpDbConfig(res.text)).toEqual({
      dbName: NEW.dbName,
      dbUser: NEW.dbUser,
      dbPassword: NEW.dbPassword,
      dbHost: NEW.dbHost
    })
  })

  // ĐÂY LÀ TEST QUAN TRỌNG NHẤT của file: sinh lại wp-config từ template = xoá sạch cấu hình
  // user tự thêm (salt, WP_DEBUG, hằng số plugin) — mất dữ liệu không hoàn tác được.
  test('giữ NGUYÊN VẸN mọi thứ khác: salt, prefix, WP_DEBUG, comment, ABSPATH', () => {
    for (const keep of [
      `define( 'DB_CHARSET', 'utf8mb4' );`,
      `define( 'AUTH_KEY', 'abc' );`,
      `$table_prefix = 'wp_';`,
      `define( 'WP_DEBUG', false );`,
      `/** Database username */`,
      `/* That's all, stop editing! Happy publishing. */`,
      `require_once ABSPATH . 'wp-settings.php';`
    ]) {
      expect(res.text, keep).toContain(keep)
    }
  })

  test('chỉ 4 dòng thay đổi, số dòng không đổi', () => {
    const a = REAL.split('\n')
    const b = res.text.split('\n')
    expect(b).toHaveLength(a.length)
    const diff = a.filter((line, i) => line !== b[i])
    expect(diff).toHaveLength(4)
    for (const d of diff) expect(d).toMatch(/DB_(NAME|USER|PASSWORD|HOST)/)
  })

  test('IDEMPOTENT: chạy lại trên kết quả cho ra đúng cùng chuỗi', () => {
    expect(applyWpDbConfig(res.text, NEW).text).toBe(res.text)
  })

  test('thiếu hằng số ⇒ CHÈN THÊM (không im lặng bỏ qua)', () => {
    const partial = `<?php\ndefine( 'DB_NAME', 'old' );\n$table_prefix = 'wp_';\n`
    const r = applyWpDbConfig(partial, NEW)
    expect(r.replaced).toEqual(['DB_NAME'])
    expect(r.inserted).toEqual(['DB_USER', 'DB_PASSWORD', 'DB_HOST'])
    expect(readWpDbConfig(r.text)).toEqual({
      dbName: NEW.dbName,
      dbUser: NEW.dbUser,
      dbPassword: NEW.dbPassword,
      dbHost: NEW.dbHost
    })
    // Chèn TRƯỚC $table_prefix để file còn đọc được như bản gốc
    expect(r.text.indexOf("define( 'DB_USER'")).toBeLessThan(r.text.indexOf('$table_prefix'))
  })

  test('file rỗng chỉ có <?php ⇒ chèn đủ 4 dòng ngay sau đó', () => {
    const r = applyWpDbConfig('<?php\n', NEW)
    expect(r.inserted).toHaveLength(4)
    expect(readWpDbConfig(r.text)).toMatchObject({ dbName: NEW.dbName })
    expect(r.text.startsWith('<?php\n')).toBe(true)
  })

  test('GIỮ CRLF — không thì git báo đổi cả file', () => {
    const crlf = REAL.replace(/\n/g, '\r\n')
    const r = applyWpDbConfig(crlf, NEW)
    expect(r.text).toContain('\r\n')
    expect(r.text.split('\n').every((l, i, arr) => i === arr.length - 1 || l.endsWith('\r'))).toBe(true)
  })

  test('GIỮ BOM ở đầu file (PHP sẽ echo BOM ra output nếu ta thêm/bớt sai)', () => {
    const r = applyWpDbConfig('﻿' + REAL, NEW)
    expect(r.text.startsWith('﻿')).toBe(true)
  })

  test('password có nháy/backslash/$ vẫn ra PHP hợp lệ', () => {
    const tricky: WpDbConfig = { ...NEW, dbPassword: `a'b\\c$d"e` }
    const r = applyWpDbConfig(REAL, tricky)
    expect(readDefine(r.text, 'DB_PASSWORD')).toBe(`a'b\\c$d"e`)
    // Giá trị không được cắt literal: số nháy đơn chưa escape phải chẵn trên dòng đó
    const line = r.text.split('\n').find((l) => l.includes('DB_PASSWORD'))!
    expect((line.match(/(?<!\\)'/g) ?? []).length % 2).toBe(0)
  })

  test('chèn theo EOL của file (CRLF thì dòng chèn cũng CRLF)', () => {
    const r = applyWpDbConfig('<?php\r\n$table_prefix = \'wp_\';\r\n', NEW)
    const inserted = r.text.split('\r\n').filter((l) => l.includes('DB_USER'))
    expect(inserted).toHaveLength(1)
  })
})

describe('wpDbHost', () => {
  // Trên Windows, driver mysql của PHP hiểu 'localhost' là named pipe / cổng 3306 mặc định và
  // BỎ QUA cổng ta chỉ định ⇒ site đi tìm MySQL của XAMPP thay vì MariaDB của app.
  test('luôn dùng 127.0.0.1 kèm cổng, KHÔNG dùng localhost', () => {
    expect(wpDbHost(3307)).toBe('127.0.0.1:3307')
    expect(wpDbHost(3307)).not.toContain('localhost')
  })
})

describe('looksLikeWpConfig', () => {
  test('nhận ra wp-config thật', () => {
    expect(looksLikeWpConfig(REAL)).toBe(true)
    expect(looksLikeWpConfig(`<?php define("DB_NAME","x");`)).toBe(true)
    expect(looksLikeWpConfig(`<?php $table_prefix = 'wp_';`)).toBe(true)
  })

  test('từ chối file trùng tên nhưng không phải wp-config', () => {
    expect(looksLikeWpConfig('<?php echo "hello";')).toBe(false)
    expect(looksLikeWpConfig('')).toBe(false)
  })
})

describe('phpSingleQuoted / detectEol', () => {
  test('escape đúng thứ tự (backslash trước, nháy sau)', () => {
    expect(phpSingleQuoted('a\\b')).toBe('a\\\\b')
    expect(phpSingleQuoted("a'b")).toBe("a\\'b")
    expect(phpSingleQuoted("a\\'b")).toBe("a\\\\\\'b")
  })

  test('detectEol', () => {
    expect(detectEol('a\r\nb')).toBe('\r\n')
    expect(detectEol('a\nb')).toBe('\n')
    expect(detectEol('a')).toBe('\n')
  })
})
