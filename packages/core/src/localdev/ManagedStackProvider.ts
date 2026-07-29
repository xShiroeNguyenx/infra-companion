import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PhpCgiPool } from './php/PhpCgiPool'
import { allocatePort, type PortRange, type PortProbeResult } from './ports'
import { DEFAULT_PHP_EXTENSIONS, renderPhpIni } from './templates/phpIni'
import { renderNginxConf, renderSiteConf, upstreamName, type NginxUpstream } from './templates/nginxConf'
import { MARIADB_BIN_CANDIDATES, renderClientCnf, renderMyIni } from './templates/myIni'
import { renderPmaConfig } from './templates/pmaConfig'
import { renderCmdShim } from './templates/cmdShim'
import {
  ADMINER_DOMAIN,
  PMA_DOMAIN,
  cliShimSources,
  newestPhpRuntime,
  pickPhpForWebApp,
  webAppSources
} from './runtimeCatalog'
import { genDbPassword } from './mysqlCli'
// Import từ portPurpose (thuần) chứ KHÔNG từ LocalDevStore — store kéo theo `node:sqlite`
// (chỉ có từ Node 22.5) và sẽ làm module này không test được trên Node 20 của CI.
import { MARIADB_PORT_PURPOSE, WEB_PORT_PURPOSE, phpPortPurpose } from './portPurpose'
import type { ProcessSupervisor } from './ProcessSupervisor'
import type { PlatformAdapter } from './platform/PlatformAdapter'
import type { StackCapabilities, StackProvider } from './StackProvider'
import type { LocalDevPaths, ServiceStatus, SiteRow } from './types'

/**
 * ORCHESTRATOR của local dev stack: nơi DUY NHẤT khớp RuntimeManager + ProcessSupervisor +
 * template config + cấp phát cổng lại với nhau.
 *
 * NGUYÊN TẮC BẤT BIẾN: file config là KẾT QUẢ SUY DẪN từ DB, **regenerate mỗi lần start/apply**.
 * Config tham chiếu đường dẫn tuyệt đối vào `runtimes/<id>/` (vd include mime.types), nên nâng
 * nginx 1.28 → 1.30 sẽ làm đường dẫn cũ chết. User chỉ sửa ở `conf/nginx/extra/` và
 * `conf/php/<id>/conf.d/` — hai thư mục app KHÔNG BAO GIỜ ghi đè.
 */

/** Chỉ những gì provider cần từ store — hẹp lại để test fake được, không cần SQLite. */
export interface StackPortStore {
  takenPorts(): Set<number>
  getPort(purpose: string): number | null
  setPort(purpose: string, port: number): void
}

export interface StackSettings {
  phpPoolSize: number
  httpPortFrom: number
  httpPortTo: number
  timezone: string
}

export interface ManagedStackDeps {
  paths: LocalDevPaths
  adapter: PlatformAdapter
  supervisor: ProcessSupervisor
  /** Runtime đã cài (id → thư mục). Lấy từ RuntimeManager.listInstalled(). */
  installedRuntimes(): Promise<Array<{ id: string; dir: string; broken: boolean }>>
  sites(): SiteRow[]
  ports: StackPortStore
  settings(): StackSettings
  /** Inject để test không mở socket thật. */
  probePort?: (port: number) => Promise<PortProbeResult>
  cleanTmp?: () => Promise<void>
}

const NGINX_SERVICE_ID = 'nginx'
export const MARIADB_SERVICE_ID = 'mariadb'

/**
 * Domain của các công cụ DB. Nguồn sự thật là `runtimeCatalog` (cùng chỗ khai entry cài đặt) —
 * re-export ở đây để tầng trên không phải biết là dữ liệu nằm trong catalog.
 */
export { ADMINER_DOMAIN, PMA_DOMAIN }

/** Prefix id của 2 công cụ DB — dùng để tra runtime đã cài (id có kèm version). */
const ADMINER_ID_PREFIX = 'adminer-'
const PMA_ID_PREFIX = 'phpmyadmin-'

/**
 * Mọi thứ tầng trên cần để nói chuyện với MariaDB đang do stack quản. Provider là nơi DUY NHẤT
 * biết binary nằm đâu và cổng nào đã cấp, nên nó phát ra "target" này cho DbService dùng.
 */
export interface MariadbTarget {
  runtimeId: string
  dir: string
  port: number
  serverExe: string
  clientExe: string
  adminExe: string
  dumpExe: string
  dataDir: string
  confFile: string
  /** File `[client]` chứa password root — nguồn sự thật của mật khẩu root. */
  rootCnfFile: string
  rootPassword: string
  /**
   * Marker "đã dọn dẹp sau bootstrap". Tồn tại ⇒ đã bỏ database `test` mặc định.
   * Cần marker vì bước dọn phải chạy KHI SERVER ĐÃ LÊN (bootstrap chạy trước lúc spawn), và
   * không được lặp lại mỗi lần kết nối — `DROP DATABASE test` là thao tác phá dữ liệu.
   */
  securedMarkerFile: string
}

/** Tập cổng đã chiếm, TRỪ cổng của chính purpose đang xét (nếu không nó tự chặn chính mình). */
function takenExcept(taken: Set<number>, own: number | null): Set<number> {
  if (own === null) return taken
  const next = new Set(taken)
  next.delete(own)
  return next
}

