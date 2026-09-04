# Kế hoạch: Đăng nhập Google để đồng bộ config (Google Drive sync backend)

> Trạng thái: **✅ ĐÃ LÀM (v0.2.15, 2026-09-04)** — code xong cả 4 mốc + trang privacy.
> Còn đúng 2 việc làm tay trước khi ship — **không phải sửa file code nào**:
> (1) tạo 2 biến trên GitHub: repo → Settings → Secrets and variables → Actions → tab
> **Variables** → New repository variable: `INFRA_GOOGLE_CLIENT_ID` và
> `INFRA_GOOGLE_CLIENT_SECRET` (client của Desktop app không phải bí mật nên Variables là đủ;
> để trong Secrets cũng nhận). Release build nhúng chúng LÚC BUILD qua `define` của
> electron-vite (`__GOOGLE_CLIENT_ID__`/`__GOOGLE_CLIENT_SECRET__`), và `release.yml` có
> guard FAIL sớm nếu thiếu biến — không có chuyện ship bản Google sync chết im lặng.
> (2) **Publish to production** trên Google Console (đừng quên — Testing thì refresh token
> chết sau 7 ngày). Dev test vẫn như cũ: thả `.google-oauth.json` (gitignore) vào gốc repo
> hoặc env `INFRA_GOOGLE_CLIENT_ID`/`_SECRET` lúc chạy.
> Viết 2026-09-04, dựa trên phân tích từ đợt F65 (v0.2.8).

---

## 1. Lời hứa UX — nói chính xác ngay từ đầu

**Mục tiêu:** cài app trên máy mới → đăng nhập Google → dữ liệu (hosts, groups, keys, snippets,
tunnels…) tự về, không phải chép file hay dựng thư mục đồng bộ.

**Một điều KHÔNG đổi, và phải nói rõ trên UI:** đăng nhập Google **không thay được sync
passphrase**. Trên máy mới user vẫn nhập 2 thứ: master password (khoá vault local) và sync
passphrase (giải mã blob). Google chỉ thay vai trò "thư mục đồng bộ" — nơi *chứa và chuyển*
blob, không phải nơi *mở* blob.

**Vì sao không bỏ passphrase được** (đã chốt từ v0.2.8, ghi lại để khỏi mở lại tranh luận):
blob giải mã ra chứa **private key SSH + mật khẩu host dạng plaintext**. Nếu khoá dữ liệu theo
tài khoản Google (lưu key giải mã trên Drive, hoặc derive từ identity) thì **chiếm được Gmail =
chiếm toàn bộ hạ tầng SSH** — biến một tài khoản email thành chìa khoá tổng của mọi server.
E2EE bằng passphrase riêng là ranh giới giữ cho tài khoản Google bị lộ chỉ là "lộ một file mã
hoá", không phải "mất fleet".

---

## 2. Kiến trúc — không có server nào của mình

```
┌─ máy user ────────────────────────────────────┐
│ Electron main                                 │
│  ├─ OAuth loopback + PKCE ──► trình duyệt hệ thống ──► Google
│  ├─ DriveBackend (implements SyncBackend)  ◄──► Google Drive API (drive.file)
│  └─ SyncService (đã có) ── blob mã hoá E2EE bằng sync passphrase
└───────────────────────────────────────────────┘
```

- **OAuth 2.0 cho ứng dụng Desktop**: mở **trình duyệt hệ thống** (`shell.openExternal`) →
  user đồng ý → Google redirect về `http://127.0.0.1:<cổng ephemeral>` mà app đang lắng nghe
  tạm → app đổi code lấy token. Dùng **PKCE (S256)**. **Không cần server nào** — đây là flow
  chuẩn cho installed app; `client_id` nhúng trong app là công khai theo thiết kế (Google nói
  rõ secret của installed app không được coi là bí mật).
- **`DriveBackend` implements `SyncBackend`** (`packages/core/src/sync/backends.ts:11`) — đúng 4
  hàm `read()` / `write()` / `describe()` / `listNearMisses()`, nên **toàn bộ guard chống ghi
  đè của F65 (near-miss + `seenRemoteAt`) dùng lại nguyên trạng**, không viết lại logic sync.
- **Token lưu ở đâu:** refresh token mã hoá DEK trong bảng `meta` của vault — đúng pattern
  `ai_api_key` / `do_token:<id>` đã có. Không bao giờ qua IPC sang renderer; renderer chỉ biết
  `{connected: boolean, email}`.
- Blob nằm trên Drive dưới dạng **file thấy được** trong My Drive (nhờ scope `drive.file`) —
  cố ý: kịch bản "máy mượn chỉ có trình duyệt" (v0.2.8) vẫn chạy, user tự tải file blob từ
  drive.google.com rồi dùng "Nhập từ file".

