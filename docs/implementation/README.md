# Triển khai code — DeployBox

Thư mục này là **tầng code-level** của kế hoạch DeployBox: từ kiến trúc/lộ trình (ở thư mục cha) xuống tới **cấu trúc thư mục, schema dữ liệu, hợp đồng API, và bản triển khai chi tiết backend + frontend** cho **Phase 1**.

> Đọc bối cảnh trước ở [../README.md](../README.md) và [../06-phase-1-mvp.md](../06-phase-1-mvp.md). Stack đã chốt: **Next.js + NestJS + Postgres/Prisma + Redis/BullMQ + Docker + Caddy**.

---

## Đọc theo thứ tự

| # | File | Nội dung | Ai viết theo |
|---|------|----------|--------------|
| 00 | [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md) | Monorepo pnpm, cây thư mục, gói `@deploybox/shared` (chia sẻ type FE↔BE), dev env | Cả team |
| 01 | [01-data-model-prisma.md](01-data-model-prisma.md) | **Schema Prisma đầy đủ** + enum + ghi chú thiết kế | Backend |
| 02 | [02-api-contract.md](02-api-contract.md) | **Hợp đồng API** REST + WebSocket + DTO dùng chung | Cả FE & BE |
| 03 | [03-backend-nestjs.md](03-backend-nestjs.md) | Triển khai backend: module, **luồng deploy end-to-end**, Docker/Caddy/Cloudflare, queue, realtime, auth | Backend |
| 04 | [04-frontend-nextjs.md](04-frontend-nextjs.md) | Triển khai frontend: route App Router, data fetching, **log realtime**, form, design system | Frontend |
| 05 | [05-lo-trinh-trien-khai.md](05-lo-trinh-trien-khai.md) | **Lộ trình milestone** M0→M4, checklist công việc, ước lượng, rủi ro | Cả team |

**Đường đi nhanh:** 00 (khung) → 01 + 02 (xương sống dữ liệu/API) → 03 hoặc 04 (theo vai trò) → 05 (bắt tay làm theo milestone).

---

## Nguồn chuẩn (source of truth)

Khi tài liệu xung khắc nhau, ưu tiên theo thứ tự: **01 (Prisma) → 02 (API contract) → 03/04 (triển khai)**.

- ⚠️ **Tên thực thể:** tầng triển khai dùng **`Project` / `Deployment`** (theo schema Prisma). Tên rút gọn **`App`** xuất hiện trong [../06-phase-1-mvp.md](../06-phase-1-mvp.md) chỉ là cách gọi khái niệm ở tầng kế hoạch — khi **code thì dùng `Project`/`Deployment`**.
- Mọi enum/DTO/sự kiện WS sống trong gói `@deploybox/shared` để FE và BE không lệch (xem [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md) §3).

---

## Phạm vi

- ✅ Bao trùm: **Phase 1** (web tĩnh + backend, dùng nội bộ).
- ↗️ Có chừa móc nối cho: multi-tenant (`Team` sẵn trong schema), quota (`memoryMb`/`cpuLimit`), scale-to-zero (`sleepEnabled`) — để Phase 3 SaaS bồi thêm chứ không đập đi.
- ❌ Chưa chi tiết: mobile build ([../07-phase-2-mobile.md](../07-phase-2-mobile.md)), cô lập SaaS + billing ([../08-phase-3-saas.md](../08-phase-3-saas.md), [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md)).

---

## Bắt đầu

Theo **[05-lo-trinh-trien-khai.md](05-lo-trinh-trien-khai.md)**: làm **M0 (khung)** rồi **M1 (slice deploy web tĩnh xuyên pipeline)** trước — đó là phần lộ rủi ro tích hợp sớm nhất.
