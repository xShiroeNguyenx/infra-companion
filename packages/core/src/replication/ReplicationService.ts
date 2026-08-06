import { EventEmitter } from 'node:events'
import type { ChainEndpoint } from '../connection/establish'
import { execOnce } from '../connection/execOnce'
import { startForward } from '../connection/forward'
import type { LoginStepLike } from '../connection/loginScript'
import type { HostKeyVerifier } from '../connection/types'
import { makeCliProbe, openDriverProbe, queryFirstSupported, type ReplProbe } from './probe'
import {
  READ_ONLY_SQL,
  VARS_SQL,
  computeDrift,
  mergeReadOnly,
  masterStatusSqlFor,
  normalizeMasterStatus,
  normalizeReplicaStatus,
  normalizeVars,
  parseServerVersion,
  replicaStatusSqlFor,
  variableRowsToMap,
  type MasterStatus,
  type ReplSample,
  type ReplVars,
  type ServerVersion
} from './status'

/**
 * F55 — Theo dõi một hoặc nhiều cặp master↔slave. Cùng kiến trúc với `MonitorService`:
 * giữ kết nối mở giữa các lần poll, tự dựng lại khi rớt, phát event `sample`.
 *
 * VÌ SAO PHẢI GIỮ KẾT NỐI MỞ (chứ không mở/đóng mỗi lần đo): vault tự khoá sau 15 phút không
 * hoạt động, mà cảnh báo thì phải chạy suốt đêm. Kết nối đã mở không cần hỏi lại credential —
 * đúng cách MonitorService giữ SSH client sống.
 *
 * Chu kỳ mặc định 15s chứ không phải 3s như metric hệ điều hành: `SHOW SLAVE STATUS` nặng hơn
 * đọc /proc, và độ trễ replication không đổi trong vòng vài giây.
 */

export const DEFAULT_POLL_INTERVAL_MS = 15_000
export const MIN_POLL_INTERVAL_MS = 5_000
export const MAX_POLL_INTERVAL_MS = 300_000

/** Một đầu của cặp (master hoặc replica). */
export interface ReplEndpointTarget {
  hostId: string
  chain: ChainEndpoint[]
  loginSteps?: LoginStepLike[]
  /** `auto` = thử driver trước, hỏng thì rơi sang CLI. */
  probeMode: 'auto' | 'driver' | 'cli'
  dbPort: number
  /** Bắt buộc cho chế độ driver. Thiếu → chỉ chạy được CLI. */
  dbUser?: string
  dbPassword?: string
  /** Binary client dùng ở chế độ CLI (`mysql` hoặc `mariadb`). */
  cliBinary?: string
  /**
   * MySQL ĐÃ sẵn sàng ở địa chỉ local này (đầu local của một tunnel caller đã bật) → nối thẳng
   * vào, KHÔNG bắc cầu thêm gì.
   *
   * Vì sao cần: `startForward` chỉ là `direct-tcpip` phát từ endpoint SSH, nên khi MySQL nằm ở MÁY
   * KHÁC trong mạng trong (vd `10.20.30.40:3306`) thì gate có thể mở nhầm mạng hoặc bị firewall
   * drop SYN — đúng regression v0.1.31. Tunnel L đã có logic chọn đường cho ca đó
   * (`chooseLocalForwardRoute` → `nc` trên máy sâu trước), nên ta dùng lại nó thay vì làm lại.
   *
   * Đặt field này ⇒ CHỈ chạy được chế độ driver: chế độ CLI nghĩa là chạy `mysql` TRÊN server,
   * còn ở đây ta đang ở đầu local của tunnel.
   */
  localAddress?: { host: string; port: number }
  /**
   * Caller đã biết đầu này hỏng từ trước khi đo (host bị xoá, tunnel không bật được…).
   *
   * Có để trong cụm nhiều slave: một slave hỏng KHÔNG được làm hỏng cả lượt đo, nên caller vẫn
   * đưa nó vào danh sách kèm lý do, và probe ném đúng lý do đó ra thành sample lỗi của riêng nó.
   */
  brokenReason?: string
}

