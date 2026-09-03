# ROADMAP — Infra Companion

> Phiên bản hiện tại: **Phase 0–6 + Local dev stack (v0.2.x)** — tính năng đã có xem [docs/USER-GUIDE.md](docs/USER-GUIDE.md).  
> File này liệt kê những gì **chưa làm** hoặc **chỉ làm một phần** trong các phase trước, sắp xếp theo thứ tự ưu tiên.

---

## Local dev stack (v0.2.0) — phần CÒN LẠI

> Vùng tính năng mới, thay Laragon/XAMPP: app tự tải + tự quản PHP/Nginx/MariaDB portable, site trỏ
> vào folder có sẵn chạy ở `*.localhost` (0 hosts file, 0 UAC), cấp DB + user cho từng site,
> Adminer/phpMyAdmin/Composer/WP-CLI/Node/mkcert. Kế hoạch đầy đủ ở
> `C:\Users\DELL\.claude\plans\wplocal-laragon-*.md` (M0–M5); dưới đây là các mốc CHƯA làm.
>
> ~~M1 nền tảng + service manager + site PHP~~ ✅ v0.2.0 · ~~M2 phần DB (cấp DB/user, dump/import,
> ghi `wp-config.php`)~~ ✅ v0.2.0 · ~~sửa site: domain custom / loại site / docroot / cổng 80~~ ✅ v0.2.1

- **M1.5 — `.test` + HTTPS local** — mkcert đã cài sẵn và nằm trong PATH của terminal site, nhưng
  app CHƯA tự `mkcert -install` + cấp cert per-site + sinh vhost 443. Đây là hạng mục duy nhất còn
  lại cần thao tác quyền cao (cert store), nên làm opt-in và gom 1 lần xin quyền cho cả lô.
  *(Domain `.test` hiện đã đặt được ở form sửa site — chỉ thiếu phần phân giải: dùng nút 🎯 hoặc
  hosts entry tay.)*
- **M2 phần còn lại — tạo site WordPress mới** — hiện chỉ trỏ vào folder CÓ SẴN; chưa có bước tải
  WordPress + scaffold `wp-config.php` + chạy `wp core install` (WP-CLI đã cài sẵn).
- **M3 — Deploy local ↔ server SSH** ⭐ — đây là phần *cầu nối* mà Laragon/LocalWP không có: pull/push
  file + DB với chính VPS đã cấu hình trong app (SFTP + exec sẵn có), `wp search-replace` domain, và
  so config local vs prod bằng CompareView. Làm `pull` trước.
- **M4 — Share public link** — cho người khác xem site local (provider `ssh` reverse forward, hoặc
  `cloudflared`).
- **macOS/Linux** — toàn bộ chỗ OS-specific đã nhốt trong `PlatformAdapter` (`WindowsAdapter` là impl
  duy nhất, `PosixAdapter` là stub throw), nên đây là viết 1 adapter chứ không phải sửa rải rác.

## HostMap — trỏ domain sang IP không sửa hosts (v0.2.0) — phần CÒN LẠI

> Mở browser Chromium với `--host-resolver-rules` → DNS ghi đè trong đúng cửa sổ đó, cert HTTPS vẫn
> khớp, mở song song nhiều server. ~~Nhóm domain + nhiều server đích + mở tất cả + copy `curl --resolve`~~ ✅ v0.2.0

- **Proxy loopback trong app** — để phủ những client KHÔNG hiểu cờ Chromium: Firefox, Postman, client
  DB. Hướng: proxy HTTP/CONNECT trên 127.0.0.1 (HTTPS đi CONNECT nên không đụng cert), tuỳ chọn bật
  proxy cho user hiện tại qua HKCU (không cần admin) + tự khôi phục khi thoát app.
- **Nhớ vị trí/cỡ cửa sổ browser** và tuỳ chọn xoá profile theo từng target (hiện chỉ xoá cả nhóm).

---

## Còn sót từ Phase 3–6 (ưu tiên cao)

### Terminal nâng cao (Phase 3)
- ~~**Workspaces** (P38)~~ — ✅ Đã làm (v0.1.4): lưu/mở lại bộ tab + split + broadcast bằng 1 click (⋯ → Workspaces). *Còn lại (sau): đồng bộ workspace qua vault để dùng chung cả team.*
- **SSH Certificates** (P15) — hỗ trợ user cert ký bởi CA; import cert kèm key.
- **FIDO2 / hardware key** (P16) — sk-ed25519, sk-ecdsa qua OS ssh-agent.

