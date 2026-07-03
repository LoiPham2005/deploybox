# Cơ chế hoạt động — bấm "Deploy" thì chuyện gì xảy ra?

> Giải thích ngắn gọn, dễ hiểu. Chi tiết kỹ thuật hơn: [kien-truc.md](kien-truc.md).

## Các "nhân vật" tham gia

| Ai | Làm gì |
|---|---|
| **Web** (Next.js :3000) | Dashboard bạn bấm nút |
| **API** (NestJS :4000) | Bộ não: nhận lệnh, tự tay clone/build/chạy app |
| **Caddy** (:8080 dev / 80+443 prod) | Anh gác cổng: nhìn tên miền → dẫn khách vào đúng app |
| **Postgres** (Supabase) | Sổ cái: project, env, lịch sử deploy |

---

## Dòng thời gian 1 lần deploy (mọi loại project)

```
Bạn bấm Deploy
   │
   ▼
1. API ghi sổ: tạo bản ghi Deployment, trạng thái QUEUED → BUILDING
   │     (có Redis thì xếp hàng qua BullMQ, không có thì chạy luôn)
   ▼
2. CLONE — git clone code từ GitHub/GitLab về máy chủ
   │     (repo private → dùng token đã lưu, được mã hoá trong DB)
   ▼
3. BUILD — chạy lệnh build của project (npm ci → npm run build...)
   │     mọi dòng log được ghi file + đẩy LIVE lên màn hình bạn (SSE)
   ▼
4. CHẠY — tuỳ loại project (xem bên dưới)
   │
   ▼
5. MỞ CỔNG — API báo Caddy: "tên miền <slug>.domain → trỏ vào app này"
   │     đồng thời hạ bản deploy cũ xuống STOPPED (chỉ 1 bản chạy)
   ▼
6. BÁO TIN — trạng thái RUNNING, gửi Telegram ✅/❌
        deploy fail → AI đọc log, chỉ nguyên nhân + cách sửa
```

Cả quá trình có đồng hồ đếm giờ — build treo quá 30 phút sẽ bị kill (không ăn máy mãi).

---

## Frontend (STATIC) — ví dụ Vite/React, Vue, HTML

Frontend build ra **đống file tĩnh** (HTML/CSS/JS) — không cần process nào chạy cả.

```
clone → npm run build → lấy thư mục dist/ → cất vào "kệ" releases/
                                                  │
Caddy serve thẳng file tĩnh từ kệ ◄───────────────┘
```

- Mỗi lần deploy = 1 ngăn kệ mới → **rollback = trỏ lại ngăn cũ**, tức thì.
- Không tốn RAM chạy nền — Caddy phát file là xong.

> ⚠️ **Next.js SSR không phải STATIC** — nó cần server chạy → chọn loại **BACKEND**, lệnh chạy `npx next start`.

## Backend — ví dụ NestJS, Express (có 2 chế độ)

Backend là **process phải sống 24/7**. DeployBox chạy nó 1 trong 2 cách:

**Cách 1 — Host-run (tắt Docker):** chạy thẳng trên máy chủ
```
clone → npm ci --include=dev → build (NODE_ENV=production)
      → spawn: node dist/main.js  (process nền, tách khỏi API)
      → ghi PID vào file để còn quản lý
```
- Nhẹ, nhanh, không cần Docker.
- **Watchdog** quét mỗi 60 giây: process chết → đọc log → tự bật lại → AI chẩn đoán vì sao chết → báo Telegram. Chết quá 3 lần/10 phút → dừng hẳn (tránh vòng lặp crash).

**Cách 2 — Docker (mặc định):** đóng gói rồi chạy container
```
clone → docker build (ra image, mỗi lần deploy 1 tag)
      → docker run deploybox-<slug>  (giới hạn RAM/CPU theo cấu hình)
```
- Cô lập tốt hơn, giới hạn được tài nguyên, `restart unless-stopped`.
- Rollback = chạy lại image cũ (image các bản trước vẫn giữ).

Cả 2 cách đều được **bơm env vars** của project (secret giải mã lúc chạy, không nằm trong code).

---

## Khách vào app bằng cách nào?

Mọi app chung 1 cổng vào là **Caddy** — nó nhìn **tên miền** để chia khách:

```
                       ┌── blog.sneakup.io.vn   → file tĩnh kệ releases/blog
Khách ──► Caddy ───────┼── api-shop.sneakup.io.vn → localhost:3001 (backend #1)
                       └── web-shop.sneakup.io.vn → localhost:3002 (backend #2)
```

- **Dev trên máy:** `http://<slug>.localhost:8080` (Chrome tự hiểu `*.localhost`).
- **Production VPS:** DNS wildcard `*.domain` trỏ về server, Caddy **tự xin HTTPS** (Let's Encrypt) cho từng app — bạn không phải đụng vào cert.

## Sau khi deploy xong, hệ thống tự lo gì?

| Tự động | Nghĩa là |
|---|---|
| **Self-heal** | Reboot máy chủ → API bật lại → tự dựng lại mọi app từ bản build sẵn (không cần deploy lại) |
| **Watchdog** | App host-run chết ngang → tự restart + AI chẩn đoán + Telegram |
| **Sleep** | App nhàn rỗi lâu → cho "ngủ" tiết kiệm RAM, có khách gọi thì đánh thức |
| **Auto-deploy** | Push code lên GitHub → webhook gọi về → tự deploy (bật/tắt per project) |
| **Dọn dẹp** | Bản build/image cũ quá số lượng giữ lại → tự xoá cho đỡ đầy đĩa |

## Tóm tắt 30 giây

- **Frontend (STATIC)** = build ra file tĩnh, Caddy phát — không có process, rollback tức thì.
- **Backend** = process sống 24/7 — chạy thẳng (host-run, có watchdog) hoặc trong Docker (có limit RAM/CPU).
- **Mọi app** vào qua Caddy theo tên miền `<slug>.domain`, production tự có HTTPS.
- Fail ở bước nào → log realtime + AI chỉ cách sửa + Telegram báo ngay.
