# Phase 1 — MVP nội bộ (web tĩnh + backend)

> Mục tiêu của phase này: tự xây bản DeployBox tối thiểu CHẠY THẬT cho **web tĩnh** và **web có backend**, dùng nội bộ team, **tin user**. Đầu ra phải chứng minh được luồng end-to-end: từ một Git repo → build → chạy → có URL HTTPS thật trên domain của mình.
>
> Tiền đề: bạn đã làm xong [05-phase-0-coolify.md](05-phase-0-coolify.md) (đã cài Coolify, đã deploy thử, đã hiểu luồng). Phase 1 là TỰ CODE lại luồng đó ở mức tối thiểu, không dùng Coolify nữa.

---

## 1. Phạm vi (Scope)

### 1.1. LÀM gì ở Phase 1

| # | Hạng mục | Loại app áp dụng |
|---|----------|------------------|
| 1 | Đăng nhập dashboard (auth nội bộ) | chung |
| 2 | Kết nối Git repo + nhận webhook push | static + backend |
| 3 | Build pipeline: clone → Nixpacks/Dockerfile → Docker image | static + backend |
| 4 | Chạy container + tự đăng ký route vào Caddy | static + backend |
| 5 | Gắn domain + cấp SSL tự động (Caddy/ACME) | static + backend |
| 6 | Quản lý env/secret cho từng app | chủ yếu backend |
| 7 | Xem log realtime (build log + runtime log) | static + backend |
| 8 | List / restart / stop / xoá deployment | static + backend |
| 9 | Dashboard UI tối thiểu | chung |

> Web tĩnh thực chất cũng được "đóng gói" thành 1 container nhỏ (serve static qua chính Caddy hoặc một image nginx/caddy nhỏ). Tức là **một code path duy nhất**: mọi app đều ra Docker image rồi chạy container. Đừng làm 2 nhánh xử lý riêng — chỉ khác ở bước build (xem [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md)).

### 1.2. KHÔNG làm gì ở Phase 1 (quan trọng — chống phình)

- ❌ **Mobile build** (Android/iOS, Fastlane, Shorebird) → để [07-phase-2-mobile.md](07-phase-2-mobile.md).
- ❌ **Multi-tenant / multi-user thật, RBAC, org/team** → để [08-phase-3-saas.md](08-phase-3-saas.md). Phase 1 chỉ cần "ai đăng nhập được thì làm được mọi thứ".
- ❌ **Billing, quota, metering, "ngủ" app nhàn rỗi** → Phase 3.
- ❌ **Sandbox nặng** (gVisor / Firecracker / rootless / seccomp). Ta **tin user** ở nội bộ. Chi tiết rủi ro xem [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).
- ❌ **Multi-VPS / cluster / orchestrator (K8s, Swarm)**. Chỉ 1 VPS, Docker chạy thẳng trên host.
- ❌ **Zero-downtime / blue-green deploy hoàn chỉnh**. Phase 1 chấp nhận "stop cũ → start mới" có vài giây downtime (có thể nâng cấp nhẹ ở mục 11).
- ❌ **Database-as-a-service** (tự cấp Postgres/Redis cho app user). User tự trỏ tới DB ngoài qua env. (Có thể thêm "1-click Postgres" như stretch goal, mục 11.)
- ❌ **Rollback UI hoàn chỉnh, build cache phức tạp, monorepo nhiều service**. Một repo = một app.
- ❌ **Auto-detect framework fancy ngoài Nixpacks**. Nixpacks lo phần nhận diện; nếu fail thì user cấp Dockerfile.

---

## 2. Kiến trúc Phase 1 (tối giản, 1 VPS)

```
                          ┌────────────────────────────────────────────┐
                          │                  VPS (1 máy)                │
                          │                                            │
   Dev push ──webhook──►  │  ┌──────────────┐    ┌──────────────────┐  │
   GitHub/GitLab          │  │  NestJS API  │───►│ Redis + BullMQ   │  │
                          │  │  (control)   │    │  (build queue)   │  │
   Browser ──────────────►│  └──────┬───────┘    └────────┬─────────┘  │
   (Next.js dashboard)    │         │                     │            │
                          │         │ Prisma              │ worker     │
                          │    ┌────▼─────┐         ┌──────▼────────┐  │
                          │    │ Postgres │         │ Build Worker  │  │
                          │    └──────────┘         │ (clone+nixpacks│  │
                          │                         │  docker build)│  │
                          │                         └──────┬────────┘  │
                          │                                │ docker run │
                          │   ┌────────────────────────────▼────────┐  │
                          │   │        Docker Engine (host)         │  │
                          │   │  [app-1] [app-2] [app-3] ...        │  │
                          │   └──────────────────┬──────────────────┘  │
                          │                      │ network: deploybox  │
                          │            ┌─────────▼──────────┐          │
   Internet ──HTTPS────►  │            │   Caddy (proxy)    │◄─ Admin  │
   (domain user)          │            │  auto-SSL/ACME     │   API    │
                          │            └────────────────────┘          │
                          └────────────────────────────────────────────┘
```

