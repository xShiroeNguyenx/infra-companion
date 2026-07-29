import { upstreamName } from '../templates/nginxConf'
import type { ServiceSpec } from '../types'
import type { PhpBackend, PhpPoolInput } from './PhpBackend'

/**
 * Pool `php-cgi.exe` cho Windows — thay thế php-fpm (không tồn tại trên Windows).
 *
 * Mỗi worker là 1 process nghe 1 cổng riêng, nginx phân phối qua `upstream`:
 *   php-cgi.exe -c <php.ini> -b 127.0.0.1:9000
 *   php-cgi.exe -c <php.ini> -b 127.0.0.1:9001  …
 *
 * BA CẠM BẪY BẮT BUỘC XỬ LÝ (bỏ sót là tính năng vỡ):
 *  1. `PHP_FCGI_MAX_REQUESTS` mặc định = 500 → php-cgi TỰ THOÁT sau 500 request. Đặt = 0.
 *     Vẫn để `restartOnCleanExit: true` làm lưới an toàn.
 *  2. `PHP_FCGI_CHILDREN` bị BỎ QUA trên Windows (không có fork) → đây chính là lý do phải
 *     spawn N process riêng thay vì trông chờ 1 process tự nhân bản.
 *  3. `cgi.force_redirect = 0` (đặt trong php.ini) — nếu không php-cgi từ chối chạy sau nginx.
 *
 * ⚠️ RÀNG BUỘC PHẢI NÓI VỚI USER: mỗi php-cgi xử lý ĐÚNG 1 request tại một thời điểm ⇒
 * N = số request PHP đồng thời tối đa. Nếu N=1 và trang PHP tự gọi HTTP về chính site mình
 * (wp-cron loopback, Laravel `Http::get(url của chính nó)`) ⇒ DEADLOCK cứng tới khi timeout.
 */
export class PhpCgiPool implements PhpBackend {
  constructor(private readonly poolPorts: number[]) {}

  upstream(runtimeId: string): string {
    return upstreamName(runtimeId)
  }

  ports(): number[] {
    return [...this.poolPorts]
  }

  buildSpecs(input: PhpPoolInput): ServiceSpec[] {
    return input.ports.map((port, index) => ({
      id: `${input.runtimeId}#${String(index)}`,
      groupId: input.runtimeId,
      label: `PHP ${input.runtimeId.replace(/^php-/, '')} · worker ${String(index + 1)}`,
      exe: input.phpCgiExe,
      args: ['-c', input.iniFile, '-b', `127.0.0.1:${String(port)}`],
      cwd: input.cwd,
      env: {
        // env TRẮNG: chỉ những gì php cần, không kế thừa process.env
        PATH: input.pathEntries.join(';'),
        SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
        TEMP: input.tmpDir,
        TMP: input.tmpDir,
        // Cạm bẫy (1): mặc định 500 → worker tự chết giữa lúc đang phục vụ
        PHP_FCGI_MAX_REQUESTS: '0'
      },
      logFile: input.logFile,
      healthPort: port,
      // Cạm bẫy (1) — lưới an toàn: nếu vẫn thoát code 0 thì bật lại im lặng
      restartOnCleanExit: true,
      maxRestarts: 5,
      restartWindowMs: 60_000,
      // php-cgi stateless: không cần dừng đàng hoàng, kill thẳng là an toàn
      graceMs: 2_000
    }))
  }
}
