import { DatabaseSync } from 'node:sqlite'

/**
 * Migration chạy tuần tự theo index; PRAGMA user_version lưu version hiện tại.
 * Chỉ THÊM migration mới vào cuối mảng, không sửa migration cũ.
 */
const MIGRATIONS: string[] = [
  // v1 — schema Phase 1.
  // Lưu ý: username/auth nằm thẳng trên hosts; tách bảng identities dùng chung ở Phase 2.
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE groups (
    id         TEXT PRIMARY KEY,
    parent_id  TEXT REFERENCES groups(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE keys (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL,
    key_type        TEXT NOT NULL,
    public_key      TEXT NOT NULL,
    private_key_enc TEXT NOT NULL,
    passphrase_enc  TEXT,
    source          TEXT NOT NULL DEFAULT 'imported',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE TABLE hosts (
    id                TEXT PRIMARY KEY,
    group_id          TEXT REFERENCES groups(id) ON DELETE SET NULL,
    label             TEXT NOT NULL,
    hostname          TEXT NOT NULL,
    port              INTEGER NOT NULL DEFAULT 22,
    username          TEXT NOT NULL DEFAULT '',
    auth_type         TEXT NOT NULL DEFAULT 'password',
    password_enc      TEXT,
    key_id            TEXT REFERENCES keys(id) ON DELETE SET NULL,
    favorite          INTEGER NOT NULL DEFAULT 0,
    last_connected_at INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );
  CREATE TABLE known_hosts (
    id                 TEXT PRIMARY KEY,
    host_pattern       TEXT NOT NULL,
    key_type           TEXT NOT NULL,
    fingerprint_sha256 TEXT NOT NULL,
    first_seen         INTEGER NOT NULL,
    last_seen          INTEGER NOT NULL,
    UNIQUE (host_pattern, key_type)
  );
  CREATE TABLE history (
    id           TEXT PRIMARY KEY,
    target       TEXT NOT NULL,
    host_id      TEXT,
    connected_at INTEGER NOT NULL
  );
  CREATE INDEX idx_hosts_group ON hosts(group_id);
  CREATE INDEX idx_history_time ON history(connected_at DESC);
  `,
  // v2 — Phase 2: jump chain, env, startup snippet, agent forward, group inheritance,
  // snippets, tunnel rules. username/auth_type chuyển sang nullable-semantics (NULL/'' = kế thừa).
  `
  ALTER TABLE hosts ADD COLUMN jump_chain TEXT;
  ALTER TABLE hosts ADD COLUMN env_enc TEXT;
  ALTER TABLE hosts ADD COLUMN startup_snippet_id TEXT;
  ALTER TABLE hosts ADD COLUMN agent_forward INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE groups ADD COLUMN username TEXT;
  ALTER TABLE groups ADD COLUMN auth_type TEXT;
  ALTER TABLE groups ADD COLUMN key_id TEXT REFERENCES keys(id) ON DELETE SET NULL;
  ALTER TABLE groups ADD COLUMN env_enc TEXT;
  ALTER TABLE groups ADD COLUMN startup_snippet_id TEXT;
  ALTER TABLE groups ADD COLUMN jump_chain TEXT;
  CREATE TABLE snippets (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    script     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE tunnels (
    id         TEXT PRIMARY KEY,
    host_id    TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('L','R','D')),
    label      TEXT NOT NULL DEFAULT '',
    bind_host  TEXT NOT NULL DEFAULT '127.0.0.1',
    bind_port  INTEGER NOT NULL,
    dest_host  TEXT,
    dest_port  INTEGER,
    auto_start INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // v3 — login script (expect/send, vd su → ssh lồng nhau), mã hoá vì chứa mật khẩu su
  `
  ALTER TABLE hosts ADD COLUMN login_script_enc TEXT;
  `,
  // v4 — protocol: ssh (mặc định) / telnet / serial. serial: hostname=COM port, port=baud.
  `
  ALTER TABLE hosts ADD COLUMN protocol TEXT NOT NULL DEFAULT 'ssh';
  `,
  // v5 — tombstones cho sync E2EE: ghi lại bản ghi đã xoá để merge LWW không "hồi sinh".
  `
  CREATE TABLE tombstones (
    record_id  TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    deleted_at INTEGER NOT NULL
  );
  `,
  // v6 — secret_ref: tham chiếu tới secret manager (op://, bw://, vault://) thay vì lưu password.
  `
  ALTER TABLE hosts ADD COLUMN secret_ref TEXT;
  `,
  // v7 — (ĐÃ BỎ tính năng VPN) Bảng/cột giữ lại để bảo toàn tính tuần tự của migration:
  // DB đã chạy v7 không được phép "tái dùng" index này cho migration khác. Không code nào dùng.
  `
  CREATE TABLE vpn_profiles (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    connect_cmd    TEXT NOT NULL,
    disconnect_cmd TEXT,
    check_host     TEXT NOT NULL,
    check_port     INTEGER NOT NULL DEFAULT 22,
    timeout_sec    INTEGER NOT NULL DEFAULT 45,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  ALTER TABLE hosts ADD COLUMN vpn_profile_id TEXT REFERENCES vpn_profiles(id) ON DELETE SET NULL;
  `,
  // v8 — ghi chú per-host (Markdown), mã hoá vì có thể chứa thông tin nhạy cảm (mật khẩu app…).
  `
  ALTER TABLE hosts ADD COLUMN notes_enc TEXT;
  `,
  // v9 — tmux: bật thì sau login tự "tmux new-session -A" để phiên sống sót khi rớt mạng (resume).
  `
  ALTER TABLE hosts ADD COLUMN tmux INTEGER NOT NULL DEFAULT 0;
  `
]

export function openDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: DatabaseSync): void {
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
}
