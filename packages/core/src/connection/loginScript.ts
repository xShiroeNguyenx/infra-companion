/**
 * Chuyển "login script" (các bước gõ sau khi vào gate: ssh / su / sudo + secret) thành
 * MỘT lệnh exec không tương tác chạy trên gate, để các tính năng không có tty
 * (SFTP, Bulk exec, Monitoring) tái hiện được đường đi tới máy đích bên trong.
 */

// Shell escape: kết thúc single-quote, emit literal ', mở lại single-quote
const SH_SQ_ESC = String.raw`'\''`

/** Shell-quote bằng single-quote, an toàn với mọi ký tự trừ null byte. */
function shq(s: string): string {
  return `'${s.replaceAll("'", SH_SQ_ESC)}'`
}

/**
 * Tùy chọn SSH dùng chung cho mọi hop khi exec qua máy trung gian.
 * StrictHostKeyChecking=no: exec không có tty, không thể trả lời yes/no; dùng "no" thay vì
 * "accept-new" vì OpenSSH đời cũ không hiểu "accept-new".
 * BatchMode=yes: nếu hop yêu cầu mật khẩu tương tác thì fail nhanh thay vì treo vô hạn.
 */
const EXEC_SSH_OPTS = '-o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10'

/**
 * SSH opts cho hop xác thực bằng password (qua sshpass):
 * - PreferredAuthentications=password trước: prompt do CLIENT sinh ra → LC_ALL=C ép thành
 *   "password:" tiếng Anh để sshpass match. Keyboard-interactive thì prompt do SERVER gửi
 *   (có thể là "パスワード:" tiếng Nhật) — sshpass không match được, chỉ để fallback.
 * - NumberOfPasswordPrompts=1: sai pass thì fail ngay, không để sshpass retry cùng pass
 *   nhiều lần gây khoá tài khoản.
 */
const EXEC_SSH_OPTS_PASSWORD =
  '-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o PreferredAuthentications=password,keyboard-interactive -o NumberOfPasswordPrompts=1'

export type LoginStepLike = { send: string; secret?: boolean }

type LoginAction =
  | { kind: 'ssh'; target: string; password: string | null }
  | { kind: 'su'; user: string; password: string | null }
  | { kind: 'sudo'; user: string | null; password: string | null }

/** Cách nạp password cho su/sudo — khác nhau giữa phiên SFTP (cần giữ stdin) và exec một phát. */
type PasswordFeed = (password: string, cmd: string) => string

/** Lấy tên user từ phần args của lệnh su (bỏ flags như -l, -). */
function parseSuUser(args: string): string {
  const parts = args.trim().split(/\s+/).filter((p) => p && !p.startsWith('-'))
  return parts.at(-1) ?? 'root'
}

/** Lấy giá trị -u USER từ args của lệnh sudo, hoặc null nếu không có. */
function extractSudoUser(sudoArgs: string): string | null {
  return /-u\s+(\S+)/.exec(sudoArgs)?.[1] ?? null
}

/**
 * Chuyển login steps thành danh sách actions theo đúng thứ tự.
 * Secret step ngay sau ssh/su/sudo được tiêu thụ làm password của step đó.
 */
function parseLoginActions(steps: LoginStepLike[]): LoginAction[] {
  const actions: LoginAction[] = []
  let i = 0
  while (i < steps.length) {
    const step = steps[i++]
    if (step.secret) continue // orphan secret step — bỏ qua
    const raw = step.send.trim()
    // Nếu step kế tiếp là secret → đó là password của step hiện tại
    const nextPass = i < steps.length && steps[i].secret ? steps[i++].send.trim() : null

    // sudo phải test trước su vì "sudo" bắt đầu bằng "su"
    const sudoM = /^sudo\b(.*)$/.exec(raw)
    if (sudoM) { actions.push({ kind: 'sudo', user: extractSudoUser(sudoM[1]), password: nextPass }); continue }

    const suM = /^su\b(.*)$/.exec(raw)
    if (suM) { actions.push({ kind: 'su', user: parseSuUser(suM[1]), password: nextPass }); continue }

    const sshM = /^ssh\s+(.+)$/.exec(raw)
    if (sshM) actions.push({ kind: 'ssh', target: sshM[1].trim(), password: nextPass })
  }
  return actions
}

