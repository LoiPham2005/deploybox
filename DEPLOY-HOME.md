# Biến máy cá nhân (Mac) thành server — Cloudflare Tunnel

Chạy DeployBox **ngay trên Mac của bạn**, người ngoài vẫn vào được `https://yourdomain.com` (HTTPS thật).
**Không cần VPS, không cần mở cổng router.**

## Cách hoạt động
```
Internet → Cloudflare (lo HTTPS) → tunnel (cloudflared trên Mac) → Web/API/Caddy trên Mac
```
- `cloudflared` tạo kết nối **đi RA** tới Cloudflare → né được chuyện không có IP public / ISP chặn cổng / CGNAT.
- Cloudflare nhận traffic + cấp HTTPS, đẩy về máy bạn.

## Bạn cần
- **1 domain**, đặt DNS ở **Cloudflare** (miễn phí — đổi nameserver của domain về Cloudflare).
- DeployBox **đã chạy local OK** (Colima/Docker, Redis, Caddy, API, Web).

Thay `yourdomain.com` và `<bạn>` (tên user Mac) ở mọi chỗ.

---

## Bước 1 — Cài & tạo tunnel
```bash
brew install cloudflared
cloudflared tunnel login                 # mở browser → chọn domain của bạn
cloudflared tunnel create deploybox      # ghi lại Tunnel ID nó in ra
```

## Bước 2 — Cấu hình ingress
Tạo file `~/.cloudflared/config.yml`:
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

## Bước 3 — Trỏ DNS
```bash
cloudflared tunnel route dns deploybox yourdomain.com
cloudflared tunnel route dns deploybox api.yourdomain.com
```
Wildcard `*`: vào **Cloudflare dashboard → DNS → Add record**:
```
Type: CNAME   Name: *   Target: <TUNNEL_ID>.cfargotunnel.com   Proxied: BẬT (đám mây cam)
```

## Bước 4 — Cấu hình DeployBox

**a) API** — sửa `deploybox/.env`:
```
APP_DOMAIN=yourdomain.com
PUBLIC_TLS=false
PUBLIC_API_URL=https://api.yourdomain.com
CORS_ORIGIN=https://yourdomain.com
```

**b) Web** — biến `NEXT_PUBLIC_*` nhúng lúc build nên phải đặt riêng cho web.
Tạo `deploybox/apps/web/.env.local`:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

**c) Build lại** (vì đổi domain + biến public):
```bash
cd deploybox
pnpm build:shared
pnpm --filter @deploybox/api build
pnpm --filter @deploybox/web build
```

## Bước 5 — Chạy tất cả (mỗi dòng 1 terminal, hoặc dùng `&`)
```bash
colima start
docker compose -f docker-compose.dev.yml up -d redis

pnpm caddy                                   # reverse proxy app user (:8080)
cd apps/api && node dist/main.js             # API :4000
cd apps/web && pnpm start                    # Web :3000 (bản build)
cloudflared tunnel run deploybox             # tunnel
caffeinate -dimsu                            # giữ Mac KHÔNG ngủ (để hở terminal này)
```

## Bước 6 — Test
- Mở **`https://yourdomain.com`** từ **điện thoại dùng 4G** (khác wifi nhà) → vào được dashboard có 🔒.
- Đăng nhập → **đổi mật khẩu seed ngay**.
- Tạo project STATIC (repo HTML) → Deploy → mở **`https://<slug>.yourdomain.com`** 🔒.

---

## ⚠️ Lưu ý quan trọng
- Mac phải **bật 24/7, không sleep** → giữ terminal `caffeinate -dimsu`. Gập laptop = sập server.
- **Đĩa**: build app user tạo image/container ăn đĩa máy bạn (đang còn ~12GB) → dễ đầy. Theo dõi `df -h`.
- **Bảo mật**: DeployBox **chạy code lạ ngay trên máy bạn** → chỉ cho **người tin tưởng** dùng, đừng public lung tung.
- Đây là cách **chơi/thử/cho vài người xem** rất hợp. Khi cần chạy thật cho team luôn-bật + an toàn → 1 VPS rẻ vẫn đáng hơn (xem [DEPLOY.md](DEPLOY.md)).

## Gỡ lỗi
| Lỗi | Xử lý |
|---|---|
| Không vào được domain | `cloudflared tunnel info deploybox` xem tunnel có healthy; DNS đã trỏ chưa |
| 502 Bad Gateway | Web :3000 / API :4000 / Caddy :8080 đang chạy chưa (`lsof -i :3000`) |
| Web gọi API fail (CORS) | `CORS_ORIGIN=https://yourdomain.com` + đã build lại web với `NEXT_PUBLIC_API_URL` đúng |
| App `<slug>.yourdomain.com` 404 | Bản ghi CNAME `*` đã thêm + Proxied bật chưa; `docker ps` xem app chạy |

> Vướng đâu chụp màn hình / copy log gửi mình, mình gỡ cùng.