/** Một slave trong cụm: endpoint + danh tính để gắn vào sample. */
export interface ReplReplicaTarget extends ReplEndpointTarget {
  replicaId: string
  label: string
}

export interface ReplPairTarget {
  pairId: string
  master: ReplEndpointTarget | null
  /** 1..N slave. Mỗi chu kỳ đọc master MỘT lần rồi so cho tất cả. */
  replicas: ReplReplicaTarget[]
  pollIntervalMs?: number
}

export interface ReplicationServiceEvents {
  sample: [ReplSample]
}

/**
 * Biến cấu hình đọc lại thưa thế nào. `SHOW GLOBAL VARIABLES` đắt (dựng cả ~500 biến rồi lọc) mà
 * `server_id`/`log_bin`/`binlog_format`/`version` thì cả tháng không đổi — đọc mỗi 15s là lãng phí
 * thuần. `read_only` KHÔNG nằm trong nhóm này: nó đọc riêng mỗi chu kỳ bằng `READ_ONLY_SQL`.
 */
export const VARS_REFRESH_MS = 5 * 60_000

/** Probe kèm những gì đã dò và nhớ được — không hỏi lại server mỗi chu kỳ. */
export interface ProbeSession {
  probe: ReplProbe
  /** Dò 1 lần rồi nhớ — version không đổi giữa 2 lần poll. */
  version: ServerVersion | null
  /** Biến cấu hình đọc lần cuối, và lúc nào (0 = chưa đọc). */
  vars?: ReplVars | null
  varsAt?: number
}

const EXEC_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Mở probe
// ---------------------------------------------------------------------------

/** Probe CLI: chạy `mysql -e '…\G'` qua SSH (đi xuyên jump chain + login-script sẵn có). */
function makeCliSession(endpoint: ReplEndpointTarget, verify: HostKeyVerifier): ProbeSession {
  const probe = makeCliProbe({
    exec: (command) =>
      execOnce(endpoint.chain, command, verify, { loginSteps: endpoint.loginSteps, timeoutMs: EXEC_TIMEOUT_MS }),
    options: {
      binary: endpoint.cliBinary,
      user: endpoint.dbUser,
      password: endpoint.dbPassword,
      // MySQL nằm ngay trên chính máy đó — nối qua TCP loopback để không phụ thuộc đường socket
      host: endpoint.dbUser ? '127.0.0.1' : undefined,
      port: endpoint.dbUser ? endpoint.dbPort : undefined
    }
  })
  return { probe, version: null }
}

/** Probe driver: bắc cầu cổng qua jump chain rồi cho mysql2 nối vào đầu local. */
async function makeDriverSession(endpoint: ReplEndpointTarget, verify: HostKeyVerifier): Promise<ProbeSession> {
  if (!endpoint.dbUser || endpoint.dbPassword === undefined) {
    throw new Error('Chế độ driver cần user + mật khẩu MySQL')
  }
  // Đã có tunnel sẵn → nối thẳng vào đầu local của nó, không bắc cầu thêm (và không đóng tunnel:
  // tunnel do TunnelService quản lý, có thể đang phục vụ cả client DB của user).
  if (endpoint.localAddress) {
    return {
      probe: await openDriverProbe({
        host: endpoint.localAddress.host,
        port: endpoint.localAddress.port,
        user: endpoint.dbUser,
        password: endpoint.dbPassword
      }),
      version: null
    }
  }
  const forward = await startForward(endpoint.chain, '127.0.0.1', endpoint.dbPort, verify)
  try {
    const probe = await openDriverProbe({
      host: '127.0.0.1',
      port: forward.port,
      user: endpoint.dbUser,
      password: endpoint.dbPassword,
      dispose: forward.close
    })
    return { probe, version: null }
  } catch (error) {
    forward.close()
    throw error
  }
}

/**
 * Mở probe theo `probeMode`. `auto` thử driver trước; hỏng vì bất kỳ lý do gì (cổng đóng,
 * thiếu credential, MySQL chỉ nghe socket) thì rơi xuống CLI — đường nào cũng cho ra cùng DTO.
 */