Điểm mấu chốt:
- **API (NestJS)** không tự build — nó chỉ tạo *job* và đẩy vào **BullMQ**.
- **Build Worker** là tiến trình Node riêng (có thể cùng repo NestJS, chạy process khác), có quyền gọi `docker` và `git`.
- **Caddy** chạy ở chế độ có **Admin API** (`localhost:2019`) để API đăng ký/gỡ route động — KHÔNG sửa file `Caddyfile` thủ công rồi reload. Chi tiết route động xem [04-domain-ssl.md](04-domain-ssl.md).
- Mọi app + Caddy nằm chung một Docker network (`deploybox`) để Caddy proxy tới container bằng tên `app-<id>:<port>`.

---

## 3. Mô hình dữ liệu tối thiểu (Prisma)

Đủ để chạy Phase 1, chừa chỗ mở rộng. (Chưa có `Org`, `Team` — Phase 3 mới thêm.)

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String   // bcrypt/argon2 hash
  role      String   @default("admin") // Phase 1: tất cả là admin
  createdAt DateTime @default(now())
}

model App {
  id        String   @id @default(cuid())
  name      String   @unique          // dùng làm slug & tên container
  type      AppType                    // STATIC | BACKEND
  repoUrl   String
  branch    String   @default("main")
  buildMode BuildMode @default(NIXPACKS) // NIXPACKS | DOCKERFILE
  domain    String?  @unique           // vd: myapp.deploybox.dev
  port      Int      @default(3000)    // cổng container expose (backend)
  webhookSecret String                 // verify HMAC webhook
  envVars   EnvVar[]
  deployments Deployment[]
  createdAt DateTime @default(now())
}

model EnvVar {
  id     String  @id @default(cuid())
  appId  String
  app    App     @relation(fields: [appId], references: [id], onDelete: Cascade)
  key    String
  value  String  // ENCRYPTED at rest (xem mục 9)
  @@unique([appId, key])
}

model Deployment {
  id        String   @id @default(cuid())
  appId     String
  app       App      @relation(fields: [appId], references: [id], onDelete: Cascade)
  status    DeployStatus @default(QUEUED) // QUEUED|BUILDING|DEPLOYING|RUNNING|FAILED|STOPPED
  commitSha String?
  imageTag  String?  // vd: deploybox/app-<name>:<sha>
  logUrl    String?  // key trong S3/MinIO chứa build log
  createdAt DateTime @default(now())
  finishedAt DateTime?
}

enum AppType    { STATIC BACKEND }
enum BuildMode  { NIXPACKS DOCKERFILE }
enum DeployStatus { QUEUED BUILDING DEPLOYING RUNNING FAILED STOPPED }
```

---

## 4. TASK BREAKDOWN theo module

Mỗi module có: việc cần làm + tiêu chí **Done**. Thứ tự thực thi tối ưu xem [§10](#10-thứ-tự-làm--vertical-slice).

### M1 — Auth / Đăng nhập

**Việc cần làm**
- NestJS: module `auth` với JWT (access token trong httpOnly cookie). Hash mật khẩu bằng `argon2`.
- Seed sẵn 1-2 user qua script (`prisma db seed`) — Phase 1 KHÔNG cần trang đăng ký.
- Guard `@UseGuards(JwtAuthGuard)` bọc toàn bộ route nghiệp vụ.
- Next.js: trang `/login`, middleware chặn route chưa đăng nhập.

**Không làm**: OAuth, SSO, quên mật khẩu, phân quyền chi tiết.

**✅ Done khi:**
- [ ] Truy cập dashboard chưa login → redirect `/login`.
- [ ] Login đúng → vào được, cookie JWT set, refresh trang vẫn giữ session.
- [ ] Mọi API nghiệp vụ trả `401` nếu thiếu/sai token.

---

### M2 — Quản lý App + Kết nối Git repo + Webhook

**Việc cần làm**
- CRUD `App`: form tạo app gồm `name`, `repoUrl`, `branch`, `type`, `buildMode`, `port`, `domain`.
- Sinh `webhookSecret` ngẫu nhiên khi tạo app; hiển thị URL webhook để dán vào GitHub/GitLab:
  `POST https://<dashboard>/api/webhooks/:appId`
