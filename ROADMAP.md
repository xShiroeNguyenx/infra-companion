# ROADMAP — Infra Companion

> Phiên bản hiện tại: **Phase 0–6** — tính năng đã có xem [docs/USER-GUIDE.md](docs/USER-GUIDE.md).  
> File này liệt kê những gì **chưa làm** hoặc **chỉ làm một phần** trong các phase trước, sắp xếp theo thứ tự ưu tiên.

---

## Còn sót từ Phase 3–6 (ưu tiên cao)

### Terminal nâng cao (Phase 3)
- ~~**Workspaces** (P38)~~ — ✅ Đã làm (v0.1.4): lưu/mở lại bộ tab + split + broadcast bằng 1 click (⋯ → Workspaces). *Còn lại (sau): đồng bộ workspace qua vault để dùng chung cả team.*
- **SSH Certificates** (P15) — hỗ trợ user cert ký bởi CA; import cert kèm key.
- **FIDO2 / hardware key** (P16) — sk-ed25519, sk-ecdsa qua OS ssh-agent.

### Sync E2EE — thêm backend (Phase 4)
- **WebDAV** — sync qua Nextcloud / Seafile / Nginx WebDAV.
- **S3** — sync qua AWS S3 / MinIO / Cloudflare R2.
- **Git repo** — commit blob vào Gitea / Forgejo / GitHub riêng.

### Vượt trội Wave 1 — còn lại (Phase 5)
- **Cloud import** (F05) — tự động import host từ AWS EC2 (kể cả SSM Session Manager), GCP Compute Engine, Azure VM, DigitalOcean, Hetzner; auto-group theo tag; refresh định kỳ.
- **Docker & Kubernetes** (F06) — liệt kê container/pod, exec vào shell, xem log, port-forward kubectl; nguồn: Docker local/remote qua SSH, kubeconfig contexts.

### Vượt trội Wave 2 — còn lại (Phase 6)
- ~~**Plugin system** (F16)~~ — ✅ **v1 đã làm (v0.1.6)**: plugin JS tin cậy chạy trong worker_thread cô lập, hook vào command palette + panel markdown + quan sát/gửi output terminal + storage; kèm tài liệu (mục Plugins trong [docs/USER-GUIDE.md](docs/USER-GUIDE.md)) + plugin mẫu. *Còn lại (v2): protocol mới (SessionKind), permission enforcement + dialog, transform output, panel HTML sandbox (F51). Marketplace F52 v1 ✅ đã làm (xem 3G).*
- **KeePassXC** (F11 mở rộng) — tích hợp Secrets Manager thêm KeePassXC qua KeePassXC-proxy.
- ~~**tmux-aware resume** (F14)~~ — ✅ Đã làm (v0.1.4): bật per-host → sau login `tmux new-session -A -s ic-main`, tự re-attach khi reconnect/mở lại (resume). *Còn lại (sau): auto-wrap toàn cục mọi phiên.*
- **ssh_config 2 chiều** (F12) — ghi ngược thay đổi vào `~/.ssh/config` (tuỳ chọn), dùng song song CLI ssh.
- ~~**Notes per host** (F18)~~ — ✅ Đã làm (v0.1.4): ghi chú Markdown mã hoá đính kèm host, xem nhanh từ sidebar, đồng bộ cùng host.

### Parity nhỏ còn thiếu (rà lại 2026-07-04, đối chiếu PLAN.md mục 2)
- **SFTP transfer queue** (P46 phần còn lại) — hàng đợi upload/download + pause/resume + retry + tốc độ/ETA (hiện transfer chạy đơn lẻ).
- **SFTP remote ↔ remote** (P45 phần còn lại) — chuyển file giữa 2 host, app làm trung gian stream.
- **Log bookmarks** (P51) — đánh dấu vị trí quan trọng trong session log, nhảy nhanh khi xem lại.
- **Windows Hello / Touch ID** (P17 phần còn lại) — xác thực sinh trắc khi mở nhanh vault (phần "remember DEK qua DPAPI/safeStorage" ĐÃ có).
- **Autocomplete từ history** (P36)†, **shortcut tuỳ biến** (P39)†, **latency + status bar chi tiết** (P40)†, **nhiều cửa sổ / kéo tab ra ngoài** (P31 phần còn lại)†.
- **Tunnel auto-start + health monitor** (F15 phần còn lại)† — tunnel tự mở khi khởi động app, tự reconnect, hiện traffic.
- **Runbook đa bước + diff output giữa các host + dry-run** (F03 phần còn lại)† — Bulk exec đã có, phần orchestration chưa.
- **Alert ngưỡng monitoring** (F04 phần còn lại) — bảng `monitor_rules` chưa có trong schema (v9); xem thêm mở rộng ở Wave 3.
- **Wake-on-LAN + mDNS/LAN discovery** (F07 phần còn lại) — toolbox đã có ping/DNS/port, chưa có WoL/discovery.