export async function openEndpointProbe(
  endpoint: ReplEndpointTarget,
  verify: HostKeyVerifier
): Promise<ProbeSession> {
  // Caller đã biết đầu này hỏng → ném đúng lý do đó, đừng thử kết nối rồi báo lỗi khó hiểu hơn
  if (endpoint.brokenReason) throw new Error(endpoint.brokenReason)
  // Đi qua tunnel: KHÔNG có đường CLI (CLI nghĩa là chạy `mysql` trên server, còn ta đang ở đầu
  // local của tunnel) → không im lặng rơi sang CLI, mà báo thẳng lý do nếu thiếu credential.
  if (endpoint.localAddress) return makeDriverSession(endpoint, verify)
  if (endpoint.probeMode === 'cli') return makeCliSession(endpoint, verify)
  if (endpoint.probeMode === 'driver') return makeDriverSession(endpoint, verify)
  try {
    return await makeDriverSession(endpoint, verify)
  } catch {
    return makeCliSession(endpoint, verify)
  }
}

// ---------------------------------------------------------------------------
// Đọc một lần
// ---------------------------------------------------------------------------

/** `SELECT VERSION()` — dò 1 lần để chọn đúng tên câu lệnh (MySQL 8.4 đã xoá SHOW SLAVE STATUS). */
export async function detectVersion(session: ProbeSession): Promise<ServerVersion | null> {
  if (session.version) return session.version
  try {
    const rows = await session.probe.queryRows('SELECT VERSION() AS v')
    const raw = rows[0]?.v
    session.version = raw === undefined || raw === null ? null : parseServerVersion(String(raw))
  } catch {
    // Không dò được thì cứ thử theo thứ tự mặc định — không vì thế mà hỏng cả lần đo
    session.version = null
  }
  return session.version
}

/**
 * Biến hệ thống, tiết kiệm câu lệnh:
 *  - Nhóm cấu hình (`SHOW GLOBAL VARIABLES`, ĐẮT) chỉ đọc lần đầu rồi mỗi `VARS_REFRESH_MS`.
 *  - `read_only`/`super_read_only` đọc MỖI chu kỳ bằng `SELECT @@global.x` (rẻ) vì đó là cảnh báo
 *    split-brain — phát hiện chậm 5 phút là không chấp nhận được.
 * Không bao giờ ném: thiếu quyền đọc biến thì vẫn phải đo được trạng thái replication.
 */
async function readVars(session: ProbeSession, now: number): Promise<ReplVars | null> {
  const stale = session.varsAt === undefined || now - session.varsAt >= VARS_REFRESH_MS
  if (stale) {
    try {
      session.vars = normalizeVars(variableRowsToMap(await session.probe.queryRows(VARS_SQL)))
    } catch {
      session.vars = null
    }
    // Ghi mốc kể cả khi lỗi: thiếu quyền thì đừng thử lại mỗi 15s cho tới lần làm mới kế
    session.varsAt = now
    return session.vars
  }
  try {
    return mergeReadOnly(session.vars ?? null, await session.probe.queryRows(READ_ONLY_SQL))
  } catch {
    // Đọc read_only lỗi → PHẢI trả null cho riêng nó, KHÔNG dùng giá trị cache: `ReplAlertEngine`
    // đóng băng khi read_only null (đúng), còn tin số cũ thì hoặc bỏ sót split-brain hoặc báo động
    // dựa trên thông tin đã lỗi thời.
    if (!session.vars) return null
    return { ...session.vars, readOnly: null, superReadOnly: null }
  }
}

async function readMaster(session: ProbeSession): Promise<MasterStatus | null> {
  const rows = await queryFirstSupported(session.probe, masterStatusSqlFor(await detectVersion(session)))
  return rows[0] ? normalizeMasterStatus(rows[0]) : null
}

/** Ảnh chụp master tại MỘT thời điểm, dùng chung cho mọi slave của cụm trong cùng chu kỳ. */
export interface MasterSnapshot {
  master: MasterStatus | null
  masterVars: ReplVars | null
  /** Đọc được replica nhưng không đọc được master — lần đo vẫn hợp lệ, chỉ mất phần so byte. */
  masterError?: string
}

export const NO_MASTER: MasterSnapshot = { master: null, masterVars: null }

