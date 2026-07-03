# DeployBox

PaaS tự host: kết nối Git → build → chạy app → tự gắn domain + SSL. Monorepo gồm dashboard (Next.js) + API (NestJS) + gói type dùng chung. Có AI "bác sĩ lỗi deploy" (Claude/ChatGPT/Gemini), thông báo Telegram, OTP email, admin panel.

## Tài liệu

| Muốn làm gì | Đọc |
|---|---|
| Chạy dev trên máy | File này (bên dưới) |
| Hiểu cơ chế: bấm Deploy thì chuyện gì xảy ra | [docs/co-che-hoat-dong.md](docs/co-che-hoat-dong.md) |
| **Deploy lên VPS** (HTTPS thật) | [docs/deploy/vps.md](docs/deploy/vps.md) — bản production hiện tại: [docs/deploy/sneakup-vps.md](docs/deploy/sneakup-vps.md) |
| Biến máy Mac thành server (pm2 + tunnel) | [docs/deploy/home-mac.md](docs/deploy/home-mac.md) |
| Biến máy Windows thành server (WSL2) | [docs/deploy/home-windows.md](docs/deploy/home-windows.md) |
| Lộ trình tính năng AI | [AI.md](AI.md) |
| Kiến trúc / thiết kế / kế hoạch gốc | [docs/](docs/README.md) |

## Yêu cầu (dev)
- Node >= 20 (đang dùng 24)
- pnpm 9 (`corepack enable` để có sẵn)
- Docker (Redis ở dev + deploy kiểu Docker) — Postgres dùng Supabase (cloud)

## Chạy dev lần đầu
```bash
corepack enable                 # bật pnpm nếu chưa có
pnpm install                    # cài dependencies toàn monorepo
cp .env.example .env            # điền DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY...

colima start                                          # Docker (Redis + deploy backend)
docker compose -f docker-compose.dev.yml up -d redis  # Redis cho hàng đợi build (tùy chọn)
pnpm db:migrate && pnpm db:seed                       # tạo bảng + tài khoản mẫu (CHỈ dev)

# 2 tiến trình nền (mỗi cái 1 terminal):
pnpm caddy                      # reverse proxy :8080 (app chạy ở http://<slug>.localhost:8080)
pnpm dev                        # API :4000 + Web :3000
```

Mở http://localhost:3000. App deploy xong mở tại **`http://<slug>.localhost:8080/`** (Chrome tự resolve `*.localhost`).

> ⚠️ Đừng chạy `pnpm dev` khi pm2/Docker production đang chạy trên cùng máy — đụng cổng 3000/4000 (`EADDRINUSE`).

## Cấu trúc
```
apps/
  api/      # NestJS — REST + build/deploy orchestrator + AI + Telegram + mail
  web/      # Next.js — dashboard
packages/
  shared/   # enum, zod schema, type dùng chung FE+BE (@deploybox/shared)
docs/
  deploy/   # hướng dẫn deploy (VPS / Mac / Windows)
  ...       # thiết kế, kiến trúc, kế hoạch theo phase
```

## Lệnh hữu ích
| Lệnh | Việc |
|---|---|
| `pnpm dev` | Chạy api + web (dev, hot-reload) |
| `pnpm dev:api` / `pnpm dev:web` | Chạy riêng |
| `pnpm typecheck` | Kiểm tra biên dịch toàn repo |
| `pnpm db:studio` | Mở Prisma Studio |
| `pnpm build` | Build production |
| `./start-server.sh` / `./stop-server.sh` | Chạy/tắt production bằng pm2 (xem docs/deploy/home-mac.md) |
