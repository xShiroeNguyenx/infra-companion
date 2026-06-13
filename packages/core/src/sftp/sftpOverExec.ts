import type { Client, ClientChannel, SFTPWrapper } from 'ssh2'
// Deep import: lớp SFTP nội bộ của ssh2 (không export ở entry chính, nhưng package không khoá subpath).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — không có type cho đường dẫn sâu
import sftpProtocol from 'ssh2/lib/protocol/SFTP.js'

const SFTP = (sftpProtocol as { SFTP: SftpCtor }).SFTP

type SftpCtor = new (client: Client, chanInfo: unknown, cfg: unknown) => SftpInstance

interface SftpInstance {
  _protocol: unknown
  outgoing: { id: number; window: number; packetSize: number; state: string }
  push(data: Buffer | null): void
  _init(): void
  end(): void
  on(event: string, cb: (...args: unknown[]) => void): unknown
  once(event: string, cb: (...args: unknown[]) => void): unknown
  emit(event: string, ...args: unknown[]): boolean
}

/** Quá hạn này mà chưa 'ready' → coi như treo (mạng blackhole), không để UI đứng im vô hạn. */
const OPEN_TIMEOUT_MS = 30_000

/**
 * Tùy chọn SSH dùng chung cho mọi hop khi exec SFTP qua máy trung gian.
 * StrictHostKeyChecking=no: exec không có tty, không thể trả lời yes/no; dùng "no" thay vì
 * "accept-new" vì OpenSSH đời cũ không hiểu "accept-new".
 * BatchMode=yes: nếu hop yêu cầu mật khẩu tương tác thì fail nhanh thay vì treo vô hạn.
 */
const EXEC_SSH_OPTS = '-o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10'

/**
 * Mở phiên SFTP tới một máy nội bộ bằng cách exec một lệnh trên `client`.
 *
 * Cách làm: trên `client` (đã kết nối tới gate), exec `execCommand` để mở subsystem SFTP
 * của máy đích, rồi nói chuyện giao thức SFTP xuyên qua kênh exec đó.
 * Đây là cách `sshfs`/`sftp -J` hoạt động nội bộ.
 *
 * @param execCommand lệnh exec đầy đủ được build bởi deriveSshArgsFromLoginSteps, vd:
 *   `ssh -o... server4 -s sftp`
 *   `ssh -o... server2 'ssh -o... server4 -s sftp'`
 *   `env LC_ALL=C sshpass -p 'PASS' sudo -u user1 bash -c 'ssh -o... server4 -s sftp'`
 *   `ssh -o... server2 'env LC_ALL=C sshpass -p '\''PASS'\'' su user1 -c '\''ssh ... -s sftp'\'''`
 */
export function openSftpOverExec(client: Client, execCommand: string): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    const command = execCommand

    client.exec(command, (error, stream: ClientChannel) => {
      if (error) return reject(new Error(`Không chạy được ssh trên máy trung gian: ${error.message}`))

      let stderr = ''
      let settled = false
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      // không có listener 'error' thì write-after-end emit error → uncaught exception sập main process
      stream.on('error', () => {})

      const openTimeout = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          stream.close()
        } catch {
          // đã đóng
        }
        // kèm stderr (nếu có) — thường chứa prompt/lỗi của su/sshpass giúp chẩn đoán hop nào treo
        const hint = stderr.trim()
        const hintSuffix = hint ? ` — stderr: ${hint}` : ''
        reject(
          new Error(`SFTP qua máy trung gian không phản hồi sau ${OPEN_TIMEOUT_MS / 1000}s${hintSuffix}`)
        )
      }, OPEN_TIMEOUT_MS)

      // SFTP instance dùng chung client (để đọc _remoteIdentRaw) nhưng định tuyến I/O qua exec stream
      const chanInfo = {
        type: 'sftp',
        incoming: { id: 0, window: Number.MAX_SAFE_INTEGER, packetSize: 32_768, state: 'open' },
        outgoing: { id: 0, window: Number.MAX_SAFE_INTEGER, packetSize: 32_768, state: 'open' }
      }
      const sftp = new SFTP(client, chanInfo, {})

      // Shim _protocol: chuyển mọi gói SFTP outgoing thẳng vào stdin của exec stream
      sftp._protocol = {
        _remoteIdentRaw: (client as unknown as { _protocol?: { _remoteIdentRaw?: Buffer } })._protocol
          ?._remoteIdentRaw,
        channelData: (_id: number, payload: Buffer) => {
          if (stream.writable) stream.write(payload)
        },
        channelClose: () => {
          try {
            stream.end()
          } catch {
            // đã đóng
          }
        },
        channelWindowAdjust: () => {},
        channelEOF: () => {},
        channelOpenConfirm: () => {},
        channelOpenFail: () => {}
      }

      // stdout của exec = luồng giao thức SFTP từ máy đích → đẩy vào parser
      stream.on('data', (chunk: Buffer) => sftp.push(chunk))
      stream.on('close', () => {
        sftp.push(null)
        if (!settled) {
          settled = true
          clearTimeout(openTimeout)
          reject(new Error(stderr.trim() || 'Kết nối SFTP qua máy trung gian bị đóng'))
          return
        }
        // phiên đã mở mà kênh exec chết (máy đích reboot, gate vẫn sống) →
        // phát 'close' để SftpService dọn session + báo UI, không thành phiên zombie
        sftp.emit('close')
      })

      sftp.once('ready', () => {
        if (settled) return
        settled = true
        clearTimeout(openTimeout)
        resolve(sftp as unknown as SFTPWrapper)
      })
      sftp.once('error', (err: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(openTimeout)
        reject(err instanceof Error ? err : new Error(String(err)))
      })

      sftp._init()
    })
  })
}