† = chưa rà code chi tiết ngày 2026-07-04 — xác minh nhanh trước khi bắt tay làm.

---

## Wave 3 — Đề xuất mở rộng (thêm 2026-07-04)

> Đề xuất mới, **chưa cam kết lịch** — chọn mục rồi làm theo phiên như trước. ID tiếp nối ma trận tính năng trong [PLAN.md](PLAN.md) mục 3 (bảng Wave 3). Ký hiệu: ⚡ quick win (~1 phiên) · 🏗️ hạng mục lớn (nhiều phiên) · ⭐ khuyến nghị làm sớm.

### 3A. Terminal thông minh (shell integration)
- **F23 — Shell integration (OSC 133)** 🏗️⭐ — inject prompt marker để app biết ranh giới từng lệnh: hiện exit code + thời gian chạy cạnh mỗi lệnh, nhảy giữa các prompt (Ctrl+↑/↓), click lệnh cũ để chạy lại. Nền tảng cho F24/F26 và các tính năng AI đọc context.
- **F24 — Command history per host** — lưu lịch sử lệnh theo host (mã hoá trong vault, sync được), search kiểu Ctrl+R ở tầng app; dùng được cả khi server xoá `.bash_history`. Nền cho autocomplete P36.
- **F25 — Trigger & highlight theo regex** ⚡ — tô màu dòng khớp pattern (ERROR/FATAL…), cấu hình "thấy pattern X → desktop notification/âm thanh" (hợp khi tail log).
- **F26 — Báo khi lệnh dài chạy xong** ⚡ — tab không focus mà prompt trở lại → notification "web-01 đã xong" (đơn giản: đoán theo im lặng output; đẹp: dựa trên F23).
- **F27 — Protective mode** ⚡ — host đánh dấu *production* thì lệnh nguy hiểm (`rm -rf`, `DROP DATABASE`, `shutdown`…) hiện confirm trước khi gửi; đặc biệt quan trọng khi Broadcast (gõ nhầm nhân N máy).

### 3B. SFTP & File
- **F28 — Diff/sync 2 thư mục local↔remote** 🏗️ — so sánh theo mtime/size/checksum, đồng bộ chọn lọc kiểu rsync.
- **F29 — Watch & auto-upload** ⚡ — theo dõi 1 thư mục local, file đổi là tự đẩy lên remote (workflow sửa code local chạy trên server).
- **F30 — Tail viewer** ⚡ — nút "theo dõi" trên file log trong SFTP → panel tail -f có follow/filter/highlight, không chiếm terminal.
- **F31 — Nén/giải nén remote** ⚡ — chuột phải → tar.gz/unzip chạy qua exec (tái dùng hạ tầng login-script v0.1.8).
- *(Mở rộng P47 — sau)*: editor tích hợp trong app (CodeMirror) bên cạnh "mở bằng editor local" đã có.

