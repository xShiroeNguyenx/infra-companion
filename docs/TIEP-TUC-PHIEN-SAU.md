# Tiếp tục phiên sau — Trạng thái dự án Infra Companion

> **Cập nhật 2026-07-12 — v0.1.17 ĐANG CHUẨN BỊ RELEASE (chưa commit/tag).** Sau khi 0.1.16 ra mắt, phiên debug thêm: (1) **tunnel port-forward QUA login-script gate** — `TunnelService.startLocal` dùng `deriveStreamExecFromLoginSteps` (MỚI, `feedKeepStdin` giữ stdin 2 chiều) + marker `ICTUN…`/class `StripUntilMarker` cắt rác MOTD của các hop; `ipc/tunnels.ts` truyền `loginSteps`; cần `nc` đầu cuối + `sshpass` hop password. User ĐÃ chạy thông chuỗi `local→ssh gate1(sakurai1)→ssh jpapst05→su vn_root→ssh jpap05→nc→DB 192.168.1.71:3306`. (2) **Sửa tunnel** (TunnelsModal nút Sửa→`saveTunnel` id→UPDATE). (3) **Sidebar full tên host khi không hover** (gom nút hành động vào `hidden group-hover:flex`, ghi chú chỉ hiện khi hover). (4) **Message ENOTFOUND rõ hơn** (establish.ts). (5) **Fix icon taskbar Windows**: set window icon RUNTIME cả prod (`extraResources: resources/icon.ico` + `win.setIcon`), AUMID giữ; ⚠️ Windows cache icon theo AUMID → máy đã dev cũ cần xoá icon cache/reboot mới thấy đúng (exe đã nhúng icon đúng — đã verify bằng trích icon). Bump 0.1.16→**0.1.17** (2 package.json) + CHANGELOG [0.1.17] tách khỏi [0.1.16] + README (badge/tunnels/limitations) + USER-GUIDE §9 + landing. typecheck 3 package + build + 195 test xanh. Lệnh git v0.1.17 ở block Git dưới.

> **v0.1.16 (F48 + F13) ĐÃ PHÁT HÀNH** (commit `7575426` + tag `v0.1.16` đã push origin). Ghi chú kỹ thuật 0.1.16 (giữ tham khảo): Đã bump 0.1.15→**0.1.16** (2 package.json) + CHANGELOG [0.1.16] + README (badge, section Remote Desktop + AI troubleshooter, Known Limitations) + USER-GUIDE (§9B Remote Desktop, §14C AI troubleshooter, §18) + landing (version + card Remote desktop). Typecheck 3 package + build electron-vite + 195 core test (thêm 69 test readonlyGuard) đều xanh. **CHƯA test GUI, CHƯA commit/tag.** Dependency MỚI: `ws` + `@novnc/novnc` (+ `@types/ws`). **F48 AI chẩn đoán** (agent read-only, exec riêng như Bulk, guard chặn lệnh ghi enforce Ở MAIN): palette 🩺; files core `connection/execOnce.ts`, `ai/readonlyGuard.ts` (+test), AiService mode `diagnose`; kênh `AI_DIAGNOSE_EXEC`; renderer `stores/aiDiagnose.ts` + `components/AiDiagnoseModal.tsx`. **F13 VNC nhúng + RDP qua tunnel** (KHÔNG FreeRDP native): core `connection/forward.ts startForward()` (listen(0) + forwardOut qua jump chain HOẶC net.connect thẳng); `ipc/connection.ts` helper `toChainEndpoint` + `prepareForward`; HostProtocol += vnc|rdp; HostEditorModal + Sidebar (nút 🖥️). RDP: `ipc/rdp.ts` (mstsc.exe, win-only) + `stores/rdp.ts` + `RdpDock.tsx`. VNC: `ipc/vnc.ts` (WebSocketServer + token bridge ws↔tcp) + TabKind 'vnc' + `features/vnc/VncView.tsx` (noVNC RFB — import BARE `@novnc/novnc`, KHÔNG subpath vì exports là string, subpath sẽ VỠ build; type shim `renderer/src/novnc.d.ts`); CSP index.html + `connect-src ws://127.0.0.1:*`. ⚠️ Giới hạn: tunnel VNC/RDP chỉ jump-host chain, CHƯA hỗ trợ login-script gate (Phase 2). ⚠️ **Gotcha khi chạy `pnpm dev`**: môi trường có `ELECTRON_RUN_AS_NODE=1` khiến electron chạy như Node → crash `app.isPackaged undefined`; phải `Remove-Item Env:ELECTRON_RUN_AS_NODE` (hoặc unset) trước khi dev. Lệnh release v0.1.16 ở block "Git" dưới (dùng `git add -A` vì gộp cả 0.1.15). Phần dưới đây (v0.1.15) giữ để tham khảo — nội dung 0.1.15 vẫn nằm trong working tree, tag v0.1.16 gánh luôn.

