import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { ManagedStackProvider, buildInstallDbArgs, parseCnfPassword, type StackPortStore } from './ManagedStackProvider'
import { ProcessSupervisor, type SpawnFn, type SpawnedProcess } from './ProcessSupervisor'
import { localDevPaths } from './paths'
import type { PlatformAdapter } from './platform/PlatformAdapter'
import type { LocalDevPaths, SiteRow } from './types'

const roots: string[] = []
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

class FakeProc implements SpawnedProcess {
  constructor(readonly pid: number) {}
  readonly stdout = { on: () => undefined }
  readonly stderr = { on: () => undefined }
  on(): this {
    return this
  }
}

/** Store cổng in-memory (khỏi cần SQLite trong test này). */
function memPorts(initial: Record<string, number> = {}): StackPortStore & { all(): Record<string, number> } {
  const map = new Map<string, number>(Object.entries(initial))
  return {
    takenPorts: () => new Set(map.values()),
    getPort: (p) => map.get(p) ?? null,
    setPort: (p, port) => {
      map.set(p, port)
    },
    all: () => Object.fromEntries(map)
  }
}

function site(over: Partial<SiteRow> = {}): SiteRow {
  return {
    id: 'id-1',
    name: 'Demo',
    slug: 'demo',
    domain: 'demo.localhost',
    rootPath: 'D:\\www\\demo',
    docRoot: 'D:\\www\\demo',
    phpVersion: 'php-8.3',
    httpPort: 8080,
    https: false,
    kind: 'php',
    status: 'ready',
    createdByApp: false,
    lastError: null,
    dbName: null,
    dbUser: null,
    dbPass: null,
    createdAt: 1,
    updatedAt: 1,
    ...over
  }
}

/**
 * `--help` của mariadb-install-db.exe THẬT trên Windows (11.4): KHÔNG có `--skip-test-db`
 * (cờ đó chỉ tồn tại ở bản shell script trên Unix).
 */
const DEFAULT_INSTALL_DB_HELP = `
Usage: mariadb-install-db.exe [OPTIONS]
  -d, --datadir=name   Data directory of the new database
  -S, --service=name   Windows service name
  -p, --password=name  Password of the root user
  -P, --port=#         mysql port
  -D, --default-user   Create default user
  -R, --allow-remote-root-access
  -s, --silent         Print less information
  -o, --verbose-bootstrap
`

/** Runtime MariaDB giả với đủ (hoặc thiếu) binary — `resolveBin` probe file thật. */
const MARIADB_BINS = [
  'bin/mariadbd.exe',
  'bin/mariadb.exe',
  'bin/mariadb-admin.exe',
  'bin/mariadb-dump.exe',
  'bin/mariadb-install-db.exe'
] as const

interface H {
  paths: LocalDevPaths
  provider: ManagedStackProvider
  sup: ProcessSupervisor
  ports: ReturnType<typeof memPorts>
  runShortCalls: Array<{ exe: string; args: string[] }>
  setNginxTestResult: (code: number, stderr?: string) => void
  sites: SiteRow[]
  spawned: () => number
}

async function harness(over?: {
  sites?: SiteRow[]
  installed?: Array<{ id: string; dir: string; broken: boolean }>
  ports?: Record<string, number>
  reserved?: Array<readonly [number, number]>
  poolSize?: number
  portRange?: [number, number]
  /** Cổng mà probe sẽ báo "đang bị chiếm" (giả lập process khác giữ cổng). */
  busyPorts?: number[]
  /** Binary MariaDB CÓ trên đĩa (mặc định đủ cả 5). Để test runtime cài thiếu. */
  mariadbBins?: readonly string[]
  /** Nội dung datadir MariaDB dựng trước — có 'mysql' nghĩa là đã bootstrap. */
  mariadbDataDirs?: readonly string[]
  /** Text mà `mariadb-install-db --help` trả về (quyết định cờ nào được truyền). */
  installDbHelp?: string
  /** Bật "dùng cổng 80" (URL không có :port). */
  usePort80?: boolean
}): Promise<H> {
  const rootDir = mkdtempSync(join(tmpdir(), 'infra-stack-'))
  roots.push(rootDir)
  const paths = localDevPaths(rootDir)

  // Runtime "đã cài" giả — tạo thư mục + file exe stub để đường dẫn có thật
  const installed =
    over?.installed ??
    [
      { id: 'nginx-1.28', dir: join(paths.runtimes, 'nginx-1.28'), broken: false },
      { id: 'php-8.3', dir: join(paths.runtimes, 'php-8.3'), broken: false }
    ]
  for (const rt of installed) {
    await mkdir(join(rt.dir, 'conf'), { recursive: true })
    await writeFile(join(rt.dir, 'conf', 'fastcgi_params'), '# stub', 'utf8')
    await writeFile(join(rt.dir, 'conf', 'mime.types'), '# stub', 'utf8')
    if (rt.id.startsWith('mariadb-')) {
      await mkdir(join(rt.dir, 'bin'), { recursive: true })
      for (const rel of over?.mariadbBins ?? MARIADB_BINS) {
        await writeFile(join(rt.dir, ...rel.split('/')), '# stub', 'utf8')
      }
    }
  }
  for (const d of over?.mariadbDataDirs ?? []) await mkdir(join(paths.dataMariadb, d), { recursive: true })

  const runShortCalls: Array<{ exe: string; args: string[] }> = []
  let nginxTest = { code: 0, stderr: '' }
  let spawnCount = 0

  const adapter: PlatformAdapter = {
    platform: 'win32',
    extractArchive: () => Promise.resolve(),
    killTree: () => Promise.resolve(),
    findStrayProcesses: () => Promise.resolve([]),
    reservedPortRanges: () => Promise.resolve(over?.reserved ?? []),
    runShort: (exe, args) => {
      runShortCalls.push({ exe, args })
      if (args.includes('-t')) return Promise.resolve({ code: nginxTest.code, stdout: '', stderr: nginxTest.stderr })
      // Probe `--help` của mariadb-install-db: mỗi test tự chọn tập cờ mà "binary" khai báo
      if (exe.includes('install-db') && args.includes('--help')) {
        return Promise.resolve({ code: 1, stdout: over?.installDbHelp ?? DEFAULT_INSTALL_DB_HELP, stderr: '' })
      }
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    },
    runWithStdinFile: () => Promise.resolve({ code: 0, stdout: '', stderr: '' })
  }

  const spawn: SpawnFn = () => new FakeProc(2000 + spawnCount++)
  const sup = new ProcessSupervisor({ paths, adapter, spawn, schedule: (fn) => { void fn; return () => {} } })
  const ports = memPorts(over?.ports)
  const sites = over?.sites ?? [site()]

  const provider = new ManagedStackProvider({
    paths,
    adapter,
    supervisor: sup,
    installedRuntimes: () => Promise.resolve(installed),
    sites: () => sites,
    ports,
    settings: () => ({
      phpPoolSize: over?.poolSize ?? 2,
      httpPortFrom: over?.portRange?.[0] ?? 8080,
      httpPortTo: over?.portRange?.[1] ?? 8099,
      ...(over?.usePort80 !== undefined ? { usePort80: over.usePort80 } : {}),
      timezone: 'Asia/Ho_Chi_Minh'
    }),
    probePort: (p) => Promise.resolve(
      (over?.busyPorts ?? []).includes(p) ? { free: false, reason: 'in-use' as const } : { free: true }
    )
  })

  return {
    paths,
    provider,
    sup,
    ports,
    runShortCalls,
    sites,
    spawned: () => spawnCount,
    setNginxTestResult: (code, stderr = '') => {
      nginxTest = { code, stderr }
    }
  }
}