### 3C. Ops & Monitoring (bồi lên Monitoring dock v0.1.9)
- ~~**Monitor tách cửa sổ riêng + chọn host theo workspace/nhóm**~~ — ✅ Đã làm (v0.1.24): nút ⧉ tách dock monitor ra **cửa sổ riêng always-on-top** (vẫn cập nhật khi thu nhỏ app chính, dùng chung luồng sample — không mở SSH thêm; Gộp lại/Dừng từ cả 2 phía); chip **Chọn nhanh** trong modal Monitoring tick cả nhóm/workspace 1 click; grip ◢ resize dock; icon app crop lại lấp đầy khung. *Còn lại (sau): nhớ vị trí/cỡ cửa sổ tách rời qua phiên; mini-mode chỉ hiện bar.*
- **F32 — Lịch sử metrics + đồ thị** ⭐ — lưu sample vào SQLite, xem đồ thị 1h/24h thay vì chỉ realtime; đi cặp với alert ngưỡng (F04) + kênh báo webhook Slack/Telegram/Discord.
- ~~**F33 — Process viewer**~~ — ✅ Đã làm (v0.1.25): modal ⚙ Tiến trình (menu ⋯ / palette) — bảng top-like qua kênh exec riêng (xuyên login-script), sort CPU/RAM, filter, tự làm mới 5s, kill TERM/-9 có confirm.
- ~~**F34 — Systemd manager**~~ — ✅ Đã làm (v0.1.25): modal 🧰 Services — list toàn bộ service + trạng thái, start/stop/restart có confirm (cần root thì hiện lỗi systemctl nguyên văn), xem journalctl 120 dòng ngay trong modal.
- **F35 — Cron manager** ⚡ — đọc/sửa crontab qua UI, diễn giải lịch chạy human-readable.
- **F36 — Disk usage explorer** — drill-down thư mục nào ăn dung lượng (chạy `du` qua exec, UI kiểu ncdu).
- **F37 — Package updates checker** ⚡ — quét `apt/yum list updates` trên cả fleet (bồi lên Bulk), bảng "máy nào cần vá gì".
- **F38 — Security audit nhanh** ⚡ — 1 nút chạy bộ check: failed logins (`lastb`), port đang mở, fail2ban status, cert TLS sắp hết hạn → báo cáo; **hợp làm plugin mẫu thứ 4** cùng khuôn Access Log Analyzer.
- ~~**F39 — Uptime/port watcher nền**~~ — ✅ Đã làm (v0.1.25): toggle 📡 trong menu ⋯ — TCP check cả fleet mỗi 60s không mở session, chấm xanh/đỏ + latency cạnh host trong sidebar; host sau login-script gate check ở địa chỉ gate (best-effort). *Còn lại (sau): ngưỡng cảnh báo khi host down (nối vào AlertEngine), lịch sử uptime.*

### 3D. Tự động hoá & Bulk nâng cao
- **F40 — Scheduled jobs** — chạy snippet/bulk theo lịch (vd check backup mỗi sáng), lưu kết quả từng lần, báo khi fail.
- *(Gộp vào F03)*: export kết quả Bulk ra CSV/Markdown ⚡; biến `{{x}}` per-host khi chạy Bulk (biến snippet đơn lẻ ĐÃ có).

### 3E. Bảo mật & Vault
- ~~**F53 — Guard lệnh nhạy cảm**~~ — ✅ Đã làm (v0.1.21): whitelist lệnh (mặc định `rm -rf`, `mkfs`, `dd if=`, `shutdown`…), bấm Enter trên lệnh khớp → popup xác nhận trước khi chạy; đọc dòng lệnh thật từ buffer xterm nên bắt được cả lệnh gọi lại bằng ↑, không thêm độ trễ gõ phím, tự bỏ qua trong vim/less/htop (Settings → Bảo vệ lệnh nhạy cảm). *Còn lại (sau): mẫu per-host, đồng bộ whitelist qua vault.*
- ~~**F41 — TOTP trong vault**~~ ⭐ — ✅ Đã làm (v0.1.25): seed base32 lưu mã hoá per-host (migration v11), login script dùng token `{{totp}}` ở ô gửi → thay bằng mã 6 số TƯƠI đúng lúc gửi (RFC 6238, verify bằng test vector chuẩn). *Còn lại (sau): nút hiện mã hiện tại trong editor; {{totp}} cho đường exec.*
- **F42 — SSH key rotation wizard** — sinh key mới → đẩy `authorized_keys` loạt host (qua Bulk) → xác minh đăng nhập → gỡ key cũ.
- **F43 — ssh-copy-id UI** ⚡ — 1 nút đẩy public key lên host đang dùng password.
- **F44 — Known-hosts manager** ⚡ — UI xem/xoá/pin fingerprint đã TOFU (P19 mở rộng).
- **F45 — Clipboard tự xoá** ⚡ — copy password/secret từ vault → tự xoá clipboard sau ~30s.
- *(Parity liên quan)*: Windows Hello (P17), audit log local append-only (PLAN mục 7.8).