/**
 * Tiền tố sshpass cho SSH hop cần password.
 *
 * Chỉ dùng cho `ssh` — ssh đọc password từ /dev/tty (controlling terminal), nên sshpass
 * cấp một pty riêng để trả lời prompt mà KHÔNG đụng stdin/stdout (nơi dữ liệu SFTP chảy
 * qua). KHÔNG dùng cho su/sudo: nhiều bản su ghi prompt ra stderr rồi đọc password từ
 * /dev/tty theo cách sshpass không bắt được → treo.
 *
 * `env LC_ALL=C`: ép prompt ssh client thành tiếng Anh ("...password:") để sshpass match
 * chuỗi mặc định "assword"; prompt tiếng Nhật "パスワード:" sẽ không match.
 */
function sshpassPrefix(password: string): string {
  return `env LC_ALL=C sshpass -p ${shq(password)} `
}

/**
 * Nạp password vào ĐẦU stdin rồi nối tiếp luồng dữ liệu gốc: `{ echo PASS; cat; } | cmd`.
 *
 * Dùng cho su/sudo (đọc password từ stdin theo dòng): chúng nuốt dòng đầu làm password,
 * còn `cat` tiếp tục đẩy phần còn lại của stdin — chính là luồng dữ liệu SFTP — xuống cho
 * lệnh con. Tránh được lỗi `echo PASS | cmd` làm cạn stdin khiến SFTP chết ngay khi mở.
 */
const feedKeepStdin: PasswordFeed = (password, cmd) => `{ echo ${shq(password)}; cat; } | ${cmd}`

/**
 * Nạp password qua stdin cho lệnh một phát (Bulk/Monitoring — lệnh không cần stdin):
 * `echo PASS | cmd`. KHÔNG dùng `cat` như bản SFTP — caller không bao giờ đóng stdin của
 * kênh exec, `cat` sẽ chờ EOF vô hạn khiến kênh không bao giờ close.
 */
const feedOneShot: PasswordFeed = (password, cmd) => `echo ${shq(password)} | ${cmd}`

/** Bọc inner command với su USER -c (password nạp qua stdin theo feed). */
function wrapSu(user: string, password: string | null, inner: string, feed: PasswordFeed): string {
  const cmd = `su ${user} -c ${shq(inner)}`
  return password ? feed(password, cmd) : cmd
}

/** Bọc inner command với sudo (-S đọc password từ stdin, nạp theo feed). */
function wrapSudo(user: string | null, password: string | null, inner: string, feed: PasswordFeed): string {
  const userFlag = user ? `-u ${user} ` : ''
  if (password) return feed(password, `sudo -S ${userFlag}bash -c ${shq(inner)}`)
  return `sudo ${userFlag}bash -c ${shq(inner)}`
}

/** Bọc innerCmd bởi một SSH hop trung gian (dùng sshpass khi hop có password). */
function buildSshHopCmd(target: string, password: string | null, innerCmd: string): string {
  if (password) return `${sshpassPrefix(password)}ssh ${EXEC_SSH_OPTS_PASSWORD} ${target} ${shq(innerCmd)}`
  return `ssh ${EXEC_SSH_OPTS} ${target} ${shq(innerCmd)}`
}

/**
 * Lõi chung: tìm ssh action cuối (máy đích), xây lệnh trong cùng bằng `innermost`,
 * rồi bọc dần ra ngoài bằng các action đứng trước (su/sudo/ssh hop).
 * Trả về null nếu không có hop ssh nào (chạy trực tiếp trên endpoint cuối chain).
 */
