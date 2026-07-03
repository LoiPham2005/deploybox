# Chạy DeployBox trên máy Mac (server tại nhà)

> Gộp từ `HUONG-DAN-CHAY-SERVER.md` (pm2 + self-heal, đã test thật) và `DEPLOY-HOME.md` (Cloudflare Tunnel).
> **Production hiện tại chạy trên VPS** — xem [sneakup-vps.md](sneakup-vps.md). Bản này dùng khi muốn biến máy Mac thành server.
>
> ⚠️ **2 máy chạy chung 1 DB Supabase + 1 bot Telegram sẽ đụng nhau** (bot 409, watchdog đánh dấu nhầm, báo cáo gửi 2 lần) — chỉ chọn **1 nơi làm chính** (xem [sneakup-vps.md](sneakup-vps.md) Bước 7).

---

## Phần 1 — Chạy production bằng pm2

### 1.1 Tổng quan — cái gì chạy ở đâu

| Thành phần | Cổng | Chạy bằng | Ghi chú |
|---|---|---|---|
| **DeployBox API** (NestJS) | 4000 | pm2 (`deploybox-api`) | Lõi điều khiển; tự đọc `.env` |
| **DeployBox Web** (Next.js) | 3000 | pm2 (`deploybox-web`) | Dashboard |
| **Caddy** | 8080 | API tự bật | Reverse proxy theo subdomain |
| **App bạn deploy** (host-run) | 3001, 3002… (nội bộ) | API tự spawn (detached) | Self-heal quản lý |
| **PostgreSQL** | — | **Supabase** (cloud) | Config + env + lịch sử deploy |

**Luồng truy cập:** Trình duyệt → `*.localhost:8080` (Caddy) → app nội bộ ở cổng riêng. Bạn chỉ dùng `localhost:3000` (dashboard) và `<slug>.localhost:8080` (app).

### 1.2 Chạy production — 2 cách (chọn 1)

> **KHÔNG dùng `pnpm dev`** cho server (dev hay restart, kill app). Cả 2 cách đều dùng cổng 3000/4000/8080 — **chỉ chạy 1 cái 1 lúc**, bật cùng lúc sẽ đụng cổng (`EADDRINUSE`).

| | **Cách A — pm2 native** | **Cách B — Docker** |
|---|---|---|
| Lệnh chạy | `./start-server.sh` | `docker compose up -d --build` |
| Cần cài sẵn | node, pnpm, caddy, (docker) | chỉ cần Docker |
| Hợp khi | Chạy 1 máy, nhẹ, đang dùng | Bê sang máy khác / nhiều server / WSL2 |

**Cách A — pm2 native (khuyến nghị 1 máy):**
```bash
./start-server.sh            # cài deps + build + (re)start pm2 + save
./start-server.sh --no-build # restart nhanh, bỏ qua build
```
Script dùng `ecosystem.config.js` ở gốc repo (2 app `deploybox-api`, `deploybox-web`, `autorestart`).

**Tự khởi động khi bật máy:**
- **Mac:** LaunchAgent chạy `pm2 resurrect` khi đăng nhập.
  - File: `~/Library/LaunchAgents/com.deploybox.pm2.plist`
  - Đăng ký: `launchctl load -w ~/Library/LaunchAgents/com.deploybox.pm2.plist`
  - Tự lên **sau reboot không cần đăng nhập tay** → bật **System Settings → Users & Groups → Automatically log in**.
- **Linux / WSL2:** `pm2 startup` (in ra 1 lệnh sudo → chạy nó, tạo systemd) → `pm2 save`.

**Cách B — Docker (1 lệnh, dễ bê đi):**
```bash
docker compose up -d --build   # build image + chạy DeployBox (api+web+caddy trong container)
docker compose logs -f         # xem log
docker compose down            # dừng
```
- File: `Dockerfile` + `docker-compose.yml` + `ecosystem.docker.config.js` (gốc repo).
- Image gồm sẵn node + caddy + git + docker-cli; `restart: unless-stopped` → tự bật lại khi boot.
- **docker.sock** được mount → deploy app user kiểu Docker-mode được.
- **Dữ liệu:** volume riêng `deploybox-data` (native binary Linux ≠ macOS). Config/project/env vẫn chung qua Supabase → đổi cách chạy chỉ cần **Deploy lại 1 lần**.