/** Dải cổng cho pool php-cgi — tách khỏi dải web để không bao giờ tranh nhau. */
const PHP_PORT_RANGE: PortRange = [9000, 9099]

/**
 * Dải cổng MariaDB. CỐ Ý bắt đầu ở 3307 chứ không 3306: máy dev rất hay đã có
 * XAMPP/Laragon/MySQL Server nghe 3306, và bind trùng sẽ fail *sau khi* InnoDB đã mở data dir.
 */
const MARIADB_PORT_RANGE: PortRange = [3307, 3399]

/**
 * Dấu hiệu datadir đã bootstrap. Dùng THƯ MỤC `mysql/` chứ không file cụ thể: từ MariaDB 10.4
 * `mysql.user` chỉ còn là view (bảng thật là `global_priv`), nên bám vào `user.frm` sẽ khiến
 * install-db chạy lại trên một datadir đã có dữ liệu.
 */
const MARIADB_BOOTSTRAP_MARKER = 'mysql'

async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false
  )
}

/**
 * Tìm binary đầu tiên có thật trong danh sách ứng viên. Phải probe chứ không hard-code vì
 * MariaDB ≥11 đã đổi tên `mysqld/mysql/mysqldump` → `mariadbd/mariadb/mariadb-dump` và bỏ dần
 * alias cũ; hard-code một tên sẽ vỡ khi user cài bản khác.
 */
async function resolveBin(dir: string, candidates: readonly string[]): Promise<string | null> {
  for (const rel of candidates) {
    const p = join(dir, ...rel.split('/'))
    if (await exists(p)) return p
  }
  return null
}

/**
 * Dựng tham số cho `mariadb-install-db`, CHỈ dùng cờ mà chính binary khai báo trong `--help`.
 *
 * Vì sao không hard-code: bản Windows (`mariadb-install-db.exe`, viết bằng C++) và bản Unix
 * (`mariadb-install-db`, shell script) có tập option lệch nhau, và còn đổi giữa các version.
 * Truyền một cờ nó không biết ⇒ nó bỏ ngay ở bước parse, KHÔNG tạo datadir, thông báo lỗi
 * `unknown option '--xxx'`. Thuần → test được.
 *
 * `--datadir` là cờ duy nhất bắt buộc và có ở mọi bản, nên nếu probe help thất bại thì vẫn
 * chạy được với tập tối thiểu (password root sẽ do `DbService.ensureReady` đặt bù).
 */
export function buildInstallDbArgs(
  helpText: string,
  input: { dataDir: string; port: number; password: string }
): string[] {
  const has = (flag: string): boolean => helpText.includes(flag)
  // Không có help (probe fail) ⇒ chỉ dùng cờ chắc chắn tồn tại ở mọi bản
  const blind = helpText.trim() === ''
  const args = [`--datadir=${input.dataDir}`]
  if (blind || has('--port')) args.push(`--port=${String(input.port)}`)
  if (blind || has('--password')) args.push(`--password=${input.password}`)
  // Không tạo database `test` mà mọi user đều ghi được (chỉ có ở một số bản)
  if (has('--skip-test-db')) args.push('--skip-test-db')
  if (has('--silent')) args.push('--silent')
  return args
}

/** Đọc password root từ dòng `password = …` của file .cnf. */
export function parseCnfPassword(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*password\s*=\s*(.*)$/.exec(line)
    if (m) return m[1]!.trim()
  }
  return null
}

/**
 * Password root: sinh 1 lần rồi giữ trong `conf/mariadb/root.cnf`.
 *
 * Vì sao KHÔNG để root không mật khẩu (kiểu XAMPP) dù chỉ bind loopback: chính các site PHP
 * ta đang host cũng chạy trên loopback, nên một site có lỗ hổng sẽ nối được vào root và đọc/
 * xoá DB của MỌI site khác. Có password + grant hẹp cho từng site thì thiệt hại bị chặn lại.
 */
async function ensureRootPassword(rootCnfFile: string, port: number): Promise<string> {
  const existing = await readFile(rootCnfFile, 'utf8').then(
    (t) => parseCnfPassword(t),
    () => null
  )
  // Luôn ghi lại file: password GIỮ NGUYÊN (đó là thứ đã nằm trong datadir, đổi là mất quyền
  // vào DB), nhưng cổng phải khớp cổng vừa cấp — nếu không, user mở root.cnf ra dùng tay sẽ
  // nối vào cổng cũ và nhận "connection refused" rất khó hiểu.
  const password = existing ?? genDbPassword()
  await writeFile(rootCnfFile, renderClientCnf({ port, user: 'root', password }), 'utf8')
  return password
}

export class ManagedStackProvider implements StackProvider {
  readonly id = 'managed' as const
  readonly capabilities: StackCapabilities = {
    canInstallRuntime: true,
    canReload: true,
    // M1: chưa làm cert/hosts (thuộc M1.5) — UI dựa vào cờ này để ẩn nút
    canIssueCert: false,
    canEditHosts: false
  }

  /** Cổng đã cấp cho pool php của từng runtime, giữ trong phiên để sinh config nhất quán. */
  private phpPorts = new Map<string, number[]>()
  private webPort: number | null = null
  private mariadb: MariadbTarget | null = null
  /** Config đã sinh + spec đã đăng ký cho trạng thái hiện tại? Xem `ensurePrepared`. */
  private prepared = false