> File bàn giao để mở phiên mới là làm việc được ngay. Cập nhật 2026-07-09: **v0.1.14 ĐÃ phát hành** (commit `5c2c0cc` + tag). **v0.1.15 SẴN SÀNG RELEASE — đã bump version (2 package.json) + CHANGELOG [0.1.15] + README + landing hero + USER-GUIDE (§11 Monitoring viết thêm svc uptime/tooltip/chart inline/dashboard history + §14 panel AI kéo thả), CHƯA commit/tag** (lệnh git cuối file — nhớ test GUI theo checklist TRƯỚC khi tag). Mục (5) **AiExplainPanel kéo thả + resize**: kéo header di chuyển (pointer capture, kẹp trong khung app, bấm nút –/✕ không tính là kéo), grip góc dưới-phải = CSS `resize` gốc Chromium (browser ghi width/height inline — React không đè vì không quản 2 key đó); vị trí nhớ trong phiên (component luôn mount); chưa kéo thì neo top-right như cũ (có panel plugin thì top-24); i18n `panel.dragHint` ×3. Các mục còn lại: (1) **service uptime trên card** — dòng `⟳ httpd 30d · java 12d` (tiến trình lâu đời nhất mỗi tên: httpd/apache2/nginx/java/node/php-fpm/mysqld/mariadbd/postgres/redis-server; section `==SVC==` mới trong METRIC_CMD — chủ đích KHÔNG dùng `$()`/awk vì login-script nesting; parser `parseServices` lấy MAX etimes/tên, cap 4; GIỮ uptime server — service uptime là bổ sung, không thay thế). (2) **tooltip giải thích mọi thông số** — hover us/sy/wa/st/r/swap + Load/CPU/RAM/Disk/net/conn/inode/top/svc (i18n `monitor.tip.*` vi/en/ja, cursor-help). (3) **chart lịch sử inline trong card** — bấm 📈 giờ TOGGLE 3 chart 1h (Load/CPU/Conn, bucket phút, refresh 60s) ngay trong dock (`InlineHistory` + prop `compact` của `MetricChart` đã export từ MetricsHistoryModal); nút "⤢ Chi tiết & 24h" mở modal đầy đủ như cũ. (4) **mục "📈 Lịch sử monitoring" trên Dashboard 🏠** (user chỉ rõ vị trí: giữa Nhóm host và Kết nối gần đây) — liệt kê MỌI server từng được monitor (kể cả khi monitoring đang tắt — đọc từ metrics.db, giữ 30 ngày), mới nhất trước, mỗi card = label (fallback id cắt ngắn nếu host đã xoá) + "lần cuối HH:mm" + chart Load 24h compact; bấm card mở MetricsHistoryModal; `MetricsStore.listHosts()` mới (SELECT GROUP BY + gộp bucket dở trong RAM) + IPC `METRICS_HOSTS` + `monitor.historyHosts()`; chỉ fetch khi Dashboard active, refresh 60s. Test 126 + 12 skip (suite SQLite 6/6 pass qua Electron-Node), typecheck + build xanh, CHƯA test GUI.