**Chuyển qua lại giữa 2 cách:**
```bash
# Đang pm2 → Docker:
pm2 stop all && pm2 kill && docker compose up -d --build
# Đang Docker → pm2:
docker compose down && ./start-server.sh
```
> Sau khi chuyển, vào dashboard **Deploy lại** các app 1 lần (build nằm ở môi trường cũ). Project/env không mất (ở Supabase).

**Dây chuyền tự động khi bật máy:**
```
Bật máy → (pm2 resurrect / docker tự lên) → deploybox-api + web
   → API bootstrap → self-heal bật lại các app đã deploy
   → Caddy tự chạy → subdomain hoạt động → KHÔNG cần deploy lại
```

### 1.3 Vận hành hằng ngày

```bash
pm2 list                      # xem trạng thái 2 app DeployBox
pm2 logs                      # log realtime cả 2
pm2 logs deploybox-api        # log riêng API (vd xem self-heal)
pm2 restart deploybox-api     # restart 1 app
pm2 restart all               # restart cả 2
pm2 stop all / pm2 start all  # tắt / bật
pm2 monit                     # màn hình giám sát CPU/RAM
```

**Khi sửa code DeployBox:** `pnpm build && pm2 restart all` (đổi `.env` thì thêm `--update-env`).

**Self-heal (tự động):** mỗi lần API khởi động, nó quét các app host-run đang `RUNNING`; cái nào process đã chết → **tự chạy lại từ bản build sẵn có**. Chạy lại không được → đánh dấu `STOPPED`. → Tắt máy / reboot **không mất app, không cần deploy lại**.

### 1.4 Lưu ý khi deploy app (rút từ thực tế)

- **Backend NestJS + Prisma (host-run, tắt Docker):**
  - Lệnh build: `npx prisma generate && npm run build`
  - Lệnh chạy: `node dist/src/main` *(nếu compile cả `prisma/`, `scripts/` thì output là `dist/src/main`, không phải `dist/main`)*
  - Env: app validate `APP_URL`/`WEB_URL` phải `https` → đặt `https://...` cho qua validation.
- **Frontend Next.js SSR:** chọn type **BACKEND** (không phải STATIC), build `npm run build`, chạy `npx next start`, đặt 1 cổng riêng (vd 3002).
- **CORS giữa web ↔ backend:** thêm env `CORS_ORIGINS=http://<web-slug>.localhost:8080` cho backend.
- **`NEXT_PUBLIC_*`** của Next.js **nhúng lúc BUILD** → đổi env xong phải **Deploy lại** mới ăn.

> Host-run cài bằng `npm ci --include=dev` (cài cả devDeps để build) và build ở `NODE_ENV=production`.

### 1.5 Checklist & xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Dashboard `ECONNREFUSED :4000` | API chưa chạy | `pm2 restart deploybox-api`, xem `pm2 logs` |
| `EADDRINUSE :::4000` | Chạy cả `pnpm dev` lẫn pm2 | Tắt 1 trong 2 (Ctrl+C dev, hoặc `pm2 stop all` rồi dev) |
| App `502 Bad Gateway` qua Caddy | Process app đã chết | Self-heal tự bật lại khi API restart; hoặc Deploy lại |
| Web báo CORS bị chặn | Backend chưa whitelist origin web | Thêm env `CORS_ORIGINS=...` → Deploy lại backend |
| Build Next.js lỗi `useContext` null | Build ở `NODE_ENV=development` | Build ở production (host-run đã xử lý) |
| Deploy lỗi `input/output error` | Ổ đĩa máy đầy | Dọn cache (`~/.gradle`, `~/.npm`…), `docker system prune` |

**Đường dẫn quan trọng:**
- Cấu hình pm2: `ecosystem.config.js`
- Auto-start (Mac): `~/Library/LaunchAgents/com.deploybox.pm2.plist`
- Process list đã lưu: `~/.pm2/dump.pm2`
- Log app đã deploy: `<deploybox>/apps/api/.deploybox-data/runtime-logs/<slug>.log`
- Build app đã deploy: `<deploybox>/apps/api/.deploybox-data/apps/<slug>/`

---

## Phần 2 — Mở ra internet bằng Cloudflare Tunnel (HTTPS thật, không cần VPS)

Người ngoài vào được `https://yourdomain.com` mà **không cần VPS, không mở cổng router**.

```
Internet → Cloudflare (lo HTTPS) → tunnel (cloudflared trên Mac) → Web/API/Caddy trên Mac
```
`cloudflared` tạo kết nối **đi RA** tới Cloudflare → né chuyện không có IP public / ISP chặn cổng / CGNAT.