### Sync E2EE — thêm backend (Phase 4)
- ~~**F65 — Chống ghi đè + chuyển vault bằng file + auto-sync**~~ — ✅ Đã làm (v0.2.8). **Chống ghi đè** là phần quan trọng nhất: `read()` trả null vốn bị hiểu là "lần đầu, chưa có gì" nên app ghi blob của mình đè lên — mà đó là đúng hai tình huống hay xảy ra nhất trong thực tế: file **có ở đó nhưng sai tên** (`infra-companion-vault (1).blob`, tên trình duyệt đặt cho bản tải trùng) và **client cloud chưa tải xong**. Cả hai đều thay dữ liệu của mọi máy khác bằng dữ liệu của máy này, im lặng và không lùi được. Giờ app nhìn xem thư mục còn file nào gần giống (`findNearMissBlobs`) và nhớ máy này đã từng đọc được blob thật chưa (`seenRemoteAt`), trúng một trong hai thì **dừng và nói tên file tìm thấy** thay vì ghi; ghi đè là nút riêng. Vault trống cũng không tạo blob rỗng nữa. **Chuyển bằng file**: xuất/nhập blob dạng file, cho kịch bản ngồi máy mượn chỉ có trình duyệt — nhập là một chiều và UI nói rõ. **Auto-sync** 0/5/15/30/60 phút + một lượt đẩy lúc thoát app (merge là LWW nên thay đổi chưa rời máy là thay đổi có thể bị bỏ im lặng sau này); bỏ lượt khi vault khoá và **không** tính là hoạt động của user nên không vô hiệu auto-lock. *Còn lại (sau): UI giải quyết xung đột (hiện LWW không hỏi); nâng mức tối thiểu của sync passphrase — 8 ký tự là quá yếu cho một blob đặt trên cloud drive, nhưng nâng thẳng sẽ khoá user đang dùng passphrase ngắn ra ngoài.*
- **WebDAV** — sync qua Nextcloud / Seafile / Nginx WebDAV.
- **S3** — sync qua AWS S3 / MinIO / Cloudflare R2.
- **Git repo** — commit blob vào Gitea / Forgejo / GitHub riêng.
- ~~**Export hosts ra định dạng đọc được** (P30 trong PLAN.md)~~ — ✅ Đã làm (v0.2.8): `⋯` → **Xuất hosts…** ra `ssh_config` / CSV / JSON. Trước đó **không có exporter nào** — thứ duy nhất xuất được là blob mã hoá mà chỉ app này mở, tức dữ liệu vào thì được mà ra thì không, hơi lạ với một client lấy "không khoá bạn vào cloud" làm điểm bán. Bản `ssh_config` chạy được ngay với lệnh `ssh`: **kế thừa group được phân giải trước** (host để trống `username`/`keyId`/`jumpChain` là lấy của group — xuất thô sẽ ra file thiếu `User` và không đăng nhập được) và `ProxyJump` dựng lại từ jump chain bằng alias thật. Alias làm sạch ký tự `* ? ! #` — để nguyên thì nhãn "web *" thành pattern khớp MỌI host — và khử trùng lặp bằng hậu tố `-2`. **File cố ý không chứa bí mật nào**: không mật khẩu, không key material, không `notes` (chính USER-GUIDE bảo người ta ghi mật khẩu ứng dụng ở đó), không `env`; modal nói thẳng có gì và không có gì để không ai nhầm đây là bản backup. Key nằm mã hoá trong vault chứ không phải file trên đĩa nên `IdentityFile` **để dạng comment** kèm tên key — đoán bừa một path sẽ tạo ra config trông chạy được nhưng hỏng lúc kết nối. Bộ sinh là hàm thuần (`packages/core/src/exporters/hostExport.ts`, 25 test, gồm cả test khẳng định 3 định dạng đều không rò notes/env/secretRef). *Còn lại (sau): xuất kèm key ra `~/.ssh/` (phải hỏi rất rõ vì ghi private key ra đĩa); nhập ngược CSV/JSON.*

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
- **Autocomplete từ history** (P36)†, **shortcut tuỳ biến** (P39)†, **latency + status bar chi tiết** (P40)†.
- **Kéo tab ra thành cửa sổ riêng** (P31 phần còn lại)† — *đã có một phần*: Monitoring (v0.1.24) và
  Tunnels (v0.2.1) tách được ra cửa sổ always-on-top; còn lại là kéo BẤT KỲ tab (nhất là terminal) ra
  ngoài — cái này khó hơn nhiều vì phải di chuyển cả phiên PTY/SSH sang cửa sổ mới.
- **Tunnel auto-start + health monitor** (F15 phần còn lại)† — tunnel tự mở khi khởi động app, tự
  reconnect, hiện traffic. *(v0.2.1 đã làm phần theo dõi thủ công: mở ở tab, tách cửa sổ riêng, sắp
  xếp theo tên — nhưng auto-start/auto-reconnect thì chưa.)*
