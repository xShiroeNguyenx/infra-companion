# Infra Companion — Hướng dẫn sử dụng

> SSH client desktop thế hệ mới: đầy đủ tính năng Termius + nhiều thứ vượt trội (local-first, sync E2EE tự host, bulk exec, monitoring, AI đa nhà cung cấp…).
> File này hướng dẫn dùng + cách test tính năng của **phiên bản hiện tại (Phase 0–6)**. Tính năng sắp tới xem [../ROADMAP.md](../ROADMAP.md).

---

## 0. Chạy app

Từ thư mục gốc `infra-companion`:

```bash
pnpm dev      # DEV — hot reload, sửa code tự cập nhật (khuyên dùng khi phát triển)
pnpm start    # Chạy bản đã build (cần "pnpm build" trước nếu vừa sửa code)
pnpm build    # Build production ra out/
pnpm dist     # Đóng gói installer ra release/
pnpm test     # Test core: crypto / sync merge / parser ssh_config (merge cần Node >= 22.5, Node 20 tự skip)
```

> ⚠️ Đừng chạy `npx electron .` ở thư mục gốc — app nằm trong `apps/desktop`. Dùng `pnpm dev`/`pnpm start`, hoặc `npx electron apps/desktop`.

---

## 1. Vault (kho mã hoá) — màn hình đầu tiên

**Là gì**: mọi host/password/SSH key được mã hoá bằng **master password** (argon2id → AES‑256‑GCM). Không có master password = không đọc được dữ liệu. Local-first, không cần tài khoản cloud.

**Dùng**:
- Lần đầu: đặt master password (≥ 8 ký tự). Tick **"Ghi nhớ trên máy này"** để mở khoá tự động qua Windows DPAPI (không phải gõ lại).
- Khoá ngay: nút **🔒 Khoá vault** ở thanh trạng thái dưới. Tự khoá sau 15 phút không thao tác (nếu không bật ghi nhớ).

**Test**: tạo vault → thêm 1 host → tắt app → mở lại. Nếu **không** tick ghi nhớ, app sẽ đòi master password; nhập sai → từ chối.

---

## 2. Quản lý Host / Group / Key

### Host
- Sidebar trái → nút **+ Host**. Điền tên, hostname/IP, port, username, cách xác thực.
- Click host để kết nối; hover để hiện nút **⭐ ghim**, **split** (⊟), **SFTP** (📁), **sửa** (✏).
- **Ghi chú (Notes)**: trong form sửa host có ô **Ghi chú** (Markdown, **mã hoá** trong vault) — ghi mục đích server, info bàn giao, mật khẩu app… Host có ghi chú sẽ hiện nút **📝** ở sidebar để xem nhanh (read-only); đồng bộ cùng host qua Sync.
- **Ghim host (Favorites)**: hover host → bấm **⭐** để ghim. Host đã ghim hiện ở mục **★ Yêu thích** ngay đầu sidebar để truy cập nhanh (vẫn lọc theo ô tìm kiếm). Bấm ⭐ lần nữa để bỏ ghim. Lưu **trên máy này** (không đồng bộ). *Test: ghim 1 host → thấy ở mục ★ Yêu thích đầu sidebar; tắt mở app vẫn giữ.*

### Xác thực (Authentication) — 6 kiểu
| Kiểu | Khi nào dùng |
|------|--------------|
| **Password** | Gõ mật khẩu; để trống = hỏi mỗi lần kết nối |
| **SSH Key** | Chọn key đã import/sinh trong mục Keys |
| **SSH Agent (OS)** | Dùng OpenSSH agent/Pageant của Windows (kể cả FIDO2 sk-key) |
| **Secret manager** | Lấy password từ 1Password/Bitwarden/Vault lúc kết nối (xem mục 14B) |
| **Không cần xác thực** | Server cho vào thẳng (auth none / password rỗng) |
| **(kế thừa từ group)** | Lấy theo cấu hình mặc định của group |

### Keys (nút **Keys**)
- **Sinh key mới**: tạo cặp ed25519, private key mã hoá trong vault. Bấm **Copy pub** để dán vào `~/.ssh/authorized_keys` trên server.
- **Import key**: dán private key (OpenSSH/PEM/PuTPK), nhập passphrase nếu có.

