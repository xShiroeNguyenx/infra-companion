# Tiếp tục phiên sau — Trạng thái dự án Infra Companion

> File bàn giao để mở phiên mới là làm việc được ngay. Cập nhật: chuẩn bị release **v0.1.4** (workspaces/notes/tuỳ biến terminal/accent/tmux), sau khi v0.1.3 đã phát hành.

## Đang ở đâu

Đã xong **Phase 0 → 6** (hơn 23 tính năng) + **1 phiên rà soát chất lượng** + **v0.1.3 (đã tag/phát hành)**: gộp tab / mở nhóm / ảnh nền. App build + typecheck + 27 test đều sạch.

**v0.1.4 đã sẵn sàng nhưng CHƯA commit/tag** (xem mục cuối) — 5 tính năng: Workspaces, Notes per host, tuỳ biến terminal (font/cỡ chữ/con trỏ), màu accent tuỳ chỉnh, tmux-resume. Schema DB lên **v9** (`hosts.notes_enc`, `hosts.tmux`). ⚠️ **tmux-resume chưa test runtime** — cần server có tmux + rớt mạng thật để kiểm chứng trước khi tin tưởng.

| Phase | Trạng thái |
|-------|-----------|
| 0 — Skeleton (Electron + React + xterm + node-pty, monorepo pnpm) | ✅ |
| 1 — SSH core + Vault (argon2id + AES-256-GCM, hosts/groups/keys, TOFU, auto-reconnect) | ✅ |
| 2 — SFTP, tunnels L/R/D (SOCKS5), jump chain, snippets, import ssh_config, group inheritance, agent | ✅ |
| 3 — Split panes + **broadcast**, command palette, Telnet, Serial, session logs | ✅ (còn: workspaces, FIDO2, SSH certs) |
| 4 — **Sync E2EE** (zero-knowledge, backend thư mục) | ✅ (còn: WebDAV/S3/Git) |
| 5 — **Bulk Execution**, **Monitoring** (không agent), Network Toolbox; Bulk/Monitor/SFTP **xuyên login-script** | ✅ (còn: cloud import F05, Docker/K8s F06) |
| 6 — **AI assistant** (Claude/OpenAI/Gemini/Ollama), **Session recording** (asciicast), **Secrets manager** (op/bw/vault) | ✅ (còn: plugin F16) |
| 7 — Team server, RDP/VNC, Mosh, zero-trust | ⬜ chưa làm |

Chi tiết tính năng + cách test: [HUONG-DAN-SU-DUNG.md](./HUONG-DAN-SU-DUNG.md). Roadmap các tính năng tiếp theo: [../ROADMAP.md](../ROADMAP.md).

## Chạy lại app (từ thư mục gốc `infra-companion`)

```bash
pnpm install     # nếu máy mới / vừa pull
pnpm dev         # DEV, hot-reload (khuyên dùng)
# hoặc: pnpm build && pnpm start
```
Lưu ý: KHÔNG chạy `npx electron .` ở thư mục gốc (app nằm trong `apps/desktop`). Dùng `pnpm dev`/`pnpm start`.

## Phiên rà soát chất lượng đã làm gì (vừa xong)

Review toàn bộ codebase (4 agent song song + đọc tay phần lõi), tìm ~30 finding, **đã sửa hết nhóm nghiêm trọng**:

