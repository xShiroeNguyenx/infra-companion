# Changelog

All notable changes to Infra Companion are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