/**
 * Đọc master MỘT lần cho cả chu kỳ. Không bao giờ ném: master hỏng thì các slave vẫn đo được
 * (nhiều nơi chỉ cấp quyền trên slave), chỉ mất phần so vị trí binlog.
 */
export async function readMasterSnapshot(session: ProbeSession | null, now: number): Promise<MasterSnapshot> {
  if (!session) return NO_MASTER
  try {
    return { master: await readMaster(session), masterVars: await readVars(session, now) }
  } catch (error) {
    return { master: null, masterVars: null, masterError: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Đọc trạng thái MỘT slave và tính độ lệch so với ảnh chụp master đã có. Chỉ gọi
 * `probe.queryRows` nên test được bằng probe giả, không cần MySQL thật.
 *
 * Không đọc được replica → `ok: false` (không có gì để nói về slave đó); các slave khác trong
 * cụm KHÔNG bị ảnh hưởng.
 */
export async function readSample(
  pairId: string,
  replica: { replicaId: string; label: string; session: ProbeSession },
  masterSnapshot: MasterSnapshot,
  now: number
): Promise<ReplSample> {
  const base: ReplSample = {
    pairId,
    replicaId: replica.replicaId,
    replicaLabel: replica.label,
    ts: now,
    ok: false,
    mode: replica.session.probe.mode,
    master: null,
    replica: null,
    masterVars: null,
    replicaVars: null,
    drift: null
  }

  let status
  try {
    const rows = await queryFirstSupported(
      replica.session.probe,
      replicaStatusSqlFor(await detectVersion(replica.session))
    )
    status = rows[0] ? normalizeReplicaStatus(rows[0]) : null
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) }
  }

  return {
    ...base,
    ok: true,
    master: masterSnapshot.master,
    replica: status,
    masterVars: masterSnapshot.masterVars,
    replicaVars: await readVars(replica.session, now),
    drift: status ? computeDrift(masterSnapshot.master, status) : null,
    masterError: masterSnapshot.masterError
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

interface ActivePair {
  target: ReplPairTarget
  verify: HostKeyVerifier
  masterSession: ProbeSession | null
  /** Mỗi slave giữ kết nối riêng, key = replicaId. Slave này hỏng không ảnh hưởng slave kia. */
  replicaSessions: Map<string, ProbeSession>
  timer: NodeJS.Timeout | null
  stopped: boolean
  polling: boolean
}

export interface ReplicationServiceDeps {
  /** Tiêm để test — mặc định mở probe thật qua SSH. */
  openProbe?: (endpoint: ReplEndpointTarget, verify: HostKeyVerifier) => Promise<ProbeSession>
  /** Tiêm để test. Mặc định `Date.now`. */
  now?: () => number
}

export function clampPollInterval(ms: number | undefined): number {
  if (!ms || !Number.isFinite(ms)) return DEFAULT_POLL_INTERVAL_MS
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, Math.round(ms)))
}

export class ReplicationService extends EventEmitter<ReplicationServiceEvents> {
  private readonly pairs = new Map<string, ActivePair>()
  private readonly openProbe: NonNullable<ReplicationServiceDeps['openProbe']>
  private readonly now: () => number

  constructor(deps: ReplicationServiceDeps = {}) {
    super()
    this.openProbe = deps.openProbe ?? openEndpointProbe
    this.now = deps.now ?? Date.now
  }

  /** Bắt đầu theo dõi định kỳ. Gọi lại với cùng pairId là no-op (dùng `stop` trước nếu muốn đổi). */
  async start(target: ReplPairTarget, verify: HostKeyVerifier): Promise<void> {
    if (this.pairs.has(target.pairId)) return
    const pair: ActivePair = {
      target,
      verify,
      masterSession: null,
      replicaSessions: new Map(),
      timer: null,
      stopped: false,
      polling: false
    }
    this.pairs.set(target.pairId, pair)
    await this.poll(pair)
    if (pair.stopped) return
    pair.timer = setInterval(() => void this.poll(pair), clampPollInterval(target.pollIntervalMs))
  }

  /** Đo một lần ngay, không đợi hết chu kỳ (nút Làm mới trên UI). */
  async pollNow(pairId: string): Promise<void> {
    const pair = this.pairs.get(pairId)
    if (pair) await this.poll(pair)
  }

  isRunning(pairId: string): boolean {
    return this.pairs.has(pairId)
  }

  stop(pairId: string): void {
    const pair = this.pairs.get(pairId)
    if (!pair) return
    pair.stopped = true
    if (pair.timer) clearInterval(pair.timer)
    pair.timer = null
    this.closeSessions(pair)
    this.pairs.delete(pairId)
  }

  stopAll(): void {
    for (const id of [...this.pairs.keys()]) this.stop(id)
  }

  private static closeQuietly(session: ProbeSession | null | undefined): void {
    try {
      session?.probe.close()
    } catch {
      /* đóng lỗi thì cũng không làm gì hơn được */
    }
  }

  private closeSessions(pair: ActivePair): void {
    ReplicationService.closeQuietly(pair.masterSession)
    for (const session of pair.replicaSessions.values()) ReplicationService.closeQuietly(session)
    pair.masterSession = null
    pair.replicaSessions.clear()
  }

  /** Vứt kết nối của RIÊNG một slave — slave khác trong cụm không bị đụng tới. */
  private closeReplica(pair: ActivePair, replicaId: string): void {
    ReplicationService.closeQuietly(pair.replicaSessions.get(replicaId))
    pair.replicaSessions.delete(replicaId)
  }

  private async poll(pair: ActivePair): Promise<void> {
    // Lần đo trước còn treo (mạng chậm, chu kỳ ngắn) → bỏ lượt này thay vì chồng kết nối
    if (pair.polling || pair.stopped) return
    pair.polling = true
    try {
      if (!pair.masterSession && pair.target.master) {
        try {
          pair.masterSession = await this.openProbe(pair.target.master, pair.verify)
        } catch {
          // Không mở được master thì vẫn đo slave — readMasterSnapshot sẽ ghi masterError
        }
      }
      if (pair.stopped) return
      // Đọc master MỘT lần rồi so cho MỌI slave: nhẹ cho master, và các slave được so trên cùng
      // một mốc vị trí binlog nên chênh lệch giữa chúng mới có nghĩa.
      const snapshot = await readMasterSnapshot(pair.masterSession, this.now())
      if (!snapshot.master && snapshot.masterError) {
        ReplicationService.closeQuietly(pair.masterSession)
        pair.masterSession = null // lần sau dựng lại (SSH rớt / MySQL restart)
      }

      for (const target of pair.target.replicas) {
        if (pair.stopped) return
        await this.pollReplica(pair, target, snapshot)
      }
    } finally {
      pair.polling = false
    }
  }

  /** Đo 1 slave. Mọi lỗi gói vào sample của chính slave đó — không làm hỏng lượt của slave khác. */
  private async pollReplica(pair: ActivePair, target: ReplReplicaTarget, snapshot: MasterSnapshot): Promise<void> {
    try {
      let session = pair.replicaSessions.get(target.replicaId)
      if (!session) {
        session = await this.openProbe(target, pair.verify)
        pair.replicaSessions.set(target.replicaId, session)
      }
      if (pair.stopped) return
      const sample = await readSample(
        pair.target.pairId,
        { replicaId: target.replicaId, label: target.label, session },
        snapshot,
        this.now()
      )
      if (pair.stopped) return
      // Đo hỏng → vứt kết nối của slave này để lần sau dựng lại từ đầu
      if (!sample.ok) this.closeReplica(pair, target.replicaId)
      this.emit('sample', sample)
    } catch (error) {
      this.closeReplica(pair, target.replicaId)
      if (!pair.stopped) {
        this.emit('sample', errorSample(pair.target.pairId, target.replicaId, target.label, this.now(), error))
      }
    }
  }
}

export function errorSample(
  pairId: string,
  replicaId: string,
  replicaLabel: string,
  ts: number,
  error: unknown
): ReplSample {
  return {
    pairId,
    replicaId,
    replicaLabel,
    ts,
    ok: false,
    mode: null,
    master: null,
    replica: null,
    masterVars: null,
    replicaVars: null,
    drift: null,
    error: error instanceof Error ? error.message : String(error)
  }
}
