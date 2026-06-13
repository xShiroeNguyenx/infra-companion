# ROADMAP — Infra Companion

> Phiên bản hiện tại: **Phase 0–6** — tính năng đã có xem [docs/HUONG-DAN-SU-DUNG.md](docs/HUONG-DAN-SU-DUNG.md).  
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
- **Plugin system** (F16) — plugin JS sandbox hook vào command palette, panel UI, protocol mới, format output; kèm tài liệu Plugin API.
- **KeePassXC** (F11 mở rộng) — tích hợp Secrets Manager thêm KeePassXC qua KeePassXC-proxy.
- ~~**tmux-aware resume** (F14)~~ — ✅ Đã làm (v0.1.4): bật per-host → sau login `tmux new-session -A -s ic-main`, tự re-attach khi reconnect/mở lại (resume). *Còn lại (sau): auto-wrap toàn cục mọi phiên.*
- **ssh_config 2 chiều** (F12) — ghi ngược thay đổi vào `~/.ssh/config` (tuỳ chọn), dùng song song CLI ssh.
- ~~**Notes per host** (F18)~~ — ✅ Đã làm (v0.1.4): ghi chú Markdown mã hoá đính kèm host, xem nhanh từ sidebar, đồng bộ cùng host.

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
- **Theme tuỳ chỉnh** — ✅ Một phần (v0.1.4): chọn **màu accent** tuỳ ý (Settings → Giao diện). *Còn lại (sau): tuỳ biến cả bảng màu (nền/panel…), import/export theme.*
- ~~**Font & cỡ chữ terminal**~~ — ✅ Đã làm (v0.1.4): font/cỡ chữ/giãn dòng/kiểu con trỏ toàn cục (Settings → Terminal). *Còn lại (sau): per-host override.*

---

## Ngoài phạm vi (chưa lên kế hoạch)

- Mobile app (iOS / Android) — kiến trúc `packages/core` tách riêng để mở khả năng này sau.
- Web version.
- Marketplace plugin trả phí.
- Compliance SOC 2 (chỉ liên quan nếu thương mại hoá bản Team).

---

> Để bắt đầu một hạng mục: xem `docs/TIEP-TUC-PHIEN-SAU.md` lấy ngữ cảnh kỹ thuật, sau đó chọn mục và bắt đầu phiên làm việc mới.
