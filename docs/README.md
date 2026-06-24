# DeployBox — Kế hoạch xây nền tảng deploy tự host (PaaS)

> **Mục tiêu:** xây một web dashboard cho phép từ một chỗ: kết nối Git → build → chạy app trên server của mình → **tự gắn domain + SSL**. Dùng **nội bộ team trước**, tiến hóa thành **SaaS/khởi nghiệp** sau. Tự host trên VPS.

Đây là một **PaaS thu nhỏ** kiểu Coolify / CapRover / Dokku / Dokploy / Railway / Vercel — nhưng tự code, tự chủ hạ tầng, và mở rộng được sang **build/distribution app mobile** (thứ các PaaS kia không làm).

`DeployBox` là tên codename tạm — đổi thoải mái.

---

## Đọc theo thứ tự nào

**Nếu bạn chỉ có 10 phút:** đọc [00-tong-quan.md](00-tong-quan.md) → xem bảng quyết định bên dưới → nhảy tới [05-phase-0-coolify.md](05-phase-0-coolify.md) để bắt tay làm.

**Đọc đầy đủ, theo mạch:**

| # | File | Nội dung | Đọc khi |
|---|------|----------|---------|
| 00 | [00-tong-quan.md](00-tong-quan.md) | Ý tưởng, khả thi, sản phẩm LÀ/KHÔNG LÀ gì, "mobile không phải hosting", vì sao nội bộ = MVP của SaaS | Đầu tiên, ai cũng đọc |
| 01 | [01-kien-truc-tong-the.md](01-kien-truc-tong-the.md) | Sơ đồ hệ thống, từng thành phần, luồng end-to-end khi bấm Deploy, mô hình dữ liệu | Muốn hiểu bức tranh kỹ thuật |
| 02 | [02-tech-stack.md](02-tech-stack.md) | Chọn công nghệ từng lớp + lý do + thay thế, cấu hình VPS tối thiểu, ví dụ Caddyfile | Trước khi code |
| 03 | [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md) | 4 luồng deploy: web tĩnh / web backend / Android / iOS | Muốn biết mỗi loại app chạy ra sao |
| 04 | [04-domain-ssl.md](04-domain-ssl.md) | Cơ chế gắn domain + DNS + SSL (Let's Encrypt, wildcard, Cloudflare API) | Phần "gắn domain" bạn quan tâm nhất |
| 05 | [05-phase-0-coolify.md](05-phase-0-coolify.md) | **Phase 0** — cài Coolify thật, deploy thử, học luồng (~1 tuần) | **Bắt tay làm ngay** |
| 06 | [06-phase-1-mvp.md](06-phase-1-mvp.md) | **Phase 1** — MVP nội bộ: web tĩnh + backend, task breakdown | Sau Phase 0 |
| 07 | [07-phase-2-mobile.md](07-phase-2-mobile.md) | **Phase 2** — build & phân phối mobile (Android trước, iOS sau) | Khi cần mobile |
| 08 | [08-phase-3-saas.md](08-phase-3-saas.md) | **Phase 3** — multi-tenant, billing, quota, lên SaaS | Khi mở bán |
| 09 | [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md) | Chạy code lạ, sandbox, chống lạm dụng, secrets — rủi ro #1 | Trước khi lên SaaS (đọc sớm để thiết kế đúng) |
| 10 | [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md) | Chi phí thật, scale-to-zero, monitoring, backup, scale lên nhiều node | Khi tính tiền & vận hành |

---

## Bảng quyết định (tóm tắt — chi tiết ở từng file)

| Hạng mục | Lựa chọn | Ghi chú |
|---|---|---|
| Hạ tầng | **Tự host trên VPS** (Hetzner/DO/Vultr), bắt đầu 1 VPS | Mở rộng dần |
| Frontend | **Next.js** (React + TS) | |
| Backend/API | **NestJS** (Node + TS) | Thay thế: Go |
| Database | **PostgreSQL** + Prisma | |
| Hàng đợi build | **Redis + BullMQ** | |
| Đóng gói & chạy | **Docker** | |
| Build auto-detect | **Nixpacks** (hoặc Dockerfile) | Cái Railway/Coolify dùng |
| Reverse proxy + SSL | **Caddy** (auto HTTPS Let's Encrypt) | Thay thế: Traefik |
| DNS tự động | **Cloudflare API** | |
| Mobile build | Android = runner Linux; **iOS = bắt buộc macOS** | Fastlane; Flutter có Shorebird (OTA) |
| Cô lập code lạ (SaaS) | gVisor / Firecracker, rootless Docker, network/resource limits | Chỉ nặng khi lên SaaS |
| Object storage | S3-compatible (MinIO / Cloudflare R2) | R2 egress = $0 |
| Monitoring | Prometheus + Grafana + Uptime Kuma | |

---

## 3 điều phải khắc cốt

1. **Mobile KHÔNG phải hosting.** Web = chạy 24/7 trên server ta. Mobile = build ra file `.apk/.aab/.ipa` → ký số → phân phối qua store/TestFlight/OTA. Hai bài toán khác hẳn → mobile tách sang Phase 2. **iOS bắt buộc máy macOS.**
2. **Bản nội bộ = MVP của SaaS.** Cùng một lõi (Dashboard · Build · Container · Proxy · DNS); lên SaaS chỉ **bồi thêm** multi-tenant + cô lập bảo mật + billing. Điều kiện: ngay Phase 1 model dữ liệu phải có sẵn `user/team/project`.
3. **Rủi ro #1 là chạy code lạ của người dùng** (cả lúc build lẫn run) — nhẹ với bản nội bộ (tin user), cực nặng với SaaS. Thiết kế kiến trúc để sau này nhét sandbox vào được.

---

## Bắt đầu từ đâu (gợi ý hành động)

1. Đọc [00-tong-quan.md](00-tong-quan.md).
2. Làm **Phase 0** ([05-phase-0-coolify.md](05-phase-0-coolify.md)): thuê 1 VPS, cài Coolify, deploy thử 1 web tĩnh + 1 web backend, gắn domain thật. Hiểu luồng tận mắt **trước khi viết code**.
3. Quyết định: chỉ cần dùng → xài luôn Coolify; muốn làm sản phẩm riêng → bước sang **Phase 1** ([06-phase-1-mvp.md](06-phase-1-mvp.md)).

---

## Triển khai code (tầng kỹ thuật chi tiết)

Khi bắt tay code Phase 1, xem thư mục **[implementation/](implementation/)** — kế hoạch triển khai chi tiết cho **backend (NestJS)** và **frontend (Next.js)**: cấu trúc monorepo, **schema Prisma**, **hợp đồng API**, bản triển khai từng tầng, và **lộ trình milestone M0→M4**. Bắt đầu ở [implementation/README.md](implementation/README.md).
