# Chạy DeployBox trên Windows (WSL2) — server tại nhà

> Gộp từ `CHAY-O-NHA-WINDOWS.md` (checklist ngắn) và `DEPLOY-HOME-WINDOWS.md` (Cloudflare Tunnel đầy đủ).
> Bản cho Mac: [home-mac.md](home-mac.md) · VPS: [vps.md](vps.md)

**Vì sao qua WSL2?** DeployBox dùng công cụ Linux (`git`, `sh`, `docker`) khi build app user → trên Windows phải chạy **bên trong WSL2** (Linux con trong Windows). Chạy trực tiếp trên Windows "thuần" sẽ lỗi build.

**Yêu cầu:** Windows 10 (bản 2004+) hoặc Windows 11.

## Theo về / Cài lại (khi chuyển máy)

| Theo bạn về (không mất) | Phải cài lại ở nhà |
|---|---|
| Code → qua **GitHub** | node, pnpm, pm2, caddy, **cloudflared** |
| Config/project/env → **Supabase** (cloud) | build lại app (native binary Linux) |

---

## Bước 1 — WSL2 + Docker Desktop (làm 1 lần)

1. **WSL2** — PowerShell (Run as Administrator):
   ```powershell
   wsl --install
   ```
   → Reboot → mở **Ubuntu** từ Start menu → tạo user + mật khẩu. **Từ đây mọi lệnh chạy trong Ubuntu.**
2. **Docker Desktop** (chỉ cần nếu deploy app kiểu Docker; host-run thì bỏ qua): tải ở docker.com → cài → **Settings → Resources → WSL Integration → bật cho Ubuntu** → Apply.

## Bước 2 — Cài công cụ (trong Ubuntu)

```bash
sudo apt update

# node + pnpm + pm2 (qua nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 24
npm i -g pnpm pm2

# caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl git
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo systemctl disable --now caddy 2>/dev/null || true   # ta tự chạy caddy riêng

# cloudflared (cho HTTPS)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

# Kiểm tra Docker (nếu đã cài Docker Desktop) — phải in "Hello from Docker!"
docker run --rm hello-world
```

## Bước 3 — Lấy code + env

```bash
# clone TRONG WSL (đừng để /mnt/c/... — chậm + lỗi quyền/line-ending)
cd ~
git clone <URL-repo-deploybox-của-bạn> deploybox
cd deploybox && pnpm install

# tạo .env — copy từ máy cũ, GIỮ NGUYÊN 3 dòng:
#   DATABASE_URL=...        (Supabase dùng chung)
#   ENCRYPTION_KEY=...      (khác key → secret cũ giải mã lỗi toàn bộ)
#   JWT_SECRET=...
nano .env
```

## Bước 4 — Build + chạy server (pm2)

> `ecosystem.config.js` **KHÔNG cần sửa** — path tự nhận (`__dirname`).

```bash
./start-server.sh          # cài deps + build + pm2 + save
pm2 startup                # in ra 1 lệnh sudo → copy chạy nó (auto-start khi boot, thay launchd của Mac)
pm2 save
```
→ Dashboard: `http://localhost:3000`. Dừng: `./stop-server.sh`. Vận hành hằng ngày (pm2 list/logs/restart, self-heal): xem [home-mac.md](home-mac.md) Phần 1 — chạy y hệt.

## Bước 5 — Deploy lại app

Vào dashboard → mỗi project bấm **Deploy** (build lại trong Linux). Project/env đã có sẵn từ Supabase, không phải tạo lại.

---

## HTTPS bằng Cloudflare Tunnel

### Cách nhanh (URL tạm, không cần domain)
```bash
cloudflared tunnel --url http://localhost:8080
```
→ In ra `https://<ngẫu-nhiên>.trycloudflare.com` — mở từ điện thoại/máy khác được ngay.

### Cách cố định (URL riêng — cần domain + tài khoản Cloudflare)