### Group + kế thừa
- Menu `⋯` → **Tạo group**. Đặt mặc định: username / kiểu auth / key / env / startup snippet.
- Host trong group để trống các trường đó → **kế thừa** từ group.
- **Test kế thừa**: tạo group "Sakura" username mặc định `vn_dev` → tạo host bỏ trống username → kết nối thấy dùng `vn_dev`.

---

## 3. Kết nối SSH nâng cao

### Quick Connect
Gõ thẳng `user@host` hoặc `user@host:port` vào ô tìm kiếm sidebar → Enter để kết nối ngay (không cần lưu host). Lịch sử 50 kết nối gần nhất hiện ở mục **Gần đây**.

### Jump host (ProxyJump nhiều bậc)
- Sửa host → **Nâng cao** → thêm jump host theo thứ tự. Tương đương `ssh -J hop1,hop2 target`.
- Mỗi bậc xác minh host key + hỏi mật khẩu riêng nếu thiếu.
- **Lưu ý**: jump kiểu này xác thực **từ máy bạn** xuyên qua tunnel. Nếu máy đích chỉ nhận key có sẵn **trên gate** (không nhận credential của bạn từ ngoài) → dùng **Login script** bên dưới thay thế.

### Login script (su → ssh, hoặc ssh lồng nhau) — Termius không có
- Sửa host → **Nâng cao** → **Login script** → nút **"Mẫu: su → ssh"** hoặc tự thêm bước.
- Mỗi bước: **chờ chuỗi** (vd `assword`, `$`) → **gửi lệnh**. Tick 🔒 nếu là mật khẩu (mã hoá trong vault).
- Ví dụ thực tế (jpapst04 qua gate):
  - Host `jpapst04`: hostname = `133.242.68.60` (gate), auth = của gate.
  - Login script 1 bước: chờ `$` → gửi `ssh vn_dev@jpapst04`.
  - Kết nối → app tự ssh vào gate rồi tự gõ `ssh jpapst04` → vào thẳng. Chạy lại cả khi auto-reconnect.

### tmux — tự khôi phục phiên khi rớt mạng (per-host)
- Sửa host → **Nâng cao** → tick **"Tmux — tự khôi phục phiên khi rớt mạng"**. Sau login app tự chạy `tmux new-session -A -s ic-main`.
- Rớt mạng → app kết nối lại → **re-attach** đúng phiên tmux còn sống trên server (lệnh đang chạy/scrollback phía server còn nguyên). Kể cả khi app đã bỏ cuộc sau 3 lần thử, **mở lại host** vẫn attach lại được.
- **Yêu cầu**: server có cài `tmux`. Lưu ý: startup snippet chạy ở shell **ngoài** tmux; mở cùng host ở 2 tab sẽ "soi gương" (cùng 1 phiên tmux).

### Khác
- **Agent forwarding** (`ssh -A`), **env vars** (gửi sau login), **startup snippet** (tự chạy sau login) — đều trong phần Nâng cao.
- **known_hosts (TOFU)**: lần đầu kết nối hiện fingerprint để xác minh; nếu host key đổi → cảnh báo đỏ (chống MITM).
- **Auto-reconnect**: rớt mạng tự kết nối lại 3 lần (báo vàng trong terminal).

---

## 4. SFTP (truyền file)

**Mở**: hover host ở sidebar → bấm icon 📁.

- 2 pane: **Local** ↔ **Remote**. Double-click thư mục để vào; nút `↑` lên cha, `⟳` refresh, `+📁` thư mục mới.
- Nút **→** upload, **←** download (đệ quy cả thư mục). Hàng đợi transfer + progress ở đáy.
- Đổi tên, xoá (đệ quy), **chmod** (octal), và **✏ Sửa** — mở file remote bằng editor mặc định trên máy, **lưu là tự upload lại**.

### SFTP qua máy nội bộ (nested-ssh) — vượt trội
Với host vào bằng login script `ssh vn_dev@jpapst04`, SFTP **tự vào jpapst04** (không dừng ở gate) bằng cách chạy `ssh vn_dev@jpapst04 -s sftp` trên gate. Không cần cấu hình thêm.

**Test**: mở SFTP `jpapst04` → pane Remote phải là `/home/vn_dev` **của jpapst04**, không phải của gate.

---

## 5. Terminal & Multi-pane

