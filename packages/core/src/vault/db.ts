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
  `,
  // v10 — F48: lịch sử AI chẩn đoán sự cố. data_enc = JSON {steps, conclusion, error} mã hoá bằng DEK
  // (output server có thể chứa thông tin nhạy cảm). KHÔNG đưa vào sync — đây là log cục bộ.
  // host_id để tham chiếu (không FK: host có thể bị xoá mà vẫn muốn giữ lịch sử).
  `
  CREATE TABLE diagnoses (
    id         TEXT PRIMARY KEY,
    host_id    TEXT,
    host_label TEXT NOT NULL,
    symptom    TEXT NOT NULL,
    status     TEXT NOT NULL,
    data_enc   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_diagnoses_time ON diagnoses(created_at DESC);
  `,
  // v11 — F41 TOTP seed per-host (mã hoá — là secret 2FA) + màu group (tab/pane màu theo group:
  // production đỏ, staging vàng… chống gõ nhầm server).
  `
  ALTER TABLE hosts ADD COLUMN totp_enc TEXT;
  ALTER TABLE groups ADD COLUMN color TEXT;
  `,
  // v12 — F55: cặp master↔slave cần theo dõi bất đồng bộ. master_host_id có thể NULL
  // (chỉ có quyền/đường mạng tới slave — vẫn đọc được lag và trạng thái thread).
  // db_password_enc mã hoá bằng DEK. ON DELETE CASCADE theo replica: xoá host thì cặp vô nghĩa;
  // master thì SET NULL để cặp vẫn dùng được ở chế độ chỉ-slave.
  `
  CREATE TABLE repl_pairs (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    replica_host_id  TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    master_host_id   TEXT REFERENCES hosts(id) ON DELETE SET NULL,
    db_port          INTEGER NOT NULL DEFAULT 3306,
    db_user          TEXT,
    db_password_enc  TEXT,
    cli_binary       TEXT,
    probe_mode       TEXT NOT NULL DEFAULT 'auto',
    poll_interval_sec INTEGER NOT NULL DEFAULT 15,
    watch_enabled    INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  );
  CREATE INDEX idx_repl_pairs_replica ON repl_pairs(replica_host_id);
  `,
  // v13 — F55: đọc MySQL qua TUNNEL đã lưu thay vì bắc cầu tới host SSH. Cần khi MySQL nằm ở máy
  // khác trong mạng trong (vd 10.20.30.40:3306): tunnel đã có logic đi `nc` trên máy sâu trước
  // (chooseLocalForwardRoute), còn bắc cầu thẳng chỉ là direct-tcpip phát từ gate → đi sai mạng.
  // CỐ Ý KHÔNG đặt FK tới tunnels(id): ON DELETE SET NULL sẽ âm thầm biến cặp về chế độ host và
  // đo sai đường: thà giữ id treo để lúc đo báo thẳng "tunnel đã bị xoá, chọn lại".
  `
  ALTER TABLE repl_pairs ADD COLUMN replica_tunnel_id TEXT;
  ALTER TABLE repl_pairs ADD COLUMN master_tunnel_id TEXT;
  `,
  // v14 — F55: một cụm = 1 master + N SLAVE (trước đây 1 cặp chỉ 1 slave). Thực tế gần như luôn
  // là một master nhiều slave; gom lại thì master chỉ khai một lần, mỗi chu kỳ đọc master MỘT lần
  // rồi so cho mọi slave (nhẹ cho master + các slave được so trên CÙNG mốc vị trí binlog).
  //
  // Danh sách slave lưu JSON (tiền lệ: hosts.jump_chain) thay vì bảng con, vì phải BỎ cột
  // replica_host_id — nó là FK ON DELETE CASCADE, nghĩa là xoá host của slave ĐẦU sẽ xoá luôn cả
  // cụm gồm các slave khác. Với JSON thì host/tunnel biến mất chỉ làm slave đó báo lỗi lúc đo,
  // đúng cách đã chọn cho tunnel_id ở v13.
  //
  // SQLite không DROP COLUMN được khi cột nằm trong FK → phải dựng lại bảng. Thứ tự dưới đây
  // KHÔNG cần tắt `foreign_keys` (không tắt được trong transaction): lúc DROP thì chưa có bảng
  // nào tham chiếu repl_pairs. Nội suy JSON bằng nối chuỗi an toàn vì id là UUID/hex.
  `
  CREATE TABLE repl_pairs_v14 (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    master_host_id    TEXT REFERENCES hosts(id) ON DELETE SET NULL,
    master_tunnel_id  TEXT,
    replicas_json     TEXT NOT NULL DEFAULT '[]',
    db_port           INTEGER NOT NULL DEFAULT 3306,
    db_user           TEXT,
    db_password_enc   TEXT,
    cli_binary        TEXT,
    probe_mode        TEXT NOT NULL DEFAULT 'auto',
    poll_interval_sec INTEGER NOT NULL DEFAULT 15,
    watch_enabled     INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );
  INSERT INTO repl_pairs_v14 (id, name, master_host_id, master_tunnel_id, replicas_json, db_port,
    db_user, db_password_enc, cli_binary, probe_mode, poll_interval_sec, watch_enabled, created_at, updated_at)
  SELECT id, name, master_host_id, master_tunnel_id,
    '[{"id":"' || id || '","label":"","hostId":"' || replica_host_id || '","tunnelId":' ||
      CASE WHEN replica_tunnel_id IS NULL THEN 'null' ELSE '"' || replica_tunnel_id || '"' END ||
      ',"dbPort":' || db_port || '}]',
    db_port, db_user, db_password_enc, cli_binary, probe_mode, poll_interval_sec, watch_enabled,
    created_at, updated_at
  FROM repl_pairs;
  DROP INDEX IF EXISTS idx_repl_pairs_replica;
  DROP TABLE repl_pairs;
  ALTER TABLE repl_pairs_v14 RENAME TO repl_pairs;
  `,
  // v15 — F55: credential RIÊNG cho từng đầu. Thực tế không phải lúc nào cũng có một tài khoản
  // giám sát dùng chung: master một tài khoản, mỗi slave một tài khoản khác là chuyện thường.
  // db_user/db_password_enc của cụm giữ vai trò MẶC ĐỊNH; đầu nào khai riêng thì thắng.
  // Credential riêng của từng SLAVE nằm trong `replicas_json` (mật khẩu vẫn mã hoá bằng DEK, chỉ
  // là chỗ lưu đổi từ cột sang field JSON) — không cần thêm cột cho slave.
  `
  ALTER TABLE repl_pairs ADD COLUMN master_db_user TEXT;
  ALTER TABLE repl_pairs ADD COLUMN master_db_password_enc TEXT;
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