**Core (packages/core):**
- `SshSession`: reconnect không còn leak kết nối tới jump host; timer login-script được hủy khi rớt giữa chừng; xử lý channel đóng không có exit-status; decode UTF-8 bằng `StringDecoder` (hết vỡ ký tự tiếng Việt/CJK tại ranh giới TCP — áp cả Telnet/Serial/Bulk/Monitor).
- `TunnelService`: sửa race bấm Dừng trong lúc đang kết nối (trước đây leak port + chain mồ côi, phải thoát app mới nhả port).
- `socks5`: validate version sớm, method no-auth, reply mã lỗi chuẩn, không drop byte pipeline.
- `TelnetSession`: bảng trạng thái option (chống loop negotiation), trả lời TTYPE subnegotiation, xử lý escape IAC trong findSe.
- `BulkService`: timeout/cancel đóng kết nối thật sự (trước đây lệnh vẫn chạy tiếp trên remote sau khi UI báo timeout); hỗ trợ AbortSignal.
- `MonitorService`: hết leak setInterval mỗi lần reconnect; watchdog 10s cho poll treo; host non-Linux báo lỗi thay vì card "OK" rỗng.
- `SftpService`: đóng chain khi open fail; lọc `.`/`..` từ readdir (trước đây delete đệ quy có thể leo lên thư mục cha!); chặn path traversal qua tên file chứa `\` khi download về Windows; chmod validate; sftpOverExec có timeout + không crash khi write-after-close + dọn session khi kênh chết ngầm.
- `VaultService`: **sửa bug mất `secret_ref` khi sync** (thiếu cột trong importSnapshot); thêm `close()`.
- `SecretsService`/`AiService`/`netTools`: chặn flag-injection, timeout 60s cho fetch AI, `max_completion_tokens` cho model OpenAI mới, ping IPv6/locale.

**Main process:** runId Bulk do renderer sinh (sửa race event-trước-invoke làm UI kẹt "Đang chạy"); IPC `bulk:cancel`; guard `will-navigate`; dọn session khi renderer reload/đóng cửa sổ; monitor nhiều subscriber; guard `isDestroyed` mọi broadcast.

**Renderer:** khoá vault giờ là **overlay** (không unmount terminal → không mất scrollback khi auto-lock 15'); Esc đóng mọi modal; **confirm trước mọi xoá** (host/key/snippet/tunnel/recording/file — đặc biệt xoá file local là `rm -rf` không qua thùng rác); modal w-fit hết tràn màn nhỏ; Bulk có nút Hủy + tự hủy khi đóng modal; SyncModal hết kẹt nút khi IPC lỗi; Replay cuộn được bản ghi to; modal toàn cục mount 1 nơi (store `ui.ts` — hết double-instance Monitoring); Ctrl+I không còn gửi Tab vào terminal; form Host/Group không đóng khi misclick backdrop.

**Test (mới):** `pnpm test` — 27 test cho crypto (KDF/GCM/verifier), parser ssh_config, sync merge (LWW/tombstone/secret_ref/SQL-injection-tombstone).
> Test merge cần `node:sqlite` (Node ≥ 22.5). Node hệ thống 20 sẽ tự skip 6 test này; chạy đủ bằng Node của Electron:
> ```powershell
> $env:ELECTRON_RUN_AS_NODE='1'; Start-Process -FilePath "$PWD\node_modules\electron\dist\electron.exe" -ArgumentList "$PWD\node_modules\vitest\vitest.mjs","run" -WorkingDirectory "$PWD\packages\core" -NoNewWindow -Wait; $env:ELECTRON_RUN_AS_NODE=$null
> ```

**Chưa sửa (chấp nhận được / để sau):** cảnh báo style SonarLint (window vs globalThis, nested-ternary…) — theo convention codebase; `sandbox: false` (preload cần); Bulk/Monitor/SFTP xuyên login-script vẫn chỉ hỗ trợ `ssh …` thuần.

## Chi tiết kỹ thuật các tính năng

**v0.1.4 (CHƯA commit)** — 5 mục dưới đây. Hầu hết ở renderer + thay đổi nhỏ ở core (vault). Build + typecheck + 27 test sạch.

- **tmux-aware resume (F14)** per-host: schema **v9** (`hosts.tmux` INTEGER, mirror `agent_forward` qua resolveConnection→prepared→`SshSessionOptions`). `SshSession.sendBootstrap` thêm dòng cuối `tmux new-session -A -s ic-main` **CHỈ khi** `options.tmux` (gate chặt → host không bật bootstrap y hệt cũ). Resume nhờ sendBootstrap chạy lại mỗi (re)connect. importSnapshot: thêm `'tmux'` vào col list + default `?? 0` (cột NOT NULL, snapshot cũ thiếu). UI: checkbox trong HostEditor (Nâng cao). **CHƯA test runtime được** (cần server có tmux + rớt mạng thật) — user phải tự kiểm trước khi tag.
- **Theme accent tuỳ chỉnh**: `accentColor` trong settings (localStorage `infra.accent`), `applyAccent()` set CSS var inline `--c-accent/-hover/-fg/-soft` (hover = darken 14%); áp sớm trong main.tsx. Color picker trong Settings → Giao diện.
- **Tuỳ biến terminal**: font/cỡ chữ/giãn dòng/kiểu con trỏ trong Settings → Terminal. Settings store (localStorage, key `infra.term.*`); [TerminalPane.tsx](../apps/desktop/src/renderer/src/features/terminal/TerminalPane.tsx) đọc settings cho options + effect áp live (set `term.options.*` rồi `fit()` để PTY nhận cols/rows mới). Default font giữ stack cũ (`TERM_FONT_DEFAULT`) nên không đổi hiển thị user hiện tại. Thuần renderer, không đụng core.
- **Notes per host (F18)**: ghi chú Markdown mã hoá per-host. Schema **v8** (`ALTER TABLE hosts ADD COLUMN notes_enc`); `notes` trong HostDto (giải mã khi vault mở, như env)/HostInput (undefined=giữ, null/''=xoá); xử lý ở `saveHost`/`toHostDto` + sync export/import (`notes_plain`/`notes_enc`) trong [VaultService.ts](../packages/core/src/vault/VaultService.ts). UI: ô Notes trong [HostEditorModal.tsx](../apps/desktop/src/renderer/src/components/HostEditorModal.tsx); nút 📝 trên host row (khi có notes) mở [NotesModal.tsx](../apps/desktop/src/renderer/src/components/NotesModal.tsx) (read-only). 27 test vẫn pass (gồm sync-merge với cột mới).
- **Workspaces (P38)**: lưu/mở lại bố cục tab+split+broadcast. Mỗi `Pane` có thêm `origin` (gán DUY NHẤT trong `createPane`); tab SFTP có `sftpHostId`. `snapshotWorkspace()`/`restoreWorkspace()` trong [stores/tabs.ts](../apps/desktop/src/renderer/src/stores/tabs.ts); CRUD localStorage trong [stores/workspaces.ts](../apps/desktop/src/renderer/src/stores/workspaces.ts) (key `infra.workspaces`); UI [WorkspacesModal.tsx](../apps/desktop/src/renderer/src/components/WorkspacesModal.tsx) (vào từ ⋯ + palette). Lưu **hostId** (không denormalize) → swap sang vault-sync sau này dễ; restore chịu được host đã xoá (try/catch từng pane). Mở = cộng thêm tab, phiên mới (không scrollback). **TODO sau**: đồng bộ workspace qua vault cho cả team.
**v0.1.3 (ĐÃ phát hành/tag)** — 3 mục dưới đây + ghi chú VPN:

- **Nút Split đổi nghĩa** ([stores/tabs.ts](../apps/desktop/src/renderer/src/stores/tabs.ts)): bỏ `splitView` (xếp các tab cạnh nhau dạng lưới — Broadcast không xuyên tab). Giờ Split = `mergeTabs` gộp mọi tab terminal thành pane trong 1 tab (Broadcast dùng chung), bấm lại = `unmergeTab` tách ra. Giữ scrollback khi pane bị remount bằng `@xterm/addon-serialize` + snapshot trong [lib/termBus.ts](../apps/desktop/src/renderer/src/lib/termBus.ts) (chỉ chụp khi pane còn trong store → không rò bộ nhớ). **Dep mới**: `@xterm/addon-serialize`.
- **Mở cả nhóm 1 click**: `openSshGroup(hostIds)` trong tabs store — nút lưới trên header group ở Sidebar + lệnh palette "Mở nhóm" → mở mọi host trong group thành pane chia sẵn trong 1 tab.
- **Ảnh nền (background image)**: Settings → Ảnh nền. Lưu data URL đã downscale (canvas, cap 2560px JPEG) trong `localStorage` (per-user, **không sync**). Phủ **full khung**: chrome (`bg-panel`) bán trong suốt qua override `--c-panel` khi `data-bg='on'`; terminal trong suốt (`--term-bg: transparent` + xterm `allowTransparency` + theme nền trong suốt + nền pane/grid bỏ); lớp ảnh ở **z âm** trong stacking context `isolate` của App root → nằm dưới mọi overlay nên **không che ô nhập mật khẩu**. Chỉnh opacity/blur/vị trí (giữa/trái/phải/trên/dưới)/lấp khung (cover/contain).
- **VPN: đã thử rồi BỎ HẲN.** User muốn VPN nhúng thật (gỡ OpenVPN Connect vẫn chạy, dùng cho team) — không khả thi nhẹ nhàng: cần card mạng ảo (driver Wintun) + service đặc quyền, và OpenVPN Connect v3 **không có CLI để connect**. Đã gỡ sạch code VPN, **chỉ còn migration DB v7** (`vpn_profiles` + cột `hosts.vpn_profile_id`) — GIỮ CHỦ ĐÍCH để bảo toàn thứ tự migration (DB của user đã chạy tới v7; xoá đi sẽ làm migration tương lai bị skip). Bảng/cột "chết", không code nào dùng. **ĐỪNG tái dùng index 7** cho migration khác — migration mới thêm vào cuối là v8. Nếu sau này team thực sự cần: hướng đúng là bundle OpenVPN community + Wintun + Interactive Service (cài 1 lần cần admin) — hạng mục riêng cỡ vài ngày, Windows trước.

## 2 LỰA CHỌN cho phiên sau (chọn 1 số là bắt đầu)

1. **Plugin system (F16)** — thuần JS, vừa sức. Plugin JS sandbox hook vào command palette / panel / format output. Rủi ro thấp.
2. **VNC (noVNC)** — xem màn hình remote trong tab. Thuần JS khả thi hơn RDP (RDP cần FreeRDP native, nặng). Rủi ro trung bình.

## Việc cần làm khi mở phiên mới
- Mở lại file này để nhớ ngữ cảnh.
- Nói số **1 / 2** → bắt đầu luôn.

## Git + Release v0.1.4 (anh tự chạy; tôi không tự commit)

> v0.1.3 ĐÃ tag/phát hành (3 tính năng: gộp tab/mở nhóm/ảnh nền). Phần đang chờ là **v0.1.4** (workspaces/notes/terminal/accent/tmux).

Version đã bump sẵn `0.1.3 → 0.1.4` ở `package.json` (gốc + `apps/desktop`); CHANGELOG tách [0.1.4]/[0.1.3], README/ROADMAP/docs đã cập nhật. Release tự kích hoạt khi **push tag `v*.*.*`** (xem `.github/workflows/release.yml`: tạo GitHub Release rồi build song song Win/macOS/Linux).

```powershell
cd d:\NGUYENKHANH\GLOBAL_WORKSPACE\infra-companion
git add -A
git status            # xem lại trước khi commit
git commit -m "feat: workspaces + notes per host + terminal font/cursor + custom accent + tmux resume (v0.1.4)"
git push origin main
# Phát hành: tạo tag để CI build + tạo release
git tag v0.1.4
git push origin v0.1.4
```

> Môi trường dev: Node 20, pnpm 9, Electron 42 (Node 24 runtime — dùng `node:sqlite`), ssh2/node-pty/serialport là native nhưng đã externalize + prebuilt nên không cần build C++. Khi chạy electron từ terminal đã dính biến `ELECTRON_RUN_AS_NODE` thì thêm `$env:ELECTRON_RUN_AS_NODE=$null` cùng lệnh (chỉ là gotcha của terminal, không phải lỗi app).
