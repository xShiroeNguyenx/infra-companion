# Infra Companion — User Guide

> A next-generation desktop SSH client: everything Termius does, plus a lot more (local-first, self-hosted E2EE sync, bulk exec, monitoring, multi-provider AI…).
> This guide covers how to use — and how to test — the features of the **current release**. For upcoming features see [../ROADMAP.md](../ROADMAP.md).

---

## 0. Running the app

From the repo root `infra-companion`:

```bash
pnpm dev      # DEV — hot reload, code changes apply live (recommended while developing)
pnpm start    # Run the built version (run "pnpm build" first if you changed code)
pnpm build    # Production build into out/
pnpm dist     # Package an installer into release/
pnpm test     # Core tests: crypto / sync merge / ssh_config parser (merge needs Node >= 22.5; Node 20 auto-skips)
```

> ⚠️ Don't run `npx electron .` from the repo root — the app lives in `apps/desktop`. Use `pnpm dev`/`pnpm start`, or `npx electron apps/desktop`.

---

## 1. Vault (encrypted store) — the first screen

**What it is**: every host / password / SSH key is encrypted with a **master password** (argon2id → AES‑256‑GCM). No master password = the data can't be read. Local-first, no cloud account required.

**Use**:
- First time: set a master password (≥ 8 chars). Tick **"Remember on this machine"** to auto-unlock via Windows DPAPI / macOS Keychain (no re-typing).
- Lock now: the **🔒 Lock vault** button in the bottom status bar. Auto-locks after 15 minutes idle (unless "remember" is on).

**Test**: create a vault → add a host → quit the app → reopen. If you did **not** tick remember, the app asks for the master password; a wrong one is rejected.

---

## 2. Managing Hosts / Groups / Keys

### Host
- Left sidebar → **+ Host**. Fill in name, hostname/IP, port, username, auth method.
- Click a host to connect; hover to reveal **⭐ pin**, **split** (⊟), **SFTP** (📁), **edit** (✏).
- **Notes**: the host editor has a **Notes** field (Markdown, **encrypted** in the vault) — record the server's purpose, handoff info, app passwords… Hosts with a note show a **📝** button in the sidebar for a quick read-only view; synced with the host.
- **Favorite hosts**: hover a host → click **⭐** to pin it. Pinned hosts appear in a **★ Favorites** section at the very top of the sidebar for quick access (still filtered by the search box). Click ⭐ again to unpin. Stored **on this machine** (not synced). *Test: pin a host → it shows under ★ Favorites at the top; it persists across app restarts.*

### Authentication — 6 methods
| Method | When to use |
|--------|-------------|
| **Password** | Type a password; leave empty = prompt on every connect |
| **SSH Key** | Pick a key imported/generated in the Keys panel |
| **SSH Agent (OS)** | Use the Windows/OpenSSH agent or Pageant (incl. FIDO2 sk-keys) |
| **Secret manager** | Fetch the password from 1Password/Bitwarden/Vault at connect time (see §14B) |
| **No authentication** | Server lets you straight in (auth none / empty password) |
| **(inherit from group)** | Use the group's default configuration |

### Keys (the **Keys** button)
- **Generate a new key**: creates an ed25519 pair; the private key is encrypted in the vault. Click **Copy pub** to paste into `~/.ssh/authorized_keys` on the server.
- **Import a key**: paste a private key (OpenSSH/PEM/PuTTY), enter a passphrase if any.

### Groups + inheritance
- Menu `⋯` → **Create group**. Set defaults: username / auth method / key / env / startup snippet.
- Hosts in the group that leave those fields empty **inherit** from the group.
- **Test inheritance**: create a group "Production" with default username `deploy` → create a host with username left blank → connect and it uses `deploy`.

---

## 3. Advanced SSH connections

### Quick Connect
Type `user@host` or `user@host:port` directly into the sidebar search → Enter to connect immediately (no need to save a host). The 50 most recent connections appear under **Recent**.