  constructor(private readonly deps: ManagedStackDeps) {}

  async init(): Promise<{ reaped: number }> {
    await this.deps.cleanTmp?.()
    const { killed } = await this.deps.supervisor.reconcile()
    return { reaped: killed.length }
  }

  services(): ServiceStatus[] {
    return this.deps.supervisor.status()
  }

  /**
   * `id` nhận CẢ id 1 service (`php-8.3#0`) LẪN groupId (`php-8.3`, `nginx`).
   * UI hiển thị pool php theo nhóm nên nút bật/tắt gửi groupId; nếu không xử lý ở đây thì
   * supervisor sẽ throw "Service chưa đăng ký" — nút im lặng không làm gì.
   */
  async start(id: string): Promise<void> {
    if (this.isServiceId(id)) return this.deps.supervisor.start(id)
    return this.deps.supervisor.startGroup(id)
  }

  async stop(id: string): Promise<void> {
    if (this.isServiceId(id)) return this.deps.supervisor.stop(id)
    return this.deps.supervisor.stopGroup(id)
  }

  async restart(id: string): Promise<void> {
    if (this.isServiceId(id)) return this.deps.supervisor.restart(id)
    await this.deps.supervisor.stopGroup(id)
    await this.deps.supervisor.startGroup(id)
  }

  private isServiceId(id: string): boolean {
    return this.deps.supervisor.status().some((s) => s.id === id)
  }

  tailLog(serviceId: string, lines: number): string[] {
    return this.deps.supervisor.tail(serviceId, lines)
  }

  /**
   * Bật cả stack: sinh config → đăng ký spec → start php pool TRƯỚC rồi mới nginx.
   * Thứ tự quan trọng: nginx `upstream` trỏ vào cổng php, start nginx trước thì request đầu
   * tiên sẽ 502.
   */
  async startAll(): Promise<void> {
    const plan = await this.prepare()
    this.prepared = true
    // MariaDB trước: WordPress hỏng ngay ở request đầu nếu PHP lên trước DB
    if (plan.mariadbRegistered) await this.deps.supervisor.start(MARIADB_SERVICE_ID)
    for (const runtimeId of plan.phpRuntimeIds) await this.deps.supervisor.startGroup(runtimeId)
    if (plan.nginxRegistered) await this.deps.supervisor.start(NGINX_SERVICE_ID)
  }

  async stopAll(): Promise<void> {
    await this.deps.supervisor.stopAll()
  }

  /** Sinh lại config từ DB rồi reload nginx (gate bằng `nginx -t`). */
  async applySites(): Promise<{ ok: boolean; error?: string }> {
    const plan = await this.prepare()
    this.prepared = true
    if (!plan.nginxRegistered) return { ok: false, error: 'Chưa cài nginx' }
    return this.reloadNginx()
  }

  /**
   * Đảm bảo spec đã đăng ký + config đã sinh, KHÔNG chạy `nginx -t`/`-s reload`.
   *
   * Dùng cho đường ĐỌC (renderer poll danh sách service mỗi 3s). Trước đây đường đó gọi
   * `applySites()` ⇒ mỗi 3 giây lại ghi đè toàn bộ file config + spawn `nginx -t` + `nginx -s
   * reload`; log nginx đầy `signal process started` và mỗi lần reload là một lần nginx drop
   * worker cũ. Thao tác GHI (thêm/xoá site, cài/gỡ runtime) vẫn gọi `applySites()`.
   */
  async ensurePrepared(): Promise<void> {
    if (this.prepared) return
    await this.prepare()
    this.prepared = true
  }

  /** Đánh dấu config đã cũ (đổi cài đặt, thêm runtime…) → lần đọc sau sinh lại. */
  markDirty(): void {
    this.prepared = false
  }

  async dispose(graceMs: number): Promise<void> {
    await this.deps.supervisor.stopAll(graceMs)
  }

  // ── nội bộ ──────────────────────────────────────────────────────────────────

