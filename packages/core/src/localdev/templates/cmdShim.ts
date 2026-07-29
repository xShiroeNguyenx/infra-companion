/**
 * Sinh shim `.cmd` cho các tool `.phar` (Composer, WP-CLI). Thuần → golden-string test.
 *
 * VÌ SAO CẦN: `.phar` không tự chạy được trên Windows, phải `php x.phar`. Không có shim thì
 * user phải gõ cả đường dẫn tuyệt đối tới php.exe của app — coi như tool không dùng được.
 *
 * Chi tiết dễ sai, đều xử ở đây:
 * - `-c "<php.ini>"`: PHẢI truyền php.ini do app sinh, nếu không php CLI chạy với ini rỗng ⇒
 *   thiếu openssl/zip/curl ⇒ Composer chết ngay ở bước tải package.
 * - `%*` (không phải `%1 %2 …`): giữ nguyên toàn bộ tham số kể cả khi có dấu cách/nháy.
 * - `@echo off` + `setlocal`: không in lại lệnh, và không rò biến vào shell của user.
 * - `exit /b %ERRORLEVEL%`: trả đúng exit code, nếu không script CI của user luôn thấy 0.
 */

export interface CmdShimModel {
  /** Đường dẫn tuyệt đối tới php.exe trong runtime của app. */
  phpExe: string
  /** php.ini do app sinh cho runtime đó. */
  iniFile: string
  /** Đường dẫn tuyệt đối tới file .phar. */
  phar: string
}

/** Bọc `"…"` cho path có dấu cách. `"` không hợp lệ trong tên file Windows nên chỉ cần loại bỏ. */
function q(p: string): string {
  return `"${p.replace(/"/g, '')}"`
}

export function renderCmdShim(m: CmdShimModel): string {
  return [
    '@echo off',
    ':: File này do Infra Companion SINH RA — mọi thay đổi sẽ bị ghi đè.',
    'setlocal',
    `${q(m.phpExe)} -c ${q(m.iniFile)} ${q(m.phar)} %*`,
    'exit /b %ERRORLEVEL%',
    ''
  ].join('\r\n')
}