```
Internet → Cloudflare (lo HTTPS) → tunnel (cloudflared) → Web/API/Caddy chạy trong WSL2
```

**1. Tạo tunnel:**
```bash
cloudflared tunnel login            # in ra URL → mở bằng browser Windows → chọn domain
cloudflared tunnel create deploybox # ghi lại Tunnel ID
```

**2. Cấu hình ingress** — tạo `~/.cloudflared/config.yml` (path Linux `/home/...`, không phải `C:\`):
```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/<bạn>/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: yourdomain.com
    service: http://localhost:3000        # dashboard (Next)
  - hostname: api.yourdomain.com
    service: http://localhost:4000        # API
  - hostname: "*.yourdomain.com"
    service: http://localhost:8080        # app user (Caddy route theo host)
  - service: http_status:404
```

**3. Trỏ DNS:**
```bash
cloudflared tunnel route dns deploybox yourdomain.com
cloudflared tunnel route dns deploybox api.yourdomain.com
```
Wildcard `*`: **Cloudflare dashboard → DNS → Add record**:
```
Type: CNAME   Name: *   Target: <TUNNEL_ID>.cfargotunnel.com   Proxied: BẬT (đám mây cam)
```

**4. Cấu hình DeployBox** — sửa `~/deploybox/.env`:
```
APP_DOMAIN=yourdomain.com
PUBLIC_TLS=false
PUBLIC_API_URL=https://api.yourdomain.com
CORS_ORIGIN=https://yourdomain.com
```
Tạo `~/deploybox/apps/web/.env.local` (biến `NEXT_PUBLIC_*` nhúng lúc build):
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```
Build lại + restart: `pnpm build && pm2 restart all --update-env`

**5. Chạy tunnel:**
```bash
cloudflared tunnel run deploybox    # hoặc: pm2 start "cloudflared tunnel run deploybox" --name tunnel
```

**6. Test:** mở **`https://yourdomain.com`** từ điện thoại 4G (khác wifi) → dashboard 🔒 → tạo project STATIC → Deploy → `https://<slug>.yourdomain.com` 🔒.

**Giữ máy không ngủ** (thay `caffeinate` của Mac):
- Settings → System → Power → **Sleep = Never** (khi cắm điện), hoặc PowerShell: `powercfg /change standby-timeout-ac 0`.
- Giữ **Docker Desktop + WSL2 chạy**. Tắt máy = sập server.

---

## ⚠️ Lưu ý quan trọng
- **cloudflared phải chạy trên chính máy này** (không dùng lại config/tunnel của máy khác).
- Máy phải **bật 24/7, không sleep**. Muốn 24/7 không phụ thuộc máy → dùng VPS ([vps.md](vps.md)).
- **Đĩa:** build app user ăn đĩa (Windows + WSL2 + Docker) → dễ đầy, theo dõi.
- **Bảo mật:** DeployBox chạy code lạ ngay trên máy bạn → chỉ cho người tin tưởng dùng.

## Lệnh vận hành (nhớ mấy cái này)
```bash
./start-server.sh          # bật server
./stop-server.sh           # tắt server
pm2 list                   # xem trạng thái
pm2 logs                   # xem log
cloudflared tunnel --url http://localhost:8080   # HTTPS nhanh (URL tạm)
```

## Gỡ lỗi (Windows/WSL2)
| Lỗi | Xử lý |
|---|---|
| `docker` trong WSL2 báo lỗi | Docker Desktop đang chạy + đã bật **WSL Integration → Ubuntu** chưa |
| Cài/chạy chậm, lỗi quyền | Code phải ở `~/deploybox` (Linux fs), **không** để `/mnt/c/...` |
| Không vào được domain | `cloudflared tunnel info deploybox` xem healthy; DNS đã trỏ chưa |
| 502 Bad Gateway | Web :3000 / API :4000 / Caddy :8080 chạy chưa (`lsof -i :3000`) |
| App `<slug>.yourdomain.com` 404 | CNAME `*` đã thêm + Proxied bật; app có đang chạy không |