  /**
   * Cấp cổng + sinh mọi file config + đăng ký spec vào supervisor.
   * Idempotent: gọi lại sẽ regenerate config và cập nhật spec (không giết process đang chạy).
   */
  private async prepare(): Promise<{
    phpRuntimeIds: string[]
    nginxRegistered: boolean
    mariadbRegistered: boolean
  }> {
    const { paths, adapter, supervisor, ports, settings } = this.deps
    const cfg = settings()
    const installed = (await this.deps.installedRuntimes()).filter((r) => !r.broken)
    const nginx = installed.find((r) => r.id.startsWith('nginx-'))
    const phpRuntimes = installed.filter((r) => r.id.startsWith('php-'))
    const reserved = await adapter.reservedPortRanges().catch(() => [])
    const probe = this.deps.probePort

    await this.ensureDirs()

    // ── Cổng web ──
    if (this.webPort === null) {
      const remembered = ports.getPort(WEB_PORT_PURPOSE)
      const res = await allocatePort(
        remembered,
        [cfg.httpPortFrom, cfg.httpPortTo],
        // Loại cổng CỦA CHÍNH purpose này khỏi tập "đã bị chiếm" — nếu không, cổng đã ghi nhớ
        // tự coi mình bị chiếm ⇒ mỗi lần khởi động lại cấp cổng mới ⇒ URL user bookmark chết.
        takenExcept(ports.takenPorts(), remembered),
        reserved,
        probe
      )
      if (res.port === null) {
        throw new Error(
          `Không còn cổng rảnh trong dải ${String(cfg.httpPortFrom)}–${String(cfg.httpPortTo)}` +
            (res.lastReason === 'os-reserved'
              ? ' (dải này đang bị Windows/Hyper-V giữ — đổi dải cổng trong Cài đặt)'
              : '')
        )
      }
      this.webPort = res.port
      ports.setPort(WEB_PORT_PURPOSE, res.port)
    }

    // ── php.ini + pool cho từng runtime PHP ──
    const upstreams: NginxUpstream[] = []
    const phpRuntimeIds: string[] = []
    /** runtimeId → php.ini đã sinh. Shim CLI (composer/wp) cần đúng ini này, xem writeBinShims. */
    const phpIniFiles = new Map<string, string>()
    for (const rt of phpRuntimes) {
      const poolPorts = await this.ensurePhpPorts(rt.id, cfg.phpPoolSize, reserved, probe)
      const iniFile = await this.writePhpIni(rt)
      phpIniFiles.set(rt.id, iniFile)
      const pool = new PhpCgiPool(poolPorts)
      const specs = pool.buildSpecs({
        runtimeId: rt.id,
        phpCgiExe: join(rt.dir, 'php-cgi.exe'),
        iniFile,
        cwd: rt.dir,
        logFile: join(paths.logs, `${rt.id}.log`),
        ports: poolPorts,
        tmpDir: join(paths.tmp, rt.id),
        // PATH có thư mục runtime để php tìm DLL nằm cạnh nó (ICU cho ext intl)
        pathEntries: [rt.dir]
      })
      for (const s of specs) supervisor.register(s)
      upstreams.push({ name: upstreamName(rt.id), ports: poolPorts })
      phpRuntimeIds.push(rt.id)
    }

    // ── MariaDB ──
    const mariadbRt = installed.find((r) => r.id.startsWith('mariadb-'))
    this.mariadb = mariadbRt ? await this.prepareMariadb(mariadbRt, reserved, probe) : null

    // ── Tool: config.inc.php của phpMyAdmin + shim composer/wp trong bin/ ──
    // Sau MariaDB vì config pma cần cổng + password root vừa cấp; TRƯỚC nginx vì không phụ
    // thuộc vhost (thiếu nginx thì chỉ là chưa mở được bằng browser).
    await this.writePmaConfig(installed)
    await this.writeBinShims(installed, phpRuntimeIds, phpIniFiles)

    // ── nginx.conf + vhost từng site ──
    let nginxRegistered = false
    if (nginx) {
      await this.writeNginxConf(nginx.dir, upstreams)
      await this.writeSiteConfs(nginx.dir, phpRuntimeIds)
      supervisor.register({
        id: NGINX_SERVICE_ID,
        groupId: NGINX_SERVICE_ID,
        label: 'Nginx',
        exe: join(nginx.dir, 'nginx.exe'),
        args: ['-p', this.nginxPrefix(), '-c', this.nginxConfFile()],
        cwd: nginx.dir,
        env: {
          PATH: nginx.dir,
          SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
          TEMP: paths.tmp,
          TMP: paths.tmp
        },
        logFile: join(paths.logs, 'nginx-error.log'),
        healthPort: this.webPort,
        // nginx master thoát code 0 là BẤT THƯỜNG (nó phải chạy mãi) → không auto-restart
        restartOnCleanExit: false,
        maxRestarts: 5,
        restartWindowMs: 60_000,
        graceMs: 5_000,
        gracefulStop: async () => {
          const res = await adapter.runShort(
            join(nginx.dir, 'nginx.exe'),
            ['-p', this.nginxPrefix(), '-c', this.nginxConfFile(), '-s', 'quit'],
            { cwd: nginx.dir, timeoutMs: 5_000 }
          )
          return res.code === 0
        }
      })
      nginxRegistered = true
    }

    return { phpRuntimeIds, nginxRegistered, mariadbRegistered: this.mariadb !== null }
  }

