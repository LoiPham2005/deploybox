# Kiến trúc tổng thể

Tài liệu này mô tả kiến trúc tổng thể của DeployBox: các thành phần, trách nhiệm, luồng end-to-end khi user bấm "Deploy", và mô hình dữ liệu chính. Stack cụ thể từng thành phần xem [02-tech-stack.md](02-tech-stack.md); chi tiết cấp domain + SSL xem [04-domain-ssl.md](04-domain-ssl.md).

> Nguyên tắc xuyên suốt: bản nội bộ (Phase 1) và bản SaaS (Phase 3) dùng CHUNG kiến trúc này. Phần "cô lập + multi-tenant + billing" chỉ là LỚP BỒI THÊM, không thiết kế lại. Mọi entity dữ liệu đều mang sẵn cột `teamId` (xem [Mô hình dữ liệu](#mo-hinh-du-lieu)) để Phase 3 bật multi-tenant mà không phải migrate phá vỡ.

---

## 1. Sơ đồ ASCII toàn hệ thống

```
                                   INTERNET (người dùng cuối + dev của team)
                                              │
                                              │ HTTPS (443)
                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  VPS (DigitalOcean / Hetzner / Vultr) — bắt đầu chỉ 1 node                              │
│                                                                                        │
│   ┌────────────────────────────────────────────────────────────────────────────────┐  │
│   │  CADDY  (reverse proxy + auto HTTPS / Let's Encrypt ACME)                        │  │
│   │  - Route theo host: dashboard.deploybox.io → Dashboard                           │  │
│   │  - api.deploybox.io → API/Backend                                                │  │
│   │  - <app>.deploybox.io & domain custom của user → container app tương ứng         │  │
│   │  - Tự xin/gia hạn cert (HTTP-01); wildcard *.deploybox.io qua DNS-01 (Cloudflare) │  │
│   └───────┬─────────────────────────┬──────────────────────────────┬─────────────────┘ │
│           │                         │                              │                    │
│           ▼                         ▼                              ▼                    │
│   ┌───────────────┐        ┌──────────────────┐         ┌────────────────────────────┐ │
│   │ DASHBOARD     │        │ API / BACKEND    │         │ APP CONTAINERS (của user)  │ │
│   │ Next.js (SSR) │◀──────▶│ NestJS (REST/WS) │         │ ┌──────────┐ ┌───────────┐ │ │
│   │ React + TS    │  HTTP  │ Auth, CRUD,      │         │ │ web-tinh │ │ web+backend│ │ │
│   └───────────────┘        │ orchestration    │         │ │ (static) │ │ (24/7)     │ │ │
│                            └──┬────┬────┬───┬──┘         │ └──────────┘ └───────────┘ │ │
│                               │    │    │   │            │   ... N app container ...  │ │
│            ┌──────────────────┘    │    │   └─────┐      └────────────┬───────────────┘ │
│            ▼                       │    ▼         ▼                   │ docker run/network│
│   ┌─────────────────┐             │ ┌──────────────────┐             ▼                   │
│   │ PostgreSQL      │             │ │ Redis + BullMQ   │      ┌──────────────────┐       │
│   │ (Prisma ORM)    │             │ │ (build queue)    │      │ DOCKER ENGINE    │       │
│   │ users/projects/ │             │ └────────┬─────────┘      │ (container       │       │
│   │ deployments...  │             │          │ jobs           │  runtime, networks)│      │
│   └─────────────────┘             │          ▼                └──────────────────┘       │
│                                   │ ┌────────────────────────────────────┐               │
│            ┌──────────────────────┘ │ BUILD RUNNER (worker process)      │               │
│            ▼                        │ - Web: git clone → Nixpacks/Docker  │               │
│   ┌─────────────────┐               │   build → push image → run container│               │
│   │ SECRETS         │               │ - Mobile: xem 07-phase-2-mobile.md  │               │
│   │ (EnvVar mã hoá  │◀──────────────│   (Android runner Linux; iOS macOS) │               │
│   │  trong PG /     │  inject env   └──────────┬──────────────┬──────────┘               │
│   │  Docker secret) │                          │ push image   │ upload log/artifact      │
│   └─────────────────┘                          ▼              ▼                          │
│                                      ┌──────────────────┐ ┌──────────────────────────┐   │
│                                      │ IMAGE REGISTRY   │ │ OBJECT STORAGE           │   │
│                                      │ (registry tự host│ │ S3-compatible: MinIO     │   │
│                                      │  / GHCR)         │ │ (tự host) hoặc CF R2     │   │
│                                      └──────────────────┘ │ → build log, artifact,   │   │
│                                                           │   APK/AAB/IPA            │   │
│                                                           └──────────────────────────┘   │
│                                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│   │ DNS AUTOMATION (Cloudflare API)  — tạo/sửa A/CNAME record cho domain custom + ACME │ │
│   │  DNS-01 challenge cho wildcard. Chi tiết: 04-domain-ssl.md                          │ │
│   └──────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│   │ MONITORING / LOGGING: Prometheus + Grafana (metrics), Uptime Kuma (healthcheck),  │ │
│   │  log container → object storage / stream về Dashboard qua WebSocket                │ │
│   └──────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Lưu ý topo: ở Phase 1 mọi thứ chạy **trên cùng 1 VPS** (control plane = API/DB/Redis và data plane = app container chung host). Khi lên SaaS (Phase 3) tách: control plane riêng, các app container của user đẩy sang **node runner cô lập** (gVisor/Firecracker, rootless Docker) — xem [08-phase-3-saas.md](08-phase-3-saas.md) và [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).

---

## 2. Thành phần và trách nhiệm

| Thành phần | Công nghệ | Trách nhiệm chính | Ranh giới (không làm gì) |
|---|---|---|---|
| **Dashboard** | Next.js (React + TS) | UI: đăng nhập, tạo project, nối Git, xem deployment/log realtime, quản domain & env. Gọi API qua REST, nhận log/trạng thái qua WebSocket. | Không gọi thẳng Docker/Registry; mọi thao tác qua API. |
| **API / Backend** | NestJS (Node + TS) | "Bộ não" / control plane: auth, RBAC, CRUD entity, nhận webhook Git, **đẩy job vào BullMQ**, gọi Docker Engine API, gọi Cloudflare API, viết Caddy config, ký URL artifact. | Không tự build image trong process request (đẩy sang runner). |
| **Build queue** | Redis + BullMQ | Hàng đợi job build/deploy: backpressure, retry, concurrency limit, ưu tiên. Là ranh giới giữa API (nhanh) và build (chậm). | Không lưu dữ liệu lâu dài (đó là việc của PG). |
| **Build runner (web)** | Worker Node + Nixpacks/Docker | Consume job: `git clone` → build image (Nixpacks auto-detect hoặc Dockerfile của user) → push lên registry → tạo/cập nhật container → stream log. | Không quyết định routing domain (báo API làm). |
| **Build runner (mobile)** | Fastlane (Android: Linux; iOS: macOS), Shorebird OTA | Build APK/AAB & IPA, ký số, phân phối. iOS **bắt buộc macOS**. Chi tiết: [07-phase-2-mobile.md](07-phase-2-mobile.md). | Không deploy container (mobile là CI/CD + distribution, không phải hosting). |
| **Image registry** | Registry tự host (hoặc GHCR) | Lưu image đã build, version theo tag (`project:deploymentId`), nguồn để `docker run` và rollback. | Không lưu source code thô. |
| **Container runtime** | Docker Engine | Chạy app container 24/7 (web backend) hoặc serve static; quản network, healthcheck, restart policy, resource limit (CPU/RAM). | Không lo TLS/domain (Caddy lo). |
| **Reverse proxy + SSL** | Caddy | Route HTTPS theo host → đúng container; **auto cấp/gia hạn Let's Encrypt** (HTTP-01; wildcard DNS-01). API ghi config động qua Caddy Admin API. Chi tiết: [04-domain-ssl.md](04-domain-ssl.md). | Không build, không biết database. |
| **DNS automation** | Cloudflare API | Tạo/sửa A/CNAME cho subdomain & domain custom; cấp token cho DNS-01 wildcard. Chi tiết: [04-domain-ssl.md](04-domain-ssl.md). | Không quản cert (Caddy quản). |
| **PostgreSQL** | PostgreSQL + Prisma | Nguồn sự thật (source of truth) cho mọi entity & trạng thái deployment. | Không lưu file lớn (log/artifact → object storage). |
| **Object storage** | S3-compatible: MinIO (tự host) / Cloudflare R2 | Lưu build log dài, artifact (APK/AAB/IPA), static bundle. API ký URL tải có hạn. | Không phải DB truy vấn quan hệ. |
| **Secrets** | EnvVar mã hoá (AES) trong PG; Docker secret/env khi run | Lưu biến môi trường nhạy cảm (API key, DB pass), inject vào container lúc run/build. Không lộ ra log/UI dạng plaintext. | Không hard-code trong image. |
| **Monitoring/Logging** | Prometheus + Grafana; Uptime Kuma; log stream | Metrics (CPU/RAM/req), healthcheck uptime, cảnh báo; gom log container đẩy về Dashboard (WebSocket) + lưu object storage. | Không tự sửa app. |

---

## 3. Luồng end-to-end khi user bấm "Deploy"

Áp dụng cho **web tĩnh** và **web backend** (mobile khác — xem [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md) và [07-phase-2-mobile.md](07-phase-2-mobile.md)).

```
┌─ Khởi tạo ───────────────────────────────────────────────────────────────────┐
│ (A) User bấm "Deploy" trên Dashboard   HOẶC   (B) Git push → webhook → API     │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               ▼
1. API (NestJS): xác thực, kiểm quota/quyền → tạo bản ghi Deployment(status=QUEUED)
                 → enqueue job vào BullMQ (Redis), trả 202 + deploymentId cho UI
                               ▼
2. Build runner nhận job → cập nhật Deployment(status=BUILDING)
   - git clone repo @ commit SHA (token Git từ Secrets)
   - inject build-time EnvVar
   - Build image:
       • có Dockerfile của user → docker build
       • không → Nixpacks auto-detect ngôn ngữ → image
   - Stream log từng dòng → WebSocket về Dashboard + ghi BuildLog → object storage
                               ▼
3. Push image → IMAGE REGISTRY, tag = <project>:<deploymentId> (và :latest)
                               ▼
4. Run container (Docker Engine API):
   - inject runtime EnvVar/secret
   - gắn resource limit (CPU/RAM), restart=always, healthcheck
   - đợi healthcheck PASS (web backend); web tĩnh → serve thẳng thư mục static
   - status=DEPLOYING
                               ▼
5. Cập nhật reverse proxy (Caddy):
   - API ghi route mới qua Caddy Admin API: host → container:port
   - Blue/green: chỉ chuyển traffic khi container mới healthy → zero-downtime
                               ▼
6. Gắn domain + SSL (lần đầu / domain custom):
   - API gọi Cloudflare API tạo/sửa A|CNAME record
   - Caddy tự xin Let's Encrypt cert (HTTP-01; wildcard → DNS-01). Xem 04-domain-ssl.md
                               ▼
7. Hoàn tất:
   - Deployment(status=SUCCESS), lưu image tag để rollback
   - Dọn container cũ (giữ N bản gần nhất cho rollback)
   - Báo trạng thái về Dashboard (WS) + (tuỳ chọn) notify
                               ▼
   Nếu lỗi ở bất kỳ bước → status=FAILED, giữ log, KHÔNG chuyển traffic (giữ bản cũ)
```

Trạng thái Deployment (state machine):
`QUEUED → BUILDING → DEPLOYING → SUCCESS` | bất kỳ bước → `FAILED` | thao tác tay → `CANCELLED` / `ROLLED_BACK`.

Điểm bất biến quan trọng:
- **Traffic chỉ chuyển sang bản mới khi healthcheck PASS** → không bao giờ down vì deploy hỏng.
- **Image cũ được giữ lại** → rollback = trỏ Caddy về container cũ, không cần build lại.
- API **không bao giờ build đồng bộ** trong request HTTP → mọi việc nặng đi qua BullMQ.

---

## 4. Mô hình dữ liệu chính

Các entity cốt lõi (PostgreSQL + Prisma). Mọi entity có `id`, `createdAt`, `updatedAt`. Cột `teamId` có sẵn từ Phase 1 để Phase 3 bật multi-tenant không phá schema.

### 4.1. Bảng entity

| Entity | Trường chính | Mô tả |
|---|---|---|
| **User** | `id`, `email`, `passwordHash`/oauth, `name` | Người dùng đăng nhập dashboard. |
| **Team** | `id`, `name`, `plan`, `quota` (json) | Nhóm/tổ chức sở hữu project. Phase 1: 1 team mặc định; Phase 3: gốc multi-tenant + billing. |
| **Membership** | `id`, `userId→User`, `teamId→Team`, `role` (OWNER/ADMIN/MEMBER) | Quan hệ N–N User↔Team kèm vai trò (RBAC). |
| **Project** | `id`, `teamId→Team`, `name`, `type` (STATIC/BACKEND/MOBILE), `gitUrl`, `gitBranch`, `buildConfig` (json) | Đơn vị "app" user tạo. `type` quyết định luồng build (xem [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md)). |
| **Service** | `id`, `projectId→Project`, `kind` (WEB/WORKER/DB), `port`, `resourceLimit` (json), `restartPolicy` | Tiến trình chạy được trong 1 project (1 project có thể nhiều service: web + worker + db). |
| **Deployment** | `id`, `projectId→Project`, `serviceId→Service`, `commitSha`, `status`, `imageTag`, `startedAt`, `finishedAt` | Một lần build+run. Lưu `imageTag` để rollback. Là tâm của state machine ở mục 3. |
| **Domain** | `id`, `projectId→Project`, `host`, `type` (SUBDOMAIN/CUSTOM), `sslStatus`, `dnsRecordId` (Cloudflare), `verified` | Domain gắn vào project. Caddy dùng `host` để route. Chi tiết: [04-domain-ssl.md](04-domain-ssl.md). |
| **EnvVar / Secret** | `id`, `projectId→Project`, `key`, `valueEncrypted`, `scope` (BUILD/RUNTIME), `isSecret` | Biến môi trường; `valueEncrypted` mã hoá at-rest, inject lúc build/run. |
| **BuildLog** | `id`, `deploymentId→Deployment`, `storageKey` (object storage), `summary`, `exitCode` | Con trỏ tới log dài trong object storage + tóm tắt nhanh để hiển thị. |

### 4.2. Quan hệ (ERD rút gọn)

```
User ──< Membership >── Team ──< Project ──< Service ──< Deployment ──< BuildLog
                                   │                          │
                                   ├──< Domain                └─ imageTag → Image Registry
                                   └──< EnvVar/Secret                       (BuildLog.storageKey → Object Storage)
```

- `User N──N Team` qua **Membership** (kèm `role`).
- `Team 1──N Project`; `Project 1──N Service / Domain / EnvVar`.
- `Service 1──N Deployment`; `Deployment 1──N BuildLog`.
- `Deployment.imageTag` trỏ sang **Image Registry** (không phải bảng SQL); `BuildLog.storageKey` trỏ sang **Object Storage**.

### 4.3. Lát cắt Prisma minh hoạ (rút gọn)

```prisma
model Project {
  id          String       @id @default(cuid())
  teamId      String
  team        Team         @relation(fields: [teamId], references: [id])
  name        String
  type        ProjectType  // STATIC | BACKEND | MOBILE
  gitUrl      String
  gitBranch   String       @default("main")
  services    Service[]
  domains     Domain[]
  envVars     EnvVar[]
  deployments Deployment[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  @@index([teamId])
}

model Deployment {
  id         String           @id @default(cuid())
  projectId  String
  serviceId  String
  commitSha  String
  status     DeploymentStatus // QUEUED|BUILDING|DEPLOYING|SUCCESS|FAILED|CANCELLED|ROLLED_BACK
  imageTag   String?
  startedAt  DateTime?
  finishedAt DateTime?
  buildLogs  BuildLog[]
  createdAt  DateTime         @default(now())
  @@index([projectId, status])
}
```

---

## 5. Ranh giới control plane vs data plane (chuẩn bị cho SaaS)

| Lớp | Thành phần | Phase 1 (nội bộ) | Phase 3 (SaaS) |
|---|---|---|---|
| **Control plane** | Dashboard, API, PostgreSQL, Redis/BullMQ | Cùng 1 VPS, tin user | Tách node riêng, không chạy code user |
| **Data plane** | App container, build runner | Chung host với control plane | Node runner cô lập: gVisor/Firecracker, rootless Docker, seccomp, network isolation, resource limit |

Việc giữ ranh giới này NGAY TỪ ĐẦU (API gọi Docker qua một interface trừu tượng `Orchestrator`, không gọi thẳng `dockerode` rải rác) là điều kiện để Phase 3 thay backend runtime mà không viết lại API. Rủi ro chạy code không tin cậy là số 1 khi lên SaaS — xem [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md); chi phí container 24/7 và quota/"ngủ" app nhàn rỗi — xem [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md).