| Tính năng | Cách dùng |
|-----------|-----------|
| **Tab mới** (local) | `Ctrl+Shift+T`, hoặc nút `+` (chevron để chọn shell: PowerShell/cmd/Git Bash/WSL) |
| **Thêm pane vào tab** | `Ctrl+Shift+D` thêm 1 pane local; icon **⊟** trên host ở sidebar = mở host đó vào pane mới của tab hiện tại |
| **Gộp tab ⇄ tách** (nút **⊞ Split**) | Bấm **⊞ Split** trên thanh công cụ: gộp **TẤT CẢ tab terminal** đang mở thành các pane trong 1 tab (để Broadcast xuyên suốt); bấm lại để tách về tab riêng. Nội dung màn hình (scrollback) được giữ nguyên khi gộp/tách |
| **Mở cả nhóm** | Nút **lưới** trên header group ở sidebar (hoặc lệnh **Mở nhóm** trong Command Palette): mở mọi host trong nhóm thành các pane chia sẵn trong 1 tab — sẵn sàng Broadcast |
| **Broadcast** | Nút **📡 Broadcast** hoặc `Ctrl+Shift+B`: gõ ở 1 pane → gửi tới **TẤT CẢ pane** trong tab |
| **Chuyển tab** | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| **Đóng tab/pane** | `Ctrl+Shift+W`, hoặc `✕` trên tab/pane, hoặc middle-click tab |
| **Tìm trong terminal** | `Ctrl+F` |
| **Copy / Paste** | `Ctrl+Shift+C` / `Ctrl+Shift+V` |
| **Copy bằng chuột** | Tô khối 1 đoạn → **click chuột trái vào vùng vừa tô** = sao chép (hiện toast *"Đã sao chép"*) |
| **Paste bằng chuột** | **Click chuột phải** ở bất kỳ đâu trong terminal = dán nội dung clipboard vào con trỏ (theo cả Broadcast) |

### Test broadcast (tính năng "gõ 1 lần ra nhiều server")
1. Mở SSH vào jpapst04. 2. Hover jpapst05 ở sidebar → bấm **⊟ split** → 2 pane cạnh nhau.
3. Bấm **📡 Broadcast ON**. 4. Gõ `uptime` → cả 2 pane cùng chạy.

> Nhanh hơn: cho jpapst04 + jpapst05 vào cùng 1 group → bấm nút **lưới** trên header group → cả 2 mở sẵn dạng pane → bật **Broadcast ON**. Hoặc đang có nhiều tab rời thì bấm **⊞ Split** để gộp hết thành pane trong 1 tab.

---

## 5B. Giao diện & ảnh nền — `⋯` → Cài đặt (Settings)

- **Chủ đề**: Tối / Sáng. **Ngôn ngữ**: Tiếng Việt / English / 日本語. Đổi là áp dụng ngay, nhớ qua các lần mở app.
- **Ảnh nền**: bấm **Chọn ảnh…** → ảnh hiện mờ phủ **toàn bộ cửa sổ** (sau cả sidebar lẫn terminal); chrome (thanh bên/tab/status) tự mờ đi để lộ ảnh, còn modal/menu vẫn đục để dễ đọc. Chỉnh:
  - **Lấp khung**: *Phủ kín* (cover — lấp đầy, có thể cắt bớt) / *Vừa khung* (contain — thấy trọn ảnh, không cắt).
  - **Vị trí ảnh**: Giữa / Trái / Phải / Trên / Dưới.
  - **Độ hiện** (5–100%) và **Độ mờ** (0–24px) — giảm độ hiện hoặc tăng độ mờ nếu chữ khó đọc trên ảnh sáng.
  - **Xoá** để bỏ ảnh nền.
- Ảnh được nén tự động và lưu **trên máy này** (không đồng bộ) — mỗi người tự chọn ảnh riêng.
- **Màu accent**: bảng chọn màu (color picker) đặt màu nhấn riêng (nút bấm chính, viền chọn…) đè lên theme dark/light; nút Khôi phục về mặc định.
- **🎨 Bảng màu tuỳ chỉnh (Theme studio)**: mục gập trong Settings → Giao diện cho tuỳ biến **11 màu giao diện** (Nền chính, Thanh bên, Cửa sổ nổi, Ô nhập, Hover, Viền, Chữ, Chữ mờ, Nguy hiểm, Thành công, Cảnh báo). Bấm ô màu để đổi → **áp dụng ngay**. Override lưu **tách theo theme** (dark và light riêng) nên đổi Tối↔Sáng vẫn đúng. Nút **✕** cạnh từng màu để bỏ override màu đó; **Khôi phục mặc định** để xoá hết.
  - **Xuất / Nhập theme**: bấm **Xuất / Nhập theme** → hiện ô JSON chứa theme hiện tại (accent + bảng màu). **Sao chép** để chia sẻ/sao lưu; dán JSON khác vào rồi **Áp dụng** để nạp theme. (Lưu trên máy này, không đồng bộ.)