function deriveNestedCommand(
  steps: LoginStepLike[],
  innermost: (target: string, password: string | null) => string,
  feed: PasswordFeed
): string | null {
  if (steps.length === 0) return null

  const actions = parseLoginActions(steps)

  let lastSshIdx = -1
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i].kind === 'ssh') { lastSshIdx = i; break }
  }
  if (lastSshIdx === -1) return null

  const lastSsh = actions[lastSshIdx] as { kind: 'ssh'; target: string; password: string | null }
  let cmd = innermost(lastSsh.target, lastSsh.password)

  // Xây dựng từ trong ra ngoài: bọc cmd bằng các action trước đó theo thứ tự ngược
  for (let i = lastSshIdx - 1; i >= 0; i--) {
    const action = actions[i]
    if (action.kind === 'su') {
      cmd = wrapSu(action.user, action.password, cmd, feed)
    } else if (action.kind === 'sudo') {
      cmd = wrapSudo(action.user, action.password, cmd, feed)
    } else if (action.kind === 'ssh') {
      cmd = buildSshHopCmd(action.target, action.password, cmd)
    }
  }

  return cmd
}

/**
 * Chạy thẳng binary sftp-server, dò các vị trí phổ biến giữa các distro
 * (RHEL/Alma → Debian/Ubuntu → SUSE/Alpine → BSD). Dùng khi login script còn su/sudo
 * SAU hop ssh cuối (hoặc không có hop ssh nào): subsystem `-s sftp` luôn chạy dưới
 * user ssh — không xuyên qua su/sudo được, nên sửa file của user đã su sẽ bị
 * Permission denied. Chủ đích KHÔNG dùng biến/`$()`: chuỗi bị shq bọc qua nhiều hop,
 * tránh mọi ký tự `$` cho chắc (bài học METRIC_CMD).
 */
const SFTP_SERVER_PROBE =
  'if [ -x /usr/libexec/openssh/sftp-server ]; then exec /usr/libexec/openssh/sftp-server; ' +
  'elif [ -x /usr/lib/openssh/sftp-server ]; then exec /usr/lib/openssh/sftp-server; ' +
  'elif [ -x /usr/lib/ssh/sftp-server ]; then exec /usr/lib/ssh/sftp-server; ' +
  'elif [ -x /usr/libexec/sftp-server ]; then exec /usr/libexec/sftp-server; ' +
  'else echo sftp-server-not-found 1>&2; exit 127; fi'

/**
 * Xây dựng lệnh exec đầy đủ từ login script để truyền vào openSftpOverExec.
 *
 * Xử lý các tình huống theo đúng thứ tự lồng nhau. Ví dụ:
 *   steps = [ssh web-02, su admin+pass, ssh web-03+pass]
 *   → exec trên gate:
 *     ssh OPTS web-02 '{ echo PASS_SU; cat; } | su admin -c
 *       '\''env LC_ALL=C sshpass -p PASS_WEB3 ssh OPTS_PASSWORD web-03 -s sftp'\'''
 *   su nuốt PASS_SU ở đầu stdin, cat đẩy tiếp dữ liệu SFTP cho ssh trong cùng;
 *   ssh dùng sshpass (pty riêng) để trả password, stdin/stdout giữ sạch cho dữ liệu.
 *   Yêu cầu: máy chạy ssh-có-password (vd web-02) phải cài sẵn sshpass.
 *
 * su/sudo đứng SAU hop ssh cuối (vd [ssh web-02, su admin]) — hoặc login script CHỈ có
 * su/sudo — thì không dùng subsystem được (nó chạy dưới user ssh, mất quyền của user su
 * → sửa file bị Permission denied): thay bằng chạy thẳng binary sftp-server dưới user
 * đích qua su/sudo (SFTP_SERVER_PROBE). Ví dụ:
 *   [ssh web-02, su admin+pass] → ssh OPTS web-02 '{ echo PASS; cat; } | su admin -c PROBE'
 *   [sudo -i]                   → sudo bash -c PROBE   (exec ngay trên endpoint cuối chain)
 *
 * Trả về null nếu không có hop ssh lẫn su/sudo (mở SFTP subsystem trực tiếp trên
 * endpoint cuối chain).
 */
