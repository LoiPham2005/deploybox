# Lựa chọn công nghệ

Tài liệu này chốt **công nghệ cho từng lớp** của DeployBox, kèm **lý do** và **giải pháp thay thế** đã cân nhắc. Mọi lựa chọn ở đây là cố định cho toàn dự án — các tài liệu khác bám theo bảng này. Xem tổng quan ở [00-tong-quan.md](00-tong-quan.md), kiến trúc ở [01-kien-truc-tong-the.md](01-kien-truc-tong-the.md).

---

## 1. Bảng tổng hợp stack theo lớp

| Lớp | Công nghệ ĐÃ CHỌN | Lý do ngắn gọn | Thay thế (đã cân nhắc) |
|---|---|---|---|
| **Frontend dashboard** | **Next.js** (React + TypeScript) | SSR/RSC sẵn, routing + API route gọn, ecosystem React lớn, cùng ngôn ngữ TS với backend → chia sẻ type | Remix, SvelteKit, Vite + React SPA |
| **Backend / API** | **NestJS** (Node + TypeScript) | Kiến trúc module hoá có sẵn (DI, guard, pipe), hợp dự án lớn dần; cùng TS với FE | Go (Fiber/Echo) — nhanh & ít RAM hơn; Express thuần |
| **Database** | **PostgreSQL + Prisma** | Postgres bền, JSONB + transaction tốt; Prisma type-safe, migration rõ ràng | Drizzle ORM; TypeORM; MySQL |
| **Job queue (build)** | **Redis + BullMQ** | Queue bền, retry/backoff/concurrency/rate-limit sẵn; native TS | RabbitMQ; pg-boss (queue trên Postgres) |
| **Container / runtime** | **Docker** | Chuẩn đóng gói app, image bất biến, chạy 24/7 + restart policy | Podman; containerd thuần |
| **Build engine** | **Nixpacks** (mặc định) **+ Dockerfile** (nếu user cấp) | Auto-detect ngôn ngữ, không cần user viết Dockerfile; vẫn cho override | Buildpacks (Heroku/Paketo); Kaniko |
| **Reverse proxy + SSL** | **Caddy** | Auto-HTTPS Let's Encrypt mặc định, config ngắn, API admin để cập nhật runtime | Traefik; Nginx + Certbot (thủ công) |
| **DNS tự động** | **Cloudflare API** | API tốt, DNS-01 cho wildcard, proxy/CDN/DDoS sẵn | Route53; DNS thủ công |
| **Mobile build** | **Android**: runner Linux + Fastlane · **iOS**: runner macOS + Fastlane · **OTA**: Shorebird | iOS bắt buộc macOS (luật Apple); Fastlane chuẩn ngành cho ký số + phân phối | Codemagic / Bitrise (CI macOS thuê); EAS (RN) |
| **Object storage** | **S3-compatible**: MinIO (tự host) hoặc Cloudflare R2 | Lưu artifact (APK/AAB/IPA, static build) + log; chuẩn S3 SDK | AWS S3; Backblaze B2 |
| **Monitoring** | **Prometheus + Grafana** + **Uptime Kuma** | Metrics + dashboard + healthcheck/alert, đều tự host | Netdata; VictoriaMetrics; Datadog (trả phí) |
| **Auth** | **NestJS Auth** (JWT + bcrypt/argon2), Phase 3 thêm OAuth/SSO | Tự chủ, đủ cho nội bộ; mở rộng multi-tenant sau | Auth0/Clerk; Keycloak (tự host) |

> Chi tiết luồng dùng các thành phần này: [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md). Domain/SSL: [04-domain-ssl.md](04-domain-ssl.md).

---

## 2. Giải thích các lựa chọn then chốt

### 2.1 Vì sao Caddy (auto-SSL) thay vì Nginx thủ công

Đây là lựa chọn quan trọng nhất của lớp proxy vì DeployBox phải **tự cấp domain + SSL cho hàng chục app động**, không thể sửa config bằng tay mỗi lần deploy.

| Tiêu chí | Caddy | Nginx + Certbot (thủ công) |
|---|---|---|
| Cấp HTTPS | **Tự động** (ACME built-in, gia hạn tự động) | Phải gọi Certbot, viết cron gia hạn, reload |
| Thêm domain app mới | Gọi **Admin API** (`/load`) → áp dụng ngay, không downtime | Sửa file `.conf` + `nginx -t` + `reload`, dễ sai |
| Wildcard (DNS-01) | Plugin `caddy-dns/cloudflare` tích hợp gọn | Cấu hình ACME DNS-01 thủ công, rườm rà |
| Độ dài config | Caddyfile ngắn vài dòng | Verbose, dễ lỗi |
| Hot reload | Có, qua API, không rớt kết nối | Reload tiến trình |