### 3F. AI (bồi lên AI assistant F09 sẵn có)
- **F46 — Giải thích output đang chọn** ⚡⭐ — bôi đen đoạn output → chuột phải "Giải thích" → AI trả lời trong panel dock góc phải (tái dùng dock v0.1.9). Rẻ, hiệu quả cao.
- **F47 — Sinh lệnh inline** ⚡ — gõ `#` + mô tả tiếng Việt/Anh trong terminal → AI đề xuất lệnh, Enter chấp nhận (kiểu Warp AI).
- **F48 — AI chẩn đoán sự cố** 🏗️ — mô tả triệu chứng → AI đề xuất chuỗi lệnh chẩn đoán, chạy từng bước **có approval**, đọc output đề xuất bước tiếp (agent mode của F09).
- **F49 — Tóm tắt phiên** — từ session dài hoặc recording asciicast → AI tóm tắt "đã làm gì trên máy nào" thành note bàn giao (ghép với Notes per host F18).
- **F50 — MCP server** 🏗️⭐ — expose app làm MCP server để Claude Code/Desktop điều khiển ("mở SSH tới web-01, chạy X") — điểm khác biệt chưa client nào có.

### 3G. Plugin ecosystem
- **F51 — Plugin panel HTML sandbox** — panel iframe sandbox để plugin vẽ đồ thị/bảng đẹp hơn miniMarkdown (thuộc gói Plugin v2).
- ~~**F52 — Plugin index kiểu git**~~ — ✅ **v1 đã làm**: registry JSON tĩnh trên GitHub Pages (`docs/landing/registry/plugins.json`, sinh bằng `scripts/build-registry.mjs`) + tab 🛒 Marketplace trong modal Plugins — cài/cập nhật 1 click, verify SHA-256 từng file trước khi ghi. ✅ **Ký số ed25519 đã làm** (bước 2): registry ký bằng private key ngoài repo, app verify bằng public key nhúng, entry không chữ ký bị loại. *Còn lại: plugin trả phí (license key qua merchant-of-record — Lemon Squeezy/Paddle).*
- **Bộ plugin mẫu mới** ⚡ — mỗi mẫu vừa là tính năng vừa là marketing: cert-expiry checker, fail2ban report, backup verifier, MySQL slow-log analyzer (cùng khuôn Access Log Analyzer).

### 3H. App & QoL
- ~~**Bố cục chia màn hình (split layout) + kiểu khung pane + nút Command Palette trên toolbar**~~ — ✅ Đã làm (v0.1.23): 5 layout (auto/cột/hàng/chính-trái/chính-trên) chọn qua ▼ cạnh Split ON; kiểu khung Thanh gọn / Mac (bo góc + nút đóng tròn); nút ⌘ mở palette cho người không biết Ctrl+Shift+P; sửa scrollbar terminal mảnh (xterm 6 overlay). *Còn lại (sau): layout/khung per-tab hoặc per-pane; màu tab/pane theo host/group (dưới).*
- **F53 — Tray + chạy nền** — đóng cửa sổ nhưng tunnel/monitoring vẫn sống trong tray (đi cặp F15 auto-start).
- **F54 — Deep link `infra-companion://host/<id>`** ⚡ — click link trong wiki/ticket là mở đúng session.
- ~~**Tab/pane màu theo group**~~ ⚡ — ✅ Đã làm (v0.1.25): group editor có bảng màu nhận diện (8 màu + không màu) → sọc màu trên tab, header pane split và sidebar row của host trong group. *Còn lại (sau): màu per-host override; đổi màu viền pane khi broadcast.*
- **Dọn schema** ⚡ — migration MỚI xoá bảng chết `vpn_profiles` + cột `hosts.vpn_profile_id` (giữ đúng thứ tự migration — v10 đã dùng cho `diagnoses`, v11 cho totp/color; xem ghi chú VPN trong handoff).

