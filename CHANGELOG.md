# Changelog

All notable changes to Infra Companion are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
