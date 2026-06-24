# Lộ trình triển khai (Phase 1)

Tài liệu này ghép bản triển khai [03-backend-nestjs.md](03-backend-nestjs.md) và [04-frontend-nextjs.md](04-frontend-nextjs.md) thành **một lộ trình code theo milestone** cho Phase 1 (web tĩnh + backend, dùng nội bộ). Phạm vi Phase 1 xem [../06-phase-1-mvp.md](../06-phase-1-mvp.md).

---

## 1. Nguyên tắc: vertical slice trước

> Làm **mỏng nhưng xuyên suốt** một luồng (một loại app, một đường đi end-to-end) để chứng minh cả pipeline sớm — rồi mới mở rộng chiều rộng.

Lý do: rủi ro lớn nhất nằm ở **tích hợp hạ tầng** (Docker daemon + Caddy Admin API + Cloudflare DNS + SSL). Phải chạm vào chúng **sớm nhất có thể**, không để dồn về cuối. Vì vậy Milestone 1 cố tình đi xuyên toàn bộ pipeline với loại app dễ nhất (web tĩnh).

---

## 2. Bản đồ milestone

```
M0 Khung dự án ─▶ M1 Slice web tĩnh ─▶ M2 Web backend ─▶ M3 Domain+SSL+rollback ─▶ M4 Tự động hoá
   (nền tảng)       (⭐ xuyên pipeline)   (container 24/7)   (custom domain)         (webhook, sleep)
```

### M0 — Khung dự án (foundation)
**Mục tiêu:** bộ khung chạy được, đăng nhập được, DB sẵn sàng.

Backend:
- [ ] Monorepo pnpm + gói `@deploybox/shared` + tooling (xem [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md))
- [ ] `docker-compose.dev.yml` (postgres + redis + minio)
- [ ] Prisma schema + `migrate init` + seed team/user mặc định (xem [01-data-model-prisma.md](01-data-model-prisma.md))
- [ ] NestJS skeleton: ConfigModule, PrismaModule, AuthModule (register/login/me + JWT), JwtAuthGuard
- [ ] Health endpoint

Frontend:
- [ ] Next.js skeleton + Tailwind + shadcn/ui
- [ ] Trang login/register, lưu token, middleware bảo vệ route
- [ ] Vỏ dashboard (layout + sidebar + empty state)

**Done when:** đăng nhập → thấy dashboard rỗng.

---

### M1 — ⭐ Vertical slice: deploy WEB TĨNH từ Git → subdomain + SSL
Slice quan trọng nhất — chạm toàn bộ hạ tầng lần đầu.

Backend:
- [ ] ProjectsModule: tạo/list/chi tiết project (`type=STATIC`)
- [ ] QueueModule + **BuildProcessor**: clone repo → build → publish file tĩnh, stream log
- [ ] **DeployProcessor (STATIC)**: đăng ký file-server route vào Caddy cho `<slug>.deploybox.app`
- [ ] **CaddyService**: upsert route + auto-TLS (Caddy Admin API)
- [ ] **CloudflareService**: tạo DNS record cho subdomain
- [ ] RealtimeGateway + emit `DEPLOYMENT_LOG`/`DEPLOYMENT_STATUS`; DeploymentsModule

Frontend:
- [ ] Form tạo project (zod schema dùng chung)
- [ ] Trang project detail + nút **Deploy**
- [ ] Màn deployment detail: **log realtime** + badge trạng thái

**Done when:** nhập repo web tĩnh → bấm Deploy → xem log chạy live → mở `https://<slug>.deploybox.app` thấy site có SSL.

---

### M2 — WEB BACKEND (container 24/7)
Backend:
- [ ] BuildProcessor nhánh `BACKEND`: `docker build` ra image
- [ ] **DockerService.run**: container + resource limit (memory/cpu/pids) + non-root + inject env RUNTIME
- [ ] DeployProcessor (BACKEND): `reverse_proxy` route → `container:internalPort`; healthcheck; dừng bản cũ (zero-downtime cơ bản)
- [ ] EnvModule: CRUD env, **mã hoá secret** (CryptoService)
- [ ] stop/restart project