export function deriveSftpExecFromLoginSteps(steps: LoginStepLike[]): string | null {
  if (steps.length === 0) return null
  const actions = parseLoginActions(steps)
  if (actions.length === 0) return null

  let lastSshIdx = -1
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i].kind === 'ssh') { lastSshIdx = i; break }
  }
  // Sau hop ssh cuối chỉ có thể là su/sudo (ssh cuối đã là lastSshIdx)
  const trailing = actions.slice(lastSshIdx + 1)

  let cmd: string
  if (trailing.length === 0) {
    if (lastSshIdx === -1) return null
    const lastSsh = actions[lastSshIdx] as { kind: 'ssh'; target: string; password: string | null }
    cmd = lastSsh.password
      ? `${sshpassPrefix(lastSsh.password)}ssh ${EXEC_SSH_OPTS_PASSWORD} ${lastSsh.target} -s sftp`
      : `ssh ${EXEC_SSH_OPTS} ${lastSsh.target} -s sftp`
  } else {
    cmd = SFTP_SERVER_PROBE
    for (let i = trailing.length - 1; i >= 0; i--) {
      const action = trailing[i]
      if (action.kind === 'su') cmd = wrapSu(action.user, action.password, cmd, feedKeepStdin)
      else if (action.kind === 'sudo') cmd = wrapSudo(action.user, action.password, cmd, feedKeepStdin)
    }
    if (lastSshIdx >= 0) {
      const lastSsh = actions[lastSshIdx] as { kind: 'ssh'; target: string; password: string | null }
      cmd = buildSshHopCmd(lastSsh.target, lastSsh.password, cmd)
    }
  }

  // Bọc tiếp bằng các action đứng TRƯỚC hop ssh cuối (như deriveNestedCommand)
  for (let i = lastSshIdx - 1; i >= 0; i--) {
    const action = actions[i]
    if (action.kind === 'su') cmd = wrapSu(action.user, action.password, cmd, feedKeepStdin)
    else if (action.kind === 'sudo') cmd = wrapSudo(action.user, action.password, cmd, feedKeepStdin)
    else cmd = buildSshHopCmd(action.target, action.password, cmd)
  }
  return cmd
}

/**
 * Xây dựng lệnh exec chạy `command` trên máy đích của login script (Bulk exec / Monitoring).
 * Ví dụ steps = [ssh web-01] + command = "uptime" →
 *   `ssh -o StrictHostKeyChecking=no … web-01 'uptime'`
 *
 * Trả về null nếu không có hop ssh nào (chạy command trực tiếp trên endpoint cuối chain).
 */
export function deriveExecFromLoginSteps(steps: LoginStepLike[], command: string): string | null {
  return deriveNestedCommand(
    steps,
    (target, password) => {
      if (password) return `${sshpassPrefix(password)}ssh ${EXEC_SSH_OPTS_PASSWORD} ${target} ${shq(command)}`
      return `ssh ${EXEC_SSH_OPTS} ${target} ${shq(command)}`
    },
    feedOneShot
  )
}

/**
 * Như deriveExecFromLoginSteps nhưng dùng feedKeepStdin (`{ echo PASS; cat; } | …`) — GIỮ luồng
 * stdin chảy tiếp sau khi nạp password su/sudo. BẮT BUỘC cho tunnel/luồng 2 CHIỀU (vd `nc` bắc
 * cầu DB): feedOneShot (`echo PASS |`) cắt stdin sau mật khẩu → byte client gửi lên không tới
 * được lệnh trong cùng. (Giống hệt cách deriveSftpExecFromLoginSteps giữ stdin cho SFTP.)
 */
export function deriveStreamExecFromLoginSteps(steps: LoginStepLike[], command: string): string | null {
  return deriveNestedCommand(
    steps,
    (target, password) => {
      if (password) return `${sshpassPrefix(password)}ssh ${EXEC_SSH_OPTS_PASSWORD} ${target} ${shq(command)}`
      return `ssh ${EXEC_SSH_OPTS} ${target} ${shq(command)}`
    },
    feedKeepStdin
  )
}
