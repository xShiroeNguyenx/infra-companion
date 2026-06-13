# PLAN.md — Infra Companion

> Desktop SSH client thế hệ mới: **đầy đủ 100% tính năng Termius** + các tính năng vượt trội mà Termius không có.
> Ngày lập: 2026-06-10.
> Tiến độ: ✅ **Phase 0–6 hoàn thành** (hơn 23 tính năng + phiên rà soát chất lượng ~30 bug fix + 27 test) + **v0.1.3** (gộp tab/mở nhóm/ảnh nền) + **v0.1.4** (workspaces/notes/tuỳ biến terminal/accent/tmux). Chi tiết tính năng: [docs/HUONG-DAN-SU-DUNG.md](docs/HUONG-DAN-SU-DUNG.md). Roadmap tiếp theo: [ROADMAP.md](ROADMAP.md).

---

## 1. Tổng quan & Mục tiêu

### 1.1. Vấn đề
Termius là SSH client phổ biến nhất hiện nay nhưng có các hạn chế lớn:
- **Bắt buộc tài khoản cloud** để sync (dữ liệu hạ tầng nhạy cảm nằm trên server của họ).
- **Subscription đắt**: Pro $10/tháng, Team $20/user/tháng, Business $30/user/tháng.
- **Thiếu nhiều thứ dân DevOps cần**: không có RDP/VNC, không có Docker/Kubernetes, không monitoring, không bulk execution, không tích hợp cloud provider, không session recording, AI phụ thuộc cloud của hãng.
- Đóng nguồn, không có plugin system.

### 1.2. Mục tiêu sản phẩm
1. **Parity**: Làm được mọi thứ Termius làm được trên desktop (Windows/macOS/Linux).
2. **Vượt trội**: Local-first, không bắt buộc tài khoản, sync tự host, RDP/VNC, Docker/K8s, cloud import, monitoring, bulk ops, AI chạy được với local LLM, plugin system.
3. **Bảo mật là nền móng**: mã hoá at-rest, E2EE khi sync, private key không bao giờ rời máy ở dạng plaintext.

### 1.3. Đối tượng người dùng
- DevOps / SRE / SysAdmin quản lý nhiều server.
- Developer cần SSH/SFTP hằng ngày.
- Team nhỏ muốn chia sẻ hạ tầng an toàn mà không trả subscription.

---

## 2. Ma trận tính năng Termius (PHẢI CÓ ĐỦ — Parity Checklist)

### 2.1. Giao thức & Kết nối
| # | Tính năng | Ghi chú triển khai |
|---|-----------|--------------------|
| P01 | SSH client (OpenSSH-compatible) | thư viện `ssh2` (Node) |
| P02 | SFTP (GUI 2 pane) | subsystem của `ssh2` |
| P03 | Telnet | socket thuần + parser |
| P04 | Mosh | bundle binary `mosh-client`; Windows chạy qua WSL — đánh dấu *stretch* |
| P05 | Serial / COM port | package `serialport` |
| P06 | Local terminal (PowerShell, cmd, WSL, Git Bash, bash/zsh) | `node-pty` |
| P07 | Port forwarding: Local / Remote / Dynamic (SOCKS5) | `ssh2` forwardOut/forwardIn + UI quản lý |
| P08 | Jump host / Host chain (tương đương `ssh -J`, nhiều bậc) | chain các connection `ssh2` |
| P09 | Proxy SOCKS5 / HTTP CONNECT cho kết nối SSH | `socks` + custom agent |
| P10 | Agent forwarding | `ssh2` agentForward + Pageant/OpenSSH agent/ssh-agent |
| P11 | Keep-alive, auto-reconnect, connection timeout cấu hình được | |
| P12 | Quick Connect (gõ `user@host:port` kết nối ngay) + history | |