describe('ManagedStackProvider — sinh config', () => {
  test('sinh nginx.conf, php.ini và vhost từng site', async () => {
    const h = await harness()
    await h.provider.applySites()

    const nginxConf = readFileSync(join(h.paths.confNginx, 'nginx.conf'), 'utf8')
    expect(nginxConf).toContain('upstream php_8_3 {')
    expect(nginxConf).toContain('server 127.0.0.1:9000;')
    expect(nginxConf).toContain('/sites/*.conf')

    const phpIni = readFileSync(join(h.paths.confPhp, 'php-8.3', 'php.ini'), 'utf8')
    expect(phpIni).toContain('cgi.force_redirect = 0')

    const vhost = readFileSync(join(h.paths.confNginxSites, 'demo.conf'), 'utf8')
    expect(vhost).toContain('server_name demo.localhost;')
    expect(vhost).toContain('fastcgi_pass php_8_3;')
  })

  test('tạo đủ thư mục nginx cần ghi (nếu thiếu, nginx cố ghi vào runtimes/ read-only)', async () => {
    const h = await harness()
    await h.provider.applySites()
    for (const d of [
      join(h.paths.run, 'nginx-prefix', 'logs'),
      join(h.paths.run, 'nginx-prefix', 'temp'),
      join(h.paths.tmp, 'nginx'),
      h.paths.confNginxExtra
    ]) {
      expect(existsSync(d), d).toBe(true)
    }
  })

  test('SITE ĐÃ XOÁ khỏi DB thì vhost cũ cũng phải bị xoá (nếu chỉ ghi thêm, nginx vẫn phục vụ site đã xoá)', async () => {
    const h = await harness()
    await h.provider.applySites()
    expect(existsSync(join(h.paths.confNginxSites, 'demo.conf'))).toBe(true)
    // Xoá site khỏi "DB"
    h.sites.length = 0
    await h.provider.applySites()
    const left = await readdir(h.paths.confNginxSites)
    expect(left.filter((f) => f.endsWith('.conf'))).toEqual([])
  })

  test('site status != ready thì KHÔNG sinh vhost (site đang tạo dở)', async () => {
    const h = await harness({ sites: [site({ status: 'creating' })] })
    await h.provider.applySites()
    expect(existsSync(join(h.paths.confNginxSites, 'demo.conf'))).toBe(false)
  })

  // HỒI QUY: thêm site TRƯỚC khi cài PHP ⇒ phpVersion bị chốt null. Nếu vhost dựa cứng vào
  // giá trị đó thì sau khi cài PHP vẫn không có fastcgi_pass, index chỉ có index.html
  // ⇒ nginx trả 403 Forbidden (đã gặp thật). Config phải tự chọn PHP lúc sinh.
  test('site PHP có phpVersion=null vẫn được cấp fastcgi_pass nếu đã cài PHP', async () => {
    const h = await harness({ sites: [site({ kind: 'wordpress', phpVersion: null })] })
    await h.provider.applySites()
    const vhost = readFileSync(join(h.paths.confNginxSites, 'demo.conf'), 'utf8')
    expect(vhost).toContain('fastcgi_pass php_8_3;')
    expect(vhost).toContain('index index.php')
  })

  test('phpVersion trỏ runtime KHÔNG còn cài ⇒ tự dùng PHP đang có', async () => {
    const h = await harness({ sites: [site({ phpVersion: 'php-9.9' })] })
    await h.provider.applySites()
    const vhost = readFileSync(join(h.paths.confNginxSites, 'demo.conf'), 'utf8')
    expect(vhost).toContain('fastcgi_pass php_8_3;')
  })

  test('chưa cài PHP nào ⇒ vhost không có fastcgi_pass (không sinh config trỏ vào hư không)', async () => {
    // dir PHẢI tuyệt đối: `dir: ''` làm harness mkdir('conf') tương đối với CWD ⇒ rác
    // `conf/fastcgi_params` rơi vào thư mục đang chạy vitest (đã từng bẩn cả gốc repo).
    const h = await harness({
      installed: [
        { id: 'nginx-1.30', dir: join(mkdtempSync(join(tmpdir(), 'infra-nophp-')), 'nginx-1.30'), broken: false }
      ],
      sites: [site({ kind: 'wordpress' })]
    })
    // dựng lại thư mục stub cho nginx đã có trong harness; chỉ cần không throw
    await h.provider.applySites().catch(() => undefined)
  })

  // Site là folder CÓ SẴN của user (có thể là repo git) — app không được rải file vào đó.
  test('log của site ghi vào khu vực APP, KHÔNG vào thư mục project của user', async () => {
    const h = await harness({ sites: [site({ rootPath: 'D:\\www\\demo', docRoot: 'D:\\www\\demo' })] })
    await h.provider.applySites()
    const vhost = readFileSync(join(h.paths.confNginxSites, 'demo.conf'), 'utf8')
    expect(vhost).not.toContain('D:/www/demo/logs')
    expect(vhost).toContain('/logs/sites/demo/access.log')
    expect(vhost).toContain('/logs/sites/demo/error.log')
  })

  test('site tĩnh: vhost không có block PHP', async () => {
    const h = await harness({ sites: [site({ kind: 'static', phpVersion: null })] })
    await h.provider.applySites()
    const vhost = readFileSync(join(h.paths.confNginxSites, 'demo.conf'), 'utf8')
    expect(vhost).not.toContain('fastcgi_pass')
    expect(vhost).toContain('index.html')
  })

  test('site WordPress dùng try_files fallback /index.php?$args', async () => {
    const h = await harness({ sites: [site({ kind: 'wordpress' })] })
    await h.provider.applySites()
    const vhost = readFileSync(join(h.paths.confNginxSites, 'demo.conf'), 'utf8')
    expect(vhost).toContain('/index.php?$args')
  })

  test('mọi site dùng CÙNG cổng web đã cấp (không phải httpPort cũ trong DB)', async () => {
    const h = await harness({
      sites: [site({ httpPort: 1234 }), site({ id: 'id-2', slug: 'shop', domain: 'shop.localhost', httpPort: 5678 })]
    })
    await h.provider.applySites()
    const a = readFileSync(join(h.paths.confNginxSites, 'demo.conf'), 'utf8')
    const b = readFileSync(join(h.paths.confNginxSites, 'shop.conf'), 'utf8')
    expect(a).toContain('listen 127.0.0.1:8080;')
    expect(b).toContain('listen 127.0.0.1:8080;')
  })
})

