import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { sitePortPurpose as sitePortPurposeKey } from './portPurpose'
import type { SiteInsert, SiteRow, SiteUpdate } from './types'

/**
 * State của local dev stack trong SQLite RIÊNG (`localdev.db` trong userData).
 *
 * VÌ SAO KHÔNG NẰM TRONG VAULT (quyết định quan trọng nhất về dữ liệu của module này):
 * vault tự khoá sau 15 phút idle (`main/ipc/vault.ts` AUTO_LOCK_MS). Nếu cấu hình site nằm
 * trong vault thì sau 15' main KHÔNG đọc được nữa → không restart được nginx đã crash, không
 * supervise được, không auto-start được. Cùng lập luận đã ghi ở `monitorSettings.ts`.
 * Hệ quả kèm theo: dữ liệu này nằm HOÀN TOÀN ngoài `SYNC_TABLES` nên không bao giờ sync sang
 * máy khác — đúng, vì nó mang đường dẫn tuyệt đối + cổng đã cấp của CHÍNH máy này.
 *
 * Tách file khỏi vault.db cũng để không đụng schema vault (đang ở v11).
 * Theo khuôn `MetricsStore.ts`: migration append-only qua `PRAGMA user_version`, WAL.
 */

/** Chỉ THÊM migration vào cuối mảng, KHÔNG sửa entry cũ (giống vault/db.ts + MetricsStore). */
const MIGRATIONS: string[] = [
  // v1 — site + cấp phát cổng
  `
  CREATE TABLE sites (
    id             TEXT    PRIMARY KEY,
    name           TEXT    NOT NULL,
    slug           TEXT    NOT NULL UNIQUE,
    domain         TEXT    NOT NULL UNIQUE,
    root_path      TEXT    NOT NULL,
    doc_root       TEXT    NOT NULL,
    php_version    TEXT,
    http_port      INTEGER NOT NULL,
    https          INTEGER NOT NULL DEFAULT 0,
    kind           TEXT    NOT NULL DEFAULT 'php',
    status         TEXT    NOT NULL DEFAULT 'ready',
    -- 0 = app KHÔNG tạo thư mục này (user trỏ vào folder có sẵn) ⇒ TUYỆT ĐỐI không xoá file
    created_by_app INTEGER NOT NULL DEFAULT 0,
    last_error     TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  -- purpose: 'web' | 'php-pool-0' | 'mariadb' | 'site:<siteId>' — UNIQUE để không cấp trùng
  CREATE TABLE port_alloc (
    purpose     TEXT    PRIMARY KEY,
    port        INTEGER NOT NULL UNIQUE,
    reserved_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sites_slug ON sites(slug);
  `,
  // v2 — database riêng cho từng site (MariaDB). Thêm cột thay vì bảng phụ: quan hệ 1-1 và
  // luôn đọc cùng lúc với site. `db_pass` plaintext là có ý — xem chú thích ở SiteRow.
  `
  ALTER TABLE sites ADD COLUMN db_name TEXT;
  ALTER TABLE sites ADD COLUMN db_user TEXT;
  ALTER TABLE sites ADD COLUMN db_pass TEXT;
  `
]

// Type + helper khoá cổng nằm ngoài file này (types.ts / portPurpose.ts) để module khác dùng
// được mà không kéo theo `node:sqlite`. Re-export cho tiện chỗ gọi.
export type { SiteInsert, SiteRow, SiteUpdate } from './types'
export { phpPortPurpose, sitePortPurpose } from './portPurpose'

interface RawSiteRow {
  id: string
  name: string
  slug: string
  domain: string
  root_path: string
  doc_root: string
  php_version: string | null
  http_port: number
  https: number
  kind: string
  status: string
  created_by_app: number
  last_error: string | null
  db_name: string | null
  db_user: string | null
  db_pass: string | null
  created_at: number
  updated_at: number
}

function toSite(r: RawSiteRow): SiteRow {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    domain: r.domain,
    rootPath: r.root_path,
    docRoot: r.doc_root,
    phpVersion: r.php_version,
    httpPort: r.http_port,
    https: r.https === 1,
    kind: r.kind as SiteRow['kind'],
    status: r.status as SiteRow['status'],
    createdByApp: r.created_by_app === 1,
    lastError: r.last_error,
    dbName: r.db_name ?? null,
    dbUser: r.db_user ?? null,
    dbPass: r.db_pass ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = row.user_version
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version]!)
      version += 1
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return db
}

export class LocalDevStore {
  private db: DatabaseSync | null = null

  constructor(private readonly dbPath: string) {}

  // ── Site ────────────────────────────────────────────────────────────────────

  listSites(): SiteRow[] {
    // `.all()` của node:sqlite trả Record<string, SQLOutputValue>[] → phải qua unknown
    const rows = this.ensureDb()
      .prepare('SELECT * FROM sites ORDER BY name COLLATE NOCASE')
      .all() as unknown as RawSiteRow[]
    return rows.map(toSite)
  }

  getSite(id: string): SiteRow | null {
    const row = this.ensureDb().prepare('SELECT * FROM sites WHERE id = ?').get(id) as RawSiteRow | undefined
    return row ? toSite(row) : null
  }

  getSiteBySlug(slug: string): SiteRow | null {
    const row = this.ensureDb().prepare('SELECT * FROM sites WHERE slug = ?').get(slug) as RawSiteRow | undefined
    return row ? toSite(row) : null
  }

  /** Slug/domain đã dùng — để sinh slug duy nhất trước khi tạo site. */
  takenSlugs(): Set<string> {
    const rows = this.ensureDb().prepare('SELECT slug FROM sites').all() as Array<{ slug: string }>
    return new Set(rows.map((r) => r.slug))
  }