  /**
   * Cấp cổng + sinh my.ini + đăng ký service MariaDB. Trả về target cho DbService.
   *
   * BA CHI TIẾT DỄ MẤT DỮ LIỆU nếu làm sai, đều xử ở đây:
   *  1. `--defaults-file` (KHÔNG phải `--defaults-extra-file`) để mysqld bỏ qua `my.ini` toàn cục
   *     của XAMPP/Laragon có thể đang nằm ở `C:\` hoặc `%WINDIR%`.
   *  2. Dừng bằng `mariadb-admin shutdown` — taskkill giữa transaction = mất điện, lần sau
   *     InnoDB phải crash-recovery (và có thể mất write chưa flush).
   *  3. `bootstrap` chỉ chạy khi datadir CHƯA có `mysql/` — chạy lại install-db trên datadir
   *     đã có dữ liệu là hỏng.
   */
  private async prepareMariadb(
    rt: { id: string; dir: string },
    reserved: readonly PortRange[],
    probe?: (port: number) => Promise<PortProbeResult>
  ): Promise<MariadbTarget | null> {
    const { paths, adapter, supervisor, ports } = this.deps

    const serverExe = await resolveBin(rt.dir, MARIADB_BIN_CANDIDATES.server)
    const clientExe = await resolveBin(rt.dir, MARIADB_BIN_CANDIDATES.client)
    const adminExe = await resolveBin(rt.dir, MARIADB_BIN_CANDIDATES.admin)
    const dumpExe = await resolveBin(rt.dir, MARIADB_BIN_CANDIDATES.dump)
    const installDbExe = await resolveBin(rt.dir, MARIADB_BIN_CANDIDATES.installDb)
    // Thiếu server thì không có gì để chạy; thiếu client/admin thì có chạy cũng không dùng được
    if (!serverExe || !clientExe || !adminExe) return null

    const dataDir = paths.dataMariadb
    const tmpDir = join(paths.tmp, 'mariadb')
    const confDir = paths.confMariadb
    await mkdir(confDir, { recursive: true })
    await mkdir(dataDir, { recursive: true })
    await mkdir(tmpDir, { recursive: true })

    const remembered = ports.getPort(MARIADB_PORT_PURPOSE)
    const alloc = await allocatePort(
      remembered,
      MARIADB_PORT_RANGE,
      takenExcept(ports.takenPorts(), remembered),
      reserved,
      probe
    )
    if (alloc.port === null) {
      throw new Error(
        'Không còn cổng rảnh cho MariaDB (dải 3307–3399)' +
          (alloc.lastReason === 'os-reserved' ? ' — dải này đang bị Windows/Hyper-V giữ' : '')
      )
    }
    const port = alloc.port
    ports.setPort(MARIADB_PORT_PURPOSE, port)

    const rootCnfFile = join(confDir, 'root.cnf')
    const rootPassword = await ensureRootPassword(rootCnfFile, port)

    const confFile = join(confDir, 'my.ini')
    await writeFile(
      confFile,
      renderMyIni({
        basedir: rt.dir,
        datadir: dataDir,
        tmpdir: tmpDir,
        logError: join(paths.logs, 'mariadb.log'),
        port
      }),
      'utf8'
    )

    supervisor.register({
      id: MARIADB_SERVICE_ID,
      groupId: MARIADB_SERVICE_ID,
      label: 'MariaDB',
      exe: serverExe,
      args: [`--defaults-file=${confFile}`],
      cwd: rt.dir,
      env: {
        PATH: join(rt.dir, 'bin'),
        SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
        TEMP: tmpDir,
        TMP: tmpDir
      },
      logFile: join(paths.logs, 'mariadb.log'),
      healthPort: port,
      // mysqld thoát code 0 nghĩa là bị shutdown chủ động → KHÔNG được tự bật lại
      restartOnCleanExit: false,
      maxRestarts: 3,
      restartWindowMs: 120_000,
      // Buffer pool lớn có thể mất >10s để flush; cắt sớm = crash-recovery lần sau
      graceMs: 20_000,
      gracefulStop: async () => {
        const cnf = join(tmpDir, 'shutdown.cnf')
        try {
          await writeFile(cnf, renderClientCnf({ port, user: 'root', password: rootPassword }), 'utf8')
          const res = await adapter.runShort(adminExe, [`--defaults-extra-file=${cnf}`, 'shutdown'], {
            cwd: rt.dir,
            timeoutMs: 20_000
          })
          return res.code === 0
        } finally {
          await rm(cnf, { force: true }).catch(() => {})
        }
      },
      bootstrap: async () => {
        if (await exists(join(dataDir, MARIADB_BOOTSTRAP_MARKER))) return
        if (!installDbExe) {
          throw new Error('Runtime MariaDB thiếu mariadb-install-db.exe — hãy cài lại runtime')
        }
        // HỎI binary xem nó nhận cờ nào thay vì đoán. Bản Windows và bản shell script Unix của
        // mariadb-install-db có tập option KHÁC NHAU (bug đã gặp: `--skip-test-db` chỉ có ở bản
        // Unix ⇒ bản Windows chết ngay ở parse option, không tạo được datadir nào).
        const help = await adapter
          .runShort(installDbExe, ['--help'], { cwd: rt.dir, timeoutMs: 20_000 })
          .then((r) => `${r.stdout}\n${r.stderr}`)
          .catch(() => '')
        const args = buildInstallDbArgs(help, { dataDir, port, password: rootPassword })
        const res = await adapter.runShort(installDbExe, args, { cwd: rt.dir, timeoutMs: 180_000 })
        if (!(await exists(join(dataDir, MARIADB_BOOTSTRAP_MARKER)))) {
          throw new Error(
            `Khởi tạo dữ liệu MariaDB thất bại: ${(res.stderr || res.stdout || `mã ${String(res.code)}`).trim().slice(-500)}`
          )
        }
      }
    })

    return {
      runtimeId: rt.id,
      dir: rt.dir,
      port,
      serverExe,
      clientExe,
      adminExe,
      dumpExe: dumpExe ?? clientExe,
      dataDir,
      confFile,
      rootCnfFile,
      securedMarkerFile: join(confDir, '.secured'),
      rootPassword
    }
  }

  /** Target MariaDB hiện tại (null = chưa cài runtime). Sinh config nếu chưa có. */
  async mariadbTarget(): Promise<MariadbTarget | null> {
    if (this.mariadb) return this.mariadb
    await this.ensurePrepared()
    return this.mariadb
  }