// Shell escape: kết thúc single-quote, emit literal ', mở lại single-quote
const SH_SQ_ESC = String.raw`'\''`

/** Shell-quote bằng single-quote, an toàn với mọi ký tự trừ null byte. */
function shq(s: string): string {
  return `'${s.replaceAll("'", SH_SQ_ESC)}'`
}

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

type LoginAction =
  | { kind: 'ssh'; target: string; password: string | null }
  | { kind: 'su'; user: string; password: string | null }
  | { kind: 'sudo'; user: string | null; password: string | null }

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
function parseLoginActions(steps: Array<{ send: string; secret?: boolean }>): LoginAction[] {
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
function feedPasswordThenStdin(password: string, cmd: string): string {
  return `{ echo ${shq(password)}; cat; } | ${cmd}`
}

/** Bọc inner command với su USER -c (password nạp qua đầu stdin). */
function wrapSu(user: string, password: string | null, inner: string): string {
  const cmd = `su ${user} -c ${shq(inner)}`
  return password ? feedPasswordThenStdin(password, cmd) : cmd
}

/** Bọc inner command với sudo (-S đọc password từ stdin, nạp qua đầu stdin). */
function wrapSudo(user: string | null, password: string | null, inner: string): string {
  const userFlag = user ? `-u ${user} ` : ''
  if (password) return feedPasswordThenStdin(password, `sudo -S ${userFlag}bash -c ${shq(inner)}`)
  return `sudo ${userFlag}bash -c ${shq(inner)}`
}

/** Xây lệnh ssh … -s sftp cho đích SFTP cuối (dùng sshpass khi hop có password). */
function buildInnermostSftpCmd(target: string, password: string | null): string {
  if (password) return `${sshpassPrefix(password)}ssh ${EXEC_SSH_OPTS_PASSWORD} ${target} -s sftp`
  return `ssh ${EXEC_SSH_OPTS} ${target} -s sftp`
}

/** Bọc innerCmd bởi một SSH hop trung gian (dùng sshpass khi hop có password). */
function buildSshHopCmd(target: string, password: string | null, innerCmd: string): string {
  if (password) return `${sshpassPrefix(password)}ssh ${EXEC_SSH_OPTS_PASSWORD} ${target} ${shq(innerCmd)}`
  return `ssh ${EXEC_SSH_OPTS} ${target} ${shq(innerCmd)}`
}

/**
 * Xây dựng lệnh exec đầy đủ từ login script để truyền vào openSftpOverExec.
 *
 * Xử lý các tình huống theo đúng thứ tự lồng nhau. Ví dụ:
 *   steps = [ssh jpapst05, su vn_root+pass, ssh jpap06+pass]
 *   → exec trên gate:
 *     ssh OPTS jpapst05 '{ echo PASS_SU; cat; } | su vn_root -c
 *       '\''env LC_ALL=C sshpass -p PASS_JP6 ssh OPTS_PASSWORD jpap06 -s sftp'\'''
 *   su nuốt PASS_SU ở đầu stdin, cat đẩy tiếp dữ liệu SFTP cho ssh trong cùng;
 *   ssh dùng sshpass (pty riêng) để trả password, stdin/stdout giữ sạch cho dữ liệu.
 *   Yêu cầu: máy chạy ssh-có-password (vd jpapst05) phải cài sẵn sshpass.
 *
 * Trả về null nếu không có hop ssh nào (mở SFTP trực tiếp trên endpoint cuối chain).
 */
export function deriveSshArgsFromLoginSteps(
  steps: Array<{ send: string; secret?: boolean }>
): string | null {
  if (steps.length === 0) return null

  const actions = parseLoginActions(steps)

  // Tìm ssh action cuối cùng — đây là đích SFTP cuối cùng
  let lastSshIdx = -1
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i].kind === 'ssh') { lastSshIdx = i; break }
  }
  if (lastSshIdx === -1) return null

  // Bắt đầu từ lệnh SFTP đích (lớp trong cùng)
  const lastSsh = actions[lastSshIdx] as { kind: 'ssh'; target: string; password: string | null }
  let cmd = buildInnermostSftpCmd(lastSsh.target, lastSsh.password)

  // Xây dựng từ trong ra ngoài: bọc cmd bằng các action trước đó theo thứ tự ngược
  for (let i = lastSshIdx - 1; i >= 0; i--) {
    const action = actions[i]
    if (action.kind === 'su') {
      cmd = wrapSu(action.user, action.password, cmd)
    } else if (action.kind === 'sudo') {
      cmd = wrapSudo(action.user, action.password, cmd)
    } else if (action.kind === 'ssh') {
      cmd = buildSshHopCmd(action.target, action.password, cmd)
    }
  }

  return cmd
}