- **Terminal**: chỉnh **cỡ chữ**, **giãn dòng**, **kiểu con trỏ** (khối/gạch đứng/gạch dưới) và **font chữ** (tên font CSS, dùng font đã cài; có nút ↺ khôi phục mặc định). Áp dụng ngay cho mọi pane.

---

## 5C. Workspaces (lưu & mở lại bố cục) — `⋯` → Workspaces

**Là gì**: lưu nguyên bố cục đang mở (tất cả tab + split pane + trạng thái Broadcast) thành 1 workspace có tên, mở lại bằng 1 click. Hợp với việc lặp lại layout quen thuộc (vd "Monitor cluster" = jpapst04+05 split sẵn + Broadcast).

**Dùng**:
- Mở các tab/split như mong muốn → `⋯` → **Workspaces** → đặt tên → **Lưu**.
- Mở lại: chọn workspace → **Mở** (mở thêm vào tab đang có). **✏** đổi tên, **✕** xoá.

**Lưu ý**:
- Mở workspace tạo **phiên SSH mới** (đăng nhập lại, không có nội dung scrollback cũ).
- Mở là **cộng thêm** tab (không đóng tab đang mở) — mở 2 lần thì nhân đôi tab.
- Lưu **trên máy này** (chưa đồng bộ); chỉ tham chiếu host theo ID nên host nào đã sync sang máy khác thì workspace mở được tới đó. Host đã xoá thì pane đó bỏ qua (báo lỗi nhẹ), không chặn các pane khác.

**Test**: mở jpapst04, split thêm jpapst05, bật Broadcast → Lưu tên "ST monitor" → đóng hết tab → Workspaces → Mở "ST monitor" → 2 pane mở lại cạnh nhau, Broadcast bật sẵn.

---

## 6. Telnet & Serial

- Sửa/Thêm host → **Giao thức**: **Telnet** (host + port 23) hoặc **Serial (COM/USB)**.
- Serial: dropdown **tự liệt kê cổng COM** đang cắm + chọn **baud** (9600…230400). Dùng cho console switch/router qua cáp USB-serial.
- **Test Serial**: cắm cáp USB-serial → thêm host Serial → chọn cổng → kết nối → Enter để thấy prompt thiết bị.

---

## 7. Session logging (ghi log phiên)

- Trên thanh công cụ tab: nút **⏺ Ghi log** → ghi toàn bộ output pane đang chọn ra file `…/logs/<thời gian>_<tên>.log` (đã lọc mã màu ANSI).
- Command Palette → **📂 Mở thư mục log phiên** để xem file.
- **Test**: bật ⏺ → gõ vài lệnh → mở thư mục log → kiểm tra nội dung.

---

## 7B. Session Recording & Replay (ghi hình phiên) — `⋯` → Bản ghi phiên

**Là gì**: ghi lại phiên terminal dạng **asciicast v2** (chuẩn asciinema) — raw + thời gian — để **xem lại như video**. Khác với Ghi log (text thuần để grep).

**Ghi**: thanh công cụ tab → nút **⏯ Ghi hình** (cạnh ⏺ Ghi log). Bật → ghi ra file `.cast`.
**Xem lại**: `⋯` → **⏯ Bản ghi phiên** → chọn bản → **▶ Replay** → player có **play/pause (⏸/▶)**, **restart (↺)**, **thanh tua**, **tốc độ 1x/2x/4x/8x**.
**Export**: 📂 Mở thư mục → file `.cast` mở được bằng `asciinema play` hoặc asciinema-player trên web.

**Test**: mở terminal → ⏯ Ghi hình → gõ `ls`, `top` rồi `q` → tắt ghi → Bản ghi phiên → Replay → thử tua + 4x.

---

## 8. Snippets (lệnh lưu sẵn)

