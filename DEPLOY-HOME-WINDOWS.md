# Biến máy Windows thành server — Cloudflare Tunnel (qua WSL2)

Chạy DeployBox **ngay trên máy Windows của bạn**, người ngoài vẫn vào được `https://yourdomain.com` (HTTPS thật). **Không cần VPS, không mở cổng router.**

> **Vì sao qua WSL2?** DeployBox dùng công cụ Linux (`git`, `sh`, `docker`) khi build app user, nên trên Windows ta chạy nó **bên trong WSL2** (Linux con trong Windows). Đây là cách chuẩn + ổn định nhất — chạy trực tiếp trên Windows "thuần" sẽ lỗi build.

## Cách hoạt động
```
Internet → Cloudflare (lo HTTPS) → tunnel (cloudflared) → Web/API/Caddy chạy trong WSL2
```

## Bạn cần
- **Windows 10 (bản 2004+) hoặc Windows 11.**
- **1 domain**, đặt DNS ở **Cloudflare** (miễn phí — đổi nameserver về Cloudflare).
- DeployBox (code).

Thay `yourdomain.com` và `<bạn>` (tên user Ubuntu) ở mọi chỗ.

---

## Bước 0 — Cài WSL2 + Docker Desktop (làm 1 lần)

1. **WSL2**: mở **PowerShell (Run as Administrator)**:
   ```powershell
   wsl --install
   ```
   → khởi động lại máy → mở **"Ubuntu"** từ Start menu, tạo user + mật khẩu.

2. **Docker Desktop**: tải tại docker.com → cài → mở → vào **Settings → Resources → WSL Integration** → **bật cho Ubuntu** → Apply. (Docker Desktop miễn phí cho cá nhân; nó cung cấp `docker` cho cả Windows lẫn WSL2.)

> Từ đây, **MỌI lệnh chạy trong terminal Ubuntu (WSL2)** — mở "Ubuntu" từ Start menu.

---

## Bước 1 — Cài công cụ trong WSL2 (Ubuntu)
```bash
sudo apt update

# Node 20 + git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
sudo corepack enable

# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
sudo systemctl disable --now caddy 2>/dev/null || true   # ta tự chạy caddy riêng

# cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

# Kiểm tra Docker (qua Docker Desktop) — phải in "Hello from Docker!"
docker run --rm hello-world
```

Đưa code DeployBox vào **trong WSL2** (đừng để ở `/mnt/c/...` — chậm + lỗi quyền/line-ending):
```bash
cd ~
git clone <repo-url> deploybox      # hoặc copy code vào ~/deploybox
cd ~/deploybox && pnpm install
```

---

## Bước 2 — Tạo tunnel
```bash
cloudflared tunnel login            # in ra 1 URL → copy mở bằng browser Windows → chọn domain
cloudflared tunnel create deploybox # ghi lại Tunnel ID
```

## Bước 3 — Cấu hình ingress
Tạo `~/.cloudflared/config.yml` (chú ý path Linux `/home/...`, không phải `C:\`):
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

## Bước 4 — Trỏ DNS
```bash
cloudflared tunnel route dns deploybox yourdomain.com
cloudflared tunnel route dns deploybox api.yourdomain.com
```
Wildcard `*`: **Cloudflare dashboard → DNS → Add record**:
```
Type: CNAME   Name: *   Target: <TUNNEL_ID>.cfargotunnel.com   Proxied: BẬT (đám mây cam)
```

## Bước 5 — Cấu hình DeployBox

**a) API** — sửa `~/deploybox/.env`:
```
APP_DOMAIN=yourdomain.com
PUBLIC_TLS=false
PUBLIC_API_URL=https://api.yourdomain.com
CORS_ORIGIN=https://yourdomain.com
```

**b) Web** — tạo `~/deploybox/apps/web/.env.local`:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

**c) Build lại:**
```bash
cd ~/deploybox
pnpm build:shared
pnpm --filter @deploybox/api build
pnpm --filter @deploybox/web build
```

## Bước 6 — Chạy tất cả (mỗi cái 1 tab Ubuntu; Docker Desktop phải đang chạy)
```bash
docker compose -f docker-compose.dev.yml up -d redis

pnpm caddy                                   # reverse proxy app user (:8080)
cd apps/api && node dist/main.js             # API :4000
cd apps/web && pnpm start                    # Web :3000 (bản build)
cloudflared tunnel run deploybox             # tunnel
```

**Giữ máy không ngủ** (thay cho `caffeinate` của Mac):
- Settings → System → Power → **Sleep = Never** (khi cắm điện). Hoặc PowerShell: `powercfg /change standby-timeout-ac 0`.
- Giữ **Docker Desktop + các tab Ubuntu mở**. Tắt máy / đóng terminal = sập server.

## Bước 7 — Test
- Mở **`https://yourdomain.com`** từ **điện thoại dùng 4G** (khác wifi) → vào được dashboard 🔒.
- Đăng nhập → **đổi mật khẩu seed ngay**.
- Tạo project STATIC → Deploy → mở **`https://<slug>.yourdomain.com`** 🔒.

---

## ⚠️ Lưu ý quan trọng
- Máy phải **bật 24/7, không sleep**; **Docker Desktop + terminal Ubuntu phải mở**. Tắt máy = sập.
- **Đĩa**: build app user ăn đĩa (Windows + WSL2 + Docker) → theo dõi, dễ đầy.
- **Bảo mật**: DeployBox **chạy code lạ ngay trên máy bạn** → chỉ cho **người tin tưởng** dùng.
- Hợp để **chơi/thử/cho vài người xem**. Cần luôn-bật + an toàn cho team thật → 1 VPS rẻ vẫn hơn (xem [DEPLOY.md](DEPLOY.md)).

## Gỡ lỗi (Windows/WSL2)
| Lỗi | Xử lý |
|---|---|
| `docker` trong WSL2 báo lỗi | Docker Desktop đang chạy chưa + đã bật **WSL Integration → Ubuntu** chưa |
| Cài/chạy chậm, lỗi quyền | Code phải ở `~/deploybox` (Linux fs), **không** để `/mnt/c/...` |
| Không vào được domain | `cloudflared tunnel info deploybox` xem healthy; DNS đã trỏ chưa |
| 502 Bad Gateway | Web :3000 / API :4000 / Caddy :8080 chạy chưa (`lsof -i :3000`) |
| App `<slug>.yourdomain.com` 404 | CNAME `*` đã thêm + Proxied bật; `docker ps` xem app chạy |

> Vướng đâu chụp màn hình / copy log gửi mình, mình gỡ cùng. (Bản cho Mac: [DEPLOY-HOME.md](DEPLOY-HOME.md))