---

## 3. Quyền (scope) xin từ Google — phần quan trọng nhất

| Scope | Loại theo Google | Vì sao cần | Hệ quả verification |
|---|---|---|---|
| `https://www.googleapis.com/auth/drive.file` | **Non-sensitive (Recommended)** | Đọc/ghi **CHỈ những file do chính app tạo** trên Drive của user. Đủ cho blob sync. Máy thứ 2 đăng nhập cùng tài khoản + cùng `client_id` vẫn thấy file app đã tạo. | **Không cần thẩm định bảo mật.** |
| `openid` + `.../auth/userinfo.email` | Non-sensitive | Hiện "Đã kết nối: user@gmail.com" trên UI — không có thì user không biết mình đang sync vào tài khoản nào. | Không cần. |

**Cố tình KHÔNG xin:**

- `https://www.googleapis.com/auth/drive` (toàn bộ Drive) — loại **Restricted**: bắt buộc
  CASA security assessment (bên thứ ba, tốn tiền, làm lại hằng năm). Hoàn toàn không cần —
  app chỉ đụng một file của chính nó.
- `drive.readonly`, `drive.metadata` — cũng Restricted, cùng lý do.
- `drive.appdata` (thư mục ẩn của app) — là lựa chọn thay thế hợp lệ, nhưng **thua
  `drive.file`** ở một điểm quyết định: file trong appDataFolder **user không nhìn thấy và
  không tự tải được** từ drive.google.com → mất kịch bản máy-mượn, và user không kiểm chứng
  được app đang lưu gì. Minh bạch hơn = `drive.file`.

Nguyên tắc: **chỉ non-sensitive scope** thì đưa app lên Production không cần vòng thẩm định
scope; thứ duy nhất có thể phải chờ duyệt là **brand verification** (tên + logo hiện đẹp trên
màn hình consent) — nộp logo là kích hoạt vòng duyệt này, thường vài ngày tới ~2 tuần.

---

## 4. Thiết lập Google Cloud Console — từng bước (việc làm tay, không phải code)

1. Tạo project (vd `infra-companion-sync`) tại console.cloud.google.com — dùng tài khoản
   Google mà mình giữ lâu dài, đây sẽ là "chủ" của OAuth client.
2. **Enable API**: APIs & Services → Library → bật **Google Drive API**.
3. **OAuth consent screen** (Console mới gọi là **Google Auth Platform** → Branding):
   - User type: **External**.
   - App name: `Infra Companion` · support email · logo (logo → kích hoạt brand review).
   - ⚠️ **Đừng upload logo trong lúc dev** — thêm logo là mở vòng duyệt brand ngay; để trống,
     bổ sung ở bước chuẩn bị ship. Homepage/privacy/authorized domain cũng được phép để trống
     khi còn ở Testing, nhưng bắt buộc đủ trước khi Publish to production.
   - **Authorized domain**: `techdecoded.net`.
   - **Homepage**: trang landing hiện có · **Privacy policy URL**: trang mới ở mục 5
     · Terms of service URL (nên có, một trang ngắn là đủ).
4. **Scopes**: thêm 3 scope ở mục 3 (tất cả non-sensitive → không mở vòng thẩm định).
5. **Audience / Publishing status**:
   - Lúc dev để **Testing** + thêm tài khoản mình vào **Test users**.
   - ⚠️ **Testing có 2 giới hạn phải nhớ**: tối đa 100 test user, và **refresh token hết hạn
     sau 7 ngày** → app đang chạy tự nhiên bắt đăng nhập lại hằng tuần. Vì vậy **phải bấm
     "Publish to production" TRƯỚC khi ship** tính năng, không phải "để sau".
6. **Credentials** → Create OAuth client ID → type **Desktop app** → lấy `client_id`
   (nhúng vào app, không phải bí mật).
   - ⚠️ **Đừng chọn type "Web application"**: loại Web bắt khai trước redirect URI cố định,
     mà app redirect về `http://127.0.0.1:<cổng ngẫu nhiên>` — chỉ loại **Desktop app** mới tự
     cho phép loopback mọi cổng (và vì thế không có ô redirect URI nào phải điền).
   - Kiểm nhanh không cần code: dán URL `accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=http://127.0.0.1:8123&response_type=code&scope=openid%20email%20…drive.file&access_type=offline`
     vào trình duyệt — thấy consent hiện tên app + 2 quyền là cấu hình đúng; sau khi đồng ý
     trình duyệt báo "refused to connect" ở 127.0.0.1 là **kết quả mong đợi** (chưa có app
     lắng nghe).
   - ℹ️ **KHÔNG tạo "API key"** — loại credential đó chỉ cho API dữ liệu công khai không gắn
     user (Maps, YouTube…), không bao giờ đọc được file Drive riêng tư; Drive bắt buộc đi bằng
     OAuth token. Cũng **không cần service account** (không có server) và **không cần bật
     billing** (Drive API miễn phí). Client secret mà Google sinh kèm cho loại Desktop **không
     được coi là bí mật** theo chính tài liệu Google — nhúng vào code/repo public là đúng thiết
     kế, lớp bảo vệ thật là PKCE + redirect chỉ về loopback trên máy user.