- Menu `⋯` → **Snippets**. Tạo snippet có biến `{{ten_bien}}`.
- Chạy: nút **⚡** trên thanh tab → chọn snippet → điền biến → tick các pane đích → **Chạy** (chạy đa session).
- **Test**: snippet `sudo systemctl restart {{service}}` → chạy với `service=nginx` trên nhiều phiên.

---

## 9. Tunnels (port forwarding) — `⋯` → Tunnels

| Loại | Ý nghĩa |
|------|---------|
| **L (Local)** | Cổng trên máy bạn → qua SSH → đích (vd vào DB remote như local) |
| **R (Remote)** | Cổng trên server → về máy bạn |
| **D (Dynamic)** | SOCKS5 proxy local — duyệt web qua server |

**Test SOCKS5**: + Tunnel → host `Sakurai1-gate1`, loại **Dynamic**, bind `1080` → **Chạy** (chấm xanh) → đặt SOCKS5 `127.0.0.1:1080` trong trình duyệt → duyệt web đi qua gate.
**Test Local**: loại L, bind `13306`, dest `127.0.0.1:3306` → kết nối MySQL vào `127.0.0.1:13306`.

---

## 10. Bulk Execution (chạy lệnh đa host) — `⋯` → Bulk Execution

**Là gì**: chạy 1 lệnh trên N host **song song** (tối đa 8 cùng lúc), gom nhóm output để phát hiện máy lệch.

**Dùng**: tick host → gõ lệnh (`uptime`, `df -h /`…) → **⚡ Chạy**. Kết quả dạng lưới; bật "Gom theo output" để gom các máy trả kết quả giống nhau, máy lệch gắn nhãn vàng **"(lệch?)"**. Đang chạy có nút **Hủy** (đóng kết nối, dừng host còn xếp hàng); đóng modal giữa chừng cũng tự hủy.

**Chạy xuyên login script**: host vào bằng `ssh vn_dev@jpapst04` → lệnh chạy **đúng trên jpapst04** (app tự `ssh vn_dev@jpapst04 '<lệnh>'`), không phải gate.

**Test**: tick cả 3 host → gõ `hostname; uptime` → mỗi máy trả hostname **riêng** của nó (jpapst04/05 khác gate).

> Giới hạn: chỉ xuyên được login script kiểu `ssh …` thuần; nếu có `su` trước thì host đó chạy ở gate.

---

## 11. Monitoring Dashboard — `⋯` → Monitoring

**Là gì**: theo dõi **CPU load / RAM / disk / uptime** realtime, **không cần cài agent** (đọc `/proc` + `df` qua SSH mỗi 3s). Chỉ Linux.

**Dùng**: chọn host → **Bắt đầu theo dõi** → mỗi host 1 card: sparkline load + thanh Load/RAM/Disk (đỏ >90%, vàng >70%) + uptime. Tự kết nối lại nếu rớt; tự dừng khi đóng dashboard.

**Chạy xuyên login script**: giống Bulk — jpapst04/05 đo đúng máy trong, không phải gate.

**Test**: chọn jpapst04 + jpapst05 → Bắt đầu → xem số liệu của đúng từng máy.

---

## 12. Network Toolbox — `⋯` → Network Toolbox

Thuần local, không cần SSH. Nhập host/IP rồi:
- **Ping** (độ trễ), **DNS lookup** (A/AAAA/PTR), **Quét port phổ biến** (16 cổng: SSH/HTTP/MySQL/RDP/Redis…).
- **Test**: ping `1.1.1.1`; quét port `133.242.68.60` xem cổng 22 có mở.

---

## 13. Sync E2EE (đồng bộ đa máy) — `⋯` → Sync

**Là gì**: mã hoá toàn bộ vault thành 1 blob, đẩy vào **thư mục đồng bộ sẵn** (Google Drive / Dropbox / OneDrive / Syncthing / ổ mạng). Backend **chỉ thấy blob mã hoá** (zero-knowledge). Termius bắt dùng cloud của họ — cái này tự host.

**Dùng**:
1. Chọn thư mục đồng bộ → đặt **sync passphrase** (≥8 ký tự, **giống nhau trên mọi máy**, có thể khác master password) → Bật sync.
2. Máy khác: cùng thư mục + cùng passphrase → dữ liệu hội tụ (merge Last-Write-Wins + tombstone cho xoá).

**Test nhanh 1 máy**: trỏ vào `D:\sync-test` → bật sync → mở file `infra-companion-vault.blob` trong đó: toàn ký tự mã hoá, không đọc được host/password = đúng zero-knowledge.

