/**
 * F35 — đọc/sửa crontab của một host qua UI.
 *
 * "Máy này đang hẹn giờ chạy những gì" là câu hỏi xuất hiện trong gần như mọi lần truy nguyên
 * sự cố, mà trả lời nó vẫn phải SSH vào gõ `crontab -l` rồi tự đọc năm cột số.
 *
 * ⚠️ Ghi crontab là GHI VÀO PRODUCTION. Phần ghi ở đây chỉ dựng lệnh; nơi gọi phải đi qua
 * xác nhận (và guard production của F27) trước khi chạy.
 */

/** Bọc chuỗi trong nháy đơn cho shell. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/** Marker để biết `crontab <file>` thật sự thành công — không dùng `$?` (§4). */
export const CRON_OK_MARKER = 'IC_CRON_OK'

/** File tạm trên remote. Trong `~` để không đụng quyền `/tmp` bị hạn chế của một số hệ. */
const TMP_FILE = '~/.infra-companion-crontab.tmp'

export type CronLineKind = 'job' | 'env' | 'comment' | 'blank'

export interface CronLine {
  kind: CronLineKind
  /** Nguyên văn dòng — giữ lại để ghi ngược KHÔNG làm xáo trộn phần mình không hiểu. */
  raw: string
  /** kind='job': phần lịch (5 trường hoặc `@daily`). */
  schedule?: string
  /** kind='job': phần lệnh. */
  command?: string
  /** kind='env': `FOO=bar`. */
  name?: string
  value?: string
}

/**
 * Parse crontab.
 *
 * Giữ NGUYÊN VĂN từng dòng kể cả dòng không hiểu: crontab thật hay có comment, biến môi
 * trường (`MAILTO=`, `PATH=`) và cú pháp lạ. Dựng lại file từ những gì mình hiểu là cách chắc
 * chắn để xoá mất thứ của người khác.
 */
export function parseCrontab(content: string): CronLine[] {
  const out: CronLine[] = []
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      out.push({ kind: 'blank', raw })
      continue
    }
    if (trimmed.startsWith('#')) {
      out.push({ kind: 'comment', raw })
      continue
    }
    // Biến môi trường: NAME=value, và NAME không được chứa khoảng trắng
    const env = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (env) {
      out.push({ kind: 'env', raw, name: env[1]!, value: env[2]! })
      continue
    }
    // Dạng @reboot / @daily…
    const special = trimmed.match(/^(@\w+)\s+(.+)$/)
    if (special) {
      out.push({ kind: 'job', raw, schedule: special[1]!, command: special[2]! })
      continue
    }
    // 5 trường lịch rồi tới lệnh
    const five = trimmed.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/)
    if (five) {
      out.push({ kind: 'job', raw, schedule: five[1]!.replace(/\s+/g, ' '), command: five[2]! })
      continue
    }
    // Không nhận ra → giữ như comment để ghi ngược không mất
    out.push({ kind: 'comment', raw })
  }
  // `split` trên chuỗi kết thúc bằng \n sinh một dòng rỗng cuối — bỏ để không cộng dồn mỗi lần lưu
  if (out.length > 0 && out[out.length - 1]!.kind === 'blank' && out[out.length - 1]!.raw === '') out.pop()
  return out
}

/** Dựng lại nội dung crontab từ các dòng. Luôn kết thúc bằng `\n` — thiếu là cron bỏ dòng cuối. */
export function buildCrontab(lines: CronLine[]): string {
  return lines.map((l) => l.raw).join('\n') + '\n'
}

/**
 * Mô tả lịch chạy dạng người đọc được — trả về KHOÁ i18n + tham số để UI tự dịch,
 * hoặc null khi biểu thức phức tạp (UI hiện nguyên văn thay vì đoán sai).
 */
export interface ScheduleDescription {
  key: string
  params?: Record<string, string>
}