**Kết luận**: với mô hình "mỗi deploy sinh ra một domain mới", Caddy + Admin API là phù hợp nhất. Backend NestJS sẽ gọi Caddy Admin API (`POST /config/...`) để cắm route cho app mới mà không cần restart proxy. Chi tiết cấp wildcard + DNS-01 ở [04-domain-ssl.md](04-domain-ssl.md). *Traefik* là thay thế hợp lý (auto-discovery qua Docker label) nhưng config phức tạp hơn cho người mới; ta giữ Traefik làm phương án B.

### 2.2 Vì sao NestJS

- **Module hoá sẵn**: dự án sẽ phình to (apps, deployments, builds, domains, billing...). NestJS có DI + module + guard/interceptor → tổ chức code rõ, dễ tách service khi lên SaaS.
- **Cùng TypeScript với Next.js**: chia sẻ type (DTO, enum trạng thái deploy) giữa FE/BE, giảm lệch hợp đồng API.
- **Hợp với BullMQ & Prisma**: có module/provider pattern để inject queue và Prisma client gọn gàng.
- **Thay thế Go**: Go nhanh hơn, tốn ít RAM hơn (đáng cân nhắc cho phần worker build chịu tải) — nhưng ưu tiên tốc độ phát triển và một ngôn ngữ duy nhất cho cả team ở giai đoạn đầu. Có thể viết **worker build bằng Go sau** nếu cần tối ưu, vì worker tách rời qua Redis.

### 2.3 Vì sao PostgreSQL + Prisma

- **Postgres**: transaction ACID chắc chắn (trạng thái deploy/build cần nhất quán), JSONB lưu config app linh hoạt, mở rộng tốt khi lên multi-tenant (row-level security cho tenant ở Phase 3).
- **Prisma**: schema khai báo một chỗ → **type-safe** end-to-end, `prisma migrate` cho versioned migration rõ ràng, Studio để xem data nhanh.
- **Thay thế**: *Drizzle* nhẹ và gần SQL hơn (cân nhắc nếu cần query phức tạp/hiệu năng), *TypeORM* trưởng thành nhưng nhiều footgun. Giữ Prisma vì DX tốt nhất cho giai đoạn xây nhanh.

### 2.4 Nixpacks vs Dockerfile

Hai đường build, ưu tiên Nixpacks và cho phép override:

```
                 ┌─────────────────────────┐
   Git repo ───► │  Có Dockerfile ở root?   │
                 └───────────┬─────────────┘
                     có      │      không
              ┌──────────────┴──────────────┐
              ▼                              ▼
     docker build -f Dockerfile      nixpacks build .
     (user toàn quyền kiểm soát)     (auto-detect ngôn ngữ:
                                      Node/Python/Go/... → image)
              └──────────────┬──────────────┘
                             ▼
                   Image → push registry → run container
```

| | Nixpacks (mặc định) | Dockerfile (user cấp) |
|---|---|---|
| Khi nào dùng | App "chuẩn" không cần custom build | App cần bước build đặc thù, base image riêng |
| Ưu | User **không cần biết Docker**, auto-detect + cache layer tốt | Kiểm soát hoàn toàn, tái lập chính xác |
| Nhược | Khó tuỳ biến sâu | User phải tự viết & bảo trì |

**Quy tắc trong DeployBox**: nếu repo có `Dockerfile` ở root → dùng Dockerfile; ngược lại → Nixpacks. Cho phép user ép chế độ trong cấu hình app. Nixpacks là thứ Railway/Coolify dùng nên đã được kiểm chứng thực chiến.

### 2.5 Vì sao BullMQ (Redis)

Build là tác vụ **nặng, lâu, có thể fail** → cần một job queue thực thụ chứ không chạy inline trong request:

- **Retry + backoff** khi build lỗi mạng/registry.
- **Concurrency limit**: chặn build song song quá nhiều làm sập VPS (quan trọng vì 1 VPS).
- **Rate limit & priority**: ưu tiên job nhỏ, xếp hàng job nặng.
- **Tách worker**: API enqueue job, worker chạy build độc lập → scale riêng, restart không ảnh hưởng API.
- **Bền**: job sống trong Redis, worker chết vẫn nhặt lại được.

*Thay thế*: `pg-boss` (queue ngay trên Postgres, đỡ thêm Redis) phù hợp nếu muốn ít hạ tầng; *RabbitMQ* mạnh nhưng overkill. Ta chọn BullMQ vì native TS, hợp NestJS và đã chuẩn hoá trong stack.

---

## 3. Yêu cầu phần cứng VPS tối thiểu theo phase

Bắt đầu chỉ với **1 VPS** (DigitalOcean / Hetzner / Vultr). Khuyến nghị Hetzner vì giá/RAM tốt. Mỗi app backend là một container chạy 24/7 → **RAM là tài nguyên giới hạn chính** (xem [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md)).