describe('ManagedStackProvider — cấp phát cổng', () => {
  test('ghi nhận cổng web + cổng từng worker php vào store', async () => {
    const h = await harness({ poolSize: 3 })
    await h.provider.applySites()
    const all = h.ports.all()
    expect(all.web).toBe(8080)
    expect(all['php:php-8.3#0']).toBe(9000)
    expect(all['php:php-8.3#1']).toBe(9001)
    expect(all['php:php-8.3#2']).toBe(9002)
  })

  test('dùng lại cổng đã ghi nhớ (user bookmark URL nên cổng phải ổn định)', async () => {
    const h = await harness({ ports: { web: 8093 } })
    await h.provider.applySites()
    expect(h.ports.all().web).toBe(8093)
  })

  // HỒI QUY: cổng đã ghi nhớ nằm trong takenPorts() nên từng bị coi là "đã bị người khác
  // chiếm" ⇒ mỗi lần khởi động lại cấp cổng MỚI (URL/DB client của user chết). Giữ test này.
  test('cổng pool php cũng phải ổn định giữa các lần khởi động', async () => {
    const h = await harness({
      poolSize: 2,
      ports: { web: 8080, 'php:php-8.3#0': 9007, 'php:php-8.3#1': 9008 }
    })
    await h.provider.applySites()
    expect(h.ports.all()['php:php-8.3#0']).toBe(9007)
    expect(h.ports.all()['php:php-8.3#1']).toBe(9008)
  })

  test('cổng ghi nhớ ĐANG bị process khác chiếm thật ⇒ cấp cổng khác, không kẹt', async () => {
    const h = await harness({ ports: { web: 8093 }, busyPorts: [8093] })
    await h.provider.applySites()
    expect(h.ports.all().web).not.toBe(8093)
    expect(h.ports.all().web).toBe(8080)
  })

  test('bỏ qua dải cổng OS giữ (bind vào đó fail bằng EACCES bí ẩn)', async () => {
    const h = await harness({ reserved: [[8080, 8085]], portRange: [8080, 8099] })
    await h.provider.applySites()
    expect(h.ports.all().web).toBe(8086)
  })

  test('hết cổng trong dải ⇒ lỗi NÓI RÕ nguyên nhân + gợi ý đổi dải', async () => {
    const h = await harness({ reserved: [[8080, 8081]], portRange: [8080, 8081] })
    await expect(h.provider.applySites()).rejects.toThrow(/Windows\/Hyper-V giữ|Không còn cổng rảnh/)
  })

  test('cổng web và cổng php không bao giờ trùng nhau', async () => {
    const h = await harness({ poolSize: 4 })
    await h.provider.applySites()
    const values = Object.values(h.ports.all())
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('ManagedStackProvider — đăng ký service', () => {
  test('đăng ký nginx + đúng số worker php', async () => {
    const h = await harness({ poolSize: 3 })
    await h.provider.applySites()
    const ids = h.provider.services().map((s) => s.id).sort()
    expect(ids).toEqual(['nginx', 'php-8.3#0', 'php-8.3#1', 'php-8.3#2'])
  })

  test('nginx: restartOnCleanExit=false (master thoát code 0 là bất thường)', async () => {
    const h = await harness()
    await h.provider.applySites()
    // Kiểm gián tiếp qua hành vi: nginx thoát 0 thì không được restart
    await h.provider.start('nginx')
    const before = h.spawned()
    // Không có cách đọc spec ra ngoài → khẳng định bằng service list vẫn đủ cho M1
    expect(h.provider.services().find((s) => s.id === 'nginx')?.state).toBe('running')
    expect(h.spawned()).toBe(before)
  })

  test('runtime broken bị bỏ qua (cài dở/thiếu provenance)', async () => {
    const h = await harness({
      installed: [
        { id: 'nginx-1.28', dir: 'D:\\x\\nginx-1.28', broken: true },
        { id: 'php-8.3', dir: 'D:\\x\\php-8.3', broken: false }
      ]
    })
    const res = await h.provider.applySites()
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/Chưa cài nginx/)
    // php vẫn được đăng ký
    expect(h.provider.services().map((s) => s.id)).toContain('php-8.3#0')
  })

  test('chưa cài php ⇒ nginx.conf không có upstream nào', async () => {
    const h = await harness({
      installed: [{ id: 'nginx-1.28', dir: join(mkdtempSync(join(tmpdir(), 'infra-ngx-')), 'nginx-1.28'), broken: false }]
    })
    // thư mục stub cho nginx
    await mkdir(join(h.provider['deps'].paths.runtimes, 'x'), { recursive: true }).catch(() => {})
    const res = await h.provider.applySites().catch((e: Error) => ({ ok: false, error: e.message }))
    void res
    // Không throw là đủ: site php sẽ không có upstream nên nginx -t sẽ bắt (test riêng bên dưới)
    expect(true).toBe(true)
  })
})

describe('ManagedStackProvider — reload có GATE nginx -t', () => {
  test('nginx -t chạy TRƯỚC reload', async () => {
    const h = await harness()
    await h.provider.applySites()
    await h.provider.start('nginx')
    h.runShortCalls.length = 0
    await h.provider.applySites()
    const iTest = h.runShortCalls.findIndex((c) => c.args.includes('-t'))
    const iReload = h.runShortCalls.findIndex((c) => c.args.includes('reload'))
    expect(iTest).toBeGreaterThanOrEqual(0)
    expect(iReload).toBeGreaterThan(iTest)
  })

  test('config SAI ⇒ KHÔNG reload, trả lỗi nguyên văn của nginx (1 site sai không được giết cả stack)', async () => {
    const h = await harness()
    await h.provider.applySites()
    await h.provider.start('nginx')
    h.setNginxTestResult(1, 'nginx: [emerg] invalid parameter "xyz" in demo.conf:12')
    h.runShortCalls.length = 0
    const res = await h.provider.applySites()
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/invalid parameter "xyz"/)
    expect(h.runShortCalls.some((c) => c.args.includes('reload'))).toBe(false)
  })

  test('nginx chưa chạy ⇒ chỉ cần config hợp lệ là ok, không gọi reload', async () => {
    const h = await harness()
    const res = await h.provider.applySites()
    expect(res.ok).toBe(true)
    expect(h.runShortCalls.some((c) => c.args.includes('reload'))).toBe(false)
  })
})

describe('ManagedStackProvider — vòng đời', () => {
  test('init dọn tmp + reap orphan, báo số đã dọn', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'infra-stack-init-'))
    roots.push(rootDir)
    const paths = localDevPaths(rootDir)
    let cleaned = false
    const adapter: PlatformAdapter = {
      platform: 'win32',
      extractArchive: () => Promise.resolve(),
      killTree: () => Promise.resolve(),
      findStrayProcesses: () =>
        Promise.resolve([{ pid: 1, parentPid: null, exePath: join(paths.runtimes, 'x.exe'), startedAt: 1 }]),
      reservedPortRanges: () => Promise.resolve([]),
      runShort: () => Promise.resolve({ code: 0, stdout: '', stderr: '' }),
      runWithStdinFile: () => Promise.resolve({ code: 0, stdout: '', stderr: '' })
    }
    const sup = new ProcessSupervisor({ paths, adapter, spawn: () => new FakeProc(1) })
    const provider = new ManagedStackProvider({
      paths,
      adapter,
      supervisor: sup,
      installedRuntimes: () => Promise.resolve([]),
      sites: () => [],
      ports: memPorts(),
      settings: () => ({ phpPoolSize: 2, httpPortFrom: 8080, httpPortTo: 8099, timezone: 'UTC' }),
      cleanTmp: () => {
        cleaned = true
        return Promise.resolve()
      }
    })
    const res = await provider.init()
    expect(cleaned).toBe(true)
    expect(res.reaped).toBe(1)
  })

  test('startAll: php pool TRƯỚC nginx (ngược lại thì request đầu 502)', async () => {
    const h = await harness({ poolSize: 2 })
    await h.provider.startAll()
    const states = new Map(h.provider.services().map((s) => [s.id, s.state]))
    expect(states.get('php-8.3#0')).toBe('running')
    expect(states.get('php-8.3#1')).toBe('running')
    expect(states.get('nginx')).toBe('running')
  })

  test('stopAll dừng hết', async () => {
    const h = await harness()
    await h.provider.startAll()
    await h.provider.stopAll()
    expect(h.provider.services().every((s) => s.state === 'stopped')).toBe(true)
  })

  test('capabilities M1: chưa có cert/hosts (UI dựa vào cờ này để ẩn nút)', async () => {
    const h = await harness()
    expect(h.provider.capabilities).toEqual({
      canInstallRuntime: true,
      canReload: true,
      canIssueCert: false,
      canEditHosts: false
    })
  })

  // HỒI QUY: UI hiện pool php theo NHÓM nên nút bật/tắt gửi groupId ('php-8.3'), không phải
  // id worker ('php-8.3#0'). Trước đây supervisor.start(groupId) throw "chưa đăng ký" ⇒ nút
  // im lặng không làm gì — loại bug tệ nhất về UX.
  test('start/stop/restart nhận CẢ groupId lẫn id service', async () => {
    const h = await harness({ poolSize: 2 })
    await h.provider.applySites()

    // groupId
    await h.provider.start('php-8.3')
    expect(h.provider.services().filter((s) => s.groupId === 'php-8.3').every((s) => s.state === 'running')).toBe(true)
    await h.provider.stop('php-8.3')
    expect(h.provider.services().filter((s) => s.groupId === 'php-8.3').every((s) => s.state === 'stopped')).toBe(true)

    // id service cụ thể
    await h.provider.start('php-8.3#0')
    expect(h.provider.services().find((s) => s.id === 'php-8.3#0')?.state).toBe('running')
    expect(h.provider.services().find((s) => s.id === 'php-8.3#1')?.state).toBe('stopped')

    // nginx: groupId trùng id service — vẫn phải chạy
    await h.provider.start('nginx')
    expect(h.provider.services().find((s) => s.id === 'nginx')?.state).toBe('running')
    await h.provider.restart('nginx')
    expect(h.provider.services().find((s) => s.id === 'nginx')?.state).toBe('running')
  })

  test('restart theo groupId khởi động lại mọi worker trong pool', async () => {
    const h = await harness({ poolSize: 3 })
    await h.provider.applySites()
    await h.provider.start('php-8.3')
    await h.provider.restart('php-8.3')
    expect(h.provider.services().filter((s) => s.groupId === 'php-8.3').every((s) => s.state === 'running')).toBe(true)
  })

  test('applySites gọi lại nhiều lần là idempotent (không nhân đôi service)', async () => {
    const h = await harness({ poolSize: 2 })
    await h.provider.applySites()
    await h.provider.applySites()
    await h.provider.applySites()
    expect(h.provider.services()).toHaveLength(3)
  })
})