7. Sau khi có trang policy + homepage: nộp **brand verification** (nếu có logo) và chờ duyệt.

**Chi phí:** 0đ (Drive API miễn phí, quota mặc định thừa cho blob vài trăm KB mỗi 15 phút).
Thứ tốn duy nhất là thời gian chờ duyệt brand.

---

## 5. Trang privacy policy — Google yêu cầu gì và viết thế nào

**Yêu cầu cứng từ Google:** công khai truy cập được; nằm trên **authorized domain** đã khai
(`techdecoded.net` — đã có); được link từ homepage VÀ khai trong consent screen; nói đúng app
này (không phải template ghi tên app khác); mô tả **thu thập gì — dùng làm gì — lưu ở đâu —
chia sẻ với ai — xoá thế nào**.

**Chỗ đặt:** thêm `docs/landing/privacy.html` (cùng khuôn giao diện landing, tự deploy qua
pages.yml như hiện tại), link ở footer của `index.html`. URL sẽ dạng `/privacy.html` trên
domain hiện có.

**Khung nội dung (điền được gần như nguyên văn — mạnh vì app thật sự local-first):**

1. **App là gì**: desktop SSH client, dữ liệu lưu trên máy user trong vault mã hoá.
   **Không có server của nhà phát triển; nhà phát triển không nhận, không thấy, không lưu
   bất kỳ dữ liệu nào của user.**
2. **Dữ liệu Google mà app đụng tới**:
   - Qua scope `drive.file`: app tạo và đọc/ghi **một file duy nhất** trên Google Drive của
     user (`infra-companion-vault.blob`) chứa bản sao cấu hình **đã mã hoá đầu-cuối** bằng
     passphrase chỉ user biết. Google và nhà phát triển đều không giải mã được. App không đọc
     được bất kỳ file nào khác trên Drive.
   - Qua `openid`/`email`: chỉ đọc địa chỉ email để hiển thị tài khoản đang kết nối; không
     gửi đi đâu.
3. **Lưu trữ**: OAuth token lưu mã hoá trên máy user; không rời máy.
4. **Chia sẻ / bán dữ liệu**: không chia sẻ với bên thứ ba, không quảng cáo, không analytics.
5. **Xoá / thu hồi**: gỡ kết nối trong app (thu hồi token); thu hồi từ phía Google tại
   myaccount.google.com → Security → Third-party access; xoá file blob trực tiếp trên Drive.
