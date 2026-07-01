# Hướng dẫn chạy DeployBox làm server (production)

Tài liệu này ghi lại **đúng cách đã set up + test thật**: chạy DeployBox bằng **pm2** ở chế độ production, **tự khởi động khi bật máy**, và **tự hồi phục** (self-heal) các app đã deploy sau mỗi lần restart. Cuối cùng có phần **chạy ở nhà trên Windows (WSL2)**.

---

## 1. Tổng quan — cái gì chạy ở đâu

| Thành phần | Cổng | Chạy bằng | Ghi chú |
|---|---|---|---|
| **DeployBox API** (NestJS) | 4000 | pm2 (`deploybox-api`) | Lõi điều khiển; tự đọc `.env` |
| **DeployBox Web** (Next.js) | 3000 | pm2 (`deploybox-web`) | Dashboard |
| **Caddy** | 8080 | API tự bật | Reverse proxy theo subdomain |
| **App bạn deploy** (host-run) | 3001, 3002… (nội bộ) | API tự spawn (detached) | Self-heal quản lý |
| **PostgreSQL** | — | **Supabase** (cloud) | Config + env + lịch sử deploy |

**Luồng truy cập:** Trình duyệt → `*.localhost:8080` (Caddy) → app nội bộ ở cổng riêng. Bạn chỉ dùng `localhost:3000` (dashboard) và `<slug>.localhost:8080` (app), khỏi quan tâm cổng nội bộ.

---

## 2. Chạy production — 2 cách (chọn 1)

> **KHÔNG dùng `pnpm dev`** cho server (dev hay restart, kill app). Có **2 cách chạy**, file cấu hình để chung trong repo, **dùng cái nào tùy bạn — nhưng chỉ chạy 1 cái 1 lúc** (cả 2 đều dùng cổng 3000/4000/8080, bật cùng lúc sẽ **đụng cổng**).

| | **Cách A — pm2 native** | **Cách B — Docker** |
|---|---|---|
| Lệnh chạy | `./start-server.sh` | `docker compose up -d --build` |
| Cần cài sẵn | node, pnpm, caddy, (docker) | chỉ cần Docker |
| Hợp khi | Chạy 1 máy, nhẹ, đang dùng | Bê sang máy khác / nhiều server / WSL2 |

### Cách A — pm2 native (đang dùng, khuyến nghị 1 máy)

**1 lệnh:**
```bash
./start-server.sh            # cài deps + build + (re)start pm2 + save
./start-server.sh --no-build # restart nhanh, bỏ qua build
```
Script dùng [`ecosystem.config.js`](ecosystem.config.js) (2 app `deploybox-api`, `deploybox-web`, `autorestart`).

**Tự khởi động khi bật máy:**
- **Mac:** LaunchAgent chạy `pm2 resurrect` khi đăng nhập.
  - File: `~/Library/LaunchAgents/com.deploybox.pm2.plist`
  - Đăng ký: `launchctl load -w ~/Library/LaunchAgents/com.deploybox.pm2.plist`
  - Tự lên **sau reboot không cần đăng nhập tay** → bật **System Settings → Users & Groups → Automatically log in**.
- **Linux / WSL2:** `pm2 startup` (in ra 1 lệnh sudo → chạy nó, tạo systemd) → `pm2 save`.

### Cách B — Docker (1 lệnh, dễ bê đi)

```bash
docker compose up -d --build   # build image + chạy DeployBox (api+web+caddy trong container)
docker compose logs -f         # xem log
docker compose down            # dừng
```
- File: [`Dockerfile`](Dockerfile) + [`docker-compose.yml`](docker-compose.yml) + [`ecosystem.docker.config.js`](ecosystem.docker.config.js).
- Image gồm sẵn node + caddy + git + docker-cli → DeployBox tự build & chạy app user **bên trong container**.
- **Tự khởi động khi boot:** đã có `restart: unless-stopped` → Docker tự bật lại container.
- **docker.sock** được mount → deploy app user kiểu Docker-mode được (app chạy trên host; Caddy gọi qua `host.docker.internal`).
- **Dữ liệu:** dùng volume riêng `deploybox-data` (native binary Linux ≠ macOS nên không chia sẻ build với pm2). **Config/project/env vẫn chung qua Supabase** → đổi sang Docker chỉ cần **Deploy lại 1 lần** trong môi trường mới (không phải tạo lại project).

### Chuyển qua lại giữa 2 cách

```bash
# Đang pm2 → chuyển sang Docker:
pm2 stop all && pm2 kill        # tắt pm2 (giải phóng 3000/4000/8080)
docker compose up -d --build

# Đang Docker → chuyển về pm2:
docker compose down
./start-server.sh
```
> Sau khi chuyển, vào dashboard **Deploy lại** các app 1 lần (vì build nằm ở môi trường cũ). Project/env không mất (ở Supabase).

### Dây chuyền tự động khi bật máy
```
Bật máy → (pm2 resurrect / docker tự lên) → deploybox-api + web
   → API bootstrap → self-heal bật lại các app đã deploy
   → Caddy tự chạy → subdomain hoạt động   → KHÔNG cần deploy lại
```

---

## 3. Vận hành hằng ngày

```bash
pm2 list                      # xem trạng thái 2 app DeployBox
pm2 logs                      # log realtime cả 2
pm2 logs deploybox-api        # log riêng API (vd xem self-heal)
pm2 restart deploybox-api     # restart 1 app
pm2 restart all               # restart cả 2
pm2 stop all / pm2 start all  # tắt / bật
pm2 monit                     # màn hình giám sát CPU/RAM
```

**Khi sửa code DeployBox** (không dùng `pnpm dev` cho server):
```bash
pnpm build
pm2 restart all
```