- **Runbook đa bước + diff output giữa các host + dry-run** (F03 phần còn lại)† — Bulk exec đã có, phần orchestration chưa.
- ~~**Alert ngưỡng monitoring** (F04 phần còn lại)~~ — ✅ Đã làm (dòng này sót lại chưa gạch, dọn 2026-08-30): `AlertEngine` + `hysteresis` + webhook (đều có test), ngưỡng và webhook URL cấu hình ở `ipc/monitorSettings.ts`, UI trong `MonitorModal`. **KHÔNG dùng bảng `monitor_rules` như dòng cũ dự tính** — cấu hình nằm trong file JSON ở userData, cố ý: vault tự khoá sau 15 phút idle còn alert phải đọc ngưỡng liên tục. Đánh đổi đã ghi trong file đó: webhook URL nằm plaintext trên máy user. *Còn lại (sau): đưa webhook URL vào vault khi có cách đọc lúc vault khoá; thêm kênh Slack/Telegram dựng sẵn thay vì URL thô.*
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
- ~~**F27 — Protective mode**~~ ⚡ — ✅ Đã làm (v0.2.9): guard lệnh nguy hiểm vốn CHỈ khớp mẫu chuỗi nên hộp thoại xác nhận `rm -rf …` trông y hệt nhau dù đích là một máy nháp hay năm con DB production — trong khi đường dùng nhiều nhất lại là "mở cả nhóm thành N pane + Broadcast", biến một lần gõ thành N máy. Nay đánh dấu **PRODUCTION ở GROUP** (vault v17, cờ ở cột thường; host kế thừa qua chuỗi group như username/keyId — chỉ cần MỘT nhóm bất kỳ trên đường lên gốc bật cờ, cố ý không cho nhóm con "hạ mức" xuống). Hộp thoại nói **số máy sắp nhận lệnh** + **liệt kê máy production**, và khi có production thì bắt **gõ lại tên máy** thay vì bấm một nút. Phần quyết định là hàm thuần ở `packages/shared` (renderer không import được `@infra/core`, mà guard chạy lúc bấm Enter nên cũng không đi vòng qua IPC được) — 13 test. ⚠️ Cột mới phải khai thêm ở `importSnapshot` nếu không sẽ **mất khi sync** (đúng loại regression đã có test cho `secret_ref`). *Còn lại (sau): đánh dấu production cho từng host lẻ; chặn hẳn thay vì chỉ hỏi.*

### 3B. SFTP & File
- **F28 — Diff/sync 2 thư mục local↔remote** 🏗️ — so sánh theo mtime/size/checksum, đồng bộ chọn lọc kiểu rsync.
- **F29 — Watch & auto-upload** ⚡ — theo dõi 1 thư mục local, file đổi là tự đẩy lên remote (workflow sửa code local chạy trên server).
- **F30 — Tail viewer** ⚡ — nút "theo dõi" trên file log trong SFTP → panel tail -f có follow/filter/highlight, không chiếm terminal.
- **F31 — Nén/giải nén remote** ⚡ — chuột phải → tar.gz/unzip chạy qua exec (tái dùng hạ tầng login-script v0.1.8).
- *(Mở rộng P47 — sau)*: editor tích hợp trong app (CodeMirror) bên cạnh "mở bằng editor local" đã có.