> ⚠️ Quên sync passphrase = mất dữ liệu trên thư mục đó (không khôi phục được).

---

## 14. Trợ lý AI — `Ctrl+I` hoặc `⋯` → Trợ lý AI

**Là gì**: sinh lệnh từ ngôn ngữ tự nhiên, giải thích lệnh/lỗi. **4 nhà cung cấp**: Claude / OpenAI / Gemini / **Ollama (local — riêng tư 100%)**.

**Cấu hình** (⚙): chọn provider → model → API key (mã hoá trong vault; Ollama không cần key).
| Provider | Model mặc định | Ghi chú |
|----------|----------------|---------|
| Claude | `claude-opus-4-8` | key `sk-ant-…` |
| OpenAI | `gpt-4o-mini` | key `sk-…` |
| Gemini | `gemini-2.0-flash` | key `AIza…` |
| Ollama | `llama3.1` | local, cần `ollama serve` |

**3 chế độ**:
1. **Sinh lệnh** — gõ tiếng Việt ("tìm 5 file lớn nhất trong /var/log") → AI trả lệnh + giải thích → nút **↵ Chèn vào terminal** (ghi vào pane đang mở, **KHÔNG tự chạy**, bạn duyệt rồi bấm Enter).
2. **Giải thích lệnh** — dán lệnh → giải thích từng phần + rủi ro.
3. **Giải thích lỗi** — dán output/lỗi → chẩn đoán + cách sửa.

**Test**: cấu hình Gemini → Sinh lệnh "kill process đang chiếm cổng 8080" → mở 1 tab terminal → Chèn vào terminal.

---

## 14B. Secrets Manager (lấy password từ 1Password/Bitwarden/Vault)

**Là gì**: không lưu password trong app — chỉ lưu **tham chiếu**, app gọi CLI của secret manager lấy password **đúng lúc kết nối**.

**Dùng**: Sửa host → Xác thực = **Secret manager** → nhập tham chiếu:
| Cú pháp | Secret manager | CLI gọi |
|---------|----------------|---------|
| `op://Vault/jpapst04/password` | 1Password | `op read "op://…"` |
| `bw://<item-id-hoặc-tên>` | Bitwarden | `bw get password <item>` (cần `BW_SESSION`) |
| `vault://secret/jpapst04#password` | HashiCorp Vault | `vault kv get -field=password secret/jpapst04` |

**Yêu cầu**: CLI tương ứng (`op`/`bw`/`vault`) đã **cài + đăng nhập** trên máy, có trong PATH. Bitwarden cần unlock và `BW_SESSION` trong môi trường; Vault cần `VAULT_ADDR`/token.

**Test**: cài + đăng nhập `op` → tạo host auth = Secret manager, ref `op://Personal/test/password` → kết nối → app tự lấy password. Nếu CLI chưa cài/đăng nhập → báo lỗi rõ ràng (không treo).

---

## 15. Import từ ssh_config — `⋯` → Import

Chọn file `~/.ssh/config` → tự tạo host, **giữ nguyên ProxyJump nhiều bậc**, import IdentityFile (dedupe key), báo cảnh báo nếu có. Group đặt tên `ssh_config (ngày)`.

---

## 16. Command Palette — `Ctrl+Shift+P`