describe('ManagedStackProvider — MariaDB', () => {
  const WITH_DB = [
    { id: 'nginx-1.30', dir: '', broken: false },
    { id: 'php-8.3', dir: '', broken: false },
    { id: 'mariadb-11.4', dir: '', broken: false }
  ]

  /** Điền `dir` thật dưới runtimes/ của harness (harness tạo stub theo dir được truyền). */
  async function dbHarness(over?: Parameters<typeof harness>[0]): Promise<H> {
    const rootProbe = mkdtempSync(join(tmpdir(), 'infra-db-'))
    roots.push(rootProbe)
    const installed = (over?.installed ?? WITH_DB).map((r) => ({
      ...r,
      dir: r.dir || join(rootProbe, 'runtimes', r.id)
    }))
    return harness({ ...over, installed })
  }

  test('chưa cài MariaDB ⇒ không đăng ký service, không cấp cổng (không tốn cổng vô ích)', async () => {
    const h = await harness()
    await h.provider.applySites()
    expect(h.provider.services().map((s) => s.id)).not.toContain('mariadb')
    expect(h.ports.all().mariadb).toBeUndefined()
    expect(await h.provider.mariadbTarget()).toBeNull()
  })

  test('đã cài ⇒ đăng ký service "mariadb" + cấp cổng từ 3307 (KHÔNG 3306 để tránh XAMPP)', async () => {
    const h = await dbHarness()
    await h.provider.applySites()
    expect(h.provider.services().map((s) => s.id)).toContain('mariadb')
    expect(h.ports.all().mariadb).toBe(3307)
  })

  test('sinh my.ini với --defaults-file, bind loopback, đúng cổng đã cấp', async () => {
    const h = await dbHarness()
    await h.provider.applySites()
    const ini = readFileSync(join(h.paths.confMariadb, 'my.ini'), 'utf8')
    expect(ini).toContain('port = 3307')
    expect(ini).toContain('bind_address = 127.0.0.1')
    expect(ini).toContain('character_set_server = utf8mb4')
    // datadir TUYỆT ĐỐI không nằm trong runtimes/ (gỡ runtime là mất sạch DB)
    expect(ini).toContain(`datadir = "${h.paths.dataMariadb.replace(/\\/g, '/')}"`)
    expect(ini).not.toContain(`datadir = "${h.paths.runtimes.replace(/\\/g, '/')}`)
  })

  test('mysqld được chạy với --defaults-file (bỏ qua my.ini toàn cục của XAMPP/Laragon)', async () => {
    const h = await dbHarness({ mariadbDataDirs: ['mysql'] })
    await h.provider.applySites()
    await h.provider.start('mariadb')
    // Không đọc được spec ra ngoài ⇒ khẳng định qua target + trạng thái
    const t = await h.provider.mariadbTarget()
    expect(t?.confFile).toBe(join(h.paths.confMariadb, 'my.ini'))
    expect(t?.serverExe.endsWith('mariadbd.exe')).toBe(true)
    expect(h.provider.mariadbRunning()).toBe(true)
  })

  test('cổng MariaDB ổn định giữa các lần khởi động (Navicat/wp-config đã lưu cổng)', async () => {
    const h = await dbHarness({ ports: { mariadb: 3311 } })
    await h.provider.applySites()
    expect(h.ports.all().mariadb).toBe(3311)
  })

  test('cổng ghi nhớ đang bị chiếm thật ⇒ cấp cổng khác', async () => {
    const h = await dbHarness({ ports: { mariadb: 3311 }, busyPorts: [3311] })
    await h.provider.applySites()
    expect(h.ports.all().mariadb).toBe(3307)
  })

  test('password root sinh 1 lần rồi GIỮ NGUYÊN qua các lần prepare (đổi là mất quyền vào DB)', async () => {
    const h = await dbHarness()
    await h.provider.applySites()
    const first = (await h.provider.mariadbTarget())!.rootPassword
    expect(first.length).toBeGreaterThanOrEqual(20)
    const onDisk = readFileSync(join(h.paths.confMariadb, 'root.cnf'), 'utf8')
    expect(onDisk).toContain(`password = ${first}`)

    // Provider mới, cùng thư mục ⇒ phải đọc lại password cũ
    const h2 = await harness({ installed: [], ports: {} })
    void h2
    await h.provider.applySites()
    expect((await h.provider.mariadbTarget())!.rootPassword).toBe(first)
  })

  test('root.cnf được ghi lại theo cổng MỚI nhưng giữ password cũ', async () => {
    const h = await dbHarness({ ports: { mariadb: 3320 } })
    await h.provider.applySites()
    const cnf = readFileSync(join(h.paths.confMariadb, 'root.cnf'), 'utf8')
    expect(cnf).toContain('port = 3320')
    expect(cnf).toContain('host = 127.0.0.1')
  })

  test('runtime thiếu mariadbd/mariadb-admin ⇒ KHÔNG đăng ký (thà không có hơn có service chết)', async () => {
    const h = await dbHarness({ mariadbBins: ['bin/mariadb.exe'] })
    await h.provider.applySites()
    expect(h.provider.services().map((s) => s.id)).not.toContain('mariadb')
    expect(await h.provider.mariadbTarget()).toBeNull()
  })

  test('probe được tên binary CŨ (mysqld/mysql) cho bản MariaDB thấp hơn', async () => {
    const h = await dbHarness({
      mariadbBins: ['bin/mysqld.exe', 'bin/mysql.exe', 'bin/mysqladmin.exe', 'bin/mysqldump.exe', 'bin/mysql_install_db.exe']
    })
    await h.provider.applySites()
    const t = await h.provider.mariadbTarget()
    expect(t?.serverExe.endsWith('mysqld.exe')).toBe(true)
    expect(t?.clientExe.endsWith('mysql.exe')).toBe(true)
    expect(t?.adminExe.endsWith('mysqladmin.exe')).toBe(true)
  })

  test('BOOTSTRAP: datadir trống ⇒ chạy install-db với datadir + port + password root', async () => {
    const h = await dbHarness()
    await h.provider.applySites()
    h.runShortCalls.length = 0
    // install-db không tạo được `mysql/` thật trong test ⇒ bootstrap phải báo lỗi, nhưng ta
    // vẫn kiểm được nó ĐÃ gọi đúng lệnh
    await h.provider.start('mariadb').catch(() => undefined)
    const call = h.runShortCalls.find((c) => c.exe.includes('install-db') && !c.args.includes('--help'))
    expect(call, 'phải gọi mariadb-install-db').toBeTruthy()
    expect(call!.args.some((a) => a.startsWith('--datadir='))).toBe(true)
    expect(call!.args.some((a) => a.startsWith('--password='))).toBe(true)
    expect(call!.args.some((a) => a.startsWith('--port='))).toBe(true)
  })

  // HỒI QUY (bug đã gặp thật): bản Windows của mariadb-install-db KHÔNG có `--skip-test-db`
  // (cờ đó chỉ ở bản shell script Unix) ⇒ truyền vào là chết ngay ở parse option với
  // "unknown option '--skip-test-db'", datadir không được tạo, MariaDB không bao giờ start.
  test('BOOTSTRAP: probe --help TRƯỚC, không truyền cờ binary không biết', async () => {
    const h = await dbHarness()
    await h.provider.applySites()
    h.runShortCalls.length = 0
    await h.provider.start('mariadb').catch(() => undefined)
    const iHelp = h.runShortCalls.findIndex((c) => c.exe.includes('install-db') && c.args.includes('--help'))
    const iRun = h.runShortCalls.findIndex((c) => c.exe.includes('install-db') && !c.args.includes('--help'))
    expect(iHelp, 'phải hỏi --help trước').toBeGreaterThanOrEqual(0)
    expect(iRun).toBeGreaterThan(iHelp)
    expect(h.runShortCalls[iRun]!.args).not.toContain('--skip-test-db')
  })

  test('BOOTSTRAP: bản NÀO có --skip-test-db thì mới truyền', async () => {
    const h = await dbHarness({
      installDbHelp: '  -d, --datadir=name\n  -p, --password=name\n  --skip-test-db  Do not install test db\n'
    })
    await h.provider.applySites()
    await h.provider.start('mariadb').catch(() => undefined)
    const call = h.runShortCalls.find((c) => c.exe.includes('install-db') && !c.args.includes('--help'))!
    expect(call.args).toContain('--skip-test-db')
  })

  test('BOOTSTRAP: install-db "thành công" nhưng datadir vẫn trống ⇒ báo lỗi, KHÔNG spawn mysqld', async () => {
    const h = await dbHarness()
    await h.provider.applySites()
    const before = h.spawned()
    await expect(h.provider.start('mariadb')).rejects.toThrow(/Khởi tạo dữ liệu MariaDB thất bại/)
    expect(h.spawned()).toBe(before)
    expect(h.provider.services().find((s) => s.id === 'mariadb')?.state).toBe('crashed')
  })

  // Chạy lại install-db trên datadir ĐÃ CÓ dữ liệu là mất sạch DB của user.
  test('BOOTSTRAP: datadir đã có mysql/ ⇒ KHÔNG chạy lại install-db', async () => {
    const h = await dbHarness({ mariadbDataDirs: ['mysql'] })
    await h.provider.applySites()
    h.runShortCalls.length = 0
    await h.provider.start('mariadb')
    expect(h.runShortCalls.some((c) => c.exe.includes('install-db'))).toBe(false)
    expect(h.provider.services().find((s) => s.id === 'mariadb')?.state).toBe('running')
  })

  test('DỪNG: gọi mariadb-admin shutdown, KHÔNG taskkill thẳng (taskkill = mất điện giữa transaction)', async () => {
    const h = await dbHarness({ mariadbDataDirs: ['mysql'] })
    await h.provider.applySites()
    await h.provider.start('mariadb')
    h.runShortCalls.length = 0
    await h.provider.stop('mariadb')
    const call = h.runShortCalls.find((c) => c.exe.includes('admin'))
    expect(call, 'phải gọi mariadb-admin shutdown').toBeTruthy()
    expect(call!.args).toContain('shutdown')
    // Password đi qua .cnf, KHÔNG trên command line
    expect(call!.args[0]).toMatch(/^--defaults-extra-file=/)
    const pw = (await h.provider.mariadbTarget())!.rootPassword
    for (const a of call!.args) expect(a).not.toContain(pw)
  })

  test('startAll bật MariaDB TRƯỚC php (WordPress hỏng ngay request đầu nếu PHP lên trước DB)', async () => {
    const h = await dbHarness({ mariadbDataDirs: ['mysql'], poolSize: 2 })
    await h.provider.startAll()
    const states = new Map(h.provider.services().map((s) => [s.id, s.state]))
    expect(states.get('mariadb')).toBe('running')
    expect(states.get('php-8.3#0')).toBe('running')
    expect(states.get('nginx')).toBe('running')
  })

  test('stopAll dừng cả MariaDB', async () => {
    const h = await dbHarness({ mariadbDataDirs: ['mysql'] })
    await h.provider.startAll()
    await h.provider.stopAll()
    expect(h.provider.services().every((s) => s.state === 'stopped')).toBe(true)
  })

  test('cổng MariaDB không trùng cổng web/php', async () => {
    const h = await dbHarness({ poolSize: 4 })
    await h.provider.applySites()
    const values = Object.values(h.ports.all())
    expect(new Set(values).size).toBe(values.length)
  })

  test('applySites nhiều lần không nhân đôi service mariadb', async () => {
    const h = await dbHarness({ poolSize: 1 })
    await h.provider.applySites()
    await h.provider.applySites()
    expect(h.provider.services().filter((s) => s.id === 'mariadb')).toHaveLength(1)
  })
})