### 3C. Ops & Monitoring (bồi lên Monitoring dock v0.1.9)
- ~~**Monitor tách cửa sổ riêng + chọn host theo workspace/nhóm**~~ — ✅ Đã làm (v0.1.24): nút ⧉ tách dock monitor ra **cửa sổ riêng always-on-top** (vẫn cập nhật khi thu nhỏ app chính, dùng chung luồng sample — không mở SSH thêm; Gộp lại/Dừng từ cả 2 phía); chip **Chọn nhanh** trong modal Monitoring tick cả nhóm/workspace 1 click; grip ◢ resize dock; icon app crop lại lấp đầy khung. **v0.2.1**: hạ tầng cửa sổ tách rời đã tách thành `createDetachedWindow()` và **Tunnels dùng lại được ngay** (⧉ trong header Tunnels); 4 công cụ dài (AI chẩn đoán, Tunnels, Tiến trình, Services) mở được ở TAB thay popup. *Còn lại (sau): nhớ vị trí/cỡ cửa sổ tách rời qua phiên; mini-mode chỉ hiện bar; lưu tab công cụ vào workspace.*
- ~~**F32 — Lịch sử metrics + đồ thị**~~ ⭐ — ✅ Đã làm (dòng này sót lại chưa gạch, dọn 2026-08-30): `MetricsStore` lưu sample vào SQLite riêng (`metrics.db` trong userData), `downsample.ts` gộp điểm theo khung thời gian (có test), `MetricsHistoryModal` vẽ đồ thị 1h/24h.
- ~~**F33 — Process viewer**~~ — ✅ Đã làm (v0.1.25): modal ⚙ Tiến trình (menu ⋯ / palette) — bảng top-like qua kênh exec riêng (xuyên login-script), sort CPU/RAM, filter, tự làm mới 5s, kill TERM/-9 có confirm.
- ~~**F34 — Systemd manager**~~ — ✅ Đã làm (v0.1.25): modal 🧰 Services — list toàn bộ service + trạng thái, start/stop/restart có confirm (cần root thì hiện lỗi systemctl nguyên văn), xem journalctl 120 dòng ngay trong modal.
- ~~**F55 — Theo dõi bất đồng bộ master ↔ slave (MySQL/MariaDB)**~~ — ✅ Đã làm (v0.2.2): panel 🔁 (menu ⋯ / palette / tab riêng). **Mô hình CỤM: 1 master + N slave** — master khai MỘT lần, mỗi chu kỳ đọc master MỘT lần rồi so cho mọi slave (nhẹ cho master + các slave so trên CÙNG mốc binlog nên chênh lệch GIỮA chúng mới có nghĩa); mỗi slave giữ kết nối/chẩn đoán/máy trạng thái cảnh báo RIÊNG nên một con đứt không chặn cũng không làm câm con khác. Đo trễ theo **3 cách** vì `Seconds_Behind_Master` nói dối (IO thread chết vẫn báo 0; replica delay cố ý báo số to): thêm **khoảng cách binlog theo byte** cả chiều tải về lẫn chiều apply, và trừ `MASTER_DELAY` trước khi kết luận. **15 luật chẩn đoán** kèm runbook copy-paste đã nội suy giá trị thật (1236 biết file binlog nào mất + nói thẳng START SLAVE vô ích; 1062 moi tên bảng từ message rồi dựng sẵn SELECT so 2 bên; relay log hỏng → CHANGE MASTER TO có sẵn Exec_Master_Log_Pos). Lệnh mất dữ liệu phải xác nhận trước khi copy — **app KHÔNG bao giờ tự chạy lệnh sửa**. **BA đường lấy dữ liệu**: driver mysql2 qua `startForward` (xuyên jump chain sẵn có) · `mysql` CLI qua `execOnce` · **hoặc chọn một TUNNEL đã lưu** cho từng đầu — dùng khi MySQL KHÔNG nằm trên host SSH mà ở máy khác trong mạng trong (`10.20.30.40:3306`): app bật tunnel rồi nối vào đầu local, tức dùng lại đúng đường `chooseLocalForwardRoute` đã chọn (kể cả ca phải đi `nc` trên máy sâu) thay vì `direct-tcpip` phát từ gate — chính chỗ đã gây regression v0.1.31. Mặc định dùng credential sẵn trên server, mật khẩu (nếu khai) mã hoá trong vault và chỉ đi qua file `.cnf` tạm 0600; riêng chế độ tunnel BẮT BUỘC khai user+mật khẩu (nối từ máy local nên credential trên server không áp dụng) và chỉ chạy được driver. Cảnh báo nền dùng chung `hysteresis.ts` với F04, sống sót khi vault tự khoá. Tab **So lệch dữ liệu**: kiểm kê bảng/cột/index + biến cấu hình, rồi `COUNT(*)`/`CHECKSUM TABLE` cho bảng được tick. Hỗ trợ cả MySQL 8.4 (đã xoá `SHOW SLAVE STATUS`). *Còn lại (sau): GTID gap, PostgreSQL streaming, sparkline lịch sử trễ, cửa sổ tách rời.*
- **F35 — Cron manager** ⚡ — đọc/sửa crontab qua UI, diễn giải lịch chạy human-readable.
- ~~**F36 — Disk usage explorer**~~ — ✅ Đã làm (v0.2.10): `⋯` → **Đĩa đầy ở đâu**. `df` trước rồi mới `du`, vì câu hỏi thật sự đầu tiên là "phân vùng nào sắp đầy" chứ không phải "thư mục nào to". Đi **một cấp mỗi bước** (`du -d 1`) chứ không quét cả cây: quét `/` trên máy production mất vài phút và phần lớn kết quả không ai đọc. **`-x` bắt buộc** — thiếu nó `du /` bò vào `/proc`, `/sys` và mount mạng rồi trả về con số không trả lời câu hỏi nào; `-k` ép đơn vị KB để khỏi phải parse "1.4G". Thư mục thiếu quyền bị bỏ qua chứ không làm hỏng cả lần quét, và UI nói rõ nên tổng cấp cha lớn hơn tổng các dòng bên dưới. Parser là hàm thuần (`diag/diskUsage.ts`, 21 test). *Còn lại (sau): nối vào dải "Cần chú ý" để tự báo đĩa gần đầy; xoá file ngay trong panel (là lệnh GHI, cần guard riêng).*
- ~~**F37 — Package updates checker**~~ ⚡ — ✅ Đã làm (v0.2.10): `⋯` → **Máy nào cần vá**. Tick host, quét một lượt, mỗi máy một dòng: số gói chờ, số bản **bảo mật**, tên gói; máy có bản bảo mật xếp lên đầu. Dò `apt`/`dnf`/`yum`/`apk` theo từng host bằng `command -v` (không dùng `which` — image tối giản không có). Quét theo lô 4 thay vì `Promise.all` cả loạt: mở 30 kết nối cùng lúc qua một gate là cách chắc chắn để bị nghẽn. **Chỉ đọc**: cố ý KHÔNG chạy `apt update` trước (cần root + ghi vào máy, biến lệnh chẩn đoán thành lệnh sửa) nên kết quả cũ đúng bằng lần refresh cache của chính máy đó — đã ghi trên UI — và **không có nút vá**. Parser là hàm thuần (`diag/packageUpdates.ts`, 21 test, gồm test khẳng định không lệnh nào chứa `install`/`upgrade`). *Còn lại (sau): lọc chỉ hiện máy có bản bảo mật; xuất báo cáo.*
- **F38 — Security audit nhanh** ⚡ — 1 nút chạy bộ check: failed logins (`lastb`), port đang mở, fail2ban status, cert TLS sắp hết hạn → báo cáo; **hợp làm plugin mẫu thứ 4** cùng khuôn Access Log Analyzer.
- ~~**F39 — Uptime/port watcher nền**~~ — ✅ Đã làm (v0.1.25): toggle 📡 trong menu ⋯ — TCP check cả fleet mỗi 60s không mở session, chấm xanh/đỏ + latency cạnh host trong sidebar; host sau login-script gate check ở địa chỉ gate (best-effort). *Còn lại (sau): ngưỡng cảnh báo khi host down (nối vào AlertEngine), lịch sử uptime.*