### 2.2. Xác thực & Mật mã
| # | Tính năng | Ghi chú |
|---|-----------|---------|
| P13 | Password, keyboard-interactive (OTP/2FA của server) | |
| P14 | Key: RSA, ECDSA, ed25519 (sinh key, import, export, đổi passphrase) | |
| P15 | SSH Certificates (user cert) | |
| P16 | FIDO2 / hardware key (sk-ed25519, sk-ecdsa) | qua OpenSSH agent của hệ điều hành |
| P17 | Biometric unlock vault (Windows Hello / Touch ID) | Electron `safeStorage` + Windows Hello API |
| P18 | Cipher hiện đại: chacha20-poly1305, aes-gcm; KEX post-quantum `sntrup761x25519` | kiểm tra hỗ trợ của ssh2, nếu thiếu → patch/fallback |
| P19 | known_hosts: TOFU, hiển thị fingerprint, cảnh báo thay đổi host key | |
| P20 | Agent tích hợp sẵn (built-in agent giữ key đã unlock trong RAM) | |

### 2.3. Quản lý Hosts & Vault
| # | Tính năng | Ghi chú |
|---|-----------|---------|
| P21 | CRUD Hosts: địa chỉ, port, label, icon, màu, tags | |
| P22 | Groups lồng nhau + **kế thừa cấu hình theo group** (credential, theme, env…) | điểm mạnh của Termius — phải làm đúng |
| P23 | Identities (username + credential) tách rời, gán cho nhiều host | |
| P24 | Vault mã hoá local (mặc định, không cần tài khoản) | SQLite + mã hoá field-level AES-256-GCM |
| P25 | Sync đa thiết bị **E2EE** | xem mục 6 — sync tự host, hơn Termius |
| P26 | Environment variables per host/group (gửi qua kênh SSH) | |
| P27 | Startup snippet (lệnh tự chạy sau khi login) | |
| P28 | Tìm kiếm hosts (fuzzy), filter theo tag/group | |
| P29 | Import: `~/.ssh/config`, known_hosts, PuTTY sessions, CSV, từ Termius | |
| P30 | Export: ssh_config, CSV, JSON (mã hoá tuỳ chọn) | |

### 2.4. Terminal UX
| # | Tính năng | Ghi chú |
|---|-----------|---------|
| P31 | Multi-tab, kéo thả tab, nhiều cửa sổ | |
| P32 | Split pane (ngang/dọc, lồng nhau), lưu layout | |
| P33 | Themes (kèm bộ theme có sẵn) + font + cỡ chữ per-host | xterm.js theme |
| P34 | Tìm kiếm trong terminal, scrollback lớn cấu hình được | addon `search` |
| P35 | Copy/paste thông minh, URL/path clickable, bracketed paste | addon `web-links` |
| P36 | Autocomplete lệnh từ history + snippet (inline ghost text) | |
| P37 | **AI autocomplete / sinh lệnh từ ngôn ngữ tự nhiên** | xem F09 — làm hơn Termius: hỗ trợ local LLM |
| P38 | Workspaces: lưu/mở lại bộ tab+split+kết nối | |
| P39 | Keyboard shortcuts tuỳ biến đầy đủ | |
| P40 | Hiện trạng thái kết nối, latency, thông tin host trên tab/status bar | |

### 2.5. Snippets
| # | Tính năng | Ghi chú |
|---|-----------|---------|
| P41 | CRUD snippets, folder/package, biến `{{var}}` nhập lúc chạy | |
| P42 | Chạy snippet trên **nhiều host/session cùng lúc** | |
| P43 | Snippet autocomplete trong terminal | |
| P44 | Chia sẻ snippet (export/import package) | |

### 2.6. SFTP & File
| # | Tính năng | Ghi chú |
|---|-----------|---------|
| P45 | Dual-pane file manager (local ↔ remote, remote ↔ remote) | |
| P46 | Upload/download, drag & drop, queue + pause/resume, retry | |
| P47 | Sửa file remote bằng editor local, tự upload khi save | watch file tạm |
| P48 | chmod/chown, symlink, mkdir, rename, xoá, xem thuộc tính | |
| P49 | Hiện file ẩn, sort, bookmark thư mục | |

### 2.7. Logging & Team (phần Termius Pro/Team/Business)
| # | Tính năng | Ghi chú |
|---|-----------|---------|
| P50 | Session log per host (ghi lại output), xem lại lịch sử | |
| P51 | Log bookmarks (đánh dấu vị trí quan trọng trong log) | |
| P52 | Shared vault cho team (chia sẻ host không lộ credential) | Phase 7 — self-host server |
| P53 | RBAC: quyền xem/dùng/sửa theo vault | Phase 7 |
| P54 | SSO (SAML/OIDC), SCIM | Phase 7 — chỉ khi làm server |

