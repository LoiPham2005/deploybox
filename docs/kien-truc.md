# Kiến trúc DeployBox — hiện trạng

> Bản mô tả HỆ THỐNG THẬT đang chạy (thay cho bộ kế hoạch 00→10 cũ — bản đầy đủ vẫn xem được trong git history). Nguồn sự thật cuối cùng luôn là code: `apps/api/prisma/schema.prisma` (data model) và các module trong `apps/api/src/`.

## 1. Bức tranh tổng

```
Trình duyệt ──► Web (Next.js :3000) ──► API (NestJS :4000) ──► Postgres (Supabase cloud)
                                          │
                    ┌─────────────────────┼──────────────────────┐
                    ▼                     ▼                      ▼
              Build/Deploy          Caddy (:8080 dev /       Nền tảng phụ:
              (git clone →          80/443 prod) route       AI đa provider,
              build → chạy)         *.domain → app           Telegram bot, SMTP mail,
                                                             feature flags, metrics
```

- **Monorepo pnpm**: `apps/api` (NestJS) · `apps/web` (Next.js App Router) · `packages/shared` (enum + zod schema + DTO dùng chung — build ra `dist`, đổi là phải build lại).
- **Chạy production**: pm2 (`ecosystem.config.js`) hoặc Docker (`docker-compose.yml`). Xem [deploy/](deploy/).

## 2. Thành phần chính (API)

| Module | Vai trò |
|---|---|
| `auth` | JWT (cookie httpOnly `db_token` phía web), đăng ký OTP email, quên mật khẩu, API token |
| `projects` / `teams` / `servers` | Project thuộc team; RBAC 2 tầng (dưới); server LOCAL/REMOTE (SSH) |
| `deployments` | Tạo/queue deploy, log SSE realtime, rollback, metrics container |
| `deployments/build.runner` | Lõi deploy: clone (PAT mã hoá) → build → chạy; supersede bản cũ; notify |
| `deployments/host-run-reconciler` | Watchdog 60s: app host-run chết → đọc log → restart → AI chẩn đoán; crash-loop >3 lần/10' → STOPPED |
| `webhooks` | Git push (HMAC secret) → auto deploy |
| `domains` | Domain managed `<slug>.APP_DOMAIN` + custom domain (verify TXT) |
| `env` | Biến môi trường per-project (secret mã hoá AES-256-GCM bằng `ENCRYPTION_KEY`), target BUILD/RUNTIME |
| `admin` | Stats, users, đổi plan, feature flags, cấu hình AI, chi phí AI |
| `telegram` | Bot chung: nối tài khoản qua deep-link `/start <code>`, hỏi đáp AI, thông báo deploy |
| `infra/ai` | AiService đa provider (Claude/OpenAI/Gemini) — xem [../AI.md](../AI.md) |
| `infra/mail` | SMTP (Gmail App Password) — OTP đăng ký/quên mật khẩu |
| `infra/caddy` | Đẩy route vào Caddy admin API (:2019); tự xin cert Let's Encrypt khi `PUBLIC_TLS=true` |
| `infra/sleep` | Scale-to-zero: app nhàn rỗi → SLEEPING, wake khi có request |
| `infra/feature-flags` | Bật/tắt tính năng toàn hệ thống (bảng `FeatureFlag`, seed trong code, admin chỉnh) |

## 3. Luồng deploy theo loại project

| Loại | Cách build | Cách chạy | Kết quả |
|---|---|---|---|
| **STATIC** | clone → `buildCommand` → lấy `outputDir` | Caddy serve file tĩnh (release dir, giữ bản cũ để rollback) | `https://<slug>.<domain>` |
| **BACKEND** `useDocker=true` | build Docker image | container `deploybox-<slug>`, limit RAM/CPU | như trên |
| **BACKEND** `useDocker=false` (host-run) | `npm ci --include=dev` → build `NODE_ENV=production` | spawn node detached + pidfile; watchdog tự hồi phục | như trên |
| **MOBILE** (Flutter) | build trong Docker image (`buildImage`) | không chạy — lấy artifact APK/AAB (`artifactPath`) | link tải artifact |
| Server **REMOTE** | script SSH sinh tự động (git pull → build → docker run trên VPS của team) | container trên server đó | `http://<host>:<port>` |

Ghi chú thực chiến: NestJS+Prisma host-run cần build `npx prisma generate && npm run build`, chạy `node dist/src/main`; Next.js SSR = type BACKEND chạy `npx next start`; `NEXT_PUBLIC_*` nhúng lúc build → đổi env phải deploy lại.

## 4. Domain + SSL

- **Dev**: Caddy :8080, app ở `http://<slug>.localhost:8080` (Chrome tự resolve `*.localhost`).
- **Production VPS**: `PUBLIC_TLS=true` + DNS A `@` và `*` trỏ IP → Caddy tự xin cert Let's Encrypt per-host (dashboard, api, mỗi app).
- **Máy nhà**: Cloudflare Tunnel (cert do Cloudflare lo) — xem [deploy/home-mac.md](deploy/home-mac.md).
- Custom domain của user: thêm ở card Domains, verify TXT, đặt primary.

## 5. Data model (tóm tắt — chi tiết xem `schema.prisma`)

`User` (role USER/ADMIN, telegramChatId) → `TeamMember` (OWNER/MEMBER) → `Team` (plan FREE/PRO) → `Project` → `Deployment` (status QUEUED→BUILDING→RUNNING/FAILED..., aiDiagnosis JSON) / `Domain` / `EnvVar` / `WebhookEvent`. Ngoài ra: `Server` (LOCAL/REMOTE per team), `ProjectMember` (cấp quyền project cho MEMBER), `ApiToken`, `FeatureFlag`, `Setting` (key/value: ai_provider, ai_model...), `EmailOtp` (OTP đăng ký/reset).

**RBAC 2 tầng**: role hệ thống (`UserRole` — ADMIN thấy admin panel, bỏ qua limit) ≠ role team (`TeamRole` — OWNER quản team, MEMBER chỉ thấy project được cấp qua `ProjectMember`). Helper: `isAdminRole()` trong shared.

## 6. Nguyên tắc giữ hệ thống sạch

- Type/schema dùng chung **chỉ khai báo ở `packages/shared`** — FE/BE import chung, không định nghĩa lại.
- Secret (git token, SSH key, env secret) **mã hoá at-rest** bằng `ENCRYPTION_KEY` — đổi key là giải mã fail toàn bộ.
- Web đọc token qua cookie httpOnly → mọi thao tác cần auth từ client đi qua **server action** (không `document.cookie`).
- Tính năng bật/tắt được → thêm **feature flag** (seed trong `feature-flags.service.ts`).
- Queue build: có Redis → BullMQ; không có → chạy direct (tự động theo `REDIS_URL`).
