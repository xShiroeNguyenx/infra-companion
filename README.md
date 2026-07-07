# Infra Companion

> A next-generation desktop SSH client — everything Termius does, plus local-first vault encryption, self-hosted E2EE sync, bulk execution, real-time monitoring, AI assistance with local LLM support, and more.

**Current release: v0.1.12 (Phase 0–6)**  &nbsp;|&nbsp; Windows · macOS · Linux  &nbsp;|&nbsp; Electron 42 · React 19 · TypeScript

🌐 **[Live landing page](https://xshiroenguyenx.github.io/infra-companion/)** &nbsp;·&nbsp; ⬇️ **[Download](https://github.com/xShiroeNguyenx/infra-companion/releases/latest)** &nbsp;·&nbsp; 📖 **[User guide](docs/USER-GUIDE.md)**

> The landing page deploys to GitHub Pages on its own — pushing changes under `docs/landing/` to `main` (or running the workflow manually) publishes it **without rebuilding the app** (see `.github/workflows/pages.yml`). One-time setup: **Settings → Pages → Build and deployment → Source = GitHub Actions**.

---

## Why Infra Companion?

| Pain point with Termius | How Infra Companion solves it |
|-------------------------|-------------------------------|
| Forced cloud account to sync | Local-first; sync via your own folder/WebDAV/S3/Git (zero-knowledge E2EE) |
| Expensive subscription ($10–30/user/month) | Free and open — host it yourself |
| No monitoring, no bulk execution | Built-in dashboard (CPU/RAM/disk, no agent) + parallel bulk runner |
| No AI, or AI locked to their cloud | Claude / OpenAI / Gemini / **Ollama local** (100% private) |
| No session recording | Full asciinema-compatible recording & replay |
| No secrets manager integration | Pull credentials live from 1Password, Bitwarden, HashiCorp Vault |
| SFTP can't reach internal hosts via jump chain | SFTP tunneled over nested SSH — works with login-script hosts |
| Closed-source, no plugin system | Auditable core; plugin system on the roadmap |

---

## Features

### SSH & Connections
- **SSH** with password, SSH key (ed25519 / RSA / ECDSA), SSH agent (OpenSSH / Pageant), and **Secrets Manager** auth
- **Jump host chain** — multi-hop ProxyJump (equivalent to `ssh -J hop1,hop2 target`)
- **Login script (expect/send)** — automate `su → ssh` or nested SSH sequences with per-step encrypted secrets; runs on auto-reconnect too
- **Auto-reconnect** (3 retries, status shown in terminal)
- **tmux session resume** — opt-in per host: wraps the session in tmux (`new-session -A`) so it survives disconnects and reattaches on reconnect/reopen (server must have tmux)
- **TOFU known-hosts** — fingerprint shown on first connect, red alert on host-key change
- **Quick Connect** — type `user@host:port` in the sidebar; 50-entry history
- **Favorite hosts** — pin hosts with ⭐ to a Favorites section at the top of the sidebar (respects search)
- **Telnet** and **Serial / COM port** (auto-lists connected ports, configurable baud)
- **Local terminal** — PowerShell, cmd, Git Bash, WSL shells via node-pty

### Terminal UX
- **xterm.js** with WebGL renderer — smooth even at high throughput (`yes`, large `cat`)
- **Multi-tab** with Ctrl+Shift+T / middle-click close
- **Split panes** — side-by-side sessions, Ctrl+Shift+D
- **Merge tabs ⇄ split panes** — the Split button combines all open tabs into one tab's panes (so Broadcast spans them) and toggles back; scrollback is preserved across merge/split
- **Open a group as split panes** — one click on a group header opens every host in it side by side, ready to broadcast
- **Workspaces** — save a layout (tabs + split panes + broadcast) and restore it in one click (⋯ → Workspaces)
- **Broadcast input** — type once, send to all open panes simultaneously (Ctrl+Shift+B)
- **Background image** — full-window wallpaper from a local file **or a pasted URL** (incl. Google Drive / Dropbox share links), with adjustable opacity, blur, fit (cover/contain), and position (Settings → Background image)
- **Terminal appearance** — configurable font family, size, line height, and cursor style (Settings → Terminal); applies live
- **Theme studio** — pick a custom accent and recolor the full UI palette per theme (Settings → Appearance → Custom palette); export / import a theme as JSON
- **Find in terminal** — Ctrl+F with highlight
- **Mouse copy & paste** — select then left-click the highlight to copy, right-click to paste (alongside Ctrl+Shift+C / Ctrl+Shift+V)
- **Command Palette** — Ctrl+Shift+P, keyboard-first access to every action
- **Session logging** — capture raw output (ANSI-stripped) to file
- **Session recording & replay** — asciinema v2 format; player with play/pause, seek bar, 1×/2×/4×/8× speed; export `.cast` for `asciinema play`

### Plugins (v1)
- **Trusted JS plugins** — drop a plugin folder (`manifest.json` + `index.js`) into `<userData>/plugins/`; runs in an isolated Node worker so a crash can't take down the app
- **Capabilities** — add Command Palette commands, observe terminal output & write to a session, show a markdown/text panel, store per-plugin data, notify — all via a controlled API that never exposes the vault
- **Manager** — ⋯ → 🧩 Plugins: enable/disable, reload after editing, Rescan for new plugins (no restart), view per-plugin logs/errors
- See the **Plugins** section in [docs/USER-GUIDE.md](docs/USER-GUIDE.md) and examples in [docs/examples/](docs/examples/)

### Host & Vault Management
- **Encrypted vault** — master password → argon2id → AES-256-GCM field-level encryption; all secrets (passwords, private keys, env vars) are encrypted at rest
- **Auto-lock** after 15 minutes idle; lock overlay preserves scrollback
- **Remember on this machine** — unlocks via Windows DPAPI / macOS Keychain (no master password prompt on relaunch)
- **Groups with inheritance** — set default username / auth / key / env / startup snippet at group level; individual hosts can override
- **SSH Keys** — generate ed25519, import OpenSSH/PEM/PuTTY; private keys never leave main process in plaintext
- **Snippets** — parameterized commands (`{{variable}}`), run across multiple sessions at once
- **Notes per host** — encrypted Markdown note per host (purpose, handoff info, app passwords); quick-view from the sidebar, synced with the host
- **Import** — `~/.ssh/config` (preserves multi-hop ProxyJump, deduplicates IdentityFile)

### SFTP
- **Dual-pane file manager** — Local ↔ Remote; double-click to navigate, `↑` for parent, `⟳` refresh
- Upload / download with recursive directory support and transfer queue
- **Edit remote file locally** — opens in your default editor; saves trigger auto-upload
- chmod (octal), rename, delete (with confirmation), create directory
- **SFTP over nested SSH** — for hosts reachable only via a gate (`ssh target -s sftp` runs on the gate); no extra configuration needed

### Tunnels
- **Local** (L), **Remote** (R), **Dynamic / SOCKS5** (D) port forwarding
- Managed tunnel dashboard — toggle on/off, persistent across restarts

### Bulk Execution
- Run one command across N hosts **in parallel** (up to 8 concurrent)
- Grid output view — enable **"Group by output"** to instantly spot divergent machines (flagged yellow)
- Cancel mid-run; closing the modal also cancels (connections are truly terminated)
- Works through login-script hosts — command runs on the **inner** machine, not the gate

### Monitoring Dashboard
- Per-host cards: CPU load sparkline, RAM / Disk usage bars, uptime
- **No agent required** — reads `/proc` and `df` over SSH every 3 seconds
- Thresholds: red > 90%, yellow > 70%
- Auto-reconnects on drop; works through login-script hosts

### Network Toolbox
- Ping (latency), DNS lookup (A / AAAA / PTR), port scan (16 common ports)
- Runs locally — no SSH needed

### E2EE Sync
- Encrypts vault to a single blob (`AES-256-GCM`) — the backend **never sees plaintext**
- Sync via **any shared folder** (Google Drive, Dropbox, OneDrive, Syncthing, network share)
- Merge strategy: Last-Write-Wins per field + tombstone for deletes — conflicts are rare
- Set a **sync passphrase** (separate from master password, same across all your machines)

### AI Assistant
- **Generate commands** from natural language — inserts into terminal, does NOT auto-run
- **Explain command** — break down each part and flag risks
- **Explain error** — diagnose output and suggest fixes
- Providers: **Claude** (`claude-opus-4-8`), **OpenAI** (`gpt-4o-mini`), **Gemini** (`gemini-2.0-flash`), **Ollama** (local, fully private)
- API keys stored encrypted in vault

### Secrets Manager Integration
Pull credentials at connect time — nothing stored in the app:

| Syntax | Tool | CLI called |
|--------|------|-----------|
| `op://Vault/item/field` | 1Password | `op read` |
| `bw://<item-id-or-name>` | Bitwarden | `bw get password` |
| `vault://secret/path#field` | HashiCorp Vault | `vault kv get -field=…` |

---

## Installation

### Download

Head to the **[Releases page](https://github.com/xShiroeNguyenx/infra-companion/releases)** and grab the installer for your platform:

| Platform | File |
|----------|------|
| Windows | `InfraCompanion-Setup-x.x.x.exe` (NSIS, choose install directory) |
| macOS | `InfraCompanion-x.x.x.dmg` |
| Linux | `InfraCompanion-x.x.x.AppImage` |

The app checks for updates automatically on startup and shows a banner when a new version is available.

> **Windows SmartScreen warning:** The installer is not yet code-signed. If you see "Windows protected your PC", click **More info → Run anyway**. This is expected for new open-source apps without a paid certificate. See [this explanation](https://github.com/xShiroeNguyenx/infra-companion/wiki/Windows-SmartScreen) for details.

### Build from Source

Requirements: **Node.js ≥ 20**, **pnpm 9**

```bash
git clone <repo>
cd infra-companion
pnpm install
pnpm dev          # dev mode with hot reload (recommended during development)
```

---

## Development

```bash
pnpm dev          # start Electron app in dev mode (HMR on renderer + main)
pnpm build        # production build → out/
pnpm dist         # build + package installer → apps/desktop/release/
pnpm typecheck    # TypeScript check across all packages
pnpm test         # unit tests (crypto, sync-merge, ssh_config parser)
```

> **Note:** Do not run `npx electron .` at the repo root — the app entry point is inside `apps/desktop`. Always use `pnpm dev` or `pnpm start`.

### Running tests

```bash
pnpm test
# 21 tests pass on Node 20; 6 sync-merge tests are skipped (require node:sqlite / Node ≥ 22.5)
# To run all 27 tests using Electron's bundled Node 24 runtime:
$env:ELECTRON_RUN_AS_NODE='1'
& ".\node_modules\electron\dist\electron.exe" ".\node_modules\vitest\vitest.mjs" run
# (PowerShell — run from repo root)
```

---

## Project Structure

```
infra-companion/
├── apps/
│   └── desktop/                  # Electron app
│       ├── src/main/             # Main process: IPC router, window manager
│       ├── src/preload/          # Preload bridge (contextBridge)
│       └── src/renderer/         # React UI
│           ├── features/         # hosts, terminal, sftp, tunnels, snippets,
│           │                     #   monitor, runbooks, ai, sync, vault, …
│           ├── components/       # shared UI components
│           └── stores/           # Zustand stores
├── packages/
│   ├── core/                     # Pure Node logic — reusable outside Electron
│   │   ├── connection/           # SshSession, SftpService, TelnetSession,
│   │   │                         #   SerialSession, TunnelService, Socks5
│   │   ├── vault/                # VaultService, crypto (argon2id + AES-GCM),
│   │   │                         #   SQLite migrations
│   │   ├── sync/                 # SyncService, oplog, LWW merge, FS backend
│   │   ├── importers/            # ssh_config parser
│   │   ├── monitor/              # MonitorService (SSH polling, no agent)
│   │   ├── ai/                   # Provider adapters (Anthropic/OpenAI/Ollama)
│   │   ├── bulk/                 # BulkService
│   │   ├── secrets/              # SecretsService (op/bw/vault CLI bridge)
│   │   └── nettools/             # ping, DNS, port scan
│   ├── shared/                   # TypeScript types + typed IPC contracts
│   └── ui/                       # Design system (Radix UI + Tailwind)
├── docs/
│   ├── USER-GUIDE.md             # Full feature guide & usage instructions
│   ├── landing/index.html        # Marketing landing page (demo)
│   └── TIEP-TUC-PHIEN-SAU.md     # Dev handoff notes
├── PLAN.md                       # Architecture & detailed design decisions
├── ROADMAP.md                    # Planned features not yet implemented
└── README.md                     # This file
```

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| App shell | Electron 42 | Mature SSH/PTY/Serial ecosystem for Node; used by VS Code, Tabby |
| UI | React 19 + TypeScript + Vite | Fast iteration; full type safety end-to-end |
| State | Zustand + Immer | Minimal boilerplate; fine-grained subscriptions |
| Styling | Tailwind CSS v4 + Radix UI | Dark-mode-first, dense developer-tool aesthetic |
| Terminal | xterm.js + WebGL renderer | VS Code standard; handles high-throughput output |
| SSH / SFTP | ssh2 | Full feature set: shell, exec, sftp, forwarding, agent, jump |
| Local PTY | node-pty | PowerShell, cmd, WSL, bash/zsh |
| Serial | serialport | Auto-detects COM/USB ports |
| Storage | better-sqlite3 + AES-256-GCM | Synchronous, fast; field-level encryption |
| KDF | argon2id | Recommended by OWASP for password hashing |
| OS keychain | Electron safeStorage | DPAPI (Windows) / Keychain (macOS) for vault key caching |
| Tests | Vitest | Fast unit tests; runs in Node and Electron Node runtime |
| Packaging | electron-builder + NSIS | NSIS installer for Windows; DMG for macOS; AppImage for Linux |

---

## Security Model

1. **Master password** → argon2id → 256-bit `vault_key`
2. All secrets (passwords, private keys, env vars, notes) encrypted **AES-256-GCM field-level**; metadata (hostname, label) stays plaintext for fast search
3. `vault_key` optionally cached via OS keychain (DPAPI / Keychain); cleared from RAM on vault lock
4. **Auto-lock** after 15 min idle — uses an overlay so terminal scrollback is preserved
5. Private keys are decrypted only in the main process; the renderer never receives plaintext key material
6. **Sync**: only an encrypted blob ever leaves the machine — the sync backend is zero-knowledge
7. **TOFU known-hosts**: full-screen warning if a host key changes (MITM protection)
8. All destructive actions (delete host / key / file / recording) require explicit confirmation

---

## Known Limitations (v0.1.12)

- Bulk / Monitor / SFTP through login scripts rebuild the path non-interactively: `ssh` hops (password hops need `sshpass` installed on the gate) and `su` / `sudo` steps are supported; exotic setups that force a TTY password prompt may still fail
- Sync backend: **folder only** for now (WebDAV, S3, Git planned — see [ROADMAP.md](ROADMAP.md))
- Secrets Manager: 1Password, Bitwarden, HashiCorp Vault via CLI (KeePassXC planned)
- No RDP/VNC, team server, cloud import (AWS/GCP…), Docker/K8s browser — see [ROADMAP.md](ROADMAP.md); plugin system is at **v1** (🛒 Marketplace tab installs from a static registry; no permission enforcement / output transform / package signing yet)

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full list of planned features, including:

- Plugin system (F16)
- Sync backends: WebDAV, S3, Git
- Cloud host import (AWS EC2 / GCP / Azure / DigitalOcean)
- Docker & Kubernetes browser
- VNC (noVNC, in-tab) and RDP (FreeRDP)
- Team self-host server with shared vaults and RBAC

---

## Contributing

The project uses a pnpm monorepo. Before submitting a PR:

```bash
pnpm typecheck   # must pass
pnpm test        # must pass
```

Core logic lives in `packages/core` — keep it free of Electron imports so it stays reusable. Renderer-only UI lives in `apps/desktop/src/renderer`.

---

## License

MIT © NguyenKhanh