- Endpoint webhook: verify chữ ký HMAC (`X-Hub-Signature-256` của GitHub), parse branch, nếu trùng `app.branch` → tạo `Deployment(status=QUEUED)` + enqueue BullMQ job.
- Hỗ trợ repo private: Phase 1 dùng **deploy key (SSH)** hoặc **PAT** lưu trong env của DeployBox (vì tin user/team). Lưu token repo cùng cơ chế mã hoá ở [§9](#9-quản-lý-env--secret).

**Verify webhook (ví dụ GitHub HMAC-SHA256):**
```ts
import { createHmac, timingSafeEqual } from 'crypto';

function verify(sig: string, body: Buffer, secret: string): boolean {
  const h = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return sig.length === h.length &&
         timingSafeEqual(Buffer.from(sig), Buffer.from(h));
}
```

**✅ Done khi:**
- [ ] Tạo được app qua UI; webhook URL + secret hiển thị rõ.
- [ ] `git push` lên branch đúng → DeployBox nhận webhook, tạo `Deployment` QUEUED (thấy trong DB/UI).
- [ ] Webhook sai chữ ký → `401`, không tạo job.
- [ ] Nút "Deploy thủ công" (manual trigger) cũng tạo được job (không phụ thuộc webhook).

---

### M3 — Build Pipeline (clone → image)

Trái tim của Phase 1. Chạy trong **Build Worker** (BullMQ consumer).

**Luồng 1 job build:**
```
1. set Deployment.status = BUILDING, mở stream log
2. git clone --depth=1 --branch <branch> <repoUrl> /tmp/build/<deployId>
3. lấy commitSha (git rev-parse HEAD)
4. nếu buildMode = DOCKERFILE và có ./Dockerfile:
       docker build -t deploybox/<name>:<sha> .
   ngược lại (NIXPACKS):
       nixpacks build . --name deploybox/<name>:<sha>
5. stream toàn bộ stdout/stderr → log (mục M6)
6. nếu thành công → imageTag, chuyển sang DEPLOYING (M4)
   nếu fail → status=FAILED, lưu log, dọn /tmp/build/<deployId>
```

**Lưu ý kỹ thuật**
- Web tĩnh: Nixpacks tự nhận diện (Vite/CRA/Vue...) và tạo image serve static; nếu không, cho user chọn "Static + thư mục output" → ta build bằng image `caddy`/`nginx` copy thư mục `dist/`. Một preset Dockerfile cho static:
  ```dockerfile
  FROM caddy:2-alpine
  COPY ./dist /usr/share/caddy
  ```
- Đặt **timeout** cho build (vd 15 phút) → job quá hạn = FAILED.
- Concurrency BullMQ giới hạn (vd 1–2 job song song) để không sập RAM VPS.
- Dọn image cũ định kỳ (`docker image prune`) để khỏi đầy ổ.
- **Tin user** ⇒ build chạy bằng Docker thường (chưa rootless). Đây CHÍNH là điểm sẽ phải gia cố ở Phase 3 — đánh dấu sẵn trong [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).

**✅ Done khi:**
- [ ] Job QUEUED được worker nhặt, clone đúng commit.
- [ ] App Node/Go đơn giản build ra image qua Nixpacks (không cần Dockerfile).
- [ ] Repo có Dockerfile → build theo Dockerfile.
- [ ] Build fail (vd lỗi compile) → `FAILED` + log lỗi xem được, `/tmp` được dọn.

---

### M4 — Chạy container + đăng ký vào Caddy

**Việc cần làm**
- Sau build OK: `docker run -d` container mới, đặt tên `app-<name>`, gắn network `deploybox`, inject env (M5), restart policy `unless-stopped`.
  ```bash
  docker run -d --name app-<name> \
    --network deploybox \
    --restart unless-stopped \
    --env-file <generated.env> \
    deploybox/<name>:<sha>
  ```
- **Healthcheck** trước khi cắt traffic: chờ container `running` + (backend) thử `GET /` hoặc cổng mở trong ~30s. Đạt → tiếp; quá hạn → FAILED, giữ container cũ.
- Đăng ký route động vào **Caddy Admin API** trỏ `app.domain` → `app-<name>:<port>` (chi tiết payload xem [04-domain-ssl.md](04-domain-ssl.md)).
- **Thay container cũ**: start mới → healthcheck OK → cập nhật route Caddy sang container mới → `docker rm -f` container cũ. (Phase 1 chấp nhận downtime nhỏ nếu làm đơn giản hơn: stop cũ rồi start mới.)
- Set `Deployment.status = RUNNING`.

**✅ Done khi:**
- [ ] Image build xong tự `docker run`, container ở trạng thái healthy.
- [ ] Caddy có route mới; container nằm đúng network, ping được từ Caddy.
- [ ] Deploy lần 2 (push mới) thay được container đang chạy, không để 2 bản trùng tên.

---

### M5 — Quản lý Env / Secret

**Việc cần làm**
- UI: bảng key/value env cho từng app, thêm/sửa/xoá, đánh dấu "secret" (ẩn giá trị khi hiển thị).
- Lưu `value` **mã hoá at-rest** (AES-256-GCM) bằng `MASTER_KEY` trong env của DeployBox; KHÔNG lưu plaintext trong DB.
- Khi deploy: giải mã → ghi file `.env` tạm → `--env-file` → **xoá file sau khi run**.
- Đổi env → cần redeploy mới có hiệu lực (hiện banner "Env changed, redeploy to apply").

**✅ Done khi:**
- [ ] Thêm env `DATABASE_URL` cho app backend → container nhận đúng giá trị (verify bằng `docker exec env`).
- [ ] Giá trị trong DB là ciphertext, không phải plaintext.
- [ ] Env "secret" hiển thị dạng `••••` trên UI, có nút reveal.

---

### M6 — Log realtime (build + runtime)

**Việc cần làm**
- **Build log**: worker stream stdout/stderr → đẩy realtime cho client. Cách đơn giản: ghi vào Redis pub/sub theo `deployId`, API expose **SSE** (`text/event-stream`) hoặc WebSocket; UI subscribe.
- Sau khi build xong: lưu full log lên **S3/MinIO** (`logUrl`) để xem lại (xem object storage trong [02-tech-stack.md](02-tech-stack.md)).
- **Runtime log**: stream `docker logs -f app-<name>` qua cùng kênh SSE/WS.

```
Worker ──stdout──► Redis PUB channel "log:<deployId>"
                            │
NestJS SSE  /api/deployments/:id/logs  ──► subscribe ──► browser EventSource
```

**✅ Done khi:**
- [ ] Mở trang deployment đang build → log chảy realtime trong trình duyệt.
- [ ] Build xong, reload trang → vẫn xem lại được full log (từ S3/MinIO).
- [ ] Xem được runtime log của container đang chạy.

---

### M7 — List / Restart / Stop / Xoá deployment

**Việc cần làm**
- API + UI:
  - List app + deployment gần nhất + status (badge màu).
  - **Restart**: `docker restart app-<name>`.
  - **Stop**: `docker stop` + status=STOPPED + gỡ route Caddy.
  - **Redeploy**: enqueue lại job build từ commit hiện tại.
  - **Delete app**: stop + `docker rm` + gỡ route Caddy + xoá DNS (tuỳ) + xoá DB row (cascade env/deployment).

**✅ Done khi:**
- [ ] Thấy danh sách app + trạng thái real-ish (poll mỗi vài giây hoặc qua WS).
- [ ] Stop → app tắt, domain trả 502/404 sạch (route đã gỡ).
- [ ] Restart/Redeploy hoạt động đúng.
- [ ] Delete dọn sạch container + route + DB.

---

### M8 — Gắn Domain + SSL tự động

> Chi tiết kỹ thuật DNS/ACME nằm ở [04-domain-ssl.md](04-domain-ssl.md). Mục này chỉ là phần Phase 1 cần wiring.

**Việc cần làm**
- Phase 1 dùng **wildcard subdomain** của 1 domain ta sở hữu, vd `*.deploybox.dev` → mỗi app tự có `app-<name>.deploybox.dev` (không cần user cấu hình DNS).
- Cloudflare API: tạo/ghi record cho subdomain nếu chưa có (hoặc đã có sẵn record wildcard `*` trỏ về IP VPS → khỏi gọi API mỗi lần).
- Caddy auto-cấp SSL Let's Encrypt khi route được đăng ký (HTTP-01 cho từng host; wildcard cert cần DNS-01 — xem [04-domain-ssl.md](04-domain-ssl.md)).
- (Tuỳ chọn) cho phép user nhập **custom domain** của họ → ta hướng dẫn họ trỏ CNAME → Caddy tự xin cert cho host đó.

**✅ Done khi:**
- [ ] Tạo app static → vài giây sau truy cập `https://<name>.deploybox.dev` ra trang, SSL hợp lệ (ổ khoá xanh).
- [ ] Cert tự gia hạn (Caddy lo, không cần thao tác).

---

### M9 — Dashboard UI (Next.js)

**Việc cần làm (tối thiểu)**
| Trang | Nội dung |
|-------|----------|
| `/login` | form đăng nhập |
| `/` (apps) | danh sách app + status + nút Deploy |
| `/apps/new` | form tạo app |
| `/apps/[id]` | tổng quan: domain, status, env, danh sách deployment, nút Restart/Stop/Redeploy/Delete |
| `/apps/[id]/env` | quản lý env/secret |
| `/deployments/[id]` | log realtime + commit + status |

**✅ Done khi:**
- [ ] Làm được trọn vòng đời 1 app chỉ bằng UI, không cần gõ SQL/CLI.
- [ ] Status hiển thị gần realtime; log realtime hoạt động.

---

## 5. Bảng phụ thuộc giữa các module

| Module | Phụ thuộc | Mở khoá cái gì |
|--------|-----------|----------------|
| M1 Auth | — | Bảo vệ toàn bộ API |
| M2 Git/Webhook | M1 | Tạo job build |
| M3 Build | M2, BullMQ/Redis | Có image |
| M4 Run+Caddy | M3, Caddy chạy | App có URL nội bộ |
| M8 Domain/SSL | M4, [04-domain-ssl.md](04-domain-ssl.md) | URL public HTTPS |
| M5 Env | M4 | App backend dùng được DB/secret |
| M6 Log | M3, M4, Redis, S3 | Debug được |
| M7 List/Ops | M4 | Vận hành |
| M9 UI | tất cả | Dùng bằng tay người thường |

---

## 6. Đường đi xuyên suốt (Vertical Slice) — ưu tiên số 1

> Mục tiêu: **deploy được 1 web tĩnh lên domain thật, càng sớm càng tốt**, dù UI còn xấu và nhiều bước hardcode. Chứng minh xương sống chạy thông trước khi bồi thịt.

**Slice tối thiểu (bỏ qua mọi thứ chưa cần):**
```
[hardcode 1 app static, repo public]
  → trigger build bằng API thủ công (chưa cần webhook, chưa cần auth)
  → worker: git clone → docker build (preset caddy static)
  → docker run vào network deploybox
  → gọi Caddy Admin API thêm route static.deploybox.dev → container
  → mở https://static.deploybox.dev thấy trang
```

Khi slice này chạy = ta đã chứng minh: Git → Build → Run → Caddy → HTTPS thông suốt. Mọi module còn lại chỉ là **bồi quanh xương sống này**.

---

## 7. Thứ tự làm chi tiết (đề xuất)

```
B0. Hạ tầng nền (1 lần):
    - VPS + Docker + tạo network `deploybox`
    - Caddy chạy container, bật Admin API (:2019)
    - Cloudflare: trỏ *.deploybox.dev → IP VPS
    - Postgres + Redis (docker-compose cho hạ tầng DeployBox)

B1. [VERTICAL SLICE] (mục 6) — chưa auth, chưa UI, gọi API tay.
    => Cột mốc M1: "Web tĩnh lên domain thật"

B2. M3 hoàn chỉnh build (Nixpacks + Dockerfile, log stream sơ khai)
    + M4 healthcheck + thay container
    => Backend Node đơn giản chạy được, có URL

B3. M5 Env/Secret (mở khoá app backend thật cần DATABASE_URL...)
    => Cột mốc M2: "Web backend lên domain thật, có env"

B4. M2 Webhook (auto deploy khi push) + manual trigger
    => Cột mốc M3: "Push code = auto deploy"

B5. M6 Log realtime đầy đủ (SSE + lưu S3/MinIO)
    + M7 List/Restart/Stop/Delete

B6. M1 Auth (bọc lại toàn bộ API + login UI)
    + M9 Dashboard UI hoàn chỉnh
    => Cột mốc M4: "Dùng được bằng tay, không cần CLI"
```

Lý do để **Auth (M1) làm gần cuối** dù nó là dependency lý thuyết: trong lúc dev nội bộ, API để mở sau firewall/VPN là chấp nhận được; làm slice trước cho nhanh thấy kết quả, rồi mới "khoá cửa". (Nếu team khó chịu về việc này, có thể đẩy M1 lên ngay sau B1 — chi phí thêm không lớn.)

---

## 8. Milestones & ước lượng tương đối

> Ước lượng theo **đơn vị tương đối** (1 dev quen Node/Docker, làm bán thời gian). Điều chỉnh theo thực tế.

| Mốc | Nội dung | Done khi | Cỡ tương đối |
|-----|----------|----------|--------------|
| **M1** | Vertical slice: 1 web tĩnh → `https://...deploybox.dev` | Mở URL thấy trang, SSL hợp lệ | S (nhỏ) — quan trọng nhất |
| **M2** | Web backend chạy 24/7 + env/secret + healthcheck | Push 1 API Node, gọi được qua HTTPS, đọc env | M |
| **M3** | Auto-deploy qua webhook | `git push` → app tự cập nhật | S |
| **M4** | Vận hành đầy đủ: log realtime, list/restart/stop/delete, auth, UI gọn | Người không-phải-tác-giả tự deploy được qua UI | M–L |

Tỷ trọng công sức ước lượng: M1 ~15%, M2 ~30%, M3 ~10%, M4 ~45% (UI + log + ops + auth chiếm phần lớn).

---

## 9. Quản lý Env / Secret (chi tiết bảo mật tối thiểu)

Dù tin user, vẫn KHÔNG để secret plaintext:
- `MASTER_KEY` (32 byte) lưu trong env của DeployBox (không vào Git, không vào DB).
- Mã hoá từng `EnvVar.value`: AES-256-GCM, lưu `iv:authTag:ciphertext`.
- File `.env` sinh ra lúc deploy là **tạm**, xoá ngay sau `docker run`.
- Log/console KHÔNG in giá trị env.
- Token Git (PAT/deploy key) cũng đi qua cùng cơ chế mã hoá.

> Đây là mức "đủ tốt cho nội bộ". Mức SaaS (per-tenant key, vault, rotation) để [08-phase-3-saas.md](08-phase-3-saas.md) / [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).

---

## 10. Định nghĩa "Phase 1 DONE" (tổng)

Phase 1 coi như xong khi **toàn bộ** đúng:

- [ ] Một thành viên team đăng nhập dashboard, tạo app **web tĩnh** từ Git repo, và trong vài phút có `https://<name>.deploybox.dev` chạy thật, SSL hợp lệ — **không gõ lệnh nào ngoài UI**.
- [ ] Tạo app **web backend** (Node/Go) tương tự, set env `DATABASE_URL`, app chạy 24/7, tự restart nếu crash.
- [ ] `git push` lên branch cấu hình → app **tự build & deploy** (webhook).
- [ ] Xem được **build log realtime** và **runtime log** trên UI.
- [ ] **List / Restart / Stop / Redeploy / Delete** app từ UI, dọn sạch tài nguyên.
- [ ] Secret được **mã hoá at-rest**; mọi API nghiệp vụ yêu cầu **đăng nhập**.
- [ ] Toàn bộ chạy trên **1 VPS**, không Coolify, không K8s.

---

## 11. Stretch goals (chỉ làm nếu dư thời gian — KHÔNG bắt buộc)

- 🔹 **1-click Postgres**: nút tạo container Postgres + auto-set `DATABASE_URL` vào app.
- 🔹 **Custom domain** cho từng app (CNAME + Caddy on-demand TLS).
- 🔹 **Zero-downtime** thật (giữ container cũ tới khi mới healthy rồi mới chuyển route — đã mô tả ở M4).
- 🔹 **Rollback**: deploy lại `imageTag` cũ (image còn trong registry/local).
- 🔹 Metrics cơ bản (CPU/RAM mỗi container) — tiền đề cho Prometheus/Grafana ở [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md).

> Mọi thứ liên quan **multi-tenant, cô lập untrusted code, billing, quota** đều KHÔNG thuộc Phase 1 → [08-phase-3-saas.md](08-phase-3-saas.md).