---

## 3. Tính năng VƯỢT TRỘI (Termius KHÔNG có)

### Wave 1 — giá trị cao, làm trước
| # | Tính năng | Mô tả | Hơn Termius thế nào |
|---|-----------|-------|---------------------|
| F01 | **Local-first, không cần tài khoản** | Mọi tính năng chạy offline; dữ liệu là của user | Termius bắt đăng nhập để sync |
| F02 | **Sync tự host E2EE** | Vault mã hoá thành blob, sync qua: thư mục (Syncthing/Drive), WebDAV, S3, Git repo | Termius chỉ có cloud của hãng |
| F03 | **Bulk execution / Runbooks** | Chạy 1 lệnh/snippet trên N host song song; xem output theo grid, diff output giữa các host; dry-run; lưu thành runbook nhiều bước | Termius chỉ chạy snippet nhiều host, không có diff/orchestration |
| F04 | **Monitoring dashboard** | Widget CPU/RAM/disk/network/uptime/process per host (thu thập qua SSH, không cần cài agent); cảnh báo ngưỡng | Termius hoàn toàn không có |
| F05 | **Cloud import** | Auto-import hosts từ AWS EC2 (kể cả SSM Session Manager), GCP, Azure, DigitalOcean, Hetzner; auto-group theo tag; refresh định kỳ | Termius không có |
| F06 | **Docker & Kubernetes** | Liệt kê container/pod, exec vào shell, xem logs, port-forward kubectl; nguồn: Docker local/remote qua SSH, kubeconfig contexts | XPipe có, Termius không |
| F07 | **Network toolbox** | ping, traceroute, DNS lookup, port check/scan nhanh, whois, Wake-on-LAN, mDNS/LAN discovery để tìm host mới | Termius không có |
| F08 | **Broadcast input** | Gõ 1 lần, gửi tới nhiều pane/session đã chọn (kiểu iTerm2) | Termius không có |

### Wave 2 — khác biệt hoá sâu
| # | Tính năng | Mô tả |
|---|-----------|-------|
| F09 | **AI trợ lý đa nhà cung cấp** | Sinh lệnh từ tiếng Việt/Anh, giải thích lệnh & lỗi vừa xảy ra (đọc context terminal), chế độ agent từng bước **có approval trước khi chạy**; backend: Claude API / OpenAI / **Ollama local** (privacy 100%) |
| F10 | **Session recording & replay** | Ghi phiên dạng asciinema, tua/replay, export `.cast`; audit trail ai-chạy-gì-lúc-nào |
| F11 | **Secrets manager integration** | Lấy credential trực tiếp từ 1Password, Bitwarden, HashiCorp Vault, KeePassXC — không lưu password trong app |
| F12 | **ssh_config 2 chiều** | Không chỉ import: tôn trọng và ghi ngược thay đổi vào `~/.ssh/config` (chế độ tuỳ chọn) — dùng song song với CLI ssh |
| F13 | **RDP + VNC** | Kết nối Windows RDP (FreeRDP) và VNC ngay trong tab, qua được jump host/tunnel | 
| F14 | **tmux-aware resume** | Tự attach lại tmux session sau khi rớt mạng; tuỳ chọn auto-wrap mọi phiên trong tmux |
| F15 | **Port-forward health monitor** | Dashboard tunnel: trạng thái, traffic, auto-reconnect, start-on-launch |
| F16 | **Plugin system + theme store** | Plugin JS (sandbox) hook vào: lệnh palette, panel UI, protocol mới, format output |
| F17 | **Command palette** (Ctrl+Shift+P) | Mọi hành động: connect host, chạy snippet, đổi theme… keyboard-first |
| F18 | **Notes & wiki per host** | Ghi chú markdown mã hoá đính kèm host (thông tin bàn giao, sơ đồ, mật khẩu ứng dụng…) |
| F19 | **Zero-trust friendly** | Hỗ trợ Tailscale SSH, Teleport, Cloudflare Access như transport |
| F20 | **Open-source core** | Cộng đồng audit được mã hoá/bảo mật — lợi thế niềm tin so với Termius |
| F21 | **Login script expect/send** ✅ | Tự động hoá chuỗi đăng nhập trong shell: ssh vào A → `su` user khác (mật khẩu mã hoá trong vault) → `ssh` tiếp sang B. Engine expect/send generic (chờ chuỗi → gửi lệnh), có mẫu "su → ssh", chạy lại cả khi auto-reconnect. Termius không có |
| F22 | **SFTP qua nested-ssh jump** ✅ | SFTP vào máy nội bộ chỉ vào được khi đứng trên gate (jpapst04 chỉ `ssh` được từ gate bằng key của gate): bọc lớp SFTP của ssh2 quanh exec `ssh <đích> -s sftp` chạy trên gate. Tự suy ra đích từ login script "ssh …". Termius/Tabby không làm được — chúng chỉ SFTP vào đúng máy kết nối TCP |

---

## 4. Tech Stack (khuyến nghị)

| Lớp | Lựa chọn | Lý do |
|-----|----------|-------|
| Shell app | **Electron 33+** | Termius/VS Code/Tabby đều dùng; hệ sinh thái SSH/PTY/Serial cho Node trưởng thành nhất → đạt parity nhanh. (Tauri+Rust nhẹ hơn nhưng russh chưa đủ chín cho SFTP/forwarding/FIDO2 → rủi ro tiến độ) |
| UI | **React 18 + TypeScript + Vite** | |
| State | **Zustand** (+ immer) | đơn giản, ít boilerplate |
| Styling | **Tailwind CSS + Radix UI** | build design system nhanh, dark-mode first |
| Terminal | **xterm.js** + addons: `fit`, `webgl`, `search`, `web-links`, `unicode11`, `serialize` | chuẩn ngành (VS Code dùng) |
| SSH/SFTP | **ssh2** (npm) | đầy đủ: exec, shell, sftp, forwarding, agent, jump |
| Local PTY | **node-pty** | |
| Serial | **serialport** | |
| DB local | **better-sqlite3** + mã hoá field-level (AES-256-GCM) | nhanh, đồng bộ, dễ migrate |
| Mã hoá | Node `crypto` + **argon2** (KDF master password) + Electron `safeStorage` (giữ key trong OS keychain) | |
| IPC | tRPC-over-IPC hoặc typed channel tự viết (contract chung ở `packages/shared`) | type-safe renderer↔main |
| RDP/VNC (F13) | **FreeRDP** (native module/sidecar) + **noVNC/rfb** | Phase sau |
| AI | SDK Anthropic/OpenAI + Ollama REST | adapter pattern, user tự chọn provider |
| Đóng gói | electron-builder + auto-update (GitHub Releases) | |
| Test | Vitest (unit) + Playwright (E2E Electron) | |
| CI | GitHub Actions: lint, test, build 3 OS | |

**Nguyên tắc kiến trúc quan trọng**: mọi logic SSH/crypto/storage nằm trong `core` (main process), renderer chỉ là view — sau này tái dùng core cho CLI companion hoặc server.

---

## 5. Kiến trúc tổng thể

```
┌────────────────────────── Electron Main Process ──────────────────────────┐
│  AppLifecycle · WindowManager · AutoUpdater · TrayMenu                     │
│                                                                            │
│  ┌──────────────────────── Core Services ─────────────────────────┐       │
│  │ ConnectionManager  ─ quản lý vòng đời mọi kết nối (pool, retry) │       │
│  │   ├─ SshService (ssh2)        ├─ TelnetService                  │       │
│  │   ├─ SftpService              ├─ SerialService                  │       │
│  │   ├─ PtyService (node-pty)    ├─ MoshService (sidecar)          │       │
│  │   └─ TunnelService (L/R/D forwarding + health)                  │       │
│  │ VaultService    ─ CRUD + mã hoá field-level + lock/unlock       │       │
│  │ KeyService      ─ keygen, agent tích hợp, FIDO2 bridge          │       │
│  │ KnownHostsService                                               │       │
│  │ SyncService     ─ E2EE blob ⇄ backend (FS/WebDAV/S3/Git)        │       │
│  │ SnippetService · LogService · RecordingService                  │       │
│  │ CloudImportService (AWS/GCP/Azure/DO/Hetzner)                   │       │
│  │ ContainerService (Docker/K8s) · MonitorService · NetToolService │       │
│  │ AiService (Claude/OpenAI/Ollama adapter)                        │       │
│  │ PluginHost (sandbox)                                            │       │
│  └─────────────────────────────────────────────────────────────────┘      │
│                         ▲ typed IPC (contract ở packages/shared)           │
└─────────────────────────┼──────────────────────────────────────────────────┘
                          ▼
┌────────────────────── Renderer (React) ───────────────────────┐
│ Sidebar(Hosts/Groups/Tags) · TabsBar · TerminalView(xterm.js)  │
│ SftpView · TunnelDashboard · MonitorDashboard · RunbookView    │
│ SnippetPanel · CommandPalette · Settings · VaultUnlock         │
└────────────────────────────────────────────────────────────────┘
```