**Bạn cần:** 1 domain đặt DNS ở **Cloudflare** (miễn phí) + DeployBox đã chạy OK (Phần 1). Thay `yourdomain.com` và `<bạn>` ở mọi chỗ.

### 2.1 Cài & tạo tunnel
```bash
brew install cloudflared
cloudflared tunnel login                 # mở browser → chọn domain của bạn
cloudflared tunnel create deploybox      # ghi lại Tunnel ID nó in ra
```

> **Cách nhanh không cần domain** (URL tạm để thử): `cloudflared tunnel --url http://localhost:8080` → in ra `https://<ngẫu-nhiên>.trycloudflare.com`.

### 2.2 Cấu hình ingress — `~/.cloudflared/config.yml`
```yaml
tunnel: <TUNNEL_ID>
credentials-file: /Users/<bạn>/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: yourdomain.com
    service: http://localhost:3000        # dashboard (Next)
  - hostname: api.yourdomain.com
    service: http://localhost:4000        # API
  - hostname: "*.yourdomain.com"
    service: http://localhost:8080        # app user (Caddy route theo host)
  - service: http_status:404
```

### 2.3 Trỏ DNS
```bash
cloudflared tunnel route dns deploybox yourdomain.com
cloudflared tunnel route dns deploybox api.yourdomain.com
```
Wildcard `*`: **Cloudflare dashboard → DNS → Add record**:
```
Type: CNAME   Name: *   Target: <TUNNEL_ID>.cfargotunnel.com   Proxied: BẬT (đám mây cam)
```

### 2.4 Cấu hình DeployBox

**a) API** — sửa `deploybox/.env`:
```
APP_DOMAIN=yourdomain.com
PUBLIC_TLS=false
PUBLIC_API_URL=https://api.yourdomain.com
CORS_ORIGIN=https://yourdomain.com
```

**b) Web** — biến `NEXT_PUBLIC_*` nhúng lúc build → tạo `deploybox/apps/web/.env.local`:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

**c) Build lại + restart:** `pnpm build && pm2 restart all --update-env`

### 2.5 Chạy tunnel + giữ máy thức
```bash
cloudflared tunnel run deploybox             # tunnel (chạy nền: pm2 start "cloudflared tunnel run deploybox" --name tunnel)
caffeinate -dimsu                            # giữ Mac KHÔNG ngủ (để hở terminal này)
```

### 2.6 Test
- Mở **`https://yourdomain.com`** từ **điện thoại dùng 4G** (khác wifi nhà) → dashboard có 🔒.
- Tạo project STATIC → Deploy → mở **`https://<slug>.yourdomain.com`** 🔒.

### ⚠️ Lưu ý quan trọng
- Mac phải **bật 24/7, không sleep** (giữ `caffeinate -dimsu`). Gập laptop = sập server.
- **Đĩa:** build app user ăn đĩa → theo dõi `df -h`.
- **Bảo mật:** DeployBox **chạy code lạ ngay trên máy bạn** → chỉ cho người tin tưởng dùng.
- Hợp để **chơi/thử/cho vài người xem**. Chạy thật cho team → VPS vẫn hơn (xem [vps.md](vps.md)).

### Gỡ lỗi tunnel
| Lỗi | Xử lý |
|---|---|
| Không vào được domain | `cloudflared tunnel info deploybox` xem healthy; DNS đã trỏ chưa |
| 502 Bad Gateway | Web :3000 / API :4000 / Caddy :8080 đang chạy chưa (`lsof -i :3000`) |
| Web gọi API fail (CORS) | `CORS_ORIGIN` đúng + đã build lại web với `NEXT_PUBLIC_API_URL` đúng |
| App `<slug>.yourdomain.com` 404 | CNAME `*` đã thêm + Proxied bật; app có đang chạy không |

---

## Tóm tắt 1 phút

- **Server = máy chạy DeployBox.** Phải bật + nối mạng thì app mới sống.
- **Chạy:** `./start-server.sh` (pm2) hoặc `docker compose up -d --build`. Auto-start: launchd (Mac) / `pm2 startup` (Linux).
- **Tắt/reboot:** không mất gì — bật lại là self-heal tự dựng lại mọi app.
- **Windows?** Xem [home-windows.md](home-windows.md). **VPS?** Xem [vps.md](vps.md) / [sneakup-vps.md](sneakup-vps.md).