6. **Câu Limited Use bắt buộc** (ghi nguyên văn tiếng Anh): *"Infra Companion's use and
   transfer to any other app of information received from Google APIs will adhere to the
   [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
   including the Limited Use requirements."*
7. Ngày hiệu lực + email liên hệ.

Trang viết **tiếng Anh** (đội duyệt Google đọc), có thể kèm bản tiếng Việt bên dưới.

---

## 6. Luồng UX

- **Sync modal** thêm bộ chọn backend: `Thư mục` (như cũ) | `Google Drive`.
- **Kết nối**: bấm "Đăng nhập Google" → trình duyệt mở → đồng ý → app hiện
  "✓ user@gmail.com" + nút "Ngắt kết nối" (ngắt = gọi endpoint revoke + xoá token trong vault).
- **Lượt sync đầu trên Drive**: đi qua đúng guard hiện có — không thấy blob mà `listNearMisses`
  có file gần giống (bản "(1)" do tải trùng…) hoặc từng thấy blob (`seenRemoteAt`) thì **dừng
  và hỏi**, không ghi đè.
- **Máy mới**: cài app → đặt master password → Sync → Google Drive → đăng nhập → nhập sync
  passphrase → Pull. UI ghi chú thẳng: *"Passphrase không lưu trên Google — đó là thứ giữ cho
  tài khoản Google bị lộ không kéo theo hạ tầng của bạn."*
- **Token hỏng/bị thu hồi giữa chừng** (auto-sync chạy nền): trả **mã lỗi** (`authExpired`…),
  renderer dịch lúc render (bài học v0.2.12), Needs-attention/toast nói "Kết nối Google hết
  hạn — đăng nhập lại", tuyệt đối không chết im lặng (§8).
- Auto-sync 0/5/15/30/60 phút + đẩy lúc thoát app: **dùng lại nguyên trạng** — backend chỉ là
  một implementation mới phía dưới `SyncService`.

---

## 7. Chi tiết kỹ thuật & bẫy đã biết trước

- **Không OAuth trong webview nhúng** — Google chặn (`disallowed_useragent`). Bắt buộc
  `shell.openExternal` ra trình duyệt thật; listener loopback bind `127.0.0.1` cổng ephemeral,
  đóng ngay sau khi nhận code; đặt timeout + nút huỷ (user có thể đóng trình duyệt giữa chừng).
- **PKCE S256** + `state` chống CSRF trên loopback.
- **Refresh token chỉ được cấp ở lần consent đầu** — nếu mất (user gỡ app rồi cài lại) phải
  gọi lại với `prompt=consent`. Lưu ngay khi nhận, mã hoá DEK.
- **Drive API**: giữ `fileId` của blob trong `SyncConfig` (meta JSON, như `seenRemoteAt`) —
  `files.create` (multipart) lần đầu, `files.update` các lần sau để không sinh bản trùng;
  `read()` = `files.get?alt=media`; `listNearMisses()` = `files.list` với
  `q="name contains 'infra-companion-vault' and trashed=false"` (scope `drive.file` tự giới
  hạn kết quả vào file app tạo). 429/5xx → retry + backoff, có trần.
- **HTTP từ main** dùng `net.fetch` (đi qua proxy hệ thống — khớp mọi feature hiện có) +
  AbortController timeout theo khuôn `marketplace.ts`.
- **Sync passphrase tối thiểu 8 ký tự là quá yếu cho blob nằm trên cloud** (đã ghi ở ROADMAP
  từ v0.2.8): khi backend là Drive, bắt tối thiểu cao hơn (đề xuất 12) hoặc ít nhất cảnh báo
  đậm — quyết lúc làm, nhưng phải có mặt trong bản ship.
- **Test**: phần thuần (dựng query string, parse response `files.list`, phân loại lỗi HTTP →
  mã lỗi) tách hàm thuần ở core → vitest chạy không mạng, mock HTTP bằng backend giả như
  `FakeBackend` trong `sync.test.ts`. KHÔNG test bằng tài khoản Google thật trong CI.
- **Repo public**: `client_id` nằm trong code là chấp nhận được (thiết kế của installed app);
  tuyệt đối không commit token/refresh token/email thật — kể cả trong fixture.

---

## 8. Những gì cố tình KHÔNG làm (để khỏi bàn lại)

- **Không bỏ sync passphrase** (mục 1).
- **Không xin scope rộng hơn `drive.file`** — không có lý do và đắt vô ích.
- **Không dựng server trung gian kiểu "Google chỉ để login, blob lưu server mình"** — thành
  nơi cất vault SSH của người khác, gánh rủi ro và trách nhiệm không cần thiết (kết luận từ
  v0.2.8).
- **Không tự động chọn Drive làm mặc định** — backend thư mục vẫn là mặc định; Drive là lựa
  chọn thêm.
- V1 chỉ **một tài khoản Google mỗi vault** (đa tài khoản để sau nếu có nhu cầu thật).

---

## 9. Các mốc triển khai

| Mốc | Nội dung | Ước lượng |
|---|---|---|
| **0. Giấy tờ** (làm TRƯỚC, có độ trễ chờ duyệt) | GCP project + consent screen + client ID Desktop; viết `privacy.html` (+ terms) và link từ landing; nộp brand verification | ~nửa ngày làm + vài ngày→2 tuần chờ duyệt (dev vẫn chạy song song ở chế độ Testing) |
| **1. OAuth trong main** | login/logout/refresh, loopback + PKCE, token mã hoá DEK trong meta, IPC `{connected, email}` | ~1 ngày |
| **2. `DriveBackend`** | 4 hàm của `SyncBackend` + phân loại lỗi thành mã + hàm thuần có test | ~1 ngày |
| **3. UI** | Sync modal: chọn backend, trạng thái tài khoản, lỗi `authExpired`, siết passphrase cho cloud; i18n ×3 | ~0.5–1 ngày |
| **4. Ship** | Docs (CHANGELOG/README/USER-GUIDE §13/ROADMAP) + **Publish to production trên console TRƯỚC khi tag** + test GUI 2 máy thật | ~0.5 ngày |

Tổng phần code ≈ **3–4 ngày dev**; đường găng thật là **vòng duyệt của Google** → làm Mốc 0
sớm nhất có thể.

**Checklist test GUI trước khi ship:** máy A đẩy → máy B (tài khoản Google đó) kéo về đúng;
token thu hồi từ myaccount.google.com → app báo đúng câu; blob bị đổi tên trên Drive → guard
near-miss chặn; auto-sync khi vault khoá → bỏ lượt; thoát app → có lượt đẩy cuối.