> Ghi chú release v0.1.13 (giữ để nhớ): lần đầu tag mà QUÊN commit → tag trỏ commit cũ, build ra 0.1.12, phải xoá release rỗng + dời tag; quy trình đúng: **commit → push → tag → push tag**. Nội dung v0.1.14: (1) **F04 alert ngưỡng** (hysteresis 3-sample + vùng chết + cooldown 15'; toast + Windows notification + webhook Google Chat/Slack/Discord/Telegram tự nhận diện; rules ở `monitor-settings.json` userData — KHÔNG vault, chạy cả khi vault khoá; Load không chặn 100, mặc định Load/Conn TẮT, Steal 20, RAM/Disk 90). (2) **F32 lịch sử metrics** — metrics.db riêng (bucket 1'=48h, 10'=30 ngày, tự prune), nút 📈 trên card → chart 1h/24h. (3) **F46 AI giải thích selection** — bôi chọn → ✨/Ctrl+Shift+E → panel dock. (4) **Monitoring 2.0** — CPU thật us/sy/wa/**st** (delta /proc/stat; bắt được ca jpap09 steal 40% VPS bị oversell), run queue, swap, disk mount đầy nhất + inode, net ↓↑, TCP conn, top process; dòng chẩn đoán nằm CUỐI card (user yêu cầu, Load giữ nguyên). **Việc mai**: phân tích tiếp jpap08/09 (chặn bot theo ASN từ plugin, khiếu nại steal với nhà cung cấp kèm chart 📈, cân nhắc giảm MaxRequestWorkers 1152→576 SAU khi chặn bot — đã tư vấn kỹ trong phiên). Private key ký registry: `~/.infra-companion/registry-signing-key.pem` — **PHẢI BACKUP**.

## Đang ở đâu

Đã xong **Phase 0 → 6** (hơn 23 tính năng) + **1 phiên rà soát chất lượng** + **v0.1.3 → v0.1.13 (đã tag/phát hành)**. App build + typecheck + test đều sạch (147 core test: 137 Node 20 + suite SQLite chạy qua Electron-Node).

**v0.1.14 (2026-07-08 đêm, ĐÃ bump version + docs, CHƯA commit/tag, GUI đã test một phần bằng pnpm dev — card mới hiện đúng trên jpap09)** — schema vault KHÔNG đổi (vẫn **v9**; metrics.db riêng có schema v2 của chính nó):
1. **F04 Alert ngưỡng monitoring**: `packages/core/src/monitor/AlertEngine.ts` (hysteresis thuần: breach 3 sample ~9s, vùng chết [T-margin,T), recover 3 sample, offline 3 fail/2 ok, re-alert 15'; timing theo sample.ts → test deterministic) + `webhook.ts` (Google Chat/Slack/Discord/Telegram tự nhận diện theo URL, generic JSON fallback; conn không đơn vị %) + `apps/desktop/src/main/ipc/monitorSettings.ts` (`monitor-settings.json` userData — CHỦ Ý không vault để alert chạy khi vault khoá; nút Gửi thử; Load max 10000, Conn max 1e6, Steal/RAM/Disk 0-100). Dispatch 3 kênh trong `main/ipc/monitor.ts`: MONITOR_ALERT → toast renderer; Electron `Notification` (chỉ breach; ĐÃ `setAppUserModelId` win32 — **verify Windows toast trên bản đóng gói**); webhook fire-and-forget không retry. Mặc định: RAM/Disk 90, Steal 20, Load/Conn TẮT (baseline mỗi server một khác), offline bật. ⚠️ ĐỔI chữ ký IPC `monitor.start(hosts: {id,label}[])` — main cần label khi vault khoá.
2. **F32 Lịch sử metrics**: `downsample.ts` + `MetricsStore.ts` (metrics.db riêng KHÔNG mã hoá trong userData, migrations riêng qua `PRAGMA user_version`, WAL; bucket 1' giữ 48h + 10' giữ 30 ngày song song, prune lúc mở + hourly; flush bucket dở khi stop/quit). Nút **📈** trên MonitorCard → `MetricsHistoryModal` (6 chart SVG tự vẽ: Load auto-scale, CPU, Steal, RAM, Disk, Conn auto-scale; tách đoạn tại gap dữ liệu; refresh 60s). IPC `METRICS_QUERY` lazy-open.
3. **F46 AI giải thích selection** (thuần renderer): `stores/aiExplain.ts` (cap 6000 ký tự giữ ĐUÔI; `ai.ask('explain-error')` — không code main mới; AI chưa config → toast + mở AiModal) + TerminalPane (nút ✨ theo pattern find-overlay, Ctrl+Shift+E) + `AiExplainPanel.tsx` (dock clone PluginPanelModal, pill ✨, KHÔNG dùng chung store plugin).
4. **Monitoring 2.0**: METRIC_CMD mở rộng (CHỈ double-quote — shq loginScript bọc single-quote; đếm TCP bằng `grep -c " 01 "`; df lọc fs ảo PHÍA PARSER cho portable) → CPU thật us/sy/**wa**/**st** + run queue + swap + disk mount đầy nhất + inode + net ↓↑ + conn + top process. **CPU%/net = delta giữa 2 poll** (`ActiveMonitor.prev`, reset khi reconnect; poll đầu null → card hiện từ poll 2 ~6s). `parseMetrics`/`applyCounterDeltas` EXPORT có test riêng (⚠️ bẫy `Number('') === 0` đã vá). Card: **GIỮ hàng Load** (user yêu cầu); dòng chẩn đoán `us/sy/wa/st · r · swap` nằm CUỐI card sau đường kẻ (user yêu cầu chuyển xuống); st≥10 đỏ, wa≥20 vàng, r>nproc vàng, inode≥70 vàng. Ngưỡng mới Steal % + Conn trong modal (5 ô). **Bài học vận hành từ ca jpap09**: load 300-600% do CPU steal 34-40% (VPS oversell) + bot ép java/httpd — dashboard cũ mù hoàn toàn, bản mới hiện thẳng trên card.
5. Kiểm tra: typecheck 3 package + build xanh; 137 test Node 20 + **39/39 test monitor qua Electron-Node** (`$env:ELECTRON_RUN_AS_NODE=1; electron vitest run`).

**v0.1.13 (ĐÃ phát hành 2026-07-08)** — thuần renderer + plugin mẫu, không đổi schema DB (vẫn **v9**):
1. **Dashboard home screen** — mở app (sau unlock) vào Dashboard thay vì auto-mở PowerShell. Kiến trúc: KHÔNG phải tab kind mới — là màn hình home mount thường trực, hiện khi `activeId === null` ([DashboardView.tsx](../apps/desktop/src/renderer/src/features/dashboard/DashboardView.tsx), render trong App.tsx cạnh tabs); nút **🏠** trái TabsBar highlight khi đang ở home, `showDashboard()` trong tabs store chỉ là `set({ activeId: null })`; đóng tab cuối rơi về home (empty-state cũ đã xoá). Layout 1 cột max-w-3xl: stats (hosts/groups/kết nối hôm nay/7 ngày — `listHistory` nâng 8→50 trong data.ts, Sidebar tự `slice(0,8)`) → quick connect (regex như Sidebar) → ★ favorites → chip nhóm (openSshGroup) → gần đây → workspaces (open 1 click) → tunnels (dot trạng thái live + Start/Stop tại chỗ) → bảng phím tắt. Setting `infra.startup.page` (`startupPage`, mặc định 'dashboard') trong Settings → "Trang khi mở app". ⚠️ Đã thử 2 cột + khối Monitoring tóm tắt — user BỎ cả hai (chưa cân đối / trùng MonitorDock) — đừng thêm lại. toggleBroadcast giờ guard chỉ tab terminal (fix luôn bug 📡 trên tab SFTP). i18n `dashboard.*` (~30 key) vi/en/ja.
2. **Access Log Analyzer v1.4.0** — mục **7. Top 15 nhà mạng/tổ chức (ASN_ORGANIZATION)**: log GeoIP có đuôi `| ... | ASN_ORGANIZATION: VNPT Corp` → `awk -F'ASN_ORGANIZATION: ' 'NF>1{print $2}' | sort | uniq -c | sort -rn | head -15`; không có trường → in "(log khong co truong ASN_ORGANIZATION - bo qua muc nay)". Đã test cả 2 nhánh trên log mẫu thật (webike). "6 thông số"→"7 thông số" toàn file + title lệnh trong manifest; registry build + ký lại. ⚠️ Lưu ý ngữ nghĩa: user gọi ASN org là "agent" — mục 4 Top User-Agent là thứ KHÁC, đã có từ trước.
3. Kiểm tra: typecheck 3 package + build + 98 test xanh. **Test update plugin qua Marketplace**: bản cài %APPDATA% đang để v1.3.0 CHỦ Ý — sau khi push (Pages deploy registry 1.4.0, chờ ~1-2 phút) mở 🧩 Plugins → 🛒 Marketplace → Access Log Analyzer hiện nút **Cập nhật** → bấm → verify sha256+chữ ký → Nạp lại → chạy thử "Phân tích 7 thông số". (Marketplace cache registry 5 phút — mở lại tab nếu chưa thấy.)

**v0.1.11 (ĐÃ phát hành 2026-07-07, commit `e7ee853` + tag)** — thuần renderer (UI/UX terminal), không đổi schema DB (vẫn **v9**):
1. **Sidebar thu gọn được** — nút `«` cạnh ô tìm kiếm / `Ctrl+Shift+H` / lệnh palette "Thu gọn/mở danh sách host": cột host trái thu về thanh hẹp w-8 chỉ còn nút `»` mở lại; state nhớ qua localStorage `infra.sidebar.collapsed` ([stores/ui.ts](../apps/desktop/src/renderer/src/stores/ui.ts) thêm `sidebarCollapsed`/`toggleSidebar`). Terminal tự fit nhờ ResizeObserver sẵn có trong TerminalPane. ⚠️ Chọn Ctrl+Shift+H vì Ctrl+B là prefix tmux (cấm global-intercept), Ctrl+Shift+B đã là Broadcast.
2. **Dock thu nhỏ được** — panel plugin và MonitorDock có nút `–`: plugin thu về pill `🧩 <title>` GÓC TRÊN phải (bấm bung lại; **tự bung khi plugin push nội dung mới** — useEffect theo prop panel), monitor thu về pill `📊 n host` GÓC DƯỚI phải (bottom-8, tránh đè pill plugin; chấm màu = trạng thái xấu nhất: đỏ lỗi/vàng đang nối/xanh OK; polling vẫn chạy). State local useState (không persist — chủ ý). i18n `panel.minimize`/`panel.restore` vi/en/ja.
3. **Ẩn scrollbar terminal** — scrollbar `.xterm-viewport` ẩn hẳn trong [main.css](../apps/desktop/src/renderer/src/styles/main.css) (`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`) — trước là thanh 10px chiếm ngang mỗi pane. ⚠️ Ghi chú lịch sử: từng làm thêm nút "🖱 Sửa cuộn" (tắt mouse-reporting kẹt — remote bật xterm mouse mode rồi không tắt / escape lẫn trong log khi cat/tail → lăn chuột in rác "65;53;18M…", Broadcast làm lan mọi pane) bằng cách ghi DECRST trực tiếp vào xterm qua termBus — **user quyết định BỎ, đã gỡ sạch (nút + resetTermMouse + i18n), ĐỪNG tự thêm lại**. Workaround cho user khi gặp: gõ `reset` trên shell, hoặc giữ **Shift khi lăn** (xterm.js luôn bypass mouse reporting).
4. **Kéo chỉnh kích thước pane split** — ranh giới giữa các pane kéo được ([TerminalTabView.tsx](../apps/desktop/src/renderer/src/features/terminal/TerminalTabView.tsx)): state local `colFr[]`/`rowFr[]` (fr per cột/hàng) thay `repeat(n, 1fr)`; gutter = div absolute (con của grid — abs-pos KHÔNG chiếm ô grid) rộng 6px đè lên ranh giới tại `cutPct()`%, kéo đổi cặp track 2 bên (min ~12%/track), double-click chia đều, overlay z-20 khi kéo chặn xterm nuốt chuột; reset khi cols/rows đổi; xterm tự fit qua ResizeObserver. Không đụng store — sizes sống theo component (mất khi merge/unmerge, chấp nhận).
5. Kiểm tra: typecheck 3 package + `pnpm build` xanh. **Chưa test GUI**: sidebar thu gọn + nút – thu nhỏ 2 dock + kéo resize pane — cần `pnpm dev` bản mới trước khi tag.

**v0.1.10 (ĐÃ phát hành 2026-07-06, commit `2c5565b` + tag)** — Plugin API mới + plugin mẫu tương tác, không đổi schema DB (vẫn **v9**):
1. **Plugin API `api.ui.prompt({ title?, label?, placeholder?, value? })` → `string | null`** — plugin hỏi user 1 dòng text qua modal (null = Huỷ/timeout). Chuỗi xuyên suốt: `packages/core/src/plugins/protocol.ts` (method `ui.prompt` + interface `PluginPromptOptions`) → `PluginHost` (adapter **bắt buộc mới** `promptUser(pluginId, opts)` — implementor/fake test nào cũng phải thêm) → [ipc/plugins.ts](../apps/desktop/src/main/ipc/plugins.ts) dùng lại hạ tầng `askRenderer` sẵn có (kênh mới `IPC.PLUGINS_PROMPT`; renderer trả lời qua kênh chung `PROMPT_ANSWER`, timeout 120s phía main) → [PromptsHost.tsx](../apps/desktop/src/renderer/src/components/PromptsHost.tsx) thêm loại câu hỏi `'plugin'` (modal + TextInput, nút OK/Huỷ). ⚠️ Worker: `callApi` nhận **timeout riêng** — `ui.prompt` chờ 130s (dài hơn 120s của main) thay vì 8s mặc định.
2. **Access Log Analyzer v1.2.0** (`docs/examples/access-log-analyzer/`): khi chạy lệnh sẽ **hỏi đường dẫn log** — bỏ trống = mặc định `/etc/httpd/logs/ssl_access_log`, gõ ví dụ `/var/log/nginx/access.log`; **nhớ lần nhập trước** qua `api.storage` (key `logPath`); validate path `^[A-Za-z0-9._/-]+$` (chặn khoảng trắng/ký tự phá one-liner shell). Manifest thêm permissions `ui.prompt`, `storage`. **ĐÃ copy đè** sang thư mục plugin đã cài `%APPDATA%\@infra\desktop\plugins\access-log-analyzer\` — chạy `pnpm dev` bản mới là dùng được ngay (API mới cần build app mới).
   - **Hỗ trợ log format custom của server user** (vhost:port đứng ĐẦU dòng `www.site.com:443 1.2.3.4 - - [...]` + đuôi `| Country Code | ASN…`): mọi cột dịch +1 so với combined chuẩn (IP $1→$2, URL $7→$8, status $9→$10). Plugin **tự dò offset** từ dòng đầu file (cột 1 là IP → chuẩn, không phải → +1; hằng `FIELD_OFFSET='auto'` đầu index.js, đặt số để ép). Khi có vhost, mục top-URL in `vhost/path` (1 file gộp nhiều domain). Thời gian (tách theo `[`) và User-Agent (tách theo `"`) vốn không phụ thuộc vị trí cột. Đã test pipeline awk với log mẫu cả 2 format. Sửa kèm: thông báo "(x) Khong doc duoc..." trước đây nằm giữa BEGIN và S1 nên parser vứt mất (path sai → 6 mục trống không lý do) — giờ nằm trong mục 1.
3. **Plugin API: nút hành động `cmd:` trong panel + `ctx.arg`** — markdown link `[nhãn](cmd:command.id?arg)` render thành nút, bấm gọi command CỦA CHÍNH plugin sở hữu panel với `ctx.arg` = phần sau `?` (URI-decoded). Chuỗi: `miniMarkdown.tsx` (prop `onCommand`, nơi khác không truyền → render text thường) → `PluginPanelModal.tsx` (tự tính activeSessionId từ tabs store như palette) → `invokeCommand(pluginId, commandId, sid, arg)` xuyên preload/IPC/PluginHost → `CommandCtx.arg` (protocol.ts).
4. **Access Log Analyzer v1.3.0 — panel tương tác**: mỗi mục hiện lệnh pipeline đã chạy (`$ awk …` đầu code block) + nút **↻ Chạy lại** (chạy lại riêng mục đó trên đúng phiên/log cũ, tail mẫu mới) + **✎ Sửa lệnh** (ui.prompt điền sẵn lệnh hiện tại → sửa → chỉ mục đó chạy lại và cập nhật tại chỗ; để trống = về mặc định). Lệnh đã sửa lưu `api.storage` key `cmds` (per mục, dùng cả cho lần phân tích đầy đủ sau). Validate lệnh sửa: 1 dòng, cấm `!` (history expansion), cấm chuỗi `@ALOG`. State module: `lastRun={logPath,sessionId,contents[]}` (mất khi Reload plugin — nút ↻/✎ báo "chạy phân tích trước"), `overrides={}`. Commands mới `alog.rerun`/`alog.edit` (hiện cả trong palette — gọi chay sẽ notify hướng dẫn).
5. Kiểm tra khi release: **72 test pass** (+1 test `ui.prompt` round-trip trong `PluginHost.test.ts`), typecheck 3 package + build xanh; `node --check` plugin OK; ui.prompt user đã chạy thử OK trên server thật (data.json có logPath).

**v0.1.9 (ĐÃ phát hành 2026-07-03)** — thuần renderer + plugin mẫu + docs, không đổi schema DB (vẫn **v9**):
1. **Plugin mẫu thứ 3: Access Log Analyzer** (`docs/examples/access-log-analyzer/`) — 1 lệnh palette, gõ 1 dòng shell (tail+awk trên 50k dòng cuối) vào phiên SSH đang mở, bóc output theo marker `@ALOG:...@` (token tách đôi khi echo để dòng lệnh terminal echo lại không match), hiện panel 6 thông số + hướng dẫn đọc. Config hardcode đầu `index.js` (`LOG_PATH`, `SAMPLE_LINES`, timeout 30s). ⚠️ **Bài học: CẤM ký tự `!` trong lệnh gửi vào bash tương tác** — history expansion chạy TRƯỚC khi thực thi, `!)` → "event not found" → bash vứt cả dòng; `set +H` cùng dòng không cứu được.
2. **Panel plugin neo góc phải** ([PluginPanelModal.tsx](../apps/desktop/src/renderer/src/components/PluginPanelModal.tsx)) — bỏ Modal+backdrop; dock top-right 460px, mờ 75% (hover 100%), z-40, đóng bằng ✕. **Cố ý bỏ Esc** (Esc thuộc về terminal/vim).
3. **Monitoring tách khỏi vòng đời modal** — trước đây đóng modal (hoặc mở modal KHÁC) là unmount → `stopAll()` giết monitoring ngầm. Giờ: store mới [stores/monitor.ts](../apps/desktop/src/renderer/src/stores/monitor.ts) (active + data, subscribe onSample ở App.tsx); [MonitorDock.tsx](../apps/desktop/src/renderer/src/components/MonitorDock.tsx) dock phải 320px 1 cột card, mờ 75%, z-30 (dưới panel plugin z-40 — mở cả 2 thì plugin đè dock, chấp nhận); [MonitorModal.tsx](../apps/desktop/src/renderer/src/components/MonitorModal.tsx) chỉ còn form chọn host (mở lại khi đang chạy = tick sẵn tập đang theo dõi). `store.start()` gọi `stopAll()` trước → ngữ nghĩa THAY tập host (backend dedupe theo hostId). Chỉ nút **Dừng** trên dock mới tắt.

**v0.1.8 (đã phát hành)** — bugfix, không đổi schema DB (vẫn **v9**):
1. **Fix Monitoring/Bulk xuyên login-script** — từ v0.1.3, `deriveSshArgsFromLoginSteps` bị đổi ngữ nghĩa để trả về nguyên lệnh SFTP (`ssh … -s sftp`), nhưng Monitor/Bulk vẫn bọc thêm một lớp `ssh` bên ngoài → lệnh rác, stdout rỗng, dashboard báo "Không parse được metrics (không phải Linux?)" với host Linux bình thường sau gate (phát hiện trên một host AlmaLinux vào qua login script). Đã tách builder chung [loginScript.ts](../packages/core/src/connection/loginScript.ts): `deriveSftpExecFromLoginSteps` (SFTP, giữ nguyên hành vi) + `deriveExecFromLoginSteps(steps, command)` (Bulk/Monitor). Nhờ đó Bulk/Monitor giờ xuyên được cả **su/sudo + ssh-có-password** (sshpass trên gate) như SFTP. ⚠️ Biến thể exec nạp password su/sudo bằng `echo PASS |` chứ KHÔNG `{ echo; cat; } |` như SFTP — caller không bao giờ đóng stdin kênh exec nên `cat` sẽ chờ EOF vô hạn, kênh không bao giờ close.
2. **Monitor thu stderr** — parse fail thì card hiện lỗi thật từ remote (Permission denied, sshpass thiếu…) thay vì đoán "không phải Linux?". Đã xoá `wrapSshCommand` (nguồn gốc của bẫy). +10 test cho builder (71 total).

**v0.1.7 (đã phát hành)** — ảnh nền từ URL (Google Drive/Dropbox, fetch ở main process, validate magic bytes).

**v0.1.6 (đã phát hành)** — 3 tính năng, không đổi schema DB (vẫn **v9**):
1. **Plugin system v1 (F16)** — plugin JS tin cậy ở `userData/plugins/<id>/` (manifest.json + index.js CJS), chạy trong **worker_thread chung** cô lập lỗi, API có kiểm soát (không đụng vault). Hook: command palette + panel markdown + observe/write output + storage + notify; có **Quét lại** (rescan, mở modal tự quét). Tài liệu dùng + viết plugin gộp trong mục **Plugins** của `docs/USER-GUIDE.md`; mẫu `docs/examples/`.
2. **Theme studio** — tuỳ biến 11 màu UI per base-theme (Settings → Giao diện → 🎨) + xuất/nhập theme JSON.
3. **Favorites** — nút ⭐ ghim host lên mục Yêu thích đầu sidebar (localStorage, per-máy).

**v0.1.4 (đã phát hành)** — 5 tính năng: Workspaces, Notes per host, tuỳ biến terminal (font/cỡ chữ/con trỏ), màu accent tuỳ chỉnh, tmux-resume. Schema DB ở **v9** (`hosts.notes_enc`, `hosts.tmux`). ⚠️ **tmux-resume vẫn chưa được kiểm runtime** — cần server có tmux + rớt mạng thật để kiểm chứng.

| Phase | Trạng thái |
|-------|-----------|
| 0 — Skeleton (Electron + React + xterm + node-pty, monorepo pnpm) | ✅ |
| 1 — SSH core + Vault (argon2id + AES-256-GCM, hosts/groups/keys, TOFU, auto-reconnect) | ✅ |
| 2 — SFTP, tunnels L/R/D (SOCKS5), jump chain, snippets, import ssh_config, group inheritance, agent | ✅ |
| 3 — Split panes + **broadcast**, command palette, Telnet, Serial, session logs | ✅ (còn: FIDO2, SSH certs — workspaces đã xong v0.1.4) |
| 4 — **Sync E2EE** (zero-knowledge, backend thư mục) | ✅ (còn: WebDAV/S3/Git) |
| 5 — **Bulk Execution**, **Monitoring** (không agent), Network Toolbox; Bulk/Monitor/SFTP **xuyên login-script** | ✅ (còn: cloud import F05, Docker/K8s F06) |
| 6 — **AI assistant** (Claude/OpenAI/Gemini/Ollama), **Session recording** (asciicast), **Secrets manager** (op/bw/vault) | ✅ (còn: plugin F16) |
| 7 — Team server, RDP/VNC, Mosh, zero-trust | ⬜ chưa làm |

Chi tiết tính năng + cách test: [USER-GUIDE.md](./USER-GUIDE.md). Roadmap các tính năng tiếp theo: [../ROADMAP.md](../ROADMAP.md).

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

**Chưa sửa (chấp nhận được / để sau):** cảnh báo style SonarLint (window vs globalThis, nested-ternary…) — theo convention codebase; `sandbox: false` (preload cần). ~~Bulk/Monitor/SFTP xuyên login-script chỉ hỗ trợ `ssh …` thuần~~ → đã sửa ở v0.1.8 (hỗ trợ cả su/sudo + ssh-password).

## Chi tiết kỹ thuật các tính năng

**v0.1.6 (đã phát hành)** — Plugin system + Theme studio + Favorites.

- **Plugin system v1 (F16)**: logic thuần ở `packages/core/src/plugins/` (`manifest.ts` validate, `discover.ts` quét, `protocol.ts` message union, `paths.ts` confine, `PluginHost.ts` EventEmitter quản lý vòng đời + registry + responder api-call + ref-count observe). Bootstrap worker ở [worker.ts](../apps/desktop/src/main/plugins/worker.ts) (CJS qua `createRequire`); IPC ở [ipc/plugins.ts](../apps/desktop/src/main/ipc/plugins.ts). **Pitfall đã xử lý**: electron-vite emit CJS phẳng → thêm **input thứ 2** trong `electron.vite.config.ts` để emit `out/main/plugin-worker.js`; nạp bằng `new Worker(join(__dirname,'plugin-worker.js'))`. Terminal tee qua `TerminalBridge` ([terminal.ts](../apps/desktop/src/main/ipc/terminal.ts), gate theo subscriber + `TERM_SET_ACTIVE`). Renderer: `stores/plugins.ts`, `lib/miniMarkdown.tsx` (render markdown an toàn, KHÔNG dangerouslySetInnerHTML), `PluginsModal`/`PluginPanelModal`. **Rescan**: `PluginHost.rescan()` + mở modal tự quét → thấy plugin mới không cần restart. 3 test file (33 test). Bảo mật: không truyền DEK/secret vào worker; storage confine trong thư mục plugin; crash worker → respawn 1 lần.
- **Theme studio**: `CUSTOM_PALETTE_VARS` (11 biến `--c-*`) + `CustomColors` per base-theme + `applyCustomTheme()` (override CSS var inline như accent) trong [stores/settings.ts](../apps/desktop/src/renderer/src/stores/settings.ts); key `infra.theme.custom`; áp boot trong main.tsx; UI [CustomPaletteSection.tsx](../apps/desktop/src/renderer/src/components/CustomPaletteSection.tsx) (color pickers + reset + xuất/nhập JSON qua textarea). setTheme reapply đúng bộ khi đổi dark↔light.
- **Favorites**: [stores/favorites.ts](../apps/desktop/src/renderer/src/stores/favorites.ts) (localStorage `infra.favorites`); tách `HostRow` dùng chung trong [Sidebar.tsx](../apps/desktop/src/renderer/src/components/Sidebar.tsx) + nút ⭐ + mục "★ Yêu thích" đầu list (tôn trọng search). Host ghim hiện cả ở Yêu thích lẫn group (chủ ý).

**v0.1.5 (đã phát hành)** — copy/dán bằng chuột trong terminal. Thuần renderer, chỉ 2 file.

- **Copy bằng click trái vào vùng đã tô, dán bằng click phải** trong [TerminalPane.tsx](../apps/desktop/src/renderer/src/features/terminal/TerminalPane.tsx). Gắn listener chuột ở **pha capture** trên `term.element`: `mousedown` chạy TRƯỚC khi xterm xoá selection nên đọc được đoạn đang bôi đen + tính `pointInSelection`; `mouseup` mà là click đơn (di chuyển < 3px) và rơi trong vùng → `navigator.clipboard.writeText` + toast "Đã sao chép" (key i18n `terminal.copied` cho vi/en/ja). `contextmenu` → `preventDefault` + `readText` rồi gửi qua `handleInput` (tôn trọng Broadcast). Phím tắt cũ Ctrl+Shift+C/V giữ nguyên.
  - ⚠️ **Gotcha đã xử lý**: bản build xterm 6.0 trả `getSelectionPosition()` theo **0-based tuyệt đối trong buffer** (typings ghi "1-based" là SAI), và start/end **đảo chiều** khi bôi từ dưới lên → code đã chuẩn hoá. `cellFromEvent` quy pixel→ô bằng `.xterm-screen` rect / cols-rows (không đụng private API). Nếu không tính được toạ độ thì fallback coi như trong vùng (vẫn copy khi có selection). Listener gỡ sạch + clear timer toast trong cleanup.

**v0.1.4 (đã phát hành)** — 5 mục dưới đây. Hầu hết ở renderer + thay đổi nhỏ ở core (vault). Build + typecheck + 27 test sạch.

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

## Gợi ý cho phiên sau (Plugin system F16 v1 đã xong ở v0.1.6)

1. **Wave 3 top-5** (thêm 2026-07-04, xem ROADMAP mục "Wave 3"): TOTP trong vault (F41) · alert ngưỡng + lịch sử metrics (F04+F32) · AI giải thích output đang chọn (F46) · SFTP transfer queue (P46) · Shell integration OSC 133 (F23).
2. **VNC (noVNC)** — xem màn hình remote trong tab. Thuần JS khả thi hơn RDP (RDP cần FreeRDP native, nặng). Rủi ro trung bình.
3. **Plugin v2** — protocol mới (SessionKind) + permission enforcement + transform output + panel HTML sandbox (F51) (mở rộng nền v1).
4. **SSH Certificates / FIDO2**, hoặc **Sync backend WebDAV/S3/Git**, hoặc **ssh_config 2 chiều** — xem ROADMAP.

## Việc cần làm khi mở phiên mới
- Mở lại file này để nhớ ngữ cảnh.
- Chọn 1 hạng mục ở trên → bắt đầu luôn.

## Git (anh tự chạy; tôi không tự commit)

> **v0.1.14 ĐÃ phát hành** (commit `5c2c0cc` + tag, 2026-07-08). **Đang chờ: RELEASE v0.1.15** — 5 nâng cấp UI (svc uptime ⟳ + tooltip thông số + chart inline trong dock + mục lịch sử monitoring trên Dashboard 🏠 + panel AI kéo thả/resize), ĐÃ bump version + CHANGELOG [0.1.15] + README + landing + USER-GUIDE. ⚠️ Quy trình: **commit + push main TRƯỚC, tag SAU** — tag khi chưa commit sẽ build từ commit cũ với version cũ (đã dính 1 lần ở v0.1.13). Landing hero đổi → Pages tự deploy lại khi push.

Quy trình release (cho lần sau): bump version 2 `package.json` (gốc + `apps/desktop`) + CHANGELOG + README/USER-GUIDE/landing/handoff, rồi push tag `v*.*.*` — release tự kích hoạt (xem `.github/workflows/release.yml`: tạo GitHub Release rồi build song song Win/macOS/Linux). Lưu ý: đổi `docs/landing/index.html` (version trên hero) sẽ tự deploy lại landing page qua flow Pages riêng khi push lên `main`.

**Landing page = flow ĐỘC LẬP** (`.github/workflows/pages.yml`, deploy `docs/landing/`): tự chạy khi **push thay đổi `docs/landing/**` lên `main`** (hoặc chạy tay workflow_dispatch) — **KHÔNG gắn tag/release → không build lại app**. `ci.yml` đã thêm `paths-ignore: docs/** + **/*.md` để push chỉ-docs không kích hoạt build 3-OS. **Setting 1 lần**: repo → Settings → Pages → Source = **GitHub Actions**. URL: `https://xshiroenguyenx.github.io/infra-companion/`. Link User guide/Changelog/Roadmap trong landing trỏ GitHub blob/main (không tương đối) để hoạt động khi publish.

```powershell
# ============================================================
# v0.1.17 — tunnel qua login-script + sua tunnel + sidebar full-name + fix DNS msg + fix icon taskbar
# (v0.1.16 F48+F13 DA phat hanh: commit 7575426 + tag v0.1.16 da push)
# ============================================================
cd d:\NGUYENKHANH\GLOBAL_WORKSPACE\infra-companion

# 0) Bo ELECTRON_RUN_AS_NODE neu dang set (can de chay dev/build)
#    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# BUOC 1: commit + push main (BAT BUOC truoc khi tag). Kiem `git status` truoc.
git add -A
git status                 # ra soat: dung co file rac (release/, out/, node_modules deu da .gitignore)
git commit -m @'
feat: tunnel qua login-script gate + sua tunnel + sidebar full-name + fix DNS message & icon taskbar (v0.1.17)
'@
git push origin main

# BUOC 2: tag SAU KHI push — CI build installer 3 OS
git tag v0.1.17
git push origin v0.1.17
# Xong: cho Actions ~5-10 phut -> Releases/v0.1.17 co InfraCompanion-Setup-0.1.17.exe + latest.yml

# ------------------------------------------------------------
# (Tham khao) block v0.1.15 cu — cac file nay la TAP CON cua `git add -A` o tren,
# giu lai de doi chieu; KHONG can chay neu da dung `git add -A` v0.1.16.
# ------------------------------------------------------------
cd d:\NGUYENKHANH\GLOBAL_WORKSPACE\infra-companion

# v0.1.15 — svc uptime + tooltip + chart inline + lich su monitoring tren Dashboard + panel AI keo tha
# BƯỚC 1: commit + push main (BẮT BUỘC trước khi tag)
git add packages/shared/src/types.ts packages/shared/src/ipc.ts
git add packages/core/src/index.ts packages/core/src/monitor/MonitorService.ts packages/core/src/monitor/MetricsStore.ts
git add packages/core/src/monitor/parseMetrics.test.ts packages/core/src/monitor/AlertEngine.test.ts packages/core/src/monitor/MetricsStore.test.ts packages/core/src/monitor/downsample.test.ts
git add apps/desktop/src/main/index.ts apps/desktop/src/main/ipc/monitor.ts apps/desktop/src/preload/index.ts
git add apps/desktop/src/renderer/src/components/MonitorDock.tsx apps/desktop/src/renderer/src/components/MetricsHistoryModal.tsx
git add apps/desktop/src/renderer/src/components/AiExplainPanel.tsx
git add apps/desktop/src/renderer/src/features/dashboard/DashboardView.tsx
git add apps/desktop/src/renderer/src/i18n/dict.ts
git add package.json apps/desktop/package.json
git add CHANGELOG.md README.md docs/USER-GUIDE.md docs/landing/index.html docs/TIEP-TUC-PHIEN-SAU.md
git status            # xem lại — phải hết "Changes not staged" sau khi add
git commit -m "feat: svc uptime + tooltip thong so + chart lich su inline & tren dashboard + panel AI keo tha (v0.1.15)"
git push origin main

# BƯỚC 2: tag SAU KHI push + SAU KHI test GUI OK (checklist trên) — CI build installer 3 OS
git tag v0.1.15
git push origin v0.1.15
# Xong: chờ Actions ~5-10 phút → Releases/v0.1.15 phải có InfraCompanion-Setup-0.1.15.exe + latest.yml
# App 0.1.14 đang cài sẽ hiện banner update sau khi mở lại (~10s)
```

**Checklist test tay trước khi push (pnpm dev, bật Monitoring vài host):**
1. **Service uptime**: card host chạy httpd/java phải có dòng `⟳ httpd 30d · java 12d` (dưới dòng net/conn); hover hiện giải thích; host không có service quen thuộc thì KHÔNG có dòng này.
2. **Tooltip**: hover từng thông số `us sy wa st r swap`, các bar Load/CPU/RAM/Disk, `↓↑`, `conn`, `[proc]` — đều có tooltip tiếng Việt, con trỏ đổi thành dấu hỏi.
3. **Chart inline**: bấm 📈 → 3 chart 1h (Load/CPU/Kết nối TCP) hiện NGAY TRONG card, tự refresh 60s; bấm 📈 lần nữa thu lại; nút "⤢ Chi tiết & 24h" mở modal đầy đủ như cũ.
4. **Dashboard 🏠**: mục "📈 Lịch sử monitoring" giữa Nhóm host và Kết nối gần đây — hiện các host từng monitor (jpap0x) kèm chart Load 24h + "lần cuối"; bấm card mở modal lịch sử; TẮT monitoring rồi mở Dashboard vẫn thấy (đọc từ metrics.db); máy chưa từng monitor → dòng gợi ý bật Monitoring.
5. **Panel AI ✨**: bôi chọn output → ✨ → panel hiện; NẮM HEADER kéo đi chỗ khác (không văng khỏi màn hình); kéo GÓC DƯỚI PHẢI phóng to; bấm –/✕ trên header vẫn hoạt động bình thường (không bị tính là kéo); đóng mở lại panel trong cùng phiên → vị trí giữ nguyên.
6. **Icon dev**: chạy `pnpm dev` → taskbar + title bar phải mang logo Infra Companion (không còn icon Electron mặc định).

> Môi trường dev: Node 20, pnpm 9, Electron 42 (Node 24 runtime — dùng `node:sqlite`), ssh2/node-pty/serialport là native nhưng đã externalize + prebuilt nên không cần build C++. Khi chạy electron từ terminal đã dính biến `ELECTRON_RUN_AS_NODE` thì thêm `$env:ELECTRON_RUN_AS_NODE=$null` cùng lệnh (chỉ là gotcha của terminal, không phải lỗi app).