| Phase | Mục đích | CPU | RAM | Disk | Ghi chú |
|---|---|---|---|---|---|
| **Phase 0** (Coolify) | Học, deploy thử | 2 vCPU | **4 GB** | 60–80 GB SSD | Coolify khuyến nghị tối thiểu 2 GB nhưng 4 GB chạy mượt |
| **Phase 1** (MVP nội bộ) | Dashboard + API + Postgres + Redis + Caddy + vài app | 2–4 vCPU | **8 GB** | 80–160 GB SSD | Build ăn RAM/CPU; cân nhắc tách 1 VPS riêng làm build worker |
| **Phase 2** (Mobile) | Thêm Android runner (Linux) | +2 vCPU | **+8 GB** (Android/Gradle ngốn RAM) | +100 GB | **iOS: BẮT BUỘC máy macOS riêng** (Mac mini) hoặc CI macOS thuê (Codemagic) — VPS Linux không build được iOS |
| **Phase 3** (SaaS) | Multi-tenant + cô lập + quota | Cụm 2+ node, ≥4 vCPU/node | **16 GB+/node** | 200 GB+ + S3 ngoài | Tách control-plane và run-plane; cô lập gVisor/Firecracker (xem [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)) |

**Lưu ý vận hành**:
- **Swap**: bật swap 2–4 GB cho Phase 0/1 để build nặng không bị OOM kill.
- **Disk**: image Docker + log + artifact phình nhanh → đặt cron `docker system prune` và đẩy artifact/log lên S3 (MinIO/R2).
- **Tách build**: từ Phase 1, nếu build làm app đang chạy giật, tách worker build sang VPS riêng (Redis nối qua mạng nội bộ).

---

## 4. Ví dụ Caddyfile (reverse proxy + auto HTTPS)

Minh hoạ cấu hình tĩnh để hiểu cơ chế. Trong DeployBox thực tế, các block site sẽ được **NestJS sinh động và nạp qua Caddy Admin API** thay vì sửa file tay (xem [06-phase-1-mvp.md](06-phase-1-mvp.md)).

```caddyfile
# ── Dashboard (Next.js) ─────────────────────────────
deploybox.example.com {
    reverse_proxy localhost:3000
    encode gzip zstd
    log {
        output file /var/log/caddy/dashboard.log
    }
}

# ── App backend (container Node) ────────────────────
app1.example.com {
    reverse_proxy app1_container:8080
    # Caddy TỰ xin & gia hạn cert Let's Encrypt cho domain này
    header {
        Strict-Transport-Security "max-age=31536000;"
        -Server
    }
}

# ── App web tĩnh (serve thư mục static) ─────────────
static-app.example.com {
    root * /srv/static-app
    file_server
    encode gzip
    try_files {path} /index.html   # SPA fallback (React/Vue/Flutter Web)
}
```

Cấu hình wildcard `*.deploybox.example.com` qua DNS-01 + plugin Cloudflare để mỗi app tự nhận subdomain ngay (không cần cert riêng từng lần) được mô tả ở [04-domain-ssl.md](04-domain-ssl.md).

**Ví dụ nạp route động qua Admin API** (cách DeployBox dùng khi deploy app mới):

```bash
# Thêm một site mới vào Caddy đang chạy, KHÔNG restart, KHÔNG downtime
curl -X POST "http://localhost:2019/config/apps/http/servers/srv0/routes" \
  -H "Content-Type: application/json" \
  -d '{
        "match": [{ "host": ["app2.example.com"] }],
        "handle": [{
          "handler": "reverse_proxy",
          "upstreams": [{ "dial": "app2_container:8080" }]
        }]
      }'
```

---

## 5. Checklist chốt stack

- [ ] FE: Next.js (TS) · BE: NestJS (TS) — **một ngôn ngữ TypeScript xuyên suốt**
- [ ] DB: PostgreSQL + Prisma (migration versioned)
- [ ] Queue: Redis + BullMQ (concurrency limit để bảo vệ 1 VPS)
- [ ] Runtime: Docker; Build: Nixpacks mặc định, Dockerfile override
- [ ] Proxy: Caddy + Admin API + plugin `caddy-dns/cloudflare`
- [ ] DNS: Cloudflare API (DNS-01 cho wildcard)
- [ ] Storage: MinIO/R2 (S3-compatible) cho artifact/log
- [ ] Monitoring: Prometheus + Grafana + Uptime Kuma
- [ ] Mobile (Phase 2): Android trên Linux + Fastlane; iOS trên macOS + Fastlane; Shorebird OTA
- [ ] VPS: bắt đầu 1 node, bật swap, prune Docker định kỳ

> Tiếp theo: luồng deploy chi tiết theo từng loại app ở [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md); domain & SSL ở [04-domain-ssl.md](04-domain-ssl.md).