### 3D. Tự động hoá & Bulk nâng cao
- **F40 — Scheduled jobs** — chạy snippet/bulk theo lịch (vd check backup mỗi sáng), lưu kết quả từng lần, báo khi fail.
- *(Gộp vào F03)*: export kết quả Bulk ra CSV/Markdown ⚡; biến `{{x}}` per-host khi chạy Bulk (biến snippet đơn lẻ ĐÃ có).

### 3E. Bảo mật & Vault
- ~~**F53 — Guard lệnh nhạy cảm**~~ — ✅ Đã làm (v0.1.21): whitelist lệnh (mặc định `rm -rf`, `mkfs`, `dd if=`, `shutdown`…), bấm Enter trên lệnh khớp → popup xác nhận trước khi chạy; đọc dòng lệnh thật từ buffer xterm nên bắt được cả lệnh gọi lại bằng ↑, không thêm độ trễ gõ phím, tự bỏ qua trong vim/less/htop (Settings → Bảo vệ lệnh nhạy cảm). *Còn lại (sau): mẫu per-host, đồng bộ whitelist qua vault.*
- ~~**F41 — TOTP trong vault**~~ ⭐ — ✅ Đã làm (v0.1.25): seed base32 lưu mã hoá per-host (migration v11), login script dùng token `{{totp}}` ở ô gửi → thay bằng mã 6 số TƯƠI đúng lúc gửi (RFC 6238, verify bằng test vector chuẩn). *Còn lại (sau): nút hiện mã hiện tại trong editor; {{totp}} cho đường exec.*
- **F42 — SSH key rotation wizard** — sinh key mới → đẩy `authorized_keys` loạt host (qua Bulk) → xác minh đăng nhập → gỡ key cũ.
- ~~**F43 — ssh-copy-id UI**~~ ⚡ — ✅ Đã làm (v0.2.9): nút 🔑 cạnh ô mật khẩu trong form host. Chọn key trong vault → ghi vào `~/.ssh/authorized_keys` → **đăng nhập thử bằng chính key đó** rồi mới báo thành công; sai quyền `~/.ssh` thì sshd bỏ qua key mà KHÔNG báo gì, nên thiếu bước thử thì "đã đẩy xong" là lời nói dối rất dễ tin. So key theo `<type> <blob>` bỏ comment nên đẩy lại từ máy khác không ghi trùng dòng. Lệnh shell giữ mức tầm thường (chỉ `cat` + `printf >>`), phần "đã có chưa" so trong JS — hàm thuần có test, và ít cú pháp shell thì ít chỗ vỡ khi đi qua host có login script. Chỉ mời đổi host sang auth key SAU KHI thử đăng nhập thành công. *Còn lại (sau): đẩy hàng loạt qua Bulk (F42 rotation wizard).*
- ~~**F44 — Known-hosts manager**~~ ⚡ — ✅ Đã làm (v0.2.9): `⋯` → **Fingerprint đã tin**. Không phải để gỡ bế tắc (prompt mismatch vốn đã có nút "vẫn tin") mà để **rà soát**: trước đây không có đường nào nhìn lại mình đã tin những gì, và sau khi dựng lại server thì mỗi lần nối phải bấm qua một cảnh báo đỏ — cảnh báo bị bấm quen tay là cảnh báo đã hỏng. Hiện fingerprint **đầy đủ không cắt** (để đối chiếu được với `ssh-keygen -lf` trên server — việc duy nhất cần làm với nó), kiểu key, mốc tin-từ / gặp-lần-cuối, có ô lọc. Xoá ghi **tombstone** nên việc quên lan được sang máy khác qua sync; không có nó thì máy kia vẫn giữ fingerprint cũ và tiếp tục báo mismatch. *Còn lại (sau): pin/ghim fingerprint để KHÔNG cho tự tin lại; import từ `~/.ssh/known_hosts`.*
- ~~**F45 — Clipboard tự xoá**~~ ⚡ — ✅ Đã làm (v0.2.8, trong khuôn "xem lại bí mật đã lưu"): chép mật khẩu/passphrase từ vault thì clipboard **tự xoá sau 30s**, và xoá cả khi thoát app trong khoảng đó (không có bước đó thì lời hứa "tự xoá" thành sai). Chỉ xoá khi clipboard **vẫn đang giữ đúng thứ mình ghi** — xoá mù sẽ nuốt mất thứ user vừa copy chỗ khác. *Còn lại (sau): áp cho mọi nút copy khác (public key, lệnh chẩn đoán…), hiện đếm ngược trên UI.*
- ~~**Xem lại bí mật đã lưu**~~ — ✅ Đã làm (v0.2.8): nút 👁 ở form host (mật khẩu) và ở danh sách Keys (passphrase). Vault trước đó **chỉ nhận vào mà không đọc ra được** — lưu mật khẩu xong là không xem lại được, trong khi blob sync thì lộ hết cho ai có sync passphrase, tức quy tắc cũ không phải ranh giới chống chính user mà chỉ chống lỗi renderer. **Luôn bắt nhập lại master password kể cả khi vault đang mở** (bật "ghi nhớ" thì vault không bao giờ auto-lock và tự mở lúc khởi động → thiếu bước này là ai ngồi vào máy cũng đọc được hết), khoá tạm 60s sau 5 lần sai, che mặc định + tự ẩn sau 20s, giá trị **không vào store**. Nút **chép thẳng** đi đường riêng: main giải mã rồi ghi clipboard nên giá trị **không hề vào renderer**. Dùng `verifyMasterPassword()` chứ không phải `unlock()` — `unlock()` gán `this.dek` nên "kiểm tra" sẽ mở vault như tác dụng phụ (có test riêng cho đúng điều đó). TOTP seed **cố ý không** xem lại được. *Còn lại (sau): xem lại `env`/`notes` đã mã hoá; nhật ký lần xem.*
- *(Parity liên quan)*: Windows Hello (P17), audit log local append-only (PLAN mục 7.8).