const SPECIALS: Record<string, string> = {
  '@reboot': 'cron.atReboot',
  '@yearly': 'cron.yearly',
  '@annually': 'cron.yearly',
  '@monthly': 'cron.monthly',
  '@weekly': 'cron.weekly',
  '@daily': 'cron.daily',
  '@midnight': 'cron.daily',
  '@hourly': 'cron.hourly'
}

export function describeSchedule(schedule: string): ScheduleDescription | null {
  const s = schedule.trim()
  const special = SPECIALS[s.toLowerCase()]
  if (special) return { key: special }

  const parts = s.split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string]
  const everything = (v: string): boolean => v === '*'
  const num = (v: string): string | null => (/^\d{1,2}$/.test(v) ? String(Number(v)) : null)

  // */N * * * *  → mỗi N phút
  const everyMin = min.match(/^\*\/(\d+)$/)
  if (everyMin && everything(hour) && everything(dom) && everything(mon) && everything(dow)) {
    return { key: 'cron.everyNMin', params: { n: String(Number(everyMin[1])) } }
  }
  // M * * * * → mỗi giờ vào phút M
  if (num(min) !== null && everything(hour) && everything(dom) && everything(mon) && everything(dow)) {
    return { key: 'cron.hourlyAt', params: { m: num(min)! } }
  }
  // M H * * * → mỗi ngày lúc H:MM
  if (num(min) !== null && num(hour) !== null && everything(dom) && everything(mon) && everything(dow)) {
    return { key: 'cron.dailyAt', params: { time: `${num(hour)!.padStart(2, '0')}:${num(min)!.padStart(2, '0')}` } }
  }
  // M H * * D → mỗi tuần
  if (num(min) !== null && num(hour) !== null && everything(dom) && everything(mon) && num(dow) !== null) {
    return {
      key: 'cron.weeklyAt',
      params: { dow: num(dow)!, time: `${num(hour)!.padStart(2, '0')}:${num(min)!.padStart(2, '0')}` }
    }
  }
  // M H D * * → mỗi tháng
  if (num(min) !== null && num(hour) !== null && num(dom) !== null && everything(mon) && everything(dow)) {
    return {
      key: 'cron.monthlyAt',
      params: { dom: num(dom)!, time: `${num(hour)!.padStart(2, '0')}:${num(min)!.padStart(2, '0')}` }
    }
  }
  return null // biểu thức phức tạp — UI hiện nguyên văn, đoán sai còn tệ hơn không đoán
}

/** Lệnh đọc crontab. `2>/dev/null` + `true`: không có crontab thì `crontab -l` trả mã lỗi. */
export function readCrontabCommand(): string {
  return 'crontab -l 2>/dev/null; true'
}

/**
 * Lệnh GHI crontab.
 *
 * Không dùng `crontab -` với stdin (kênh exec ở đây không đẩy stdin), không heredoc và không
 * `$?` — mỗi hop login-script bọc thêm một lớp quote rồi bóc mất (§4). Cách còn lại: `printf`
 * ra file tạm rồi `crontab <file>`. `umask 077` để file tạm không đọc được bởi user khác;
 * `rm -f` chạy vô điều kiện ở cuối nên thất bại cũng không để lại rác.
 * Thành công nhận biết bằng {@link CRON_OK_MARKER} trong stdout.
 */
export function writeCrontabCommand(content: string): string {
  const normalized = content.endsWith('\n') ? content : `${content}\n`
  return (
    `umask 077; printf '%s' ${shq(normalized)} > ${TMP_FILE} && ` +
    `crontab ${TMP_FILE} && echo ${CRON_OK_MARKER}; rm -f ${TMP_FILE}`
  )
}

/** Ghi có thành công không — dựa vào marker chứ không dựa vào exit code (bị `rm` che mất). */
export function writeSucceeded(stdout: string): boolean {
  return stdout.includes(CRON_OK_MARKER)
}
