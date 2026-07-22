# Changelog

All notable changes to Infra Companion are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.30] — 2026-07-22

### Added

- **Open Monitoring in its own tab** — besides the floating dock and the detached always-on-top window, you can now open the monitoring dashboard as a **full tab**, just like a server tab. Use **⊞ Open in tab** in the monitor config dialog, click **⊞** on the dock header, or run it from the Command Palette. Its **charts and text are noticeably larger** in a multi-column grid, so a wall of hosts is easy to read at a glance. Opening the tab **hides the floating right-side dock** (no more duplicate view), and the tab has a **minimize (–) button** that switches back to the dock — so you can flip between tab and dock at will. It reads the same live data in every mode.

### Changed

- **Shorter tool-menu labels** — the ⋯ tool menu dropped the parenthetical descriptions that cluttered each row: *"Uptime watcher (green/red dots)" → "Uptime watcher"*, *"Processes (top)" → "Processes"*, *"Services (systemd)" → "Services"*, *"Compare config (2 hosts)" → "Compare config"*, *"Sync (E2EE)" → "Sync"*. The feature screens themselves keep their descriptive titles.

### Fixed

- **Installed app no longer borrows the "Electron" name/icon on the taskbar** — the packaged app and the dev build shared one Windows AppUserModelID, so if you ever pinned the dev build once, Windows tied that identity to `electron.exe` and the installed app's taskbar button then showed the Electron name/icon and pinning it reopened the Electron welcome screen. The dev build now uses a separate AppUserModelID (`…​.dev`), so the installed app always keeps its own clean identity. (One-time cleanup on an already-affected machine: remove the stray *Electron* Start-menu shortcut and restart Explorer.)

---

## [0.1.29] — 2026-07-21

### Fixed

- **SSH "Key + Password" auth now actually completes the login** — the 2-factor method added in v0.1.28 presented the key but never sent the password against servers that require `publickey` **then** a password: the underlying SSH library walked its authentication methods once in a fixed order (`password` before `publickey`) and gave up right after the key's partial success, so the password was never sent a second time. The app now forces the correct order (key first, then password) and also answers a **PAM keyboard-interactive** password prompt — the usual case on RHEL / AlmaLinux — so `AuthenticationMethods publickey,password` (and `publickey,keyboard-interactive`) now logs in just like it does in PuTTY / OpenSSH.

---

## [0.1.28] — 2026-07-21

### Added

- **SSH "Key + Password" auth (2-factor)** — a new authentication method for servers that require *both* a public key **and** an account password in the same login (OpenSSH `AuthenticationMethods publickey,password`). Pick **SSH Key + Password** in the host (or group) editor, choose the key, and enter the password; the app presents the key first and answers the password prompt when the server asks for it. Leave the password blank to be prompted at connect time. No vault migration — it reuses the existing key/password fields.
- **Name your tunnels** — the tunnel editor now has an optional **Name** field, so a long list of port-forwards stays readable (e.g. *"Prod DB"*, *"Staging Grafana"*). The list shows the name on top with the actual route (`:port → host:port`) underneath, so you always see where a named tunnel points. Leave it blank and it falls back to the route description as before — no migration needed.

### Fixed

- **Paste no longer fires twice or ignores your custom shortcut** — the terminal's built-in browser paste ran *on top of* the customizable Paste shortcut, so Ctrl+Shift+V pasted twice and kept pasting even after you rebound Paste to a different key. The native paste is now suppressed and pasting goes through a single path: your bound shortcut (default Ctrl+Shift+V) or right-click. As a result, plain Ctrl+V no longer auto-pastes unless you bind Paste to it — matching standard terminal behavior.

---

## [0.1.27] — 2026-07-20

### Added

- **Customizable keyboard shortcuts** — a new **⌨ Keyboard shortcuts** tab in Settings lets you rebind the terminal shortcuts: **Copy selection**, **Paste**, **Find**, and **AI explain selection**. Click a shortcut, press the new combo (must include Ctrl/Alt/Meta, or be an F-key), and it applies immediately to open terminals — no restart. Esc cancels recording, a ⚠ flags conflicts, and one button resets all to defaults (Ctrl+Shift+C / V / E, Ctrl+F). Right-click paste keeps working regardless.

### Fixed