  /** MariaDB đang chạy? Dùng để UI/IPC biết có cấp DB được ngay hay phải bật service trước. */
  mariadbRunning(): boolean {
    return this.deps.supervisor.status(MARIADB_SERVICE_ID)[0]?.state === 'running'
  }

  /** Cấp (hoặc dùng lại) cổng cho pool php. Ghi vào store để lần sau giữ nguyên cổng. */
  private async ensurePhpPorts(
    runtimeId: string,
    size: number,
    reserved: readonly PortRange[],
    probe?: (port: number) => Promise<PortProbeResult>
  ): Promise<number[]> {
    const cached = this.phpPorts.get(runtimeId)
    if (cached && cached.length === size) return cached
    const out: number[] = []
    for (let i = 0; i < size; i++) {
      const purpose = phpPortPurpose(runtimeId, i)
      const remembered = this.deps.ports.getPort(purpose)
      // Cũng loại cổng của chính worker này để giữ cổng ổn định giữa các lần khởi động
      const taken = takenExcept(new Set([...this.deps.ports.takenPorts(), ...out]), remembered)
      const res = await allocatePort(remembered, PHP_PORT_RANGE, taken, reserved, probe)
      if (res.port === null) throw new Error(`Không còn cổng rảnh cho pool PHP (dải 9000–9099)`)
      this.deps.ports.setPort(purpose, res.port)
      out.push(res.port)
    }
    this.phpPorts.set(runtimeId, out)
    return out
  }

  private async writePhpIni(rt: { id: string; dir: string }): Promise<string> {
    const { paths } = this.deps
    const confDir = join(paths.confPhp, rt.id)
    const extConfDir = join(confDir, 'conf.d')
    const tmpDir = join(paths.tmp, rt.id)
    await mkdir(extConfDir, { recursive: true })
    await mkdir(tmpDir, { recursive: true })
    const iniFile = join(confDir, 'php.ini')
    await writeFile(
      iniFile,
      renderPhpIni({
        runtimeRoot: rt.dir,
        tmpDir,
        extConfDir,
        errorLog: join(paths.logs, `${rt.id}-error.log`),
        timezone: this.deps.settings().timezone,
        memoryLimit: '512M',
        extensions: DEFAULT_PHP_EXTENSIONS
      }),
      'utf8'
    )
    return iniFile
  }

  private async writeNginxConf(nginxDir: string, upstreams: NginxUpstream[]): Promise<void> {
    const { paths } = this.deps
    await writeFile(
      this.nginxConfFile(),
      renderNginxConf({
        nginxRoot: nginxDir,
        prefix: this.nginxPrefix(),
        confDir: paths.confNginx,
        logDir: paths.logs,
        runDir: paths.run,
        tempDir: join(paths.tmp, 'nginx'),
        phpUpstreams: upstreams
      }),
      'utf8'
    )
  }

  /**
   * Ghi lại TOÀN BỘ vhost từ DB: xoá file .conf cũ trước rồi ghi mới. Nếu chỉ ghi thêm,
   * site đã xoá vẫn còn file conf → nginx vẫn phục vụ nó (bug rất khó hiểu).
   *
   * @param phpRuntimeIds Các runtime PHP ĐANG CÀI (biết ở thời điểm sinh config).
   */
  private async writeSiteConfs(nginxDir: string, phpRuntimeIds: readonly string[]): Promise<void> {
    const { paths } = this.deps
    const dir = paths.confNginxSites
    await mkdir(dir, { recursive: true })
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      if (f.endsWith('.conf')) await rm(join(dir, f), { force: true })
    }
    const fastcgiParams = join(nginxDir, 'conf', 'fastcgi_params')
    for (const site of this.deps.sites()) {
      if (site.status !== 'ready') continue

      // Chọn PHP tại THỜI ĐIỂM SINH CONFIG, không dùng cứng site.phpVersion.
      // Lý do (bug đã gặp): user thêm site TRƯỚC khi cài PHP ⇒ phpVersion=null được chốt lại,
      // cài PHP xong vhost vẫn không có fastcgi_pass ⇒ nginx trả 403 vì chỉ tìm index.html.
      // Ưu tiên version site đã chọn nếu còn cài; không thì lấy PHP đang có.
      const phpId =
        site.kind === 'static'
          ? null
          : (phpRuntimeIds.find((id) => id === site.phpVersion) ?? phpRuntimeIds[0] ?? null)
      const hasPhp = phpId !== null

      // Log của site nằm trong khu vực của APP, KHÔNG ghi vào thư mục project của user
      // (site là folder có sẵn của họ — có thể là repo git; app không được rải file vào đó).
      const logDir = join(paths.logs, 'sites', site.slug)
      await mkdir(logDir, { recursive: true }).catch(() => {})

      await writeFile(
        join(dir, `${site.slug}.conf`),
        renderSiteConf({
          domain: site.domain,
          docRoot: site.docRoot,
          httpPort: this.webPort ?? site.httpPort,
          phpUpstream: hasPhp ? upstreamName(phpId) : null,
          ...(hasPhp ? { fastcgiParams } : {}),
          logDir,
          indexFiles: hasPhp ? ['index.php', 'index.html', 'index.htm'] : ['index.html', 'index.htm'],
          tryFilesFallback:
            site.kind === 'wordpress' ? '/index.php?$args' : hasPhp ? '/index.php?$query_string' : null
        }),
        'utf8'
      )
    }