  takenDomains(): Set<string> {
    const rows = this.ensureDb().prepare('SELECT domain FROM sites').all() as Array<{ domain: string }>
    return new Set(rows.map((r) => r.domain))
  }

  insertSite(input: SiteInsert): SiteRow {
    const now = Date.now()
    const id = randomUUID()
    this.ensureDb()
      .prepare(
        `INSERT INTO sites
         (id, name, slug, domain, root_path, doc_root, php_version, http_port, https, kind, status,
          created_by_app, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.slug,
        input.domain,
        input.rootPath,
        input.docRoot,
        input.phpVersion,
        input.httpPort,
        input.https ? 1 : 0,
        input.kind,
        input.status,
        input.createdByApp ? 1 : 0,
        now,
        now
      )
    const created = this.getSite(id)
    if (!created) throw new Error('Không đọc lại được site vừa tạo')
    return created
  }

  /** Cập nhật từng phần. Field `undefined` giữ nguyên giá trị cũ. */
  updateSite(id: string, patch: SiteUpdate): SiteRow | null {
    const current = this.getSite(id)
    if (!current) return null
    const next = {
      name: patch.name ?? current.name,
      domain: patch.domain ?? current.domain,
      doc_root: patch.docRoot ?? current.docRoot,
      php_version: patch.phpVersion === undefined ? current.phpVersion : patch.phpVersion,
      http_port: patch.httpPort ?? current.httpPort,
      https: (patch.https ?? current.https) ? 1 : 0,
      kind: patch.kind ?? current.kind,
      status: patch.status ?? current.status,
      last_error: patch.lastError === undefined ? current.lastError : patch.lastError,
      // ⚠️ KHÔNG đổi sang `??` (dù linter gợi ý): `null` = XOÁ credential, `undefined` = giữ
      // nguyên. `??` gộp hai ý đó lại → không bao giờ xoá được DB khỏi site.
      db_name: patch.dbName === undefined ? current.dbName : patch.dbName,
      db_user: patch.dbUser === undefined ? current.dbUser : patch.dbUser,
      db_pass: patch.dbPass === undefined ? current.dbPass : patch.dbPass
    }
    this.ensureDb()
      .prepare(
        `UPDATE sites SET name = ?, domain = ?, doc_root = ?, php_version = ?, http_port = ?,
         https = ?, kind = ?, status = ?, last_error = ?, db_name = ?, db_user = ?, db_pass = ?,
         updated_at = ? WHERE id = ?`
      )
      .run(
        next.name,
        next.domain,
        next.doc_root,
        next.php_version,
        next.http_port,
        next.https,
        next.kind,
        next.status,
        next.last_error,
        next.db_name,
        next.db_user,
        next.db_pass,
        Date.now(),
        id
      )
    return this.getSite(id)
  }

  /** Xoá bản ghi site + nhả cổng đã cấp cho nó (KHÔNG đụng file trên đĩa). */
  deleteSite(id: string): void {
    const db = this.ensureDb()
    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM port_alloc WHERE purpose = ?').run(sitePortPurposeKey(id))
      db.prepare('DELETE FROM sites WHERE id = ?').run(id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** Site đang ở trạng thái 'creating' khi app khởi động = tạo dở do crash → cần dọn/thử lại. */
  listStaleCreating(): SiteRow[] {
    const rows = this.ensureDb()
      .prepare("SELECT * FROM sites WHERE status = 'creating'")
      .all() as unknown as RawSiteRow[]
    return rows.map(toSite)
  }

  // ── Cấp phát cổng ───────────────────────────────────────────────────────────

  /** Mọi cổng đang được giữ — truyền vào pickPort/allocatePort làm tập `taken`. */
  takenPorts(): Set<number> {
    const rows = this.ensureDb().prepare('SELECT port FROM port_alloc').all() as Array<{ port: number }>
    return new Set(rows.map((r) => r.port))
  }

  getPort(purpose: string): number | null {
    const row = this.ensureDb().prepare('SELECT port FROM port_alloc WHERE purpose = ?').get(purpose) as
      | { port: number }
      | undefined
    return row?.port ?? null
  }

  /**
   * Ghi nhận cổng cho 1 mục đích. Cùng purpose → cập nhật; cổng đã thuộc purpose KHÁC → throw
   * (UNIQUE(port)) để không bao giờ có 2 service cùng nghĩ mình giữ 1 cổng.
   */
  setPort(purpose: string, port: number): void {
    const db = this.ensureDb()
    db.exec('BEGIN')
    try {
      // Nhả cổng cũ của chính purpose này trước, rồi mới chiếm cổng mới
      db.prepare('DELETE FROM port_alloc WHERE purpose = ?').run(purpose)
      db.prepare('INSERT INTO port_alloc (purpose, port, reserved_at) VALUES (?, ?, ?)').run(
        purpose,
        port,
        Date.now()
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  releasePort(purpose: string): void {
    this.ensureDb().prepare('DELETE FROM port_alloc WHERE purpose = ?').run(purpose)
  }

  /**
   * ⚠️ BẮT BUỘC gọi khi tắt app: WAL còn mở thì trên Windows `rmSync`/đổi thư mục gốc sẽ
   * EPERM (bài học đã ghi trong MetricsStore.close() + test của nó).
   */
  close(): void {
    this.db?.close()
    this.db = null
  }

  private ensureDb(): DatabaseSync {
    if (!this.db) this.db = openDb(this.dbPath)
    return this.db
  }
}
