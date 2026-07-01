# Về nhà chạy DeployBox trên Windows — Checklist ngắn

Máy nhà dùng **Windows** → chạy DeployBox trong **WSL2** (Linux con). Làm theo thứ tự.

## Theo về / Cài lại

| Theo bạn về (không mất) | Phải cài lại ở nhà |
|---|---|
| Code → qua **GitHub** | node, pnpm, pm2, caddy, **cloudflared** |
| Config/project/env → **Supabase** (cloud) | build lại app (native binary Linux) |

---

## Bước 1 — WSL2 (làm 1 lần)
PowerShell (Run as Administrator):
```powershell
wsl --install
```
→ Reboot → mở **Ubuntu** từ Start menu → tạo user + mật khẩu. **Từ đây mọi lệnh chạy trong Ubuntu.**

## Bước 2 — Cài công cụ (trong Ubuntu)
```bash
# node + pnpm + pm2
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
npm i -g pnpm pm2
# caddy
sudo apt update && sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
# cloudflared (cho HTTPS)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
```

## Bước 3 — Lấy code + env
```bash
# clone TRONG WSL (đừng để /mnt/c/... — chậm + lỗi)
git clone <URL-repo-deploybox-của-bạn> deploybox
cd deploybox
# tạo .env — copy từ máy công ty, GIỮ NGUYÊN 3 dòng:
#   DATABASE_URL=...        (Supabase dùng chung)
#   ENCRYPTION_KEY=...       (khác key → secret cũ giải mã lỗi)
#   JWT_SECRET=...
nano .env
```

## Bước 4 — Sửa 2 chỗ cho WSL
> `ecosystem.config.js` **KHÔNG cần sửa** — path tự nhận (dùng `__dirname`).
1. **Auto-start**: dùng `pm2 startup` (tạo systemd) thay cho launchd của Mac — chạy sau khi start ở bước 5.
2. **Docker** (nếu cần deploy app kiểu Docker): cài Docker Desktop for Windows + bật WSL2 integration. *Chỉ host-run thì bỏ qua.*

## Bước 5 — Build + chạy server
```bash
./start-server.sh          # cài deps + build + pm2 + save
pm2 startup                # in ra 1 lệnh sudo → copy chạy nó (auto-start khi boot)
pm2 save
```
→ Dashboard: `http://localhost:3000`. Dừng: `./stop-server.sh`.

## Bước 6 — HTTPS bằng Cloudflare Tunnel
**Cách nhanh (URL tạm, không cần domain):**
```bash
cloudflared tunnel --url http://localhost:8080
```
→ In ra `https://<ngẫu-nhiên>.trycloudflare.com` — mở từ điện thoại/máy khác được.

**Cách cố định (URL riêng, cần domain + tài khoản Cloudflare):** xem [DEPLOY-HOME-WINDOWS.md](DEPLOY-HOME-WINDOWS.md).

## Bước 7 — Deploy lại app
Vào dashboard → mỗi project bấm **Deploy** (build lại trong Linux). Project/env đã có sẵn từ Supabase, không phải tạo lại.

---

## Lệnh vận hành (nhớ mấy cái này)
```bash
./start-server.sh          # bật server
./stop-server.sh           # tắt server
pm2 list                   # xem trạng thái
pm2 logs                   # xem log
cloudflared tunnel --url http://localhost:8080   # bật HTTPS (chạy nền: thêm & )
```

## Lưu ý
- **cloudflared phải chạy trên chính máy home** (không dùng lại config của Mac).
- Máy phải **bật** thì web mới sống (tắt máy = web sập). Muốn 24/7 không phụ thuộc máy → dùng VPS.
- Chi tiết vận hành đầy đủ: [HUONG-DAN-CHAY-SERVER.md](HUONG-DAN-CHAY-SERVER.md).
