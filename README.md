# DeployBox

PaaS tự host: kết nối Git → build → chạy app → tự gắn domain + SSL. Monorepo gồm dashboard (Next.js) + API (NestJS) + gói type dùng chung.

> Kế hoạch chi tiết nằm ở `docs/`. File này chỉ hướng dẫn chạy code.

## Yêu cầu
- Node >= 20 (đang dùng 24)
- pnpm 9 (`corepack enable` để có sẵn)
- Docker (cho Postgres/Redis ở dev) — hoặc tự cài Postgres 16 + Redis 7

## Chạy lần đầu
```bash
corepack enable                 # bật pnpm nếu chưa có
pnpm install                    # cài dependencies toàn monorepo
cp .env.example .env            # sửa biến nếu cần

colima start                                          # Docker (Redis + deploy backend)
docker compose -f docker-compose.dev.yml up -d redis  # Redis cho hàng đợi build
pnpm db:migrate && pnpm db:seed                       # tạo bảng + tài khoản admin

# 2 tiến trình nền (mỗi cái 1 terminal):
pnpm caddy                      # reverse proxy :8080 (app chạy ở http://<slug>.localhost:8080)
pnpm dev                        # API :4000 + Web :3000
```

Mở http://localhost:3000 → đăng nhập (`admin@deploybox.local` / `changeme`). App deploy xong mở tại **`http://<slug>.localhost:8080/`** (Chrome tự resolve `*.localhost`).

## Cấu trúc
```
apps/
  api/      # NestJS — REST + (M1+) build/deploy orchestrator
  web/      # Next.js — dashboard
packages/
  shared/   # enum, zod schema, type dùng chung FE+BE (@deploybox/shared)
```

## Trạng thái: Phase 1 — Milestone M0 (khung nền)
Đã có: monorepo, gói shared, **auth (đăng ký/đăng nhập/JWT)**, Prisma schema đầy đủ, vỏ dashboard.
Tiếp theo (M1): tạo project + luồng deploy web tĩnh xuyên pipeline. Xem `docs/implementation/05-lo-trinh-trien-khai.md`.

## Lệnh hữu ích
| Lệnh | Việc |
|---|---|
| `pnpm dev` | Chạy api + web |
| `pnpm dev:api` / `pnpm dev:web` | Chạy riêng |
| `pnpm typecheck` | Kiểm tra biên dịch toàn repo |
| `pnpm db:studio` | Mở Prisma Studio |
| `pnpm build` | Build production |