Gõ là ra mọi hành động (keyboard-first): SSH/SFTP/Split tới host bất kỳ, mở local, toggle broadcast, mở Bulk/Monitor/AI/Sync/Tunnels/Snippets/Keys/**Plugins**, mở thư mục log, khoá vault. ↑↓ chọn, Enter chạy. Lệnh do **plugin** đăng ký cũng hiện ở đây (gợi ý `plugin`).

---

## 16B. Plugins (mở rộng app) — `⋯` → 🧩 Plugins

**Là gì**: mở rộng app bằng **plugin JavaScript** mà không phải sửa code lõi — thêm lệnh vào Command Palette, quan sát/tự động hoá theo output terminal, hiển thị panel thông tin.

> **Mô hình tin cậy**: plugin là JS do **bạn/team tự cài** (không phải marketplace). Mỗi plugin chạy trong một Node `worker_thread` chung — **cô lập lỗi**, plugin crash không kéo cả app — và **chỉ truy cập app qua đối tượng `api`**; plugin **không** đọc được vault/secret. Vì là mô hình tin cậy, sandbox không chống mã cố ý phá hoại → chỉ cài plugin bạn tin tưởng.

### A. Cài & quản lý

Mỗi plugin là 1 thư mục trong `<userData>/plugins/<plugin-id>/`:
```
<userData>/plugins/<plugin-id>/
  manifest.json     # bắt buộc — metadata + đóng góp
  index.js          # bắt buộc — CommonJS (module.exports.activate)
  data.json         # tự sinh khi dùng api.storage
```
`<userData>`: Windows `%APPDATA%\<tên app>\plugins` · macOS `~/Library/Application Support/<tên app>/plugins` · Linux `~/.config/<tên app>/plugins`.

**Cài nhanh 2 plugin mẫu** (trong repo `docs/examples/`):
1. `⋯` → **🧩 Plugins** → **📂 Mở thư mục plugins** (mở đúng thư mục — đừng đoán đường dẫn).
2. Copy `docs/examples/hello-world` và `docs/examples/output-highlighter` vào đó.
3. Bấm **↻ Quét lại** (hoặc đóng/mở lại modal) — **không cần khởi động lại app**.

**Modal Plugins** (`⋯` → 🧩 Plugins): mỗi plugin có badge trạng thái (**Đang chạy** / Đã tắt / Lỗi / Crash / Đang nạp), và:
- **Bật / Tắt** — tắt thì lệnh của plugin biến mất khỏi Palette; nhớ qua lần mở app sau (`state.json`).
- **↻ Quét lại** — phát hiện plugin mới copy vào (mở modal cũng tự quét).
- **Nạp lại** — nạp lại **code** sau khi bạn sửa file (không cần restart).
- **📂 Mở thư mục plugins**.
- Mũi tên **▼** mở rộng để xem **Lỗi** + **log** gần nhất của plugin.

### B. Dùng plugin

- **Lệnh**: `Ctrl+Shift+P` → gõ tên lệnh plugin (gợi ý `plugin`) → Enter. Vd plugin mẫu *Hello World*: lệnh **"Hello: Chào"** mở một **panel** markdown.
- **Panel**: nội dung markdown/text do plugin tạo (báo cáo, bảng…); bấm **Đóng** để tắt.
- **Toast**: plugin có thể bật thông báo ngắn (vd *Output Highlighter* báo khi thấy "error" trong terminal).
- **Tự động hoá nhẹ**: plugin có thể nghe output terminal rồi gửi lệnh vào phiên đang mở (vd lệnh "Highlighter: Gửi echo test vào phiên active").

### C. Viết plugin

`index.js` (CommonJS) export `activate(api)` (bắt buộc) và `deactivate()` (tuỳ chọn):
```js
module.exports.activate = (api) => {
  // đăng ký lệnh, subscribe output… (đồng bộ hoặc async đều được)
}
module.exports.deactivate = () => {
  // dọn dẹp khi tắt/nạp lại (huỷ subscribe…)
}
```
- `activate(api)` chạy khi plugin được bật; có **timeout 10s** (treo lâu hơn → trạng thái **Lỗi**).
- Lỗi trong `activate`/handler/`onData` được bắt + ghi log, **không** kéo plugin khác.

**manifest.json**:
```jsonc
{
  "id": "my-plugin",            // BẮT BUỘC: kebab-case, PHẢI trùng tên thư mục
  "name": "My Plugin",          // BẮT BUỘC: tên hiển thị
  "version": "1.0.0",           // BẮT BUỘC: semver
  "description": "…",           // tuỳ chọn
  "main": "index.js",           // tuỳ chọn (mặc định index.js); nằm trong thư mục plugin, đuôi .js
  "permissions": ["terminal.observe","terminal.write","ui.panel","ui.notify","storage"], // v1: chỉ khai báo/hiển thị
  "contributes": { "commands": [ { "id": "my.hello", "title": "My: Chào" } ] }  // id dạng "nhom.ten"
}
```
Sai manifest → plugin hiện trạng thái **Lỗi** (kèm thông báo khi mở ▼), **không** làm crash app.

**Đối tượng `api`** truyền vào `activate(api)`:
| API | Kiểu | Mô tả |
|-----|------|-------|
| `api.id` | `string` | id của plugin |
| `api.commands.register(id, title, handler)` | sync | Đăng ký lệnh; `handler(ctx)` chạy khi user gọi từ Palette. `ctx.activeSessionId?: string`. |
| `api.terminal.onData(cb)` | sync → `() => void` | Nghe output mọi phiên: `cb({ sessionId, data })`. Trả hàm huỷ. **Chỉ quan sát.** |
| `api.terminal.write(sessionId, data)` | async | Gửi text/lệnh vào 1 phiên (như user gõ). |
| `api.terminal.getActiveSessionId()` | async → `string \| null` | Phiên terminal đang active. |
| `api.ui.showPanel({ title, markdown?, text? })` | async | Mở panel markdown (subset an toàn) hoặc text thuần. |
| `api.ui.notify(message)` | async | Hiện toast ngắn. |
| `api.storage.get(key)` / `api.storage.set(key, value)` | async | Lưu/đọc JSON riêng cho plugin (`data.json`). |
| `api.log(...args)` | sync | Ghi log (xem ở mục Plugins → ▼). |

> Hàm **async** trả `Promise` (đi vòng qua main, timeout 8s) — nhớ `await`. `register`/`onData`/`log` là sync. Markdown của `showPanel` hỗ trợ: `#`/`##`/`###`, `**đậm**`, `*nghiêng*`, `` `code` ``, code block, danh sách `- `, link `http(s)`; **không** HTML thô.

**Ví dụ** — quan sát output → notify + gửi lệnh:
```js
let off = null
module.exports.activate = (api) => {
  off = api.terminal.onData(({ data }) => {
    if (/error|fail/i.test(data)) void api.ui.notify('⚠ Thấy "error" trong terminal')
  })
  api.commands.register('hl.echo', 'Gửi echo vào phiên active', async () => {
    const id = await api.terminal.getActiveSessionId()
    if (id) await api.terminal.write(id, 'echo hi\n')
  })
}
module.exports.deactivate = () => { if (off) off() }
```

**Ràng buộc & lưu ý khi viết**:
- Không truy cập vault/secret/host trực tiếp — chỉ qua `api`.
- Dùng `__dirname`/`__filename` (trỏ vào thư mục plugin); **đừng** dựa vào `process.cwd()` (là cwd của app).
- Cần thư viện ngoài → plugin phải **tự kèm `node_modules`** của nó.
- Output observe chỉ được forward khi có plugin đang subscribe (không ai nghe → không tốn gì).

### D. Ngoài phạm vi v1 (dự kiến v2)
Protocol kết nối mới (cắm SessionKind) · permission enforcement + dialog xin quyền · biến đổi (transform) luồng output (hiện chỉ quan sát) · panel React tuỳ ý / marketplace.

---

## 17. Bảng phím tắt

| Phím | Hành động |
|------|-----------|
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+I` | Trợ lý AI |
| `Ctrl+Shift+T` | Tab terminal local mới |
| `Ctrl+Shift+W` | Đóng tab hiện tại |
| `Ctrl+Shift+D` | Split thêm pane local |
| `Ctrl+Shift+B` | Bật/tắt Broadcast |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Chuyển tab |
| `Ctrl+F` | Tìm trong terminal |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / Paste |
| Chuột trái vào vùng đã tô | Copy đoạn đang bôi đen |
| Chuột phải trong terminal | Paste clipboard vào con trỏ |
| `Esc` | Đóng modal đang mở |

> Mọi hành động xoá (host/key/snippet/tunnel/bản ghi/file trong SFTP) đều hỏi xác nhận trước khi xoá vĩnh viễn.

---

## 18. Giới hạn đã biết của phiên bản hiện tại

- **Bulk/Monitor/SFTP xuyên login script** chỉ áp dụng login script kiểu `ssh …` thuần; nếu có `su` ở trước thì lệnh/monitor vẫn chạy trên gate.
- **Sync** hiện chỉ có backend **thư mục** (Google Drive/Dropbox/Syncthing/ổ mạng); WebDAV, S3, Git sẽ có sau.
- **Secrets manager** hỗ trợ 1Password, Bitwarden, HashiCorp Vault qua CLI; KeePassXC sẽ có sau.
- **Plugin system** mới ở **v1** (lệnh + quan sát/gửi output + panel + storage); chưa có protocol mới, permission enforcement, transform output, marketplace — xem mục 16D.
- Chưa có: **RDP/VNC**, **team server** (self-host), **cloud import** (AWS/GCP…), **Docker/K8s browser** — xem [../ROADMAP.md](../ROADMAP.md).