- **Mỗi kết nối = 1 session object** trong ConnectionManager, có state machine: `connecting → authenticating → connected → reconnecting → closed`.
- Dữ liệu terminal stream qua IPC theo binary chunk (tránh JSON-serialize từng byte).
- Crash isolation: cân nhắc chạy ConnectionManager trong `utilityProcess` riêng để renderer crash không rớt SSH.

---

## 6. Data Model (SQLite)

Các bảng chính (trường mã hoá đánh dấu 🔒):

- **vaults** — id, name, kdf_params, created_at. (mặc định 1 "Personal" vault)
- **groups** — id, vault_id, parent_id, name, sort_order + các cột config kế thừa (identity_id, theme, env 🔒, startup_snippet_id, proxy_id…) — NULL nghĩa là kế thừa từ cha.
- **hosts** — id, group_id, label, hostname, port, protocol(ssh/telnet/serial/local/rdp/vnc/docker/k8s), icon, color, tags[], identity_id, jump_chain[], proxy_id, env 🔒, note 🔒, os_hint, favorite, last_connected_at.
- **identities** — id, label, username, auth_type(password/key/cert/agent/fido2/secret-ref), password 🔒, key_id, secret_ref (vd `op://vault/item`).
- **keys** — id, label, type, public_key, private_key 🔒, passphrase_protected, source(generated/imported).
- **known_hosts** — host_pattern, key_type, fingerprint, first_seen, last_seen.
- **snippets** — id, folder_id, label, script, variables[], target_os, run_mode.
- **port_forwards** — id, host_id, type(L/R/D), bind_host, bind_port, dest_host, dest_port, auto_start, label.
- **workspaces** — id, name, layout_json (tabs/splits/host refs).
- **session_logs** — id, host_id, started_at, ended_at, file_path (file log mã hoá trên đĩa), bookmarks[].
- **recordings** — id, host_id, cast_path, duration.
- **cloud_profiles** — id, provider, auth_ref 🔒, regions[], tag_filters, auto_refresh.
- **runbooks** — id, name, steps_json (lệnh/snippet + target selector + điều kiện dừng).
- **monitor_rules** — id, host_id/group_id, metric, threshold, interval, notify.
- **settings** — key/value (theme, font, shortcut, AI provider…).
- **sync_state** — record_id, version_vector, deleted (tombstone) — phục vụ merge LWW per-field.

**Sync E2EE (F02)**: mỗi thay đổi ghi vào oplog → đóng gói blob `AES-256-GCM(vault_key)` → đẩy lên backend (folder/WebDAV/S3/Git). Merge chiến lược LWW theo field + version vector; conflict hiếm → UI resolve thủ công.

---

## 7. Mô hình bảo mật