### 3F. AI (bồi lên AI assistant F09 sẵn có)
- ~~**F46 — Giải thích output đang chọn**~~ ⚡⭐ — ✅ Đã làm (v0.1.9 · dòng này sót lại chưa gạch, dọn 2026-08-29): bôi đen output → nút ✨ nổi hoặc `Ctrl+Shift+E` → AI trả lời trong panel dock (`AiExplainPanel.tsx`).
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
- ~~**F58 — Dashboard: lưới công cụ + dùng hết chiều rộng**~~ — ✅ Đã làm (v0.2.4): **20 công cụ của menu `⋯` lên đầu Dashboard thành 2 hàng icon dàn đều hết chiều rộng** (icon lấy từ chính nhãn `menu.*` nên không lệch 2 nơi; watcher là toggle nên sáng viền khi đang bật; Local dev chỉ hiện khi user bật ở Cài đặt). Menu `⋯` GIỮ nguyên — đó là đường vào duy nhất khi đang ở tab terminal. Khung `max-w-3xl` → **`max-w-[1600px]`**: favorites 5 cột, lịch sử monitoring 4 cột, 4 ô số đếm giãn full; ngược lại giới hạn ô Kết nối nhanh. **Kết nối nhanh chuyển lên hàng header** cạnh "+ Terminal mới" (cùng việc "mở phiên mới"). **4 mục danh sách ở cuối** (gần đây/workspaces/tunnels/phím tắt) mỗi mục vẫn full width nhưng **danh sách bên trong chia 2 cột** trong CÙNG một hộp có kẻ dọc. **Chip nhóm host → card**: dải màu chạy hết chiều cao + chip `⊞ N` + **một chấm mỗi host** (xanh/đỏ/xám-chưa-check) + footer "Mở N pane trong 1 tab" — cố ý khác hẳn card 1 host ở mục Yêu thích. Kèm tách 3 emoji trùng (`processes` ⚙→📋, `snippets` ⚡→📝, thêm `keys` 🔑) vì lưới chỉ có icon. **Dải "Cần chú ý" ✅ đã làm (v0.2.9)**: gom host không phản hồi + tunnel lỗi + slave có chẩn đoán `critical`, CHỈ hiện khi thật sự có vấn đề (khối luôn hiện là khối người ta thôi đọc); host chưa có kết quả check KHÔNG tính là chết, watcher tắt thì im hẳn vì im lặng khác với "đều ổn" — hàm thuần `collectAttention` ở `packages/shared`, 8 test. *Còn lại (sau): thêm đĩa gần đầy; thay 2 ô số đếm tồn kho bằng số hành động được; lưu lịch sử cảnh báo để trả lời "đêm qua có gì nổ".*
- ~~**F62 — Trung tâm Trợ giúp / About**~~ — ✅ Đã làm (v0.2.6): 4 thẻ **Giới thiệu / Phím tắt / Có gì mới / Gỡ rối**, mở từ **F1**, dòng version ở StatusBar, nút **ⓘ** cạnh `⋯`, icon ❓ trên lưới Dashboard và Command Palette; mở được cả dạng tab (`ToolTabKind` `help`). **Kiểm tra cập nhật giờ trả lời tường minh** (`available` / `latest` / `error` / `dev`) thay vì `Promise<void>` im lặng — electron-updater không bắn sự kiện nào khi đã mới nhất, nên trước đó bấm nút xong không phân biệt được "không có bản mới" với "hỏng". **Có gì mới** đọc mục CHANGELOG của đúng version, cắt lúc build (`extractChangelogSection` ở core, có test) và nhúng qua `define` — CHANGELOG.md không nằm trong `files` của electron-builder nên bản đã cài không có file để đọc lúc chạy. Bảng phím tắt **dùng chung một nguồn** với cheat sheet Dashboard (`lib/shortcutList.ts`) và hiện **giá trị user đang đặt** cho 4 phím terminal. **Sao chép thông tin hệ thống** cố ý chỉ có version app + OS, không host/IP/user. *Còn lại (sau): màn hình license thư viện bên thứ ba; tour onboarding lần chạy đầu.*
- ~~**F63 — Ghim tunnel + khu ★ Yêu thích ở sidebar đọc như một khối riêng**~~ — ✅ Đã làm (v0.2.7): danh sách tunnel quá mười dòng là mỗi lần lại phải rà mắt, trong khi hai ba cái dùng hàng ngày nằm lẫn trong đó. Mỗi dòng thêm nút ☆ — tunnel ghim nổi lên đầu kèm vạch vàng bên trái, phần còn lại giữ thứ tự A→Z bên dưới, và **thứ tự giống nhau ở cả 3 nơi** tunnel xuất hiện (panel Tunnels, Dashboard, cửa sổ tách rời always-on-top); ghim ở cửa sổ chính thì cửa sổ tách rời đổi ngay (sync qua sự kiện `storage`). Store favorites refactor thành factory `createFavoritesStore(key)` để host và tunnel dùng chung một khuôn + helper `pinnedFirst()` partition ổn định. Ghim lưu **per-máy** như favorite host. Kèm: khu ★ Yêu thích ở sidebar tô nền/viền `warning` nhạt thay vì render y hệt mọi group khác. *Còn lại (sau): ghim đồng bộ qua vault thay vì per-máy.*
- ~~**F64 — Thêm SSH key ngay trong form host**~~ — ✅ Đã làm (v0.2.7): dropdown key trong *Thêm host* có thêm `+ Thêm key mới…` → mở panel ngay tại chỗ, sinh ed25519 mới hoặc import key có sẵn (OpenSSH / PEM / PuTTY `.ppk`, hỗ trợ passphrase), và key vừa tạo **được chọn cho host ngay khi nó tồn tại**. Trước đó form chỉ biết đuổi người dùng đi ("tạo key ở màn hình Keys") — mà đóng form host đang điền dở để đi tạo key chính là cách người ta kết thúc bằng việc không có key nào. `generateKey`/`importKey` đổi chữ ký `boolean` → `SshKeyDto|null`. Enter trong ô của panel = tạo key chứ không submit form host.
- **F53 — Tray + chạy nền** — đóng cửa sổ nhưng tunnel/monitoring vẫn sống trong tray (đi cặp F15 auto-start).
- **F54 — Deep link `infra-companion://host/<id>`** ⚡ — click link trong wiki/ticket là mở đúng session.
- ~~**Tab/pane màu theo group**~~ ⚡ — ✅ Đã làm (v0.1.25): group editor có bảng màu nhận diện (8 màu + không màu) → sọc màu trên tab, header pane split và sidebar row của host trong group. *Còn lại (sau): màu per-host override; đổi màu viền pane khi broadcast.*
- ~~**Dọn schema**~~ ⚡ — ✅ Đã làm (v0.2.10): **vault v18** bỏ bảng chết `vpn_profiles` + cột `hosts.vpn_profile_id`. v7 giữ nguyên không sửa (append-only) — cái bị cấm là sửa migration đã phát hành, không phải là không bao giờ được xoá. Thứ tự bắt buộc: bỏ CỘT trước rồi mới bỏ BẢNG, vì cột là đầu con của khoá ngoại. Đã kiểm SQLite 3.53 (bản đi kèm Electron) cho phép `DROP COLUMN` trên cột FK và giữ nguyên dữ liệu; cột này không nằm trong danh sách cột của `importSnapshot` nên sync không đụng gì. Thêm `migrations.test.ts`.