- **Empty groups can now be renamed and deleted** — groups with no hosts were hidden from the sidebar entirely, so once you created one you were stuck with it. Empty groups now show up (when you're not searching) with a subtle "no hosts yet" hint, and every group header gained a **trash button** for quick deletion (with confirmation). Deleting a group never deletes its hosts — they move to *Ungrouped*.

---

## [0.1.26] — 2026-07-20

### Added

- **Compare config across 2 hosts** — new **🔍 Compare config** in the ⋯ menu: pick two SSH hosts and a file path (by default the *same* path on both sides — the common case of the same config on many servers) and get a **side-by-side, line-by-line diff** with added / removed / changed lines highlighted, line numbers on each side, and a `+ / − / ~` summary. File contents are read over a **dedicated exec channel** (`cat`, capped at 1 MB, `test -f` guards against directories) — it never touches an open terminal and works through login-script hosts like Bulk/Processes.
- **Split: merge all *or* pick tabs** — the **Split** button now opens a small menu instead of always grabbing every open terminal: choose **Merge all** (old behavior) or tick **only the tabs you want** to combine into one split view. Splitting back and re-splitting no longer sweeps in servers you didn't want.
- **Reorder panes & choose the main window** — every split pane header gains a **⋮ menu** with **Set as main window** (promote any pane to the large slot in the *main-left* / *main-top* layouts — previously stuck on whichever pane happened to be first) plus **Move left/up** and **Move right/down** to rearrange panes freely.

### Notes

- No vault/schema migration in this release — these are UI/tooling additions only.

---

## [0.1.25] — 2026-07-19

### Added

- **TOTP 2FA autofill in login scripts** — hosts that ask for a Google Authenticator code on login can now log in hands-free: paste the account's **base32 TOTP secret** into the host editor (stored encrypted in the vault; it never leaves the main process), then use the **`{{totp}}`** token in a login-script *send* field (e.g. expect `Verification code:` → send `{{totp}}`). The app substitutes a **fresh 6-digit code at the moment the step is sent**, so slow multi-hop chains don't hand over an expired code. RFC 6238-compatible (verified against the RFC test vectors).
- **Group colors on tabs, panes and the sidebar** — give a group an accent color in the group editor (production red, staging yellow, …) and every host in it gets a colored stripe on its **tab**, its **split-pane header** and its **sidebar row** — one glance tells you which terminal is production before you type into it.
- **Background uptime watcher** — toggle **📡 Uptime watcher** in the sidebar ⋯ menu and the app TCP-checks every saved host once a minute **without opening any session**: a green/red dot next to each host in the sidebar shows reachability (hover for latency). Turns off cleanly; state is remembered.
- **Process viewer (top)** — **⚙ Processes** in the ⋯ menu / command palette: pick a host and get a live `top`-style table (CPU%, MEM%, RSS, runtime, command) over a dedicated exec channel — no terminal tab needed, login-script hosts work like Bulk. Sort by CPU or RAM, filter, optional 5s auto-refresh, and **kill** (TERM or force -9) with a confirmation.
- **Services manager (systemd)** — **🧰 Services** in the ⋯ menu / palette: list every systemd service on a host with its state, **start / stop / restart** with confirmation (root may be required — systemctl's own error is shown if not), and read the last 120 lines of **journalctl** for any unit right in the window.

### Notes

- The vault schema migrates automatically (v11: encrypted TOTP seed per host + group color). Synced vaults carry both fields; older app versions simply ignore them.
- `{{totp}}` substitution applies to interactive terminal sessions. Exec-channel features (Bulk/Monitoring/SFTP) don't substitute it — OTP prompts don't appear on those paths in practice.

---

## [0.1.24] — 2026-07-18

### Added

- **Pop the monitor panel out into its own window** — the dashboard monitor now has a **⧉ pop-out** button in its header. It opens a small, always-on-top window that keeps showing your hosts' live metrics **even when the main app is minimized** or hidden behind other windows. While popped out, the in-app dock hides so there's only one monitor on screen; move and resize the window freely, **⧉ Merge back** returns it to the in-app dock, and **■ Stop** ends monitoring from either place. It draws from the same monitoring session — no extra SSH connections are opened.
- **Pick hosts to monitor by workspace or group** — the **⚠ Monitoring** dialog has new **Quick select** chips: click a group or a saved 🗂 workspace to tick all of its SSH hosts in one go (click again to untick them), instead of hunting through the host list one by one.

### Changed

- **The app icon now fills its frame** — the logo mark used to sit small in the middle with a lot of empty space around it, so it looked tiny in the taskbar and title bar. It has been recropped to fill the icon and now reads clearly at every size.
- **The monitor panel is easier to resize** — a visible **◢** grip in the bottom-right corner makes it obvious you can drag the panel larger or smaller (both width and height).

---

## [0.1.23] — 2026-07-16

### Added

- **Split layouts** — when panes are split you can now arrange them five ways instead of only the automatic grid: **Auto grid**, **Side by side** (columns), **Stacked** (rows), **Main left** (one large pane on the left, the rest stacked beside it), and **Main top** (one large pane on top, the rest in a row below). Switch instantly from the **▼** next to the **Split ON** button, or set the default in **Settings → Terminal → Split layout**. Dragging the dividers to resize still works (for the *main* layouts you drag the main/secondary split).
- **Pane frame styles** — choose how each split pane's header looks in **Settings → Terminal → Pane frame**: **Compact bar** (status dot + title + ✕, the default) or **Mac style** (rounded window corners with a round red close button). 
- **Command palette button on the terminal toolbar** — the palette was previously reachable only via `Ctrl+Shift+P`, which many people never discover; there's now a **⌘ Commands** button on the toolbar that opens it. The shortcut still works exactly as before.

### Changed

- **The terminal scrollbar is now thin and unobtrusive** — it was stubbornly wide because xterm ≥6 draws its own overlay scrollbar (VS Code style, 14px, sized inline by JS), so the previous CSS never touched the element actually on screen. It's now slimmed to ~7px with a subtle theme-matched thumb that fades when idle. (Root cause of the earlier "the scrollbar won't shrink" was a global `scrollbar-width` rule that silently disabled all custom scrollbar styling in modern Chromium — removed.)
- **Split-pane headers are a touch smaller** so they take less vertical space, and the **Split ON** button now matches the height of the neighbouring toolbar buttons.

---

## [0.1.22] — 2026-07-15

### Added

- **AI troubleshooter now keeps a history** — every diagnosis session (its symptom, the read-only commands that ran with their output, and the final conclusion) is saved locally when it finishes, stops, or errors. Reopen the **🩺 AI troubleshooter** and past sessions appear under **Diagnosis history**: click one to review it read-only, or delete it. The last 50 sessions are kept; the steps and conclusion are **encrypted with your vault key** at rest (server output can be sensitive), so viewing history requires the vault to be unlocked.
- **The AI troubleshooter can be minimized** — while the AI is thinking or running a command you no longer have to sit and wait: press the **–** button to drop the window to a small pill (bottom-right) and keep using the rest of the app. The pill shows live status (analyzing / running / **needs your approval** / done) so you know when to click it back open; the session keeps running in the background the whole time.
- **AI troubleshooter added to the ⋯ menu** — it was previously reachable only from the command palette; it now has its own entry (🩺 AI troubleshooter) in the sidebar tools menu.

### Fixed

- **AI diagnosis conclusion no longer gets cut off mid-sentence** — the final conclusion (root cause + fix steps) is the longest part of a session and, in Vietnamese, consumes 2–3× more tokens than English, so the old fixed 1,500-token cap truncated it right where it mattered most. The diagnose output budget is raised to 4,096 tokens, and for Claude a continuation pass automatically resumes generation whenever a response is cut by the token limit — so conclusions come through complete no matter how long. The higher budget also applies to OpenAI/Gemini/Ollama (Ollama's `num_predict` was previously capped low enough to clip output).

---

## [0.1.21] — 2026-07-14

### Added

- **Sensitive command guard** — press Enter on a command that matches your watch-list (e.g. `rm -rf`) and a confirmation popup appears *before* it runs. Built for the classic accident: hitting ↑ to recall a command and running the wrong one — so the check reads the actual command line from the terminal (recalled commands are echoed by the server, not reconstructed from keystrokes), which means it catches history-recalled commands too. On by default with a sensible starter list (`rm -rf`, `rm -r`, `sudo rm`, `mkfs`, `dd if=`/`dd of=`, `shutdown`, `reboot`, `poweroff`, `halt`, writing straight to a disk device, the classic fork bomb); edit or clear the list in **Settings → Sensitive command guard**. Patterns match at a command position (literal, e.g. `rm -rf`) or as a regex when wrapped in `/…/`. The Cancel button is focused by default, so a reflexive second Enter cancels rather than running; the guard adds no per-keystroke latency and automatically stands down inside full-screen apps (vim, less, htop) so it never interrupts an editor.

### Changed

- **Settings is now a full screen instead of a small dialog** — the old modal had grown cramped, so Settings opens as a full-window screen with a left-hand category rail (Appearance, Background image, Terminal, Sensitive command guard) and a scrollable content pane, giving each group room to breathe. Everything it did before is unchanged (Esc still closes it); it's just laid out properly now.

---

## [0.1.20] — 2026-07-13

### Changed

- **Typing latency over SSH (especially multi-hop chains) is dramatically lower** — two fixes that together close most of the gap with native clients like Termius:
  - **TCP_NODELAY on the SSH socket** — the `ssh2` library never disables Nagle's algorithm, so each keystroke (a tiny packet) could sit in the OS buffer waiting for the previous packet's ACK before being sent; over a high-RTT gate this made typing feel rubber-bandy. Every connection now sets `TCP_NODELAY` on the first-hop socket, exactly like OpenSSH does for interactive sessions — this benefits terminals, SFTP, tunnels, Bulk, and Monitoring alike since they share the same chain builder.
  - **GPU-accelerated terminal rendering (WebGL)** — the terminal now renders on the GPU instead of the DOM renderer, making echo-to-glass and scrolling visibly smoother. The old reason for avoiding WebGL (stale "black frame" background when switching light/dark themes) is handled properly by clearing the glyph texture atlas on theme change; if the GPU context is lost (old drivers) the terminal falls back to the regular renderer automatically, and a new **Settings → Terminal → GPU acceleration** toggle lets you turn it off entirely.

---

## [0.1.19] — 2026-07-13

### Fixed

- **Pasting multiple lines no longer inserts blank lines between them** — right-click paste and Ctrl+Shift+V used to send the clipboard text raw; Windows clipboards carry `\r\n` line endings, and editors like vim/nano treat CR and LF as *two* newlines, so every pasted line gained an empty line after it. Both paths now go through xterm's `paste()`, which normalises line endings to `\r` (like pressing Enter) and honours bracketed-paste mode when the remote app has it enabled (vim stops cascading auto-indent on paste, too).
- **SFTP through a login script ending in `su`/`sudo` can now actually write files** — `su`/`sudo` steps that came *after* the last `ssh` hop (or a login script with no `ssh` hop at all, e.g. just `sudo -i`) were silently dropped when deriving the SFTP command, so the SFTP session ran as the plain ssh user and saving a file owned by the elevated user failed with *Permission denied*. The SFTP subsystem can't pass through `su`, so in that case the app now runs the `sftp-server` binary directly **under the target user** (probing the common distro locations: `/usr/libexec/openssh/`, `/usr/lib/openssh/`, `/usr/lib/ssh/`, `/usr/libexec/`), with the same keep-stdin password feeding used everywhere else. Login scripts whose `su`/`sudo` comes *before* the final `ssh` are unchanged.

---

## [0.1.18] — 2026-07-13

### Changed

- **AI Explain panel — long answers no longer clipped at the bottom** — the panel's max height is now computed from its *actual* top position (docked or dragged), so the bottom edge always stays inside the app frame and long explanations scroll instead of running off-screen (previously a panel dragged/docked lower than the default could extend past the window bottom, hiding the tail of the answer).
- **AI Explain panel — easier widening for long content** — a **⛶ maximize** button in the header grows the panel to near the full frame in one click (❐ restores the default size); the resize grip now allows widths up to almost the full window (was 85 vw) and a subtle **◢ mark** shows where the grip is (Chromium's native grip is invisible on dark themes). The drag-hint tooltip now mentions that the corner resizes both width *and* height.

### Added

- **Copy buttons on AI explanations** — every fenced code block (config snippets, commands…) rendered in the AI Explain panel — and in plugin panels, which share the same mini-markdown renderer — gets a hover **📋 copy** button with a "Copied ✓" confirmation, and the panel header gains a **📋 copy-all** button that copies the whole explanation as markdown.
- **Manual ↻ Reconnect after a session dies** — when a connection is lost and the 3 automatic retries fail (or a shell exits), the failure overlay now offers a **↻ Reconnect** button next to Close: one click opens a fresh session **into the same pane** — layout, split position, and broadcast membership are kept, and the previous scrollback is carried over so you can still see what happened before the drop. Each click is a full new attempt (with its own 3-retry cycle once connected); if reopening fails (host deleted, password prompt cancelled…) the overlay returns so you can try again.

---

## [0.1.17] — 2026-07-12

### Added

- **Port-forward tunnels through login-script gates** — a Local (L) tunnel whose **via host** is reached by a **login script** (nested `ssh` in a shell, e.g. `gate → jpapst04 → jpap05`) now forwards by running `nc <dest> <port>` on the innermost machine over an exec channel (the same nested-command mechanism Bulk/Monitor use), instead of `-J` `forwardOut` which those hosts reject. This lets you reach, say, a **database only pingable from the deepest hop** straight from `127.0.0.1:<local port>`. Requires `nc` on the far end (and `sshpass` on intermediate hops if they authenticate by password — same caveat as Bulk/Monitor).

### Changed

- **Edit existing tunnels** — the Tunnels dashboard gains an **Edit** button on each rule (previously only Start / Delete); it reopens the form pre-filled and updates the rule in place (a running tunnel is stopped so the next Start picks up the new config).
- **Sidebar shows the full host name when idle** — the row's action buttons (split/SFTP/VNC/duplicate/edit and the **note**) are now fully hidden until you hover, instead of reserving space and truncating the name; the note icon in particular only appears on hover.
- **Clearer "can't resolve hostname" error** — the DNS-resolution failure message now explains it's a client-side lookup and points to the fixes (set a Jump host so the name resolves on the gate, add a `hosts` mapping, or use the IP) instead of the bare "Không phân giải được hostname".

### Fixed

- **Windows taskbar icon** — the app now sets the **window icon explicitly at runtime on Windows for both dev and packaged builds** (`build/icon.ico` in dev; bundled `resources/icon.ico` via `extraResources` when packaged). Previously the packaged app set no window icon, so the running app's taskbar button fell back to the per-AppUserModelID icon — which Windows had cached as the Electron atom from earlier `pnpm dev` runs, showing the wrong icon even though the exe and Start-menu shortcut had the correct one. Note: a stale taskbar icon may still need a Windows icon-cache refresh (or reboot) to clear on a machine that ran the old dev builds.

---

## [0.1.16] — 2026-07-11

### Added

- **AI troubleshooter (F48) — step-by-step diagnosis with approval** — describe a symptom ("web returns 502", "server unusually slow") and the AI proposes **one read-only diagnostic command at a time**, with its reasoning. You **approve each step**; the command runs over a **separate SSH exec channel** (your open terminal is never touched — clean output capture, jump-host / login-script aware), the output is fed back, and the AI proposes the next step until it reaches a conclusion + suggested fix. **Read-only is enforced twice**: a system prompt that only allows information-gathering commands, plus a guard in the main process that blocks anything that writes/deletes/restarts (`rm`, `systemctl restart`, `kill`, redirection to files, package installs…) — the guard is the last line, per-step approval is the real gate. Open from the command palette (*🩺 AI troubleshooter*). Reuses the existing AI provider config (Claude / OpenAI / Gemini / Ollama).
- **Remote desktop — VNC & RDP (F13)** — connect to graphical desktops that live behind your SSH jump hosts:
  - **VNC embedded in a tab** — pure-JS [noVNC](https://github.com/novnc/noVNC) rendering the remote screen right inside Infra Companion. The main process opens a local WebSocket↔TCP bridge (bound to `127.0.0.1`, one-time token) that tunnels through the host's jump chain to the target's VNC port — so a VNC box reachable only from a gate just works. Scales to fit, prompts for the VNC password in-tab, reconnect button on drop.
  - **RDP over a tunnel** — forwards the target's `3389` through SSH (jump-host aware) to a local port and launches the OS RDP client (Windows `mstsc.exe`, with the username pre-filled) pointed at it; closing the RDP window tears the tunnel down. On macOS/Linux it opens the tunnel and tells you where to point your RDP client. A small dock lists open RDP tunnels with a **Stop** button.
  - Host editor gains **VNC / RDP** protocol options (default ports 5900 / 3389) with an optional **jump-host** chain for tunneling; open from the sidebar's 🖥️ button.
  - *Known limitation:* remote-desktop tunneling supports **jump-host chains** (SSH `-J` style); a target reachable only via an interactive **login-script gate** is not yet supported (planned).

---

## [0.1.15] — 2026-07-09

### Added

- **Service uptime on monitoring cards** — each card now shows how long well-known services have been running (`⟳ httpd 30d · java 12d` — oldest process per name, covering httpd/apache2/nginx/java/node/php-fpm/mysqld/mariadbd/postgres/redis), *alongside* the server uptime, not replacing it: server uptime tells you when the machine last rebooted (kernel patches!), service uptime tells you when Tomcat/Apache last restarted. Agentless like everything else — one extra `ps` in the same poll command; hosts where `ps`/`grep` differ simply omit the line.
- **Metric explanations on hover** — every number on a monitoring card now has a plain-language tooltip: the `us / sy / wa / st / r / swap` diagnostic row (e.g. *st = CPU stolen by the hypervisor for other VPS on the same physical host; sustained ≥10 means your provider oversold the box*), the Load/CPU/RAM/Disk bars, network rate, TCP connections, inode and top-process tags. Hover any value to learn what it means and when to worry (cursor shows *help*).
- **Inline history charts on the dashboard** — clicking 📈 on a card now expands **1-hour Load / CPU / TCP-connection charts right inside the dock** (auto-refresh every minute) instead of jumping straight to a modal; a *⤢ Details & 24h* link still opens the full history window with all metrics and ranges.
- **Monitoring history on the Home dashboard** — the 🏠 Dashboard gains a **📈 Monitoring history** section listing every server that has ever been monitored (data retained 30 days in `metrics.db`), newest first, each with its **24-hour Load chart** and last-monitored time; click a card to open the full history window. Works even when monitoring isn't currently running — it reads recorded history, so you can review yesterday's incident after a restart.
- **All floating panels are now movable and resizable** — grab the header of the ✨ **AI Explain** panel, the 📊 **Monitoring dock**, or a 🧩 **Plugin output** panel to drag it anywhere (each still starts docked in its usual corner), and drag the bottom-right corner to resize it — comfortable for reading long AI answers, watching many hosts, or wide plugin tables. Position is remembered for the session and each panel is clamped to the window so it never gets stuck off-screen. (Shared `useDraggablePanel` hook — one behaviour across all three.)

### Fixed

- **Dev-run taskbar icon** — running from source (`pnpm dev`) now shows the Infra Companion logo on the Windows taskbar and title bar instead of the default Electron icon (packaged builds already used the icon embedded in the exe).

---

## [0.1.14] — 2026-07-08

### Added

- **Monitoring 2.0 — real CPU, steal, connections, and more** — the monitor now answers *why* a server is slow, not just *that* it's slow. Each 3-second poll additionally collects: **real CPU% split into user / system / iowait / steal** (computed as deltas of `/proc/stat` between polls — sustained steal ≥10% means your VPS host is overselling CPU and is highlighted in red), **run queue** (processes waiting for CPU), **swap usage**, **all real mounts** (the fullest one is shown, e.g. `Disk /var`) plus **inode%**, **network in/out rate**, **TCP connection counts** (ESTABLISHED / TIME_WAIT — the most direct "we're being scraped" signal), and the **top CPU process** — all still agentless over the same single SSH command. The Load row stays. Load thresholds are no longer capped at 100% (normalized load on busy servers legitimately runs 300-400%+; cap is now 10 000) and its chart auto-scales; **new alert thresholds for CPU steal (default 20%) and TCP connections** (default off) join Load/RAM/Disk/offline; history charts add CPU, steal and connections.
- **Monitoring alert thresholds (F04)** — set Load/RAM/Disk % thresholds (global defaults + per-host overrides) and an offline alarm right in the Monitoring modal. Alerts fire after a sustained ~9s breach (3 polls) with a dead-band hysteresis so a metric flapping at the threshold never spams; while still breached it re-alerts every 15 minutes, and recovery is announced once. Delivery: in-app toast + **Windows notification** (default on) + optional **webhook** — paste one URL and the app auto-detects **Google Chat**, Slack, Discord or Telegram (generic JSON for anything else), with a *Send test* button. Alert rules live in `monitor-settings.json` (userData), deliberately outside the vault so alerts keep firing even while the vault is auto-locked.
- **Metrics history + charts (F32)** — monitor samples are now downsampled (1-minute buckets kept 48 h, 10-minute buckets kept 30 days, auto-pruned) into a separate unencrypted `metrics.db` (SQLite via `node:sqlite` — zero new dependencies, a few MB/month). The 📈 button on each monitoring card opens **1 h / 24 h charts** for Load (per-CPU %), RAM and Disk; offline periods show as gaps. History survives app restarts; recording only happens while monitoring runs.
- **AI explain selection (F46)** — select any output in the terminal and hit the floating **✨ Explain** button (or **Ctrl+Shift+E**): the selection goes to your configured AI provider (mode *explain-error*) and the answer appears in a minimizable dock panel on the right — no modal, keep typing while you read. Selections over 6 000 chars keep the tail (errors live at the end). If AI isn't configured yet it opens the AI settings for you.

---

## [0.1.13] — 2026-07-08

### Added

- **Dashboard home screen** — the app now boots into a **Dashboard** instead of auto-spawning a local PowerShell terminal. The dashboard is the *home screen behind your tabs*, not a tab itself: the **🏠 button** at the left of the tab bar takes you there anytime (it lights up while you're home), clicking any tab takes you back, and closing the last tab lands you home instead of an empty screen. It shows quick stats (hosts, groups, connections today / last 7 days), a **Quick connect box** (`user@host[:port]` + Enter), your **★ favorite hosts** (one click to SSH), **host group chips** (open a whole group as split panes in one click), the **recent connections** list (click to reconnect), your saved **Workspaces** (restore a full tab/split layout in one click), **Tunnels with live status and Start/Stop right on the card**, and a **keyboard-shortcut cheat sheet** — plus a *＋ New terminal* shortcut so the old one-click shell is still one click away. (Monitoring stays in its dedicated dock on the right — the dashboard doesn't duplicate it.) Also reachable from the command palette (*🏠 Dashboard*). Prefer the old behavior? **Settings → Startup page → Terminal** restores boot-to-shell (`infra.startup.page`).

- **Marketplace package signing (ed25519)** — every registry entry now carries an ed25519 signature covering `id + version + file checksums`; the app verifies it against a **public key embedded in the binary** and silently drops unsigned/tampered entries before they even appear in the Marketplace tab. This closes the "compromised registry/CDN" scenario: an attacker who can rewrite `plugins.json` (and its sha256 fields) still cannot forge signatures without the maintainer's private key, which never leaves the maintainer's machine (`~/.infra-companion/registry-signing-key.pem`, generated by `scripts/registry-keygen.mjs`; `scripts/build-registry.mjs` now refuses to build an unsigned registry). A CI test re-verifies every committed registry entry against the embedded public key, so a payload-format drift or unsigned entry fails the build.
- **Access Log Analyzer v1.4.0 — top ASN / network organization** — new section *7. Top 15 ASN_ORGANIZATION*: when the log carries GeoIP enrichment (`... | ASN_NUMBER: 45899 | ASN_ORGANIZATION: VNPT Corp`), the plugin ranks which network organizations send the most traffic; logs without that field just show a skip note. Traffic concentrated in hosting/datacenter ASNs (OVH, AWS, Tencent…) is almost certainly bots and can be blocked by ASN range; residential ISPs need more care. Command title is now "7 thông số"; registry re-signed.
- **Marketplace web page** — the plugin catalog is now browsable without the app at [`/plugins.html`](https://xshiroenguyenx.github.io/infra-companion/plugins.html) on the landing site: it renders the same signed `registry/plugins.json` (same origin, no server), one card per plugin with version/author/description and install steps. The card template already handles a future `price`/`buyUrl` field (PAID badge + Buy button) — groundwork for the paid-plugin storefront.

---

## [0.1.12] — 2026-07-07

### Added

- **Plugin Marketplace (F52, v1)** — the Plugins modal now has a **🛒 Marketplace tab**: a public JSON registry (static file on GitHub Pages — zero servers) lists community plugins; one click **installs or updates** them into your plugins folder. Safety first: every file in the registry carries a **SHA-256 checksum verified before writing**, file names are strictly validated (no path traversal), the downloaded `manifest.json` must pass the same validation as local plugins, and nothing is written unless *all* files verify. Registry is regenerated from `docs/examples/` via `node scripts/build-registry.mjs`; override the registry URL with `INFRA_REGISTRY_URL` for testing. The three sample plugins (Hello World, Output Highlighter, Access Log Analyzer) are the first catalog entries.
- **Secret scanning in CI** — new `secret-scan.yml` workflow runs [gitleaks](https://github.com/gitleaks/gitleaks) on every push/PR plus a weekly full-history sweep; complements GitHub Push Protection (which only checks new pushes against known patterns). Deliberately has no `paths-ignore` so docs/markdown are scanned too.

### Fixed

- **Plugin pill no longer covers the Monitoring dock header** — the minimized plugin pill (top-right) sat exactly on the Monitoring dashboard's `–`/Stop buttons; the dashboard now shifts down (top-14 → top-24) whenever a plugin panel is open, so both stay clickable.

---

## [0.1.11] — 2026-07-06

### Added

- **Collapsible sidebar** — the left host list can now be collapsed to a thin rail so the terminal gets the full width: the `«` button next to the search box, **Ctrl+Shift+H**, or the palette command *Collapse/expand host list*. The collapsed rail keeps a `»` button to expand; the state is remembered across launches (localStorage). Terminals re-fit automatically on toggle.
- **Resizable split panes** — the borders between panes in a split tab are now **draggable**: grab the line between two panes (cursor changes) and drag to give one pane more room; the whole column/row resizes so the grid stays aligned. Panes can't shrink below ~12% (still readable), terminals re-fit live while dragging, and **double-clicking a divider resets to equal sizes**. Sizes reset when panes are added/closed.
- **Minimizable docks** — both the plugin panel (top-right) and the Monitoring dashboard (right edge) now have a `–` button that shrinks them to a small pill: the plugin pill (`🧩 title`, top-right) restores on click and **auto-restores when the plugin pushes new content** (e.g. a section re-run finishes); the monitoring pill (`📊 n hosts`, bottom-right so the two pills never overlap) carries a status dot showing the worst host state (green/amber/red) while minimized, and monitoring keeps polling in the background.

### Fixed

- **Terminal scrollbar hidden** — the xterm viewport scrollbar took horizontal space in every pane (noticeably with 4-6 splits); it's now fully hidden. Wheel / PgUp-PgDn scrolling unchanged.

---

## [0.1.10] — 2026-07-06

### Added

- **Plugin API: `api.ui.prompt({ title?, label?, placeholder?, value? })`** — a plugin can now ask the user for one line of text via a modal dialog (same prompt pipeline as the host-key/password questions). Resolves to the entered string (may be empty) or `null` on Cancel; waits up to 120s instead of the usual 8s API timeout. Declared as the `ui.prompt` permission in `manifest.json` (v1: displayed only).
- **Plugin panels: `cmd:` action buttons** — a markdown link of the form `[label](cmd:command.id?arg)` renders as a small button that invokes that command **of the panel's own plugin**, passing the text after `?` as `ctx.arg` (URI-decoded). Command handlers receive the new optional `ctx.arg: string`. This lets a plugin build interactive reports (re-run a part, drill down) without any HTML.

### Changed

- **Access Log Analyzer v1.2.0 asks for the log path when invoked** — a dialog pre-filled with the last-used path opens first; leave it **empty to use the default** (`/etc/httpd/logs/ssl_access_log`) or type e.g. `/var/log/nginx/access.log`. The last entered path is remembered (plugin storage). Input is validated (letters, digits, `. _ / -` only) so the generated one-liner can't be broken by spaces/shell metacharacters. Editing `index.js` is no longer needed to analyze a different vhost's log.
- **Access Log Analyzer handles custom log formats with a leading vhost** — logs like `www.site.com:443 1.2.3.4 - - [...] "GET … " 200 …` (vhost:port prepended, extra `| Country Code | ASN …` fields appended) shift every column by one. The plugin now **auto-detects the offset** from the first line (column 1 is an IP → standard combined; otherwise → +1) and, when a vhost is present, prints top URLs as `vhost/path` since one file aggregates many domains. Timestamp (`[`-split) and User-Agent (`"`-split) parsing were already position-independent. A `FIELD_OFFSET` constant at the top of `index.js` overrides auto-detection for more exotic formats. The empty-file error message now lands inside section 1 (previously it was dropped by the marker parser, so a wrong path showed six silently-empty sections).
- **Access Log Analyzer v1.3.0: each panel section shows its shell command and is individually editable/re-runnable** — every section now displays the exact pipeline it ran (`$ awk … | sort | …` above the output) plus two buttons: **↻ Chạy lại** re-runs just that section on the same host/log (fresh `tail` sample), and **✎ Sửa lệnh** opens a dialog pre-filled with the current command — edit it (e.g. change `head -15` to `head -50`), press OK and only that section re-runs and updates in place. Edited commands are remembered per section (plugin storage) and also used by the next full analysis; clearing the field restores the default. Edits are validated (single line, no `!` — interactive bash history expansion would kill the whole line, no `@ALOG` marker text).

---

## [0.1.9] — 2026-07-03

### Added

- **Access Log Analyzer — third sample plugin** ([docs/examples/access-log-analyzer](docs/examples/access-log-analyzer)) — one Command Palette command analyzes the web-server access log **on the host of the active SSH session**: top 15 IPs, requests per minute (last 30 marks), top URLs, top User-Agents, status-code distribution, and what the most suspicious IP is calling — results open in a panel together with a short how-to-read guide. It types a single, fully visible shell one-liner into the session (`tail` + `awk` over the last 50 000 lines), so it works on any Linux box with no agent. Log path and sample size are constants at the top of its `index.js` (default `/etc/httpd/logs/ssl_access_log`) — edit + **Reload** to adapt to nginx etc.

### Changed

- **Plugin panels no longer block the app** — a panel now docks to the **top-right corner**, translucent (fully opaque on hover), with no backdrop: you can keep typing in the terminal while reading the result. Close it with the ✕ button; Esc is deliberately left to the terminal (vim…).
- **Monitoring dashboard is now a docked panel, independent of modals** — picking hosts and pressing *Start* closes the picker and docks a compact dashboard to the right edge (one card per host, translucent, hover to focus). It keeps monitoring while you open other modals, switch tabs or run plugins, and disappears **only when you press Stop** — previously, closing the modal (or opening any other one) silently stopped monitoring. Re-opening `⋯ → Monitoring` pre-ticks the hosts being watched; *Start* replaces the watched set.

### Fixed

- **Plugin-typed commands could be killed by bash history expansion** — the analyzer's one-liner contained a `!` inside double quotes; interactive bash expands history *before executing* (`bash: !: event not found`) and discards the entire line, so nothing ran and the plugin timed out after 30s. Generated commands no longer contain `!`.

### Notes

- Renderer + sample plugin + docs only — DB schema unchanged (still **v9**), no core/main-process changes.

---

## [0.1.8] — 2026-07-02

### Fixed

- **Monitoring & Bulk exec were broken for hosts reached through a login script** (e.g. `ssh inner-host` typed on a gate). Since v0.1.3 the internal command builder returned a full SFTP command (`ssh … -s sftp`), which Monitoring/Bulk then wrapped in *another* `ssh` — producing a garbage command whose output was empty. The dashboard showed *"Không parse được metrics (không phải Linux?)"* even for perfectly normal Linux hosts (e.g. AlmaLinux behind a gate). Both features now build the correct nested command.
- **Login-script coverage for Bulk / Monitoring now matches SFTP** — `su` / `sudo` steps and password-protected `ssh` hops (via `sshpass` on the gate) are traversed correctly instead of silently stopping at the gate host.
- **Monitoring reports the real error** — when metrics can't be parsed, the host card now shows the remote stderr (e.g. `Permission denied`, `sshpass: command not found`) instead of guessing "not Linux?".

### Internal

- Login-script → exec-command building extracted into a shared module ([packages/core/src/connection/loginScript.ts](packages/core/src/connection/loginScript.ts)) used by SFTP, Bulk and Monitoring — one code path, no more drift between the three. +10 unit tests (71 total).

---

## [0.1.7] — 2026-06-22

### Added

- **Background image from a URL** — besides picking a local file, you can now paste an **image link** in **Settings → Background image** and click **Add**. Works with direct image URLs and with **Google Drive** and **Dropbox** share links (the app rewrites them to a direct-download form automatically). The image is fetched in the main process (so it isn't blocked by browser CORS), then downscaled and stored locally as before — pasting a new link or picking a new file simply replaces the old one, so nothing piles up. Per-machine preference, not synced.

### Notes

- The link is only used to fetch the bytes once; the app never keeps the remote URL — it stores a re-compressed local copy, so the wallpaper keeps working offline. Fetches are limited to http/https, time out after 20s, cap at 25 MB, and the content is validated as a real image (by magic bytes) before use. A non-public Drive link returns an HTML page and is rejected with a clear message.

---

## [0.1.6] — 2026-06-21

### Added

- **Plugin system (v1)** — extend the app with trusted JavaScript plugins, no core changes needed. Plugins live in `<userData>/plugins/<id>/` (a `manifest.json` + a CommonJS `index.js`) and run in an isolated Node `worker_thread` (a buggy plugin can't crash the app), reaching the app only through a controlled `api` — they never touch the vault or secrets. A plugin can: **add commands** (shown in the Command Palette and the Plugins menu), **observe terminal output and write to a session**, **show a markdown/text panel**, **store its own JSON data**, and **notify**. Manage them in **⋯ → 🧩 Plugins**: enable/disable, reload after editing, open the folder, view per-plugin logs/errors, and **Rescan** to pick up newly added plugins without restarting. Ships with API docs and two example plugins.
- **Theme studio** — customize the full UI palette (background, panels, modals, inputs, hover, borders, text, danger/success/warning) per base theme in **Settings → Appearance → 🎨 Custom palette**, applied live with one-click reset. **Export / import a theme as JSON** to share or back up your look.
- **Favorite hosts** — pin hosts with the ⭐ button; pinned hosts appear in a **Favorites** section at the top of the sidebar for quick access (respects the search filter). Stored per-machine.

### Notes

- Plugin usage & API are documented in the **Plugins** section of [docs/USER-GUIDE.md](docs/USER-GUIDE.md); example plugins under [docs/examples/](docs/examples/).
- Plugin code, theme palette overrides, and favorites are stored per-machine (not part of E2EE vault sync in v1).

---

## [0.1.5] — 2026-06-20

### Added

- **Mouse copy & paste in the terminal** — select text by dragging, then **left-click inside the highlighted block to copy it** (a brief *"Copied"* toast confirms). **Right-click anywhere to paste** the clipboard at the prompt. Works in every pane and respects Broadcast mode (paste reaches all panes when broadcasting), just like the existing `Ctrl+Shift+C` / `Ctrl+Shift+V` shortcuts, which still work.

---

## [0.1.4] — 2026-06-13

### Added

- **Workspaces** — save the current layout (all tabs, split panes, and broadcast state) under a name and restore it in one click. In **⋯ → Workspaces** (or the Command Palette): *Save current layout*, then *Open* / *Rename* / *Delete* saved ones. Opening adds the layout's tabs as fresh sessions. Stored per-machine (referencing host IDs, so synced hosts resolve on any machine).
- **Notes per host** — attach an encrypted Markdown note to any host (server purpose, handoff info, app passwords…). Edit it in the host editor; hosts with a note show a 📝 button in the sidebar for a quick read-only view. Encrypted at rest in the vault and synced with the host.
- **Terminal appearance** — customize the terminal font family, font size, line height, and cursor style (block / bar / underline) in **Settings → Terminal**. Applies live to all panes and persists per-machine.
- **Custom accent color** — pick your own accent (color picker in **Settings → Appearance**); applied app-wide over the dark/light theme, with a one-click reset to the theme default.
- **tmux session resume (per-host)** — opt-in toggle in the host editor: after login the app runs `tmux new-session -A -s ic-main`, so the session lives on the server. If the network drops (or you reopen the host later), it re-attaches the still-running session and you resume where you left off. Requires tmux on the server.

### Notes

- Vault schema migrated to **v9** (`hosts.notes_enc` for notes, `hosts.tmux` flag); both fields participate in E2EE sync.

---

## [0.1.3] — 2026-06-13

### Added

- **Background image** — set a wallpaper that fills the whole window behind the UI. In **Settings → Background image**: pick an image (auto-downscaled and stored locally), then tune **opacity**, **blur**, **fit** (cover / contain), and **position** (center / left / right / top / bottom). Chrome panels (sidebar, tab bar, status bar, toolbar) become translucent so the image shows full-frame, while modals and menus stay opaque for readability. Per-machine preference — not synced.
- **Open a whole group at once** — a grid button on each group header (and an *Open group* entry in the Command Palette) opens every host in that group as split panes in a single tab, ready for Broadcast. Ideal for monitoring a cluster side by side.

### Changed

- **Split button redefined** — it now **merges** all open terminal tabs into panes within one tab (so Broadcast spans them), and toggles back to separate tabs on a second click. Terminal scrollback is preserved across merge/split. *(Previously it tiled separate tabs side by side, where Broadcast couldn't reach across tabs.)*

### Dependencies

- Added `@xterm/addon-serialize` — snapshots the terminal buffer so scrollback survives when panes are re-parented during merge/split.

---

## [0.1.2] — 2026-06-12

### Added

- **Internationalization (i18n)** — full UI translation in Vietnamese 🇻🇳, English 🇬🇧, and Japanese 🇯🇵; missing keys fall back to Vietnamese automatically.
- **Settings modal** — accessible via `⚙ Settings` in the sidebar menu; lets users switch theme and language without restarting.
- **Dark / Light theme** — two built-in themes persisted to `localStorage`; applied immediately on change with no flash on reload.
- **Themed terminal colors** — dark terminal uses Tokyo Night palette; light terminal uses GitHub Light palette, both matched to app background.
- **Settings store** (`useSettingsStore`) — Zustand store that reads/writes `infra.theme` and `infra.lang` in `localStorage`; initial values applied before React mounts to avoid color flicker.

### Changed

- All UI components (30+) refactored to use the `useT()` i18n hook — every visible string now comes from the `vi/en/ja` dictionary.
- Terminal theme now tracks the global theme setting in real time (hot-switch dark ↔ light without reconnecting).
- `electron.vite.config.ts` minor cleanup.

---

## [0.1.1] — 2026-06-07

### Added

- Official Infra Companion logo as app icon (replaces Electron default).

### Fixed

- CI race condition: GitHub Actions now creates the release before parallel build jobs start, so all artifacts attach to the same release.
- `executableName` added to `electron-builder` config — avoids `@` character in Linux/macOS output paths.
- `pnpm/action-setup` no longer pins `pnpm` version in CI (conflicted with `packageManager` in `package.json`).
- Added `contents: write` permission to the release workflow so artifacts can be uploaded.

---

## [0.1.0] — 2026-06-05

### Added

Initial public release of **Infra Companion** — a modern SSH client desktop app (Electron + React).

**Core features:**
- Encrypted vault (AES-256-GCM, master password, optional Windows DPAPI auto-unlock).
- SSH connections with password, SSH key, SSH agent, or secret-manager references (1Password `op://`, Bitwarden `bw://`).
- Serial / COM port connections.
- Multi-tab terminal with split panes and broadcast mode (type once → all panes).
- Jump host chains (multi-hop SSH).
- Group inheritance (default username / auth / env per group).
- SFTP file manager with upload, download, rename, chmod, inline editor (auto-upload on save).
- Port-forwarding tunnels (Local, Remote, Dynamic/SOCKS5).
- Bulk execution — run a command across N hosts in parallel, group results by diff.
- Monitoring dashboard — CPU / memory / disk via SSH (no agent required, Linux only).
- Network Toolbox — ping, DNS lookup, common-port scan.
- Snippets with variable interpolation (`{{var}}`).
- Session recording (asciicast) and log-to-file.
- E2EE sync via shared folder (Syncthing, Google Drive, Dropbox, OneDrive…).
- AI assistant (Anthropic Claude API, bring-your-own key).
- Command palette (Ctrl+Shift+P).
- Import from `~/.ssh/config`.
- Auto-update (electron-updater).