1. **Master password** (tuỳ chọn nhưng khuyến nghị) → `argon2id` → `vault_key` 256-bit.
2. Mọi secret (password, private key, env, note) mã hoá **AES-256-GMC field-level** bằng `vault_key`. DB metadata còn lại plaintext để search nhanh.
3. `vault_key` có thể được "remember" bằng Electron `safeStorage` (DPAPI/Keychain) + mở nhanh bằng **Windows Hello/Touch ID**; không remember → nhập master password mỗi lần mở app.
4. Auto-lock vault sau N phút idle; xoá key khỏi RAM khi lock.
5. Private key chỉ giải mã trong main process, không bao giờ gửi sang renderer.
6. Sync: chỉ blob đã mã hoá rời máy; server/backend không bao giờ thấy plaintext (zero-knowledge).
7. known_hosts strict: cảnh báo đỏ toàn màn hình khi host key đổi.
8. Audit log local (ai connect đâu, chạy runbook gì) — không thể sửa (append-only + hash chain).
9. Plugin sandbox: không cho plugin đọc vault trực tiếp, chỉ qua API có permission prompt.
10. Cập nhật ký số (code signing) cho installer + auto-update.

---

## 8. UI/UX — Danh sách màn hình

1. **Onboarding**: tạo vault, đặt master password, import từ ssh_config/PuTTY/Termius.
2. **Main window**: Sidebar (Hosts tree + search + tags) · Tab bar · vùng nội dung (terminal/sftp/dashboard) · status bar (latency, encryption, log đang ghi).
3. **Host editor** (drawer bên phải): form đầy đủ + phần "kế thừa từ group" hiển thị rõ giá trị nào override.
4. **Quick Connect** (Ctrl+T): gõ `user@host` hoặc fuzzy search host có sẵn.
5. **Command Palette** (Ctrl+Shift+P).
6. **SFTP**: 2 pane + transfer queue dưới đáy.
7. **Tunnel Dashboard**: bảng port-forward, toggle, traffic, trạng thái.
8. **Monitor Dashboard**: grid card per host (sparkline CPU/RAM/disk).
9. **Runbook/Bulk exec**: chọn targets → lệnh → grid output + diff view.
10. **Snippet manager** + panel chèn nhanh trong terminal.
11. **Vault & Security settings**: keys, known hosts, secrets integration, sync config.
12. **AI panel** (sidebar phải): chat theo context phiên hiện tại, nút "explain last error".
13. **Settings**: theme, font, shortcuts, AI provider, plugins.

Phong cách: dark-mode mặc định, mật độ thông tin cao kiểu developer tool, mọi thao tác có shortcut.

---

## 9. Roadmap chi tiết theo Phase

> Ước lượng cho 1 dev full-time. Mỗi phase có tiêu chí nghiệm thu (AC) rõ ràng.

### Phase 0 — Skeleton (1–2 tuần)
- Monorepo pnpm: `apps/desktop` (Electron+Vite+React), `packages/core`, `packages/shared`, `packages/ui`.
- Electron khởi động, cửa sổ chính, local terminal (node-pty + xterm.js) với tabs.
- CI GitHub Actions: lint + typecheck + build 3 OS; electron-builder ra installer.
- **AC**: mở app → có tab PowerShell/bash chạy được, gõ lệnh mượt; installer cài được trên Windows.

### Phase 1 — SSH Core + Vault (3–4 tuần)
- VaultService: SQLite + argon2 + AES-GCM field-level; màn unlock; auto-lock.
- CRUD Hosts/Groups/Identities/Keys (P21–P24), keygen ed25519/RSA (P14).
- SshService: connect password + key, shell channel, keep-alive, reconnect (P01, P11, P13).
- known_hosts TOFU + cảnh báo (P19). Quick Connect + history (P12).
- Tabs đa phiên, theme cơ bản, copy/paste, search trong terminal (P31, P33–P35).
- **AC**: thêm host, connect bằng key có passphrase, rút mạng → tự reconnect; restart app → vault yêu cầu unlock; fingerprint lạ → cảnh báo.

### Phase 2 — Parity I: SFTP, Forwarding, Jump, Snippets (4–6 tuần)
- SFTP dual-pane đầy đủ (P45–P49) gồm edit-with-local-editor.
- TunnelService: L/R/D forwarding + Tunnel Dashboard (P07, F15 cơ bản).
- Jump host chain nhiều bậc (P08), proxy SOCKS/HTTP (P09), agent forwarding (P10).
- Snippets: CRUD, biến, chạy đa host, autocomplete (P41–P44).
- Import ssh_config/PuTTY/known_hosts/CSV (P29), export (P30).
- Env vars + startup snippet + group inheritance hoàn chỉnh (P22, P26, P27).
- **AC**: import ssh_config 50 hosts giữ nguyên jump/proxy; mở dynamic SOCKS rồi duyệt web qua nó; sửa file remote bằng VS Code và tự upload khi save.

