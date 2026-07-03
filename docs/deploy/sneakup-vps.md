# Đẩy DeployBox lên VPS — sneakup.io.vn (hướng dẫn riêng cho máy này)

> Bản cá nhân hoá của [vps.md](vps.md) với thông số thật:
> - **VPS:** `14.225.204.227` · user `root` · SSH port `22` (mật khẩu đã có riêng — **KHÔNG ghi vào file này**, file có thể bị commit/lộ)
> - **Domain:** `sneakup.io.vn`
> - ⚠️ **VPS dùng chung (dùng ké)** → mọi bước cài đặt đều phải KIỂM TRA TRƯỚC, không ghi đè/tắt đồ của người khác, KHÔNG tự ý bật firewall.

Kết quả sau khi xong:
- Dashboard: **`https://sneakup.io.vn`**
- API: **`https://api.sneakup.io.vn`**
- App deploy ra: **`https://<slug>.sneakup.io.vn`** — HTTPS thật (Let's Encrypt tự cấp).

---

## Bước 0 — Trỏ DNS (làm ở trang quản lý tên miền, chỉ bạn làm được)

Vào nơi quản lý DNS của `sneakup.io.vn` (iNET/Mắt Bão/PA/Cloudflare…), thêm **2 bản ghi A**:

| Loại | Tên (Host) | Giá trị | TTL |
|---|---|---|---|
| A | `@` | `14.225.204.227` | Auto/300 |
| A | `*` | `14.225.204.227` | Auto/300 |

`@` = trang chính; `*` (wildcard) = `api.` + mọi app `<slug>.sneakup.io.vn`.

Kiểm tra từ máy Mac (đợi vài phút tới vài giờ cho DNS lan):
```bash
dig +short sneakup.io.vn        # phải ra 14.225.204.227
dig +short api.sneakup.io.vn    # phải ra 14.225.204.227
```
**Chưa ra đúng IP thì đừng làm tiếp** — Let's Encrypt sẽ cấp cert thất bại.

---

## Bước 1 — SSH vào VPS + soi máy TRƯỚC KHI cài (quan trọng vì dùng chung)

```bash
ssh root@14.225.204.227
```

Soi những gì đang chạy để không đụng hàng:
```bash
# Cổng nào đang bị chiếm? DeployBox cần: 80, 443 (Caddy), 3000, 4000 (app), 2019 (Caddy admin), 6379 (Redis)
ss -tlnp | grep -E ':80 |:443 |:3000 |:4000 |:2019 |:6379 '

# Đã có sẵn gì chưa?
node -v; docker -v; pm2 -v; caddy version; nginx -v
```

**Đọc kết quả:**
- **Cổng 80/443 TRỐNG** → làm tiếp bình thường ✅
- **Cổng 80/443 ĐANG BỊ nginx/apache/caddy của người khác chiếm** → DỪNG LẠI, hỏi chủ VPS. HTTPS tự động bắt buộc cần 80/443; không chiếm được thì phải nhờ chủ VPS cấu hình reverse-proxy trỏ 2 domain trên về cổng 3000/4000 của mình (cách này mất tính năng subdomain tự động cho app — chỉ chữa cháy).
- **Cổng 3000/4000/6379 bận** → đổi cổng của DeployBox trong `.env` (PORT, WEB port trong ecosystem, REDIS_URL) sang cổng trống, vd 3100/4100.
- **KHÔNG chạy** `ufw enable` hay đổi firewall — máy của người khác, lỡ khoá nhầm SSH của họ là toang.

---

## Bước 2 — Cài phần mềm còn thiếu (chỉ cài cái CHƯA có)

```bash
# Node 20 (bỏ qua nếu node -v đã ra v18+)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs

# git + pnpm
apt-get install -y git
corepack enable && corepack prepare pnpm@9 --activate

# pm2 (bỏ qua nếu đã có — nếu người khác đang dùng pm2 thì vẫn ổn,
# process của mình đặt tên deploybox-* nên không lẫn)
npm i -g pm2

# Docker (chỉ cần nếu muốn deploy app kiểu Docker; host-run thì bỏ qua được)
curl -fsSL https://get.docker.com | sh

# Caddy (binary, KHÔNG bật service mặc định để khỏi tranh cổng với ai)
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
systemctl disable --now caddy   # tắt service mặc định — ta chạy config riêng ở Bước 5
```

---

## Bước 3 — Lấy code về VPS (qua GitHub)

Code đã có trên GitHub → clone thẳng trên VPS:

```bash
# Repo public:
git clone https://github.com/LoiPham2005/deploybox.git /opt/deploybox

# Repo PRIVATE: dùng token (fine-grained, chỉ cần Contents: Read):
# git clone https://<GITHUB_TOKEN>@github.com/<user>/<repo>.git /opt/deploybox

cd /opt/deploybox && pnpm install
```

> ⚠️ Kiểm tra trên trang GitHub: repo KHÔNG được chứa file `.env` (chỉ `.env.example` là đúng).
> Lỡ commit `.env` → xoá khỏi repo + đổi toàn bộ secret bên trong ngay.
>
> (Cách dự phòng nếu không dùng GitHub: rsync từ máy Mac —
> `rsync -avz --exclude node_modules --exclude .next --exclude dist --exclude .deploybox-data --exclude .env --exclude .git deploybox/ root@14.225.204.227:/opt/deploybox/`)

---

## Bước 4 — Tạo `.env` production trên VPS

Tạo `/opt/deploybox/.env` (`nano /opt/deploybox/.env`):

```bash
# ── DB: DÙNG CHUNG Supabase với máy local (copy nguyên DATABASE_URL từ .env local) ──
DATABASE_URL=<copy từ .env trên máy Mac>

# ── Bảo mật ──
# ENCRYPTION_KEY: BẮT BUỘC copy ĐÚNG key từ .env local!
# (git token/SSH key trong DB đã mã hoá bằng key này — key khác là giải mã fail toàn bộ)
ENCRYPTION_KEY=<copy từ .env trên máy Mac>
# JWT_SECRET: nên đặt chuỗi mới, dài (chỉ làm mọi người phải đăng nhập lại):
JWT_SECRET=<chạy: openssl rand -hex 32>
JWT_EXPIRES_IN=7d

# ── HTTPS production ──
PUBLIC_TLS=true
APP_DOMAIN=sneakup.io.vn
ACME_EMAIL=phamducloi919@gmail.com
PORT=4000
WEB_UPSTREAM=localhost:3000
API_UPSTREAM=localhost:4000
PUBLIC_API_URL=https://api.sneakup.io.vn
NEXT_PUBLIC_API_URL=https://api.sneakup.io.vn
CORS_ORIGIN=https://sneakup.io.vn
CADDY_ADMIN_URL=http://localhost:2019

# ── Redis (tùy chọn — để trống REDIS_URL nếu không cài Docker) ──
REDIS_URL=

# ── Telegram + AI (copy nguyên từ .env local nếu muốn dùng trên VPS) ──
TELEGRAM_BOT_TOKEN=<copy từ local — xem ⚠️ Bước 7 trước>
TELEGRAM_CHAT_ID=<copy từ local>
GEMINI_API_KEY=<copy từ local>
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

Ctrl+O, Enter, Ctrl+X.

> ⚠️ **BẮT BUỘC** — Next.js KHÔNG đọc `.env` ở gốc repo lúc build. Phải tạo thêm file env
> riêng cho web, không thì nút Đăng nhập sẽ gọi nhầm `localhost:4000`:
> ```bash
> echo 'NEXT_PUBLIC_API_URL=https://api.sneakup.io.vn' > /opt/deploybox/apps/web/.env.production
> ```

Chuẩn bị DB client (DB đã có sẵn dữ liệu — **KHÔNG chạy seed** kẻo tạo lại account mẫu):
```bash
cd /opt/deploybox
pnpm --filter @deploybox/api exec prisma generate
```

---

## Bước 5 — Build + chạy nền

```bash
cd /opt/deploybox
make build          # build shared → api → web (Makefile có sẵn trong repo)

# Caddy chạy nền bằng systemd (config riêng của DeployBox, không đụng ai)
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

# API + Web bằng pm2 (ecosystem.config.js tự nhận đường dẫn, không phải sửa)
make up             # = pm2 start ecosystem.config.js
make save           # pm2 nhớ danh sách process
pm2 startup         # in ra 1 lệnh → copy chạy lệnh đó → tự bật sau reboot
```

Khi API khởi động, `CaddyService` tự đẩy route dashboard + api + mọi app vào Caddy,
Caddy tự xin cert Let's Encrypt cho từng host (cần DNS ở Bước 0 đã trỏ đúng).

---

## Bước 6 — Kiểm tra

```bash
# Trên VPS:
make health                      # API 4000 + Web 3000 phải HTTP 200
journalctl -u deploybox-caddy -n 30   # xem Caddy xin cert có lỗi không

# Từ máy Mac / điện thoại:
# 1. https://sneakup.io.vn        → dashboard, có khoá 🔒
# 2. Đăng nhập tài khoản của bạn (DB dùng chung nên account giữ nguyên)
# 3. Deploy thử 1 project → https://<slug>.sneakup.io.vn
```

---

## ⚠️ Bước 7 — QUAN TRỌNG: 2 máy chạy chung 1 DB

VPS và máy Mac ở nhà đang **dùng chung Supabase DB + chung bot Telegram**. Nếu chạy CẢ HAI cùng lúc sẽ đụng nhau:

| Đụng gì | Hậu quả |
|---|---|
| Bot Telegram (getUpdates) | 2 nơi cùng poll → Telegram trả lỗi 409, bot lúc được lúc không |
| Watchdog / self-heal | VPS thấy app "chết" (vì app chạy ở máy Mac chứ không phải VPS) → đánh dấu STOPPED lung tung |
| Báo cáo ngày | Gửi 2 lần |

**Chọn 1 trong 2:**
- **VPS là chính** (khuyên dùng): sau khi VPS chạy OK, về máy Mac chạy `make stop` (và tắt LaunchAgent auto-start nếu có). Máy Mac chỉ để dev.
- **Mac là chính**: thì VPS chỉ để thử nghiệm — đừng để pm2 startup trên VPS.

Muốn chạy song song thật sự thì phải tách: DB riêng + bot Telegram riêng cho mỗi máy.

---

## Cập nhật code sau này

```bash
# Máy Mac: commit + push lên GitHub như bình thường, rồi:
ssh root@14.225.204.227 'cd /opt/deploybox && git pull && pnpm install && make deploy'
```

---

## Lỗi thường gặp

| Triệu chứng | Xử lý |
|---|---|
| `https://sneakup.io.vn` không lên / cert lỗi | `dig +short sneakup.io.vn` phải ra IP VPS; cổng 80/443 không bị ai chiếm; `journalctl -u deploybox-caddy` |
| Đăng nhập "Failed to fetch" / web gọi `localhost:4000` | Next KHÔNG đọc `.env` gốc lúc build → tạo `apps/web/.env.production` chứa `NEXT_PUBLIC_API_URL=https://api.sneakup.io.vn` rồi `make deploy-web` |
| Project cũ vẫn hiện domain `.localhost` | Domain managed sinh lúc tạo project. Thêm domain mới `<slug>.sneakup.io.vn` ở card Domains rồi đặt làm chính |
| Đăng nhập bị văng liên tục | JWT_SECRET trên VPS khác local → bình thường, đăng nhập lại là xong |
| Project private không clone được | ENCRYPTION_KEY trên VPS KHÁC local → git token trong DB giải mã fail. Copy đúng key local sang |
| Bot Telegram chập chờn | Đang chạy cả 2 máy — xem Bước 7 |

---

## Ghi chú: start-server.sh / stop-server.sh (dùng cho máy Mac, KHÔNG dùng trên VPS này)

- `./start-server.sh` ≈ `make build` + `make up` + `make save` — tiện cho máy Mac ở nhà.
- `./stop-server.sh` — ⚠️ có `pm2 delete all`: trên VPS DÙNG CHUNG sẽ xoá cả process pm2
  của người khác. Trên VPS chỉ dùng `make stop` (chỉ đụng deploybox-api/deploybox-web).