### 🎯 Gợi ý 5 mục làm trước
*(F41/F04/F32/F46 trong danh sách cũ đã xong — cập nhật 2026-08-01; xem thêm mục **Local dev stack — phần CÒN LẠI** ở đầu file, trong đó **M3 deploy local↔server** là hạng mục có giá trị khác biệt nhất)*
1. **F53 Tray + chạy nền** (+F15 tunnel auto-start) — nối tiếp pop-out của monitor (v0.1.24) và tunnel (v0.2.1): đóng cửa sổ mà monitoring/watcher/tunnel vẫn sống trong tray.
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
- ~~**F57 — Dropdown chọn font + thêm font từ file**~~ — ✅ Đã làm (v0.2.4): thay ô nhập `font-family` thô bằng **dropdown liệt kê font THẬT có trên máy** — main quét thư mục font của OS rồi **đọc tên họ font từ bảng `name` trong file** (tên file không nói được: `segoeui.ttf` → "Segoe UI"), chỉ đọc vài KB/file nên 473 file → 269 họ trong ~150ms. Cố ý KHÔNG dùng `queryLocalFonts()` (cần quyền `local-fonts` Electron không cấp + user gesture, hỏng thì hỏng im lặng). Có **ô xem thử** ngay dưới dropdown (`ilI1 O0 {}[]() │├─┤` + dòng prompt) và **2 cảnh báo thật sự hữu ích**: font đang khai KHÔNG có trên máy (CSS âm thầm fallback — vd `Cascadia Mono` trong stack mặc định thường không có, terminal đang vẽ bằng Consolas) và font KHÔNG monospace (cột lệch, khung ký tự vỡ). **Thêm font từ file** `.ttf/.otf/.ttc/.woff/.woff2` mà không cần cài vào OS: copy vào `userData/fonts`, đăng ký bằng `FontFace`, kiểm **magic byte** chứ không tin đuôi file, tên file do main tự sinh (chặn path traversal), tối đa 8 font × 2MB. Vẫn giữ ô nhập CSS thô sau nút "Nhập tay chuỗi CSS" cho ai cần nhiều lớp dự phòng. *Còn lại (sau): per-host font; nhóm font monospace lên đầu dropdown; đọc tên họ trong `.woff2` (bảng đã nén).*
- ~~**F56 — Con trỏ chuột tuỳ chỉnh**~~ — ✅ Đã làm (v0.2.3): **19 preset** chia 2 nhóm (6 con trỏ của OS + **13 SVG app tự vẽ**: 3 mũi tên/vòng/chấm/pixel 8-bit + kiếm, tim, cây thông, tên lửa, bút chì, tia sét, chân mèo), rê chuột lên ô là xem thử được ngay. Áp cho **toàn app kể cả terminal** (`cursor` kế thừa từ `:root`, riêng terminal phải override vì `xterm.css` đặt cứng `cursor: text`), nhưng nút/ô nhập vẫn giữ con trỏ ngữ cảnh — đúng cách theme con trỏ của OS chỉ thay mũi tên mặc định. Hình tự vẽ có **viền 2 lớp** (quầng tối + nét trắng) nên đọc được trên cả terminal đen, panel sáng và ảnh nền rối. **Tự thêm từ file** PNG/GIF/WebP/SVG/CUR/ICO (tối đa 12) kèm ô sửa **điểm nhấn X/Y**; mọi file được vẽ lại ra canvas → PNG để ép trần 128px, chuẩn hoá định dạng và loại nội dung lạ trong SVG. **KHÔNG đóng gói bộ con trỏ bên thứ ba** (Bibata GPL-3.0, Capitaine LGPL-3.0, Breeze/Adwaita copyleft) — tải về rồi tự thêm. *Còn lại (sau): đồng bộ con trỏ qua vault; con trỏ per-host; cho phép sửa điểm nhấn của preset.*
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