### Phase 3 — Parity II: Terminal nâng cao + giao thức phụ (3–5 tuần)
- Split panes + lưu layout + Workspaces (P32, P38).
- Telnet (P03), Serial (P05), local shell profiles đa loại (P06).
- Session logs + log bookmarks (P50, P51).
- Autocomplete từ history (P36), shortcuts tuỳ biến (P39), status bar chi tiết (P40).
- SSH certificates (P15), FIDO2 qua OS agent (P16), built-in agent (P20), kiểm tra PQC (P18).
- Command Palette (F17). Broadcast input (F08).
- **AC**: cắm USB-serial connect được switch; 4 pane broadcast cùng lúc; log phiên xem lại được kèm bookmark; đăng nhập host yêu cầu FIDO2 thành công.

### Phase 4 — Sync E2EE + Import/Export hoàn chỉnh (3–4 tuần)
- SyncService: oplog + version vector + blob mã hoá; backend: folder, WebDAV, S3, Git (F02).
- Conflict resolution UI. Biometric unlock (P17).
- Import từ Termius (đọc export của họ) — chiến dịch "chuyển nhà 5 phút".
- **AC**: 2 máy sửa cùng vault offline → sync hội tụ đúng; mất master password → dữ liệu không thể giải mã (đúng thiết kế).

### Phase 5 — Vượt trội Wave 1 (5–7 tuần)
- Bulk exec + Runbooks + diff output (F03).
- Monitor dashboard + alert rules (F04).
- Cloud import AWS/GCP/Azure/DO/Hetzner + SSM (F05).
- Docker/K8s browser + exec + logs (F06).
- Network toolbox + LAN discovery + WoL (F07).
- **AC**: chạy `uptime` trên 20 host trong <5s và thấy diff; EC2 mới tạo xuất hiện sau refresh; exec vào pod k8s từ sidebar.

### Phase 6 — Vượt trội Wave 2 (5–8 tuần)
- AI service: 3 provider + explain-error đọc context + agent mode có approval (F09, P37).
- Session recording asciinema + replay (F10).
- Secrets integrations: 1Password CLI, Bitwarden, HashiCorp Vault, KeePassXC (F11).
- ssh_config 2 chiều (F12). tmux-aware resume (F14). Notes per host (F18).
- Plugin system v1 + API docs (F16).
- **AC**: hỏi AI bằng tiếng Việt "tìm process ăn RAM nhất" → sinh lệnh đúng, chờ approve; replay phiên đã ghi; connect host lấy password từ 1Password.

### Phase 7 — Team & RDP/VNC (tuỳ chọn, 6–10 tuần)
- Self-host sync server (Docker image) + shared vaults + RBAC (P52, P53).
- SSO OIDC/SAML (P54). Terminal multiplayer (xem cùng phiên).
- RDP qua FreeRDP, VNC (F13). Zero-trust transports (F19).
- Mosh hoàn chỉnh (P04).

---

## 10. Cấu trúc thư mục dự kiến

```
infra-companion/
├─ apps/
│  └─ desktop/
│     ├─ src/main/          # Electron main: bootstrap, windows, ipc-router
│     ├─ src/preload/
│     └─ src/renderer/      # React app
│        ├─ features/       # hosts/, terminal/, sftp/, tunnels/, snippets/,
│        │                  # monitor/, runbooks/, ai/, settings/, vault/
│        ├─ components/     # UI dùng chung (trên packages/ui)
│        └─ stores/         # zustand stores
├─ packages/
│  ├─ core/                 # KHÔNG phụ thuộc Electron — tái dùng được
│  │  ├─ connection/        # ssh, sftp, telnet, serial, pty, tunnel, mosh
│  │  ├─ vault/             # storage, crypto, models, migrations
│  │  ├─ sync/              # oplog, merge, backends (fs/webdav/s3/git)
│  │  ├─ importers/         # ssh-config, putty, termius, csv
│  │  ├─ cloud/             # aws, gcp, azure, do, hetzner
│  │  ├─ containers/        # docker, k8s
│  │  ├─ monitor/           # collectors qua ssh, rules
│  │  ├─ ai/                # provider adapters (anthropic/openai/ollama)
│  │  └─ nettools/
│  ├─ shared/               # types + IPC contract + zod schemas
│  └─ ui/                   # design system (Radix + Tailwind)
├─ plugins/                 # plugin SDK + examples (Phase 6)
├─ e2e/                     # Playwright tests (+ docker-compose sshd test lab)
├─ docs/
└─ PLAN.md                  # file này
```