**Self-heal (tự động):** mỗi lần API khởi động, nó quét các app host-run đang `RUNNING`; cái nào process đã chết → **tự chạy lại từ bản build sẵn có** (không build lại). Chạy lại không được → đánh dấu `STOPPED` cho khớp thực tế. → Tắt máy / reboot **không mất app, không cần deploy lại**.

---

## 4. Deploy app của bạn (không đổi)

Vào dashboard `localhost:3000` → tạo/chọn project → **Deploy**. Vài lưu ý rút ra từ thực tế:

- **Backend NestJS + Prisma (host-run, tắt Docker):**
  - Lệnh build: `npx prisma generate && npm run build`
  - Lệnh chạy: `node dist/src/main` *(nếu compile cả `prisma/`, `scripts/` thì output là `dist/src/main`, không phải `dist/main`)*
  - Env: nếu app validate `APP_URL`/`WEB_URL` phải `https` → đặt `https://...` cho qua validation.
- **Frontend Next.js SSR:** chọn type **BACKEND** (không phải STATIC), Lệnh build `npm run build`, Lệnh chạy `npx next start` (tự dùng cổng `PORT`), đặt 1 cổng riêng (vd 3002).
- **CORS giữa web ↔ backend:** thêm env `CORS_ORIGINS=http://<web-slug>.localhost:8080` cho backend (validation chỉ cấm `*` ở production, cho phép `http`).
- **`NEXT_PUBLIC_*`** của Next.js **nhúng lúc BUILD** → đổi env xong phải **Deploy lại** mới ăn.

> Cài đặt host-run dùng `npm ci --include=dev` (cài cả devDeps để build) và build ở `NODE_ENV=production` (Next.js bắt buộc).

---

## 5. Chạy ở nhà trên Windows → dùng WSL2

DeployBox viết cho Unix (`sh`, process group, Caddy). **Windows thuần không chạy được — phải qua WSL2** (Linux trong Windows).

### Các bước (làm 1 lần)
1. **Bật WSL2** — PowerShell (admin): `wsl --install` → reboot (tự cài Ubuntu).
2. **Trong Ubuntu (WSL):**
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   nvm install 24
   npm i -g pnpm pm2
   sudo apt install -y caddy          # hoặc để DeployBox tự tải
   ```
3. **Đưa code về:** `git push` từ máy này → `git clone` trong WSL (để code **trong** WSL, đừng để `/mnt/c/...` — chậm + lỗi line-ending).
4. **Copy `.env`** — ⚠️ giữ NGUYÊN: `DATABASE_URL` (Supabase dùng chung), `ENCRYPTION_KEY` (khác key → secret cũ giải mã lỗi), `JWT_SECRET`.
5. **Build + chạy:** `pnpm install && pnpm build` → `pm2 start ecosystem.config.js`.

### 2 chỗ phải sửa cho WSL/Windows
> `ecosystem.config.js` không cần sửa path — tự nhận (`__dirname`).

| Mac (hiện tại) | WSL2 (ở nhà) |
|---|---|
| Auto-start = **launchd** (LaunchAgent) | dùng **`pm2 startup`** → tạo **systemd** |
| Docker = Colima | Docker Desktop for Windows + bật **WSL2 integration** *(chỉ cần nếu deploy bằng Docker; host-run thì không cần)* |

Còn lại — self-heal, host-run, Caddy, Supabase — **chạy y hệt**.

> Muốn người ngoài truy cập qua `https://domain-thật` (không VPS, không mở cổng router): xem [`DEPLOY-HOME-WINDOWS.md`](DEPLOY-HOME-WINDOWS.md) (Cloudflare Tunnel).

---

## 6. Checklist & xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Dashboard `ECONNREFUSED :4000` | API chưa chạy | `pm2 restart deploybox-api`, xem `pm2 logs` |
| App `502 Bad Gateway` qua Caddy | Process app đã chết | Self-heal tự bật lại khi API restart; hoặc Deploy lại |
| Status "Đang chạy" nhưng 502 | App chết, chưa kịp self-heal | `pm2 restart deploybox-api` (trigger self-heal) |
| Web báo CORS bị chặn | Backend chưa whitelist origin web | Thêm env `CORS_ORIGINS=http://<web>.localhost:8080` → Deploy lại backend |
| Build Next.js lỗi `useContext` null | Build ở `NODE_ENV=development` | Đảm bảo build ở production (host-run đã xử lý) |
| Deploy lỗi `input/output error` | Ổ đĩa máy đầy | Dọn ổ (cache `~/.gradle`, `~/.npm`…), `docker system prune` |

**Đường dẫn quan trọng:**
- Cấu hình pm2: `ecosystem.config.js`
- Auto-start (Mac): `~/Library/LaunchAgents/com.deploybox.pm2.plist`
- Process list đã lưu: `~/.pm2/dump.pm2`
- Log app đã deploy: `<deploybox>/apps/api/.deploybox-data/runtime-logs/<slug>.log`
- Build app đã deploy: `<deploybox>/apps/api/.deploybox-data/apps/<slug>/`

---

## 7. Tóm tắt 1 phút

- **Server = máy chạy DeployBox** (Mac công ty hiện tại; ở nhà sẽ là Windows/WSL2). Phải **bật + nối mạng** thì app mới sống.
- **Chạy:** `pnpm build` → `pm2 start ecosystem.config.js` → `pm2 save`. Auto-start qua launchd (Mac) / `pm2 startup` (Linux/WSL).
- **Tắt/reboot:** không mất gì — bật lại là **self-heal tự dựng lại** mọi app.
- **Deploy app:** dùng dashboard như bình thường; lưu ý cấu hình ở mục 4.