### 🎯 Gợi ý 5 mục làm trước
*(F41/F04/F32/F46 trong danh sách cũ đã xong — cập nhật 2026-07-19)*
1. **F53 Tray + chạy nền** (+F15 tunnel auto-start) — nối tiếp monitor pop-out v0.1.24: đóng cửa sổ mà monitoring/watcher/tunnel vẫn sống trong tray.
2. **P46 SFTP transfer queue** (+ P45 remote↔remote) — parity còn thiếu rõ nhất.
3. **F23 Shell integration OSC 133** — tính năng "vượt Termius" thật sự, nền cho nhiều thứ sau.
4. **Mobile connect (hướng web-gateway)** — desktop làm relay, mobile mở PWA xterm.js qua LAN/tailnet; làm SAU tray (desktop chạy nền 24/7 là tiền đề).
5. **F40 Scheduled jobs** — chạy snippet/bulk theo lịch, báo khi fail.

---

## Phase 7 — Team & Remote Desktop (6–10 tuần)

### Cộng tác theo team (self-host)
- **Self-host sync server** (P52, P53) — Docker image sync server; shared vault cho team; phân quyền RBAC xem/dùng/sửa; không phụ thuộc cloud của hãng.
- **SSO OIDC/SAML + SCIM** (P54) — đăng nhập qua identity provider của công ty; provision user tự động.
- **Terminal multiplayer** — xem chung phiên terminal theo thời gian thực (pair debugging, bàn giao phiên).

### Remote Desktop
- **VNC** (F13) — xem màn hình remote qua noVNC ngay trong tab (thuần JS, không cần binary native); xuyên được qua jump host/tunnel.
- **RDP** (F13) — kết nối Windows Remote Desktop qua FreeRDP ngay trong tab; xuyên qua jump host/tunnel.

### Bảo mật mở rộng
- **Zero-trust transports** (F19) — hỗ trợ Tailscale SSH, Teleport, Cloudflare Access làm transport thay SSH trực tiếp.
- **Mosh** (P04) — bundle mosh-client; Windows chạy qua WSL.
- **VPN nhúng** — *đã đánh giá & hoãn* (2026-06-13): mục tiêu gỡ được app VPN ngoài (vd OpenVPN Connect). Cần bundle OpenVPN community + driver Wintun + Interactive Service (cài 1 lần cần admin) vì VPN bắt buộc có card mạng ảo + thao tác đặc quyền. Hạng mục riêng cỡ vài ngày, Windows trước. Hiện vẫn dùng client VPN ngoài.

---

## Tuỳ biến giao diện (sau)

- ~~**Background image**~~ — ✅ Đã làm (v0.1.3): ảnh nền phủ full khung + opacity/blur/vị trí/lấp khung. Xem [CHANGELOG.md](CHANGELOG.md).
- ~~**Theme tuỳ chỉnh**~~ — ✅ Đã làm (accent v0.1.4 + **bảng màu đầy đủ & import/export v0.1.6**): tuỳ biến 11 màu UI per theme (Settings → Giao diện → 🎨 Bảng màu tuỳ chỉnh) + xuất/nhập theme JSON. *Còn lại (sau): tuỳ biến cả màu terminal.*
- ~~**Font & cỡ chữ terminal**~~ — ✅ Đã làm (v0.1.4): font/cỡ chữ/giãn dòng/kiểu con trỏ toàn cục (Settings → Terminal). *Còn lại (sau): per-host override.*
- ~~**Copy/dán bằng chuột**~~ — ✅ Đã làm (v0.1.5): tô khối → click trái vào vùng đã tô = copy; click phải = dán (kèm Ctrl+Shift+C/V cũ). Xem [CHANGELOG.md](CHANGELOG.md).
- ~~**Ghim host (Favorites)**~~ — ✅ Đã làm (v0.1.6): nút ⭐ ghim host lên mục Yêu thích đầu sidebar (per-máy). *Còn lại (sau): đồng bộ qua vault.*

---

## Ngoài phạm vi (chưa lên kế hoạch)

- Mobile app (iOS / Android) — kiến trúc `packages/core` tách riêng để mở khả năng này sau.
- Web version.
- Marketplace plugin trả phí.
- Compliance SOC 2 (chỉ liên quan nếu thương mại hoá bản Team).

---

> Để bắt đầu một hạng mục: xem `docs/TIEP-TUC-PHIEN-SAU.md` lấy ngữ cảnh kỹ thuật, sau đó chọn mục và bắt đầu phiên làm việc mới.