---

## 11. Testing & Verification

- **Test lab bằng Docker Compose**: containers `openssh-server` (nhiều cấu hình: password-only, key-only, cert, 2FA, jump bastion), `telnet`, `sftp-only`, k3s cho K8s — E2E chạy được cả local lẫn CI.
- **Unit (Vitest)**: crypto (vector test), merge sync, parser ssh_config/PuTTY, group inheritance resolver.
- **E2E (Playwright + Electron)**: kịch bản theo AC từng phase ở mục 9.
- **Manual matrix mỗi release**: Windows 11, macOS, Ubuntu; kết nối thật tới VPS.
- **Security review**: fuzz parser, kiểm tra secret không lọt log/IPC/renderer; chạy `npm audit` + CodeQL trong CI.
- **Perf budget**: mở app < 2s; output `yes`/`cat` file lớn không drop frame (xterm webgl); RAM < 400MB với 10 tab.

---

## 12. Rủi ro & Giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|------------|
| `ssh2` thiếu thuật toán mới (PQC, sk-keys) | Trung bình | Kiểm chứng sớm ở Phase 1 (spike 2 ngày); fallback: bridge qua OpenSSH binary cho case đặc biệt |
| Mosh trên Windows rất khó | Cao | Để Phase 7, chạy qua WSL; không chặn các phase trước |
| FIDO2 phức tạp đa nền tảng | Trung bình | Uỷ quyền cho OS ssh-agent (OpenSSH ≥ 8.3 có sẵn trên Win/mac/Linux) thay vì tự làm |
| Sync conflict làm hỏng vault | Cao | Oplog append-only + backup tự động trước mỗi merge + property-based tests |
| Electron nặng bị chê | Thấp | WebGL renderer, lazy-load features, đo perf budget từ Phase 0 |
| RDP licensing/độ khó FreeRDP | Trung bình | Để Phase 7; cân nhắc sidecar process thay vì native module |
| Scope quá lớn, đốt cháy | Cao | Bám nghiêm phase; mỗi phase ship được một bản dùng thật (dogfood từ Phase 1) |

---

## 13. Ngoài phạm vi (chưa làm)

- Mobile app (iOS/Android) — kiến trúc `packages/core` tách riêng để ngỏ khả năng này.
- Web version.
- Marketplace plugin có trả phí.
- Compliance SOC 2 (chỉ cần khi thương mại hoá bản Team).

---

## 14. Quyết định cần chốt trước khi code (Phase 0)

1. ✅ Stack: Electron + TypeScript (mục 4) — đổi sang Tauri chỉ khi chấp nhận chậm parity 2–3 tháng.
2. Tên sản phẩm/app id (tạm: **Infra Companion**, `com.nguyenkhanh.infracompanion`).
3. Giấy phép nếu open-source (đề xuất: AGPL-3.0 cho app, MIT cho plugin SDK).
4. Có làm master password bắt buộc hay tuỳ chọn (đề xuất: tuỳ chọn, mặc định bật safeStorage).

## 15. Tài liệu tham khảo

- Termius features & pricing: https://termius.com/index.html · https://termius.com/pricing
- Termius docs (port forwarding, proxy): https://docs.termius.com/termius-handbook/port-forwarding · https://termius.com/documentation/proxy
- Đối thủ tham khảo tính năng: Tabby, WindTerm, XPipe, mRemoteNG, Royal TS, iTerm2 (broadcast), Warp (AI).
- Thư viện chính: ssh2, node-pty, xterm.js, serialport, better-sqlite3, argon2.