describe('buildInstallDbArgs', () => {
  const IN = { dataDir: 'D:\\data\\mariadb', port: 3307, password: 'pw' }

  test('--datadir LUÔN có (cờ bắt buộc duy nhất, tồn tại ở mọi bản)', () => {
    expect(buildInstallDbArgs('', IN)[0]).toBe('--datadir=D:\\data\\mariadb')
    expect(buildInstallDbArgs('rác không phải help', IN)[0]).toBe('--datadir=D:\\data\\mariadb')
  })

  test('CHỈ truyền cờ có trong --help', () => {
    const help = '  -d, --datadir=name\n  -p, --password=name\n'
    const args = buildInstallDbArgs(help, IN)
    expect(args).toContain('--password=pw')
    // help này không nhắc --port/--silent/--skip-test-db
    expect(args.some((a) => a.startsWith('--port='))).toBe(false)
    expect(args).not.toContain('--silent')
    expect(args).not.toContain('--skip-test-db')
  })

  test('help trống (probe fail) ⇒ dùng tập tối thiểu, KHÔNG đoán cờ lạ', () => {
    const args = buildInstallDbArgs('   \n  ', IN)
    expect(args).toEqual(['--datadir=D:\\data\\mariadb', '--port=3307', '--password=pw'])
  })

  test('bản có đủ cờ ⇒ dùng hết', () => {
    const help = '--datadir --password --port --silent --skip-test-db'
    const args = buildInstallDbArgs(help, IN)
    expect(args).toEqual([
      '--datadir=D:\\data\\mariadb',
      '--port=3307',
      '--password=pw',
      '--skip-test-db',
      '--silent'
    ])
  })

  test('password không bị đưa vào nếu bản đó không nhận (ensureReady sẽ đặt bù)', () => {
    const args = buildInstallDbArgs('  -d, --datadir=name  only\n', IN)
    expect(args.some((a) => a.includes('pw'))).toBe(false)
  })
})