Frontend:
- [ ] Tab **Env vars** (form, schema dùng chung)
- [ ] Hiển thị `type=BACKEND`, trạng thái `RUNNING`, nút stop/restart
- [ ] Lịch sử deployment + xem lại log

**Done when:** deploy app Node có env → truy cập subdomain thấy app chạy; đổi env → redeploy ăn ngay.

---

### M3 — Custom domain + SSL + rollback
Backend:
- [ ] DomainsModule: add domain → trả hướng dẫn DNS + `verifyToken`; verify (TXT) → xin cert (DNS-01 cho wildcard); Caddy gắn hostname (xem [../04-domain-ssl.md](../04-domain-ssl.md))
- [ ] redeploy (rollback) endpoint

Frontend:
- [ ] Tab **Domains**: thêm domain, hiển thị hướng dẫn DNS, trạng thái cấp SSL (cập nhật qua WS/polling)
- [ ] Nút **redeploy** từ lịch sử

**Done when:** gắn domain thật → verify → `ACTIVE` + HTTPS; rollback về bản cũ được.

---

### M4 — Tự động hoá & hoàn thiện
Backend:
- [ ] WebhooksModule: git push → auto deploy (verify HMAC bằng `webhookSecret`)
- [ ] sleep-idle job + wake-on-request (scale-to-zero) cho project bật `sleepEnabled` (xem [../10-chi-phi-va-van-hanh.md](../10-chi-phi-va-van-hanh.md))
- [ ] cleanup job (prune image/container cũ)

Frontend:
- [ ] Toggle `autoDeploy`, `sleepEnabled`
- [ ] Trạng thái `SLEEPING`, trang Settings của project
- [ ] Polish: toast, error/empty states

**Done when:** push code → tự deploy; app idle ngủ rồi tự thức khi có truy cập.

---

## 3. Thứ tự & phụ thuộc

```
M0 ──▶ M1 ──▶ M2 ──▶ M3 ──▶ M4
        ▲
   rủi ro cao nhất (Docker + Caddy + Cloudflare + SSL lần đầu)
   → làm sớm để lộ rủi ro sớm, đừng dồn về cuối
```

## 4. Ước lượng tương đối (1 dev, chỉ để tham khảo)

| Milestone | Ước lượng | Ghi chú |
|---|---|---|
| M0 | ~1 tuần | Khung + auth |
| M1 | ~1.5–2 tuần | Đường pipeline đầu tiên, nhiều tích hợp |
| M2 | ~1.5 tuần | Container + env |
| M3 | ~1 tuần | Domain + SSL + rollback |
| M4 | ~1 tuần | Webhook + sleep + dọn dẹp |

## 5. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Tích hợp Docker daemon phức tạp | Làm M1 sớm; test trên **VPS thật** sớm, đừng chỉ local |
| Caddy Admin API lạ tay | Viết POC riêng (upsert 1 route) trước khi nhúng vào code |
| SSL wildcard cần DNS-01 | Thử tay với Cloudflare token trước (xem [../04-domain-ssl.md](../04-domain-ssl.md)) |
| Chạy code lạ của user | Phase 1 tin user, nhưng **đặt sẵn resource limit + non-root** ngay từ M2 (xem [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md)) |

## 6. Definition of Done — Phase 1

> Team nội bộ tạo được project **web tĩnh + backend**, **deploy từ Git**, **xem log realtime**, **gắn domain riêng có SSL**, **quản env/secret**, **rollback** — tất cả từ dashboard, **không cần SSH**.

Khi đạt mốc này, bạn đã có **MVP nội bộ = nền của SaaS** (xem [../00-tong-quan.md](../00-tong-quan.md) §5). Bước mở rộng tiếp theo: mobile ([../07-phase-2-mobile.md](../07-phase-2-mobile.md)) và SaaS ([../08-phase-3-saas.md](../08-phase-3-saas.md)).