### Jump host (multi-hop ProxyJump)
- Edit host → **Advanced** → add jump hosts in order. Equivalent to `ssh -J hop1,hop2 target`.
- Each hop verifies the host key and prompts for its own password if needed.
- **Note**: this kind of jump authenticates **from your machine** through a tunnel. If the target only accepts a key already present **on the gate** (and won't accept your credentials from outside) → use **Login script** below instead.

### Login script (su → ssh, or nested ssh) — not in Termius
- Edit host → **Advanced** → **Login script** → the **"Template: su → ssh"** button, or add steps yourself.
- Each step: **wait for a string** (e.g. `assword`, `$`) → **send a command**. Tick 🔒 if it's a password (encrypted in the vault).
- Real example (web-01 via a gate):
  - Host `web-01`: hostname = `gate.example.com` (gate), auth = the gate's.
  - One-step login script: wait for `$` → send `ssh deploy@web-01`.
  - On connect → the app SSHes into the gate then types `ssh web-01` → you land directly. Re-runs on auto-reconnect too.

### tmux — auto-resume the session on network drops (per-host)
- Edit host → **Advanced** → tick **"tmux — auto-resume session on drop"**. After login the app runs `tmux new-session -A -s ic-main`.
- Network drops → the app reconnects → **re-attaches** the still-running tmux session on the server (running commands/server-side scrollback intact). Even if the app gave up after 3 retries, **reopening the host** re-attaches it.
- **Requires**: `tmux` installed on the server. Note: the startup snippet runs in the shell **outside** tmux; opening the same host in 2 tabs "mirrors" (same tmux session).

### Other
- **Agent forwarding** (`ssh -A`), **env vars** (sent after login), **startup snippet** (auto-runs after login) — all under Advanced.
- **known_hosts (TOFU)**: the fingerprint is shown for verification on first connect; if the host key changes → a red alert (anti-MITM).
- **Auto-reconnect**: on a drop, it retries 3 times (yellow status in the terminal).

---

## 4. SFTP (file transfer)

**Open**: hover a host in the sidebar → click the 📁 icon.

- Two panes: **Local** ↔ **Remote**. Double-click a folder to enter; `↑` goes to parent, `⟳` refreshes, `+📁` makes a new folder.
- The **→** button uploads, **←** downloads (recursive for folders). A transfer queue + progress sits at the bottom.
- Rename, delete (recursive), **chmod** (octal), and **✏ Edit** — opens the remote file in your default editor, and **saving auto-uploads** it.

### SFTP over an inner host (nested-ssh) — a standout
For a host reached via the login script `ssh deploy@web-01`, SFTP **enters web-01 itself** (doesn't stop at the gate) by running `ssh deploy@web-01 -s sftp` on the gate. No extra configuration.

**Test**: open SFTP for `web-01` → the Remote pane should be `/home/deploy` **on web-01**, not the gate's.

---

## 5. Terminal & Multi-pane

| Feature | How |
|---------|-----|
| **New tab** (local) | `Ctrl+Shift+T`, or the `+` button (chevron to pick a shell: PowerShell/cmd/Git Bash/WSL) |
| **Add a pane to a tab** | `Ctrl+Shift+D` adds a local pane; the **⊟** icon on a sidebar host opens it into a new pane of the current tab |
| **Merge tabs ⇄ split** (the **⊞ Split** button) | Click **⊞ Split** in the toolbar: merge **ALL open terminal tabs** into panes within one tab (so Broadcast spans them); click again to split back into separate tabs. Scrollback is preserved across merge/split |
| **Open a whole group** | The **grid** button on a group header in the sidebar (or the **Open group** command in the Command Palette): opens every host in the group as pre-split panes in one tab — ready for Broadcast |
| **Resize panes** | **Drag the divider** between panes (whole column/row resizes); **double-click** a divider to reset to equal sizes |
| **Broadcast** | The **📡 Broadcast** button or `Ctrl+Shift+B`: type in one pane → it's sent to **ALL panes** in the tab |
| **Switch tabs** | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| **Close tab/pane** | `Ctrl+Shift+W`, or `✕` on the tab/pane, or middle-click the tab |
| **Find in terminal** | `Ctrl+F` |
| **Copy / Paste** | `Ctrl+Shift+C` / `Ctrl+Shift+V` |
| **Copy with the mouse** | Select text → **left-click inside the highlight** = copy (a *"Copied"* toast confirms) |
| **Paste with the mouse** | **Right-click** anywhere in the terminal = paste the clipboard at the cursor (respects Broadcast) |
| **Wheel prints `65;53;18M…` garbage?** | A remote program left xterm **mouse reporting** on (or an escape sequence sneaked in while `cat`/`tail`-ing a log). Type `reset` in that shell to clear it; holding **Shift** while scrolling always bypasses mouse reporting |

### Test Broadcast (the "type once, run on many servers" feature)
1. Open SSH to web-01. 2. Hover web-02 in the sidebar → click **⊟ split** → two panes side by side.
3. Click **📡 Broadcast ON**. 4. Type `uptime` → both panes run it.

> Faster: put web-01 + web-02 in the same group → click the **grid** button on the group header → both open as panes → turn **Broadcast ON**. Or, if you already have several separate tabs, click **⊞ Split** to merge them all into panes in one tab.

---

## 5B. Appearance & background — `⋯` → Settings

- **Theme**: Dark / Light. **Language**: Tiếng Việt / English / 日本語. Changes apply instantly and persist across launches.
- **Background image**: set a wallpaper that shows faintly behind the **whole window** (behind both the sidebar and the terminal); chrome (sidebar/tabs/status) becomes translucent to reveal it, while modals/menus stay opaque for readability. Two ways to set it:
  - **Choose image…** — pick a local file.
  - **Paste an image link** in the box and click **Add** — works with direct image URLs (e.g. ending in `.jpg`/`.png`) and with **Google Drive** / **Dropbox** share links (the app rewrites those to a direct-download form for you). For Google Drive, set the file's sharing to **"Anyone with the link"** first — a private link returns a login page and is rejected. The link is fetched once in the background; only a local compressed copy is kept (so the wallpaper still works offline).

  Then adjust:
  - **Fit**: *Cover* (fills, may crop) / *Contain* (shows the whole image, no crop).
  - **Position**: Center / Left / Right / Top / Bottom.
  - **Opacity** (5–100%) and **Blur** (0–24px) — lower opacity or raise blur if text is hard to read over a bright image.
  - **Remove** to clear the background.
- The image is auto-compressed and stored **on this machine** (not synced) — everyone picks their own. Switching to a different image or link replaces the previous one (nothing accumulates).
- **Accent color**: a color picker sets your own accent (primary buttons, selection borders…) on top of the dark/light theme; a Reset button restores the default.
- **🎨 Custom palette (Theme studio)**: a collapsible section in Settings → Appearance to customize **11 UI colors** (Background, Sidebar/bars, Modals, Inputs, Hover, Borders, Text, Muted text, Danger, Success, Warning). Click a swatch to change it → **applied live**. Overrides are stored **separately per theme** (dark and light), so toggling Dark↔Light stays correct. The **✕** next to a color clears that override; **Reset to default** clears them all.
  - **Export / Import theme**: click **Export / Import theme** → a JSON box shows the current theme (accent + palette). **Copy** to share/back up; paste another JSON and **Apply** to load it. (Stored on this machine, not synced.)
- **Terminal**: adjust **font size**, **line height**, **cursor style** (block/bar/underline) and **font family** (a CSS font name using an installed font; a ↺ button restores the default). Applies instantly to all panes.

---

## 5C. Workspaces (save & restore a layout) — `⋯` → Workspaces

**What it is**: save your current layout (all tabs + split panes + Broadcast state) as a named workspace and restore it in one click. Great for repeating familiar layouts (e.g. "Monitor cluster" = web-01+02 pre-split + Broadcast).

**Use**:
- Open the tabs/splits you want → `⋯` → **Workspaces** → name it → **Save**.
- Restore: pick a workspace → **Open** (adds to your current tabs). **✏** renames, **✕** deletes.

**Notes**:
- Opening a workspace creates **fresh SSH sessions** (re-login, no old scrollback).
- Opening **adds** tabs (doesn't close current ones) — opening twice doubles the tabs.
- Stored **on this machine** (not yet synced); it only references hosts by ID, so any host synced to another machine can be opened there. A deleted host's pane is skipped (a soft error), without blocking the other panes.

**Test**: open web-01, split in web-02, turn on Broadcast → Save as "ST monitor" → close all tabs → Workspaces → Open "ST monitor" → both panes reopen side by side with Broadcast already on.

---

## 6. Telnet & Serial

- Edit/Add host → **Protocol**: **Telnet** (host + port 23) or **Serial (COM/USB)**.
- Serial: a dropdown **auto-lists connected COM ports** + pick a **baud rate** (9600…230400). For switch/router consoles over a USB-serial cable.
- **Test Serial**: plug in a USB-serial cable → add a Serial host → pick the port → connect → press Enter to see the device prompt.

---

## 7. Session logging

- On the tab toolbar: the **⏺ Log** button → writes the selected pane's entire output to `…/logs/<timestamp>_<name>.log` (ANSI codes stripped).
- Command Palette → **📂 Open session log folder** to view files.
- **Test**: turn on ⏺ → type a few commands → open the log folder → check the contents.

---

## 7B. Session Recording & Replay — `⋯` → Recordings

**What it is**: record a terminal session as **asciicast v2** (the asciinema standard) — raw + timing — to **replay like a video**. Different from logging (plain text for grep).

**Record**: tab toolbar → the **⏯ Record** button (next to ⏺ Log). Turn on → records to a `.cast` file.
**Replay**: `⋯` → **⏯ Recordings** → pick one → **▶ Replay** → a player with **play/pause (⏸/▶)**, **restart (↺)**, a **seek bar**, and **1x/2x/4x/8x speed**.
**Export**: 📂 Open folder → the `.cast` file opens with `asciinema play` or the web asciinema-player.

**Test**: open a terminal → ⏯ Record → type `ls`, `top` then `q` → stop recording → Recordings → Replay → try the seek bar + 4x.

---

## 8. Snippets (saved commands)

- Menu `⋯` → **Snippets**. Create a snippet with `{{variable}}` placeholders.
- Run: the **⚡** button on the tab toolbar → pick a snippet → fill in variables → tick target panes → **Run** (multi-session).
- **Test**: snippet `sudo systemctl restart {{service}}` → run with `service=nginx` across several sessions.

---

## 9. Tunnels (port forwarding) — `⋯` → Tunnels

| Type | Meaning |
|------|---------|
| **L (Local)** | A port on your machine → through SSH → destination (e.g. reach a remote DB as if local) |
| **R (Remote)** | A port on the server → back to your machine |
| **D (Dynamic)** | A local SOCKS5 proxy — browse the web through the server |

**Test SOCKS5**: + Tunnel → host `gate-01`, type **Dynamic**, bind `1080` → **Start** (green dot) → set SOCKS5 `127.0.0.1:1080` in your browser → traffic goes through the gate.
**Test Local**: type L, bind `13306`, dest `127.0.0.1:3306` → connect MySQL to `127.0.0.1:13306`.

---

## 10. Bulk Execution (run a command across hosts) — `⋯` → Bulk Execution

**What it is**: run one command across N hosts **in parallel** (up to 8 at once), grouping output to spot divergent machines.

**Use**: tick hosts → type a command (`uptime`, `df -h /`…) → **⚡ Run**. Results show in a grid; enable "Group by output" to cluster machines returning the same result, with outliers flagged yellow **"(differs?)"**. While running there's a **Cancel** button (closes connections, stops queued hosts); closing the modal mid-run also cancels.

**Runs through login scripts**: for a host reached via `ssh deploy@web-01`, the command runs **on web-01 itself** (the app does `ssh deploy@web-01 '<cmd>'`), not the gate.

**Test**: tick all 3 hosts → type `hostname; uptime` → each machine returns **its own** hostname (web-01/02 differ from the gate).

> Since v0.1.8 this matches SFTP: `su` / `sudo` steps and password-protected `ssh` hops are traversed too (password hops need `sshpass` installed on the gate).

---

## 11. Monitoring Dashboard — `⋯` → Monitoring

**What it is**: track **CPU load / RAM / disk / uptime** in real time, **no agent required** (reads `/proc` + `df` over SSH every 3s). Linux only.

**Use**: pick hosts → **Start monitoring** → the picker closes and a compact dashboard **docks to the top-right corner** — one card per host: a load sparkline + Load/RAM/Disk bars (red >90%, yellow >70%) + uptime. The dock is translucent (hover to focus) and doesn't block anything: keep working in the terminal, open other modals, switch tabs — monitoring continues until you press **Stop** on the dock. Press **–** to minimize it to a `📊` pill at the bottom-right: polling continues, and the pill's status dot shows the worst host state (green OK / amber connecting / red error) — click the pill to restore. Auto-reconnects on drop. Re-opening `⋯ → Monitoring` pre-ticks the hosts being watched; **Start** replaces the watched set.

**Runs through login scripts**: like Bulk — web-01/02 measure the inner machine, not the gate.

**Troubleshooting**: if a card says metrics can't be parsed, the message includes the remote error (e.g. `Permission denied`, `sshpass: command not found`) — that tells you which hop failed.

**Test**: pick web-01 + web-02 → Start → see each machine's own numbers.

---

## 12. Network Toolbox — `⋯` → Network Toolbox

Purely local, no SSH. Enter a host/IP then:
- **Ping** (latency), **DNS lookup** (A/AAAA/PTR), **Common-port scan** (16 ports: SSH/HTTP/MySQL/RDP/Redis…).
- **Test**: ping `1.1.1.1`; scan `gate.example.com` to see whether port 22 is open.

---

## 13. E2EE Sync (multi-machine) — `⋯` → Sync

**What it is**: encrypt the whole vault into a single blob and push it to a **shared folder you already use** (Google Drive / Dropbox / OneDrive / Syncthing / network share). The backend **only ever sees an encrypted blob** (zero-knowledge). Termius forces you onto their cloud — this is self-hosted.

**Use**:
1. Pick a sync folder → set a **sync passphrase** (≥8 chars, **the same on every machine**, can differ from the master password) → enable sync.
2. On another machine: same folder + same passphrase → data converges (Last-Write-Wins merge + tombstones for deletes).

**Quick single-machine test**: point at `D:\sync-test` → enable sync → open the `infra-companion-vault.blob` file there: it's all encrypted bytes, no readable host/password = zero-knowledge confirmed.

> ⚠️ Forgetting the sync passphrase = the data in that folder is lost (unrecoverable).

---

## 14. AI Assistant — `Ctrl+I` or `⋯` → AI Assistant

**What it is**: generate commands from natural language, explain commands/errors. **4 providers**: Claude / OpenAI / Gemini / **Ollama (local — 100% private)**.

**Configure** (⚙): pick a provider → model → API key (encrypted in the vault; Ollama needs no key).
| Provider | Default model | Notes |
|----------|---------------|-------|
| Claude | `claude-opus-4-8` | key `sk-ant-…` |
| OpenAI | `gpt-4o-mini` | key `sk-…` |
| Gemini | `gemini-2.0-flash` | key `AIza…` |
| Ollama | `llama3.1` | local, needs `ollama serve` |

**3 modes**:
1. **Generate command** — type in plain language ("find the 5 biggest files in /var/log") → the AI returns a command + explanation → the **↵ Insert into terminal** button (writes to the open pane, **does NOT auto-run** — you review then press Enter).
2. **Explain command** — paste a command → a part-by-part explanation + risks.
3. **Explain error** — paste output/an error → diagnosis + how to fix.

**Test**: configure Gemini → Generate command "kill the process on port 8080" → open a terminal tab → Insert into terminal.

---

## 14B. Secrets Manager (fetch passwords from 1Password/Bitwarden/Vault)

**What it is**: don't store passwords in the app — store only a **reference**, and the app calls the secret manager's CLI to fetch the password **right at connect time**.

**Use**: Edit host → Auth = **Secret manager** → enter a reference:
| Syntax | Secret manager | CLI called |
|--------|----------------|-----------|
| `op://Vault/web-01/password` | 1Password | `op read "op://…"` |
| `bw://<item-id-or-name>` | Bitwarden | `bw get password <item>` (needs `BW_SESSION`) |
| `vault://secret/web-01#password` | HashiCorp Vault | `vault kv get -field=password secret/web-01` |

**Requires**: the matching CLI (`op`/`bw`/`vault`) **installed + logged in** on your machine and on PATH. Bitwarden needs to be unlocked with `BW_SESSION` in the environment; Vault needs `VAULT_ADDR`/token.

**Test**: install + sign in to `op` → create a host with auth = Secret manager, ref `op://Personal/test/password` → connect → the app fetches the password. If the CLI isn't installed/signed in → a clear error (no hang).

---

## 15. Import from ssh_config — `⋯` → Import

Pick your `~/.ssh/config` → it creates hosts, **preserves multi-hop ProxyJump**, imports IdentityFile (dedupes keys), and warns if needed. The group is named `ssh_config (date)`.

---

## 16. Command Palette — `Ctrl+Shift+P`

Type to reach any action (keyboard-first): SSH/SFTP/Split to any host, open a local terminal, toggle broadcast, open Bulk/Monitor/AI/Sync/Tunnels/Snippets/Keys/**Plugins**, open the log folder, lock the vault. ↑↓ to choose, Enter to run. Commands registered by **plugins** also appear here (hinted `plugin`).

---

## 16B. Plugins (extend the app) — `⋯` → 🧩 Plugins

**What it is**: extend the app with **JavaScript plugins** without touching the core — add Command Palette commands, observe/automate terminal output, and show info panels.

> **Trust model**: a plugin is JS that **you/your team install yourself** (not a marketplace). Each plugin runs in a shared Node `worker_thread` — **fault-isolated**, so a crashing plugin can't take down the app — and **only reaches the app through the `api`** object; a plugin **cannot** read the vault or secrets. Because it's a trust model, the sandbox does not defend against deliberately malicious code → only install plugins you trust.

### A. Install & manage

Each plugin is a folder under `<userData>/plugins/<plugin-id>/`:
```
<userData>/plugins/<plugin-id>/
  manifest.json     # required — metadata + contributions
  index.js          # required — CommonJS (module.exports.activate)
  data.json         # created automatically when you use api.storage
```
`<userData>`: Windows `%APPDATA%\<app name>\plugins` · macOS `~/Library/Application Support/<app name>/plugins` · Linux `~/.config/<app name>/plugins`.

**Quick install of the 3 sample plugins** (in the repo at `docs/examples/`):
1. `⋯` → **🧩 Plugins** → **📂 Open plugins folder** (opens the exact folder — don't guess the path).
2. Copy `docs/examples/hello-world`, `docs/examples/output-highlighter` and `docs/examples/access-log-analyzer` into it.
3. Click **↻ Rescan** (or close/reopen the modal) — **no app restart needed**.

**The Plugins modal** (`⋯` → 🧩 Plugins): each plugin has a status badge (**Active** / Disabled / Failed / Crashed / Loading), plus:
- **Enable / Disable** — disabling removes the plugin's commands from the Palette; remembered across launches (`state.json`).
- **↻ Rescan** — detect newly copied-in plugins (opening the modal rescans too).
- **Reload** — reload the **code** after you edit a file (no restart).
- **📂 Open plugins folder**.
- The **▼** arrow expands to view the plugin's latest **Error** + **logs**.

### B. Using plugins

- **Commands**: `Ctrl+Shift+P` → type a plugin command name (hinted `plugin`) → Enter. E.g. the sample *Hello World*: the **"Hello: Say hi"** command opens a markdown **panel**.
- **Panel**: markdown/text content a plugin produces (reports, tables…) — docks to the **top-right corner**, translucent (hover to focus), and doesn't block the terminal: keep typing while reading. Close with **✕**, or minimize with **–** to a small `🧩` pill (click to restore; it also restores automatically when the plugin pushes new content). Esc is left to the terminal.
- **Toast**: a plugin can raise a short notification (e.g. *Output Highlighter* warns when it sees "error" in the terminal).
- **Light automation**: a plugin can listen to terminal output and write a command into the open session (e.g. the "Highlighter: send echo to active session" command).
- **Real-world sample — *Access Log Analyzer***: SSH into a web server (root helps for reading the log), then run **"Access log: Phân tích 6 thông số"** from the Palette. It types one visible shell one-liner into the session and opens a panel with 6 stats: top 15 IPs, requests/minute, top URLs, top User-Agents, status codes, and what the most suspicious IP is calling — plus a short how-to-read guide. When invoked it first asks for the **log path** in a small dialog — leave it empty to use the default (`/etc/httpd/logs/ssl_access_log`), or type e.g. `/var/log/nginx/access.log`; the last entered path is remembered for next time. It handles both the standard combined format and custom formats with a **leading vhost** (`www.site.com:443 1.2.3.4 - - [...]`) — the column offset is auto-detected from the first line, and with a vhost present the top-URL sections print `vhost/path` (one file often aggregates many domains). Each panel section shows the exact shell pipeline it ran and has **↻ re-run** / **✎ edit-command** buttons: edit opens a dialog pre-filled with the current command (clear it to restore the default), and only that section re-runs and updates in place; edited commands persist and are reused by the next full analysis. The default path, sample size (50 000 lines) and a `FIELD_OFFSET` override live at the top of its `index.js` — edit + **Reload** for exotic formats.

### C. Writing a plugin

`index.js` (CommonJS) exports `activate(api)` (required) and `deactivate()` (optional):
```js
module.exports.activate = (api) => {
  // register commands, subscribe to output… (sync or async both fine)
}
module.exports.deactivate = () => {
  // clean up on disable/reload (unsubscribe…)
}
```
- `activate(api)` runs when the plugin is enabled; it has a **10s timeout** (hanging longer → **Failed** status).
- Errors in `activate`/handlers/`onData` are caught and logged, and **don't** affect other plugins.

**manifest.json**:
```jsonc
{
  "id": "my-plugin",            // REQUIRED: kebab-case, MUST equal the folder name
  "name": "My Plugin",          // REQUIRED: display name
  "version": "1.0.0",           // REQUIRED: semver
  "description": "…",           // optional
  "main": "index.js",           // optional (default index.js); must stay inside the plugin folder, .js
  "permissions": ["terminal.observe","terminal.write","ui.panel","ui.notify","storage"], // v1: declared/displayed only
  "contributes": { "commands": [ { "id": "my.hello", "title": "My: Say hi" } ] }  // id is "group.name"
}
```
An invalid manifest → the plugin shows a **Failed** status (with the message when you expand ▼), and **doesn't** crash the app.

**The `api` object** passed to `activate(api)`:
| API | Kind | Description |
|-----|------|-------------|
| `api.id` | `string` | the plugin id |
| `api.commands.register(id, title, handler)` | sync | Register a command; `handler(ctx)` runs when invoked from the Palette or a panel `cmd:` button. `ctx.activeSessionId?: string`, `ctx.arg?: string` (the part after `?` in a `cmd:` link). |
| `api.terminal.onData(cb)` | sync → `() => void` | Listen to output of all sessions: `cb({ sessionId, data })`. Returns an unsubscribe fn. **Observe-only.** |
| `api.terminal.write(sessionId, data)` | async | Send text/a command into a session (as if typed). |
| `api.terminal.getActiveSessionId()` | async → `string \| null` | The currently active terminal session. |
| `api.ui.showPanel({ title, markdown?, text? })` | async | Open a panel showing `markdown` (safe subset) or plain `text`. |
| `api.ui.notify(message)` | async | Show a short toast. |
| `api.ui.prompt({ title?, label?, placeholder?, value? })` | async → `string \| null` | Ask the user for one line of text via a modal. Returns the entered string (may be empty), or `null` if the user cancelled. Waits up to 120s (not the usual 8s). |
| `api.storage.get(key)` / `api.storage.set(key, value)` | async | Read/write JSON private to the plugin (`data.json`). |
| `api.log(...args)` | sync | Write to the log (view in Plugins → ▼). |

> **async** functions return a `Promise` (round-tripped through main, 8s timeout; `ui.prompt` waits 120s) — remember to `await`. `register`/`onData`/`log` are sync. `showPanel` markdown supports: `#`/`##`/`###`, `**bold**`, `*italic*`, `` `code` ``, code blocks, `- ` lists, `http(s)` links, and **action buttons** `[label](cmd:command.id?arg)` that invoke a command of the same plugin with `ctx.arg` set to the (URI-decoded) text after `?`; **no** raw HTML.

**Example** — observe output → notify + send a command:
```js
let off = null
module.exports.activate = (api) => {
  off = api.terminal.onData(({ data }) => {
    if (/error|fail/i.test(data)) void api.ui.notify('⚠ Saw "error" in the terminal')
  })
  api.commands.register('hl.echo', 'Send echo to active session', async () => {
    const id = await api.terminal.getActiveSessionId()
    if (id) await api.terminal.write(id, 'echo hi\n')
  })
}
module.exports.deactivate = () => { if (off) off() }
```

**Constraints & tips when writing**:
- No direct access to the vault/secrets/hosts — only through `api`.
- Use `__dirname`/`__filename` (point to the plugin folder); **don't** rely on `process.cwd()` (it's the app's cwd).
- Need external libraries? The plugin must **bundle its own `node_modules`**.
- Output is only forwarded to a plugin while one is subscribed (nobody listening → zero cost).

### D. Out of scope for v1 (planned for v2)
New connection protocols (pluggable SessionKind) · permission enforcement + consent dialogs · transforming the output stream (currently observe-only) · arbitrary React panels / a marketplace.

---

## 17. Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+I` | AI Assistant |
| `Ctrl+Shift+T` | New local terminal tab |
| `Ctrl+Shift+W` | Close current tab |
| `Ctrl+Shift+D` | Split an extra local pane |
| `Ctrl+Shift+B` | Toggle Broadcast |
| `Ctrl+Shift+H` | Collapse/expand the host sidebar (more room for the terminal) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Switch tabs |
| `Ctrl+F` | Find in terminal |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copy / Paste |
| Left-click inside a selection | Copy the highlighted text |
| Right-click in the terminal | Paste the clipboard at the cursor |
| `Esc` | Close the open modal |

> Every delete action (host/key/snippet/tunnel/recording/file in SFTP) asks for confirmation before deleting permanently.

---

## 18. Known limitations of the current release

- **Bulk/Monitor/SFTP over a login script** rebuild the path non-interactively: `ssh` hops (password hops need `sshpass` on the gate) and `su`/`sudo` steps are supported; setups that force a TTY password prompt may still fail.
- **Sync** currently has only the **folder** backend (Google Drive/Dropbox/Syncthing/network share); WebDAV, S3, Git are planned.
- **Secrets manager** supports 1Password, Bitwarden, HashiCorp Vault via CLI; KeePassXC is planned.
- **Plugin system** is at **v1** (commands + observe/write output + panel + storage); no new protocols, permission enforcement, output transform, or marketplace yet — see §16D.
- Not yet available: **RDP/VNC**, a self-hosted **team server**, **cloud import** (AWS/GCP…), a **Docker/K8s browser** — see [../ROADMAP.md](../ROADMAP.md).