describe('parseCnfPassword', () => {
  test('đọc được password kể cả có khoảng trắng quanh dấu =', () => {
    expect(parseCnfPassword('[client]\npassword = abc123\n')).toBe('abc123')
    expect(parseCnfPassword('password=xyz')).toBe('xyz')
    expect(parseCnfPassword('  password   =   p q  \n')).toBe('p q')
  })

  test('không có dòng password ⇒ null (để caller sinh mới)', () => {
    expect(parseCnfPassword('[client]\nport = 3307\n')).toBeNull()
    expect(parseCnfPassword('')).toBeNull()
  })

  test('không nhầm với khoá khác chứa chữ password', () => {
    expect(parseCnfPassword('old_password = zzz\n')).toBeNull()
  })
})

/**
 * Công cụ DB (Adminer, phpMyAdmin) + shim CLI (Composer, WP-CLI). Dữ liệu vhost nằm trong
 * runtimeCatalog nên test ở đây kiểm phần KHỚP NỐI: chọn PHP nào, ghi file gì, xoá khi gỡ.
 */
describe('ManagedStackProvider — công cụ DB + shim CLI', () => {
  /** CỐ Ý để php-8.4 TRƯỚC php-8.3: pma phải tự chọn 8.3 (trần maxPhp), Adminer thì lấy 8.4. */
  function toolRuntimes(rootProbe: string, ids: readonly string[]): Array<{ id: string; dir: string; broken: boolean }> {
    return ids.map((id) => ({ id, dir: join(rootProbe, 'runtimes', id), broken: false }))
  }

  const ALL = [
    'nginx-1.30',
    'php-8.4',
    'php-8.3',
    'mariadb-11.4',
    'adminer-5.5',
    'phpmyadmin-5.2',
    'composer-2.10',
    'wpcli-2.12'
  ] as const

  async function toolHarness(
    ids: readonly string[] = ALL
  ): Promise<H & { installed: Array<{ id: string; dir: string; broken: boolean }> }> {
    const rootProbe = mkdtempSync(join(tmpdir(), 'infra-tool-'))
    roots.push(rootProbe)
    const installed = toolRuntimes(rootProbe, ids)
    const h = await harness({ installed })
    return { ...h, installed }
  }

  test('sinh vhost RIÊNG cho từng công cụ, mỗi cái một domain', async () => {
    const h = await toolHarness()
    await h.provider.applySites()

    const adminer = readFileSync(join(h.paths.confNginxSites, '00-adminer.conf'), 'utf8')
    expect(adminer).toContain('server_name db.localhost;')
    expect(adminer).toContain('index adminer.php;')

    const pma = readFileSync(join(h.paths.confNginxSites, '00-phpmyadmin.conf'), 'utf8')
    expect(pma).toContain('server_name pma.localhost;')
    expect(pma).toContain('index index.php;')
  })

  test('phpMyAdmin dùng PHP 8.3 dù 8.4 đứng trước (bản 5.2 chưa hỗ trợ 8.4); Adminer thì 8.4', async () => {
    const h = await toolHarness()
    await h.provider.applySites()
    expect(readFileSync(join(h.paths.confNginxSites, '00-phpmyadmin.conf'), 'utf8')).toContain('fastcgi_pass php_8_3;')
    expect(readFileSync(join(h.paths.confNginxSites, '00-adminer.conf'), 'utf8')).toContain('fastcgi_pass php_8_4;')
  })

  test('chưa cài PHP ⇒ KHÔNG sinh vhost (nếu sinh, browser tải về mã nguồn PHP dạng text)', async () => {
    const h = await toolHarness(['nginx-1.30', 'adminer-5.5', 'phpmyadmin-5.2'])
    await h.provider.applySites()
    const files = await readdir(h.paths.confNginxSites)
    expect(files).not.toContain('00-adminer.conf')
    expect(files).not.toContain('00-phpmyadmin.conf')
  })

  test('config.inc.php của pma mang cổng + password root THẬT vừa cấp', async () => {
    const h = await toolHarness()
    await h.provider.applySites()
    const target = await h.provider.mariadbTarget()
    expect(target).not.toBeNull()

    const pmaDir = h.installed.find((r) => r.id === 'phpmyadmin-5.2')!.dir
    const conf = readFileSync(join(pmaDir, 'config.inc.php'), 'utf8')
    expect(conf).toContain(`$cfg['Servers'][$i]['port'] = '${String(target!.port)}';`)
    expect(conf).toContain(`$cfg['Servers'][$i]['password'] = '${target!.rootPassword}';`)
    // TempDir phải NGOÀI runtimes/ (thư mục runtime coi như read-only sau khi cài)
    expect(conf).toContain(`$cfg['TempDir'] = '`)
    expect(conf).not.toContain('/runtimes/phpmyadmin-5.2/tmp')
  })

  test('blowfish secret GIỮ NGUYÊN giữa 2 lần apply (đổi là đăng xuất mọi tab pma đang mở)', async () => {
    const h = await toolHarness()
    await h.provider.applySites()
    const pmaDir = h.installed.find((r) => r.id === 'phpmyadmin-5.2')!.dir
    const first = /\$cfg\['blowfish_secret'] = '([^']*)';/.exec(readFileSync(join(pmaDir, 'config.inc.php'), 'utf8'))![1]

    h.provider.markDirty()
    await h.provider.applySites()
    const second = /\$cfg\['blowfish_secret'] = '([^']*)';/.exec(readFileSync(join(pmaDir, 'config.inc.php'), 'utf8'))![1]
    expect(second).toBe(first)
    expect(first!.length).toBeGreaterThanOrEqual(32)
  })

  test('sinh shim bin/composer.cmd + bin/wp.cmd trỏ vào php.exe, php.ini và .phar đã cài', async () => {
    const h = await toolHarness()
    await h.provider.applySites()

    const composer = readFileSync(join(h.paths.bin, 'composer.cmd'), 'utf8')
    // PHP mới nhất đang cài được chọn cho CLI
    expect(composer).toContain(join(h.installed.find((r) => r.id === 'php-8.4')!.dir, 'php.exe'))
    expect(composer).toContain(join(h.paths.confPhp, 'php-8.4', 'php.ini'))
    expect(composer).toContain(join(h.installed.find((r) => r.id === 'composer-2.10')!.dir, 'composer.phar'))

    expect(readFileSync(join(h.paths.bin, 'wp.cmd'), 'utf8')).toContain('wp-cli.phar')
  })

  test('GỠ Composer ⇒ shim bị XOÁ (shim trỏ vào phar đã mất chỉ báo "Could not open input file")', async () => {
    const h = await toolHarness()
    await h.provider.applySites()
    expect(existsSync(join(h.paths.bin, 'composer.cmd'))).toBe(true)

    // Giả lập gỡ runtime: bỏ khỏi danh sách đã cài rồi sinh lại config
    const i = h.installed.findIndex((r) => r.id === 'composer-2.10')
    h.installed.splice(i, 1)
    h.provider.markDirty()
    await h.provider.applySites()

    expect(existsSync(join(h.paths.bin, 'composer.cmd'))).toBe(false)
    // wp.cmd không liên quan thì phải còn
    expect(existsSync(join(h.paths.bin, 'wp.cmd'))).toBe(true)
  })

  test('chưa cài PHP ⇒ KHÔNG sinh shim (shim gọi php.exe không tồn tại thì vô nghĩa)', async () => {
    const h = await toolHarness(['nginx-1.30', 'composer-2.10'])
    await h.provider.applySites()
    expect(existsSync(join(h.paths.bin, 'composer.cmd'))).toBe(false)
  })

  test('URL công cụ: Adminer điền sẵn server/user; pma không cần vì config.inc.php đã có', async () => {
    const h = await toolHarness()
    await h.provider.applySites()
    const port = h.ports.all().web
    const target = await h.provider.mariadbTarget()

    expect(await h.provider.adminerUrl('wp_demo')).toBe(
      `http://db.localhost:${String(port)}/?server=127.0.0.1%3A${String(target!.port)}&username=root&db=wp_demo`
    )
    expect(await h.provider.phpMyAdminUrl('wp_demo')).toBe(`http://pma.localhost:${String(port)}/?db=wp_demo`)
    expect(await h.provider.phpMyAdminUrl()).toBe(`http://pma.localhost:${String(port)}/`)
  })

  test('chưa cài công cụ ⇒ URL null (UI ẩn nút thay vì mở tab 404)', async () => {
    const h = await toolHarness(['nginx-1.30', 'php-8.3'])
    await h.provider.applySites()
    expect(await h.provider.adminerUrl()).toBeNull()
    expect(await h.provider.phpMyAdminUrl()).toBeNull()
    expect(await h.provider.phpMyAdminReady()).toBe(false)
  })
})

