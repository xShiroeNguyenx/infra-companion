# Tiếp tục phiên sau — Trạng thái dự án Infra Companion

> File bàn giao để mở phiên mới là làm việc được ngay. Cập nhật: cuối phiên **rà soát chất lượng** (sau Phase 0–6).

## Đang ở đâu

Đã xong **Phase 0 → 6** (hơn 23 tính năng) + **1 phiên rà soát chất lượng toàn diện**. App build + typecheck + 27 test đều sạch.

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

## 2 LỰA CHỌN cho phiên sau (chọn 1 số là bắt đầu)

1. **Plugin system (F16)** — thuần JS, vừa sức. Plugin JS sandbox hook vào command palette / panel / format output. Rủi ro thấp.
2. **VNC (noVNC)** — xem màn hình remote trong tab. Thuần JS khả thi hơn RDP (RDP cần FreeRDP native, nặng). Rủi ro trung bình.

## Việc cần làm khi mở phiên mới
- Mở lại file này để nhớ ngữ cảnh.
- Nói số **1 / 2** → bắt đầu luôn.

## Git — commit toàn bộ phần đã làm (anh tự chạy; tôi không tự commit)

```powershell
cd d:\NGUYENKHANH\GLOBAL_WORKSPACE\infra-companion
# Nếu chưa từng init git ở đây:
#   git init -b main
git add -A
git status            # xem lại trước khi commit
git commit -m "Infra Companion: ra soat chat luong — sua ~30 bug (leak reconnect/tunnel/monitor, UTF-8 chunk, path traversal SFTP, secret_ref sync, race Bulk runId, vault-lock overlay, confirm xoa, Esc modal) + 27 test crypto/merge/parser"
```

> Môi trường dev: Node 20, pnpm 9, Electron 42 (Node 24 runtime — dùng `node:sqlite`), ssh2/node-pty/serialport là native nhưng đã externalize + prebuilt nên không cần build C++. Khi chạy electron từ terminal đã dính biến `ELECTRON_RUN_AS_NODE` thì thêm `$env:ELECTRON_RUN_AS_NODE=$null` cùng lệnh (chỉ là gotcha của terminal, không phải lỗi app).
