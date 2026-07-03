# Deploy DeployBox lên VPS (HTTPS thật)

Hết hướng dẫn này bạn sẽ có:
- Dashboard tại **`https://yourdomain.com`**
- API tại **`https://api.yourdomain.com`**
- App user deploy ra **`https://<slug>.yourdomain.com`** — tất cả **HTTPS thật** (Let's Encrypt, Caddy tự cấp + gia hạn).

Thay `yourdomain.com` bằng domain thật của bạn ở mọi bước.

---

## 0. Phân chia: cái gì chạy ở đâu

| Thành phần | Chạy ở | Ghi chú |
|---|---|---|
| API (NestJS) + Web (Next) | **VPS** (Node, qua pm2) | API điều khiển Docker của VPS |
| Caddy | **VPS** (systemd, cổng 80/443) | proxy + auto-HTTPS, do API quản qua admin API |
| Redis | **VPS** (Docker) | hàng đợi build |
| Docker daemon | **VPS** | build & chạy app user |
| PostgreSQL | **Supabase** (đang dùng) hoặc Docker trên VPS | giữ Supabase là gọn nhất |

---

## 1. Bạn chuẩn bị (phần này mình không làm hộ được)

**VPS:** Hetzner CX22 (~€4/th), DigitalOcean, hoặc Vultr.
- OS **Ubuntu 24.04**, **≥ 2GB RAM**, kiến trúc **amd64**.
- Lấy **IP** + đăng nhập **SSH** (key).

**Domain:** mua ở Namecheap / Cloudflare / Porkbun (~$10/năm).

**DNS:** ở trang quản lý domain, thêm 2 bản ghi A trỏ về **IP VPS**:
```
A   @   <IP_VPS>     ; yourdomain.com  -> VPS
A   *   <IP_VPS>     ; *.yourdomain.com -> VPS (gồm api. và mọi app)
```
Đợi DNS lan (vài phút–vài giờ). Kiểm tra: `dig +short yourdomain.com` phải ra IP VPS.

---

## 2. Cài đặt trên VPS

SSH vào VPS (`ssh root@<IP_VPS>`) rồi chạy:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Node 20 + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
corepack enable

# Caddy (cài qua apt, có sẵn quyền bind cổng 80/443)
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy

# Firewall: chỉ mở SSH + web
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

> Dừng service Caddy mặc định (ta tự chạy bằng config riêng): `systemctl disable --now caddy`

---

## 3. Lấy code + cấu hình

```bash
git clone <repo-url> /opt/deploybox      # hoặc scp code lên /opt/deploybox
cd /opt/deploybox
pnpm install
```

Tạo `/opt/deploybox/.env` (sao từ `.env.example`) với giá trị production:

```bash
# --- DB (giữ Supabase đang dùng, hoặc Postgres riêng) ---
DATABASE_URL=postgresql://...                 # chuỗi Supabase của bạn

# --- Bảo mật: ĐỔI thành chuỗi ngẫu nhiên mạnh ---
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
JWT_EXPIRES_IN=7d

# --- Production HTTPS ---
PUBLIC_TLS=true
APP_DOMAIN=yourdomain.com
ACME_EMAIL=you@yourdomain.com
PORT=4000
WEB_UPSTREAM=localhost:3000
API_UPSTREAM=localhost:4000
PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
CORS_ORIGIN=https://yourdomain.com
REDIS_URL=redis://localhost:6379
```

> `NEXT_PUBLIC_API_URL` được nhúng vào web lúc **build** → phải set TRƯỚC khi `pnpm --filter @deploybox/web build`.

Khởi tạo DB + build:
```bash
docker compose -f docker-compose.dev.yml up -d redis    # Redis
pnpm db:generate && pnpm --filter @deploybox/api prisma db push && pnpm db:seed
pnpm build                                               # build shared + api + web
```

---

## 4. Chạy nền (pm2 + Caddy)

```bash
# Caddy: chạy config khởi tạo (API sẽ reload routes vào đây qua admin API)
# Dùng systemd cho gọn:
cat >/etc/systemd/system/deploybox-caddy.service <<'EOF'
[Unit]
After=network.target
[Service]
ExecStart=/usr/bin/caddy run --config /opt/deploybox/caddy/init.caddyfile --adapter caddyfile
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl enable --now deploybox-caddy

# API + Web bằng pm2
npm i -g pm2
cd /opt/deploybox/apps/api && pm2 start "node dist/main.js" --name api
cd /opt/deploybox/apps/web && pm2 start "pnpm start" --name web
pm2 save && pm2 startup     # giữ chạy sau reboot (làm theo lệnh nó in ra)
```

Khi API khởi động, `CaddyService` tự đẩy route **dashboard + api + mọi app** vào Caddy, và Caddy **tự xin chứng chỉ Let's Encrypt** cho từng host.

---

## 5. Xong — kiểm tra

1. Mở **`https://yourdomain.com`** → thấy dashboard (có khóa 🔒).
2. Đăng nhập tài khoản seed → **đổi mật khẩu ngay**.
3. Tạo project STATIC (repo HTML) → Deploy → mở **`https://<slug>.yourdomain.com`** (HTTPS thật).
4. Test webhook: dán URL `https://api.yourdomain.com/api/v1/webhooks/git/<id>` + secret vào GitHub.

---

## 6. Bảo mật — đọc trước khi cho người khác dùng

- ✅ `JWT_SECRET` + `ENCRYPTION_KEY` ngẫu nhiên mạnh (lệnh `openssl rand` ở trên).
- ✅ Đổi mật khẩu tài khoản seed; tắt đăng ký nếu chỉ nội bộ.
- ✅ ufw chỉ mở 22/80/443.
- ⚠️ **DeployBox chạy code của người dùng** (build + container). An toàn khi **chỉ team tin cậy** dùng. Trước khi mở cho người ngoài (SaaS) cần **cô lập** (gVisor/Firecracker, resource limit) — xem mục Bảo mật trong [../ke-hoach-tuong-lai.md](../ke-hoach-tuong-lai.md).

---

## Lỗi thường gặp

| Triệu chứng | Xử lý |
|---|---|
| Trang không lên / cert lỗi | Kiểm tra DNS đã trỏ đúng IP (`dig`), cổng 80/443 mở, `journalctl -u deploybox-caddy` |
| API không deploy được app | `docker ps` chạy chưa; user chạy API có trong group `docker` |
| Web gọi API fail | `NEXT_PUBLIC_API_URL` đúng `https://api.yourdomain.com` và đã **build lại** web |
| Cert chưa cấp | Caddy cần domain trỏ về VPS + cổng 80 mở (HTTP-01 challenge) |

> Khi bạn dựng xong VPS + domain, báo mình IP/domain (không cần mật khẩu) — mình rà cấu hình và gỡ lỗi cùng bạn.