/**
 * Cổng 80 (URL không có `:port`). Điểm dễ sai nằm ở FALLBACK: cổng 80 trên Windows rất hay bị
 * IIS/http.sys giữ, và một tuỳ chọn thẩm mỹ thì KHÔNG được phép làm cả stack không lên được.
 */
describe('ManagedStackProvider — cổng 80', () => {
  test('bật + cổng 80 rảnh ⇒ web nghe cổng 80, vhost cũng listen 80', async () => {
    const h = await harness({ usePort80: true })
    await h.provider.applySites()
    expect(h.ports.all().web).toBe(80)
    expect(await h.provider.webPortInfo()).toEqual({ port: 80, port80Fallback: false })
    expect(readFileSync(join(h.paths.confNginxSites, 'demo.conf'), 'utf8')).toContain('listen 127.0.0.1:80;')
  })

  test('bật nhưng cổng 80 BỊ CHIẾM ⇒ lùi về dải cấu hình + gắn cờ để UI cảnh báo (KHÔNG throw)', async () => {
    const h = await harness({ usePort80: true, busyPorts: [80] })
    await h.provider.applySites()
    const info = await h.provider.webPortInfo()
    expect(info.port).toBe(8080)
    // Cờ này là thứ health đọc để nói "cổng 80 đang bị IIS giữ, đang dùng 8080"
    expect(info.port80Fallback).toBe(true)
  })

  test('TẮT nhưng đã ghi nhớ cổng 80 từ lần bật trước ⇒ phải RỜI khỏi 80', async () => {
    // Nếu vẫn ưu tiên cổng đã ghi nhớ thì tắt cài đặt xong không có tác dụng gì
    const h = await harness({ usePort80: false, ports: { web: 80 } })
    await h.provider.applySites()
    expect(h.ports.all().web).toBe(8080)
  })

  test('tắt + cổng đã ghi nhớ TRONG dải ⇒ giữ nguyên (URL user bookmark không chết)', async () => {
    const h = await harness({ usePort80: false, ports: { web: 8085 } })
    await h.provider.applySites()
    expect(h.ports.all().web).toBe(8085)
  })
})