    await this.writeWebAppConfs(dir, fastcgiParams, phpRuntimeIds)
  }

  /**
   * vhost cho các web app PHP do app host (Adminer tại `db.localhost`, phpMyAdmin tại
   * `pma.localhost`) — vai trò phpMyAdmin của XAMPP.
   *
   * Docroot là THƯ MỤC RIÊNG của runtime tương ứng, không phải docroot của site nào: chúng
   * quản trị được MỌI database, nên đặt trong folder site sẽ (a) bị deploy lên server thật
   * cùng code, (b) cho bất kỳ ai vào được site cũng vào được nó.
   *
   * Dữ liệu vhost (domain/slug/index/trần PHP) nằm trong `runtimeCatalog` cạnh entry cài đặt —
   * thêm công cụ thứ ba chỉ là thêm 1 entry, không phải thêm một hàm gần-giống nữa.
   */
  private async writeWebAppConfs(
    sitesDir: string,
    fastcgiParams: string,
    phpRuntimeIds: readonly string[]
  ): Promise<void> {
    const { paths } = this.deps
    const installed = (await this.deps.installedRuntimes()).filter((r) => !r.broken)
    for (const src of webAppSources()) {
      const rt = installed.find((r) => r.id === src.id)
      // Là code PHP — không có PHP thì vhost sẽ trả về mã nguồn dạng text
      const phpId = pickPhpForWebApp(src.webApp, phpRuntimeIds)
      if (!rt || phpId === null) continue

      const logDir = join(paths.logs, 'sites', src.webApp.slug)
      await mkdir(logDir, { recursive: true }).catch(() => {})
      await writeFile(
        join(sitesDir, `${src.webApp.slug}.conf`),
        renderSiteConf({
          domain: src.webApp.domain,
          docRoot: rt.dir,
          httpPort: this.webPort ?? 8080,
          phpUpstream: upstreamName(phpId),
          fastcgiParams,
          logDir,
          indexFiles: [src.webApp.index],
          tryFilesFallback: null
        }),
        'utf8'
      )
    }
  }

  /**
   * `config.inc.php` của phpMyAdmin — xem `templates/pmaConfig.ts` về việc vì sao PHẢI sinh và
   * vì sao ghi vào thư mục runtime. Chưa cài pma hoặc chưa có MariaDB ⇒ không có gì để ghi.
   */
  private async writePmaConfig(installed: ReadonlyArray<{ id: string; dir: string }>): Promise<void> {
    const { paths } = this.deps
    const rt = installed.find((r) => r.id.startsWith(PMA_ID_PREFIX))
    const db = this.mariadb
    if (!rt || !db) return

    const tempDir = join(paths.tmp, 'phpmyadmin')
    await mkdir(tempDir, { recursive: true }).catch(() => {})
    await writeFile(
      join(rt.dir, 'config.inc.php'),
      renderPmaConfig({
        host: '127.0.0.1',
        port: db.port,
        user: 'root',
        password: db.rootPassword,
        blowfishSecret: await this.pmaBlowfishSecret(),
        tempDir
      }),
      'utf8'
    )
  }

  /**
   * Secret mã hoá cookie của pma: sinh 1 lần rồi giữ ở `conf/pma-blowfish.secret`.
   * KHÔNG sinh mới mỗi lần apply — đổi secret làm mọi session pma đang mở bị đăng xuất.
   */
  private async pmaBlowfishSecret(): Promise<string> {
    const file = join(this.deps.paths.conf, 'pma-blowfish.secret')
    const existing = await readFile(file, 'utf8').then(
      (t) => t.trim(),
      () => ''
    )
    // pma yêu cầu ≥32 ký tự, nếu không sẽ hiện cảnh báo đỏ ở mọi trang
    if (existing.length >= 32) return existing
    const secret = genDbPassword(32)
    await mkdir(this.deps.paths.conf, { recursive: true }).catch(() => {})
    await writeFile(file, secret, 'utf8')
    return secret
  }

  /**
   * Shim `bin/composer.cmd`, `bin/wp.cmd` cho các tool `.phar` đã cài (xem `templates/cmdShim`).
   * `bin/` đã nằm trong PATH của terminal mở tại site.
   *
   * XOÁ shim khi tool/PHP không còn: shim trỏ vào phar đã bị gỡ sẽ báo "Could not open input
   * file" — thông báo không nói được lý do thật là "bạn đã gỡ Composer".
   */
  private async writeBinShims(
    installed: ReadonlyArray<{ id: string; dir: string }>,
    phpRuntimeIds: readonly string[],
    phpIniFiles: ReadonlyMap<string, string>
  ): Promise<void> {
    const { paths } = this.deps
    await mkdir(paths.bin, { recursive: true }).catch(() => {})
    // Ưu tiên PHP mới nhất đang cài cho CLI (Composer/WP-CLI đều chạy tốt trên bản mới)
    const phpId = newestPhpRuntime(phpRuntimeIds)
    const phpDir = phpId === null ? undefined : installed.find((r) => r.id === phpId)?.dir
    const iniFile = phpId === null ? undefined : phpIniFiles.get(phpId)

    for (const src of cliShimSources()) {
      const shimFile = join(paths.bin, `${src.cliShim.name}.cmd`)
      const rt = installed.find((r) => r.id === src.id)
      if (!rt || phpDir === undefined || iniFile === undefined) {
        await rm(shimFile, { force: true }).catch(() => {})
        continue
      }
      await writeFile(
        shimFile,
        renderCmdShim({ phpExe: join(phpDir, 'php.exe'), iniFile, phar: join(rt.dir, src.cliShim.phar) }),
        'utf8'
      )
    }
  }

  /** Công cụ DB (Adminer/phpMyAdmin) đã cài + có PHP để chạy nó? (UI ẩn nút khi chưa.) */
  private async webAppReady(idPrefix: string): Promise<boolean> {
    const installed = (await this.deps.installedRuntimes()).filter((r) => !r.broken)
    return installed.some((r) => r.id.startsWith(idPrefix)) && installed.some((r) => r.id.startsWith('php-'))
  }

  async adminerReady(): Promise<boolean> {
    return this.webAppReady(ADMINER_ID_PREFIX)
  }

  async phpMyAdminReady(): Promise<boolean> {
    return this.webAppReady(PMA_ID_PREFIX)
  }

  /** Cổng web đang cấp cho nginx (null = chưa cấp được). */
  private async resolveWebPort(): Promise<number | null> {
    await this.ensurePrepared()
    return this.webPort ?? this.deps.ports.getPort(WEB_PORT_PURPOSE)
  }

  /** URL mở Adminer, đã điền sẵn server/username/db để bớt 3 lần gõ. */
  async adminerUrl(dbName?: string): Promise<string | null> {
    if (!(await this.adminerReady())) return null
    const port = await this.resolveWebPort()
    if (port === null) return null
    const db = this.mariadb
    const q = new URLSearchParams()
    if (db) q.set('server', `127.0.0.1:${String(db.port)}`)
    q.set('username', 'root')
    if (dbName) q.set('db', dbName)
    return `http://${ADMINER_DOMAIN}:${String(port)}/?${q.toString()}`
  }

  /**
   * URL mở phpMyAdmin. Không cần truyền credentials qua query như Adminer: `config.inc.php`
   * đã có sẵn host/cổng/mật khẩu root (`auth_type = 'config'`) nên vào là dùng được ngay.
   */
  async phpMyAdminUrl(dbName?: string): Promise<string | null> {
    if (!(await this.phpMyAdminReady())) return null
    const port = await this.resolveWebPort()
    if (port === null) return null
    const q = new URLSearchParams()
    if (dbName) q.set('db', dbName)
    const query = q.toString()
    return `http://${PMA_DOMAIN}:${String(port)}/${query ? `?${query}` : ''}`
  }

  /**
   * Reload nginx có GATE `nginx -t`.
   * Không có gate thì 1 site conf sai cú pháp sẽ làm nginx từ chối load → CẢ STACK CHẾT vì 1
   * site. Gate biến lỗi đó thành một message đỏ đúng chỗ.
   */
  private async reloadNginx(): Promise<{ ok: boolean; error?: string }> {
    const installed = (await this.deps.installedRuntimes()).find((r) => r.id.startsWith('nginx-') && !r.broken)
    if (!installed) return { ok: false, error: 'Chưa cài nginx' }
    const exe = join(installed.dir, 'nginx.exe')
    const base = ['-p', this.nginxPrefix(), '-c', this.nginxConfFile()]

    const test = await this.deps.adapter.runShort(exe, ['-t', ...base], { cwd: installed.dir, timeoutMs: 15_000 })
    if (test.code !== 0) {
      return { ok: false, error: (test.stderr || test.stdout || 'nginx -t thất bại').trim().slice(-500) }
    }
    // nginx chưa chạy thì không có gì để reload — coi là thành công (config đã hợp lệ)
    const running = this.deps.supervisor.status(NGINX_SERVICE_ID)[0]?.state === 'running'
    if (!running) return { ok: true }

    const reload = await this.deps.adapter.runShort(exe, ['-s', 'reload', ...base], {
      cwd: installed.dir,
      timeoutMs: 15_000
    })
    if (reload.code === 0) return { ok: true }
    // `-s reload` thất bại (pid file lệch…) → hạ cấp sang restart hẳn
    await this.deps.supervisor.restart(NGINX_SERVICE_ID)
    return { ok: true }
  }

  private nginxPrefix(): string {
    return join(this.deps.paths.run, 'nginx-prefix')
  }

  private nginxConfFile(): string {
    return join(this.deps.paths.confNginx, 'nginx.conf')
  }

  /** nginx cần logs/ + temp/ writable trong prefix, nếu không nó cố ghi vào runtimes/. */
  private async ensureDirs(): Promise<void> {
    const { paths } = this.deps
    const prefix = this.nginxPrefix()
    for (const d of [
      paths.confNginx,
      paths.confNginxSites,
      paths.confNginxExtra,
      paths.confPhp,
      paths.logs,
      paths.run,
      paths.tmp,
      join(paths.tmp, 'nginx'),
      join(prefix, 'logs'),
      join(prefix, 'temp')
    ]) {
      await mkdir(d, { recursive: true })
    }
  }
}
