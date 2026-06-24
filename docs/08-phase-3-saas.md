# Phase 3 — Lên SaaS đa người dùng

> **Tiền đề xuyên suốt:** Bản nội bộ (Phase 1 + Phase 2) làm tốt **chính là MVP của SaaS**. Phase 3 KHÔNG viết lại — chỉ **bồi thêm 3 lớp**:
> 1. **Multi-tenant** (tổ chức / team / RBAC) — ai sở hữu cái gì.
> 2. **Cô lập + quota** — code lạ không phá nhau, không cháy túi.
> 3. **Billing + self-serve** — bán được, thu được tiền, khách tự onboard không cần mình.
>
> Lớp cô lập bảo mật chỉ **tóm tắt** ở đây; chi tiết kỹ thuật (gVisor/Firecracker, rootless Docker, seccomp, network isolation) nằm trọn ở [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).

---

## 0. Tư duy chuyển dịch: từ "tin user" sang "không tin ai"

| Khía cạnh | Bản nội bộ (Phase 1-2) | Bản SaaS (Phase 3) |
|---|---|---|
| Niềm tin vào code user | TIN (team mình viết) | **KHÔNG TIN** (người lạ trên Internet) |
| Cô lập build | chạy chung host, Docker thường đủ | sandbox cứng (gVisor/Firecracker) — xem [09](09-bao-mat-va-rui-ro.md) |
| Tài nguyên | dùng thoải mái, 1 team | **quota cứng** mỗi tenant, oversubscription có kiểm soát |
| Ai trả tiền | công ty (1 hoá đơn VPS) | **từng khách**, đo usage, Stripe |
| Onboarding | mình tạo tay | **self-serve**, khách tự đăng ký 100% |
| Hỗ trợ | nhắn Slack nội bộ | ticket / email / SLA theo gói |
| Pháp lý | không cần | **ToS + Privacy + AUP** bắt buộc |

**Nguyên tắc số 1 (lặp lại từ SPINE):** rủi ro lớn nhất khi lên SaaS là **chạy code không tin cậy của người dùng** — cả lúc build lẫn lúc run. Mọi quyết định kiến trúc Phase 3 phải trả lời được: "nếu user này cố tình ác ý / vô tình viết app ngốn tài nguyên, hệ thống có sập / có rò sang tenant khác / có cháy hoá đơn không?"

---

## 1. Bảng tổng: "đã có gì → cần bổ sung gì để thành SaaS"

Đây là bản đồ công việc Phase 3. Mỗi dòng là một hạng mục; cột phải là delta cần làm.

| # | Tính năng nội bộ ĐÃ CÓ (Phase 1-2) | Cần BỔ SUNG để thành SaaS | Mức |
|---|---|---|---|
| 1 | User login đơn (1 team, ai cũng admin) | `Organization` → `Membership` → `Role` (RBAC), invite, switch org | **Bắt buộc** |
| 2 | App thuộc về "hệ thống" | App thuộc `organizationId`; mọi query **scope theo tenant** | **Bắt buộc** |
| 3 | Build trong Docker thường | Build trong **sandbox** (gVisor/Firecracker), rootless, không network ra ngoài trừ registry | **Bắt buộc** (xem [09](09-bao-mat-va-rui-ro.md)) |
| 4 | Container chạy không giới hạn RAM/CPU | **cgroup limits** (`--memory`, `--cpus`, pids), network namespace cô lập | **Bắt buộc** |
| 5 | Không đếm tài nguyên | **Metering**: CPU-giây, RAM-GB-giờ, băng thông egress, build-phút, số app | **Bắt buộc** |
| 6 | Không có giới hạn | **Quota engine**: chặn tạo app thứ N+1, chặn build khi hết hạn mức | **Bắt buộc** |
| 7 | Không thu tiền | **Stripe**: Checkout, Customer, Subscription, Webhook, Customer Portal | **Bắt buộc** |
| 8 | Mình tạo tài khoản tay | **Self-serve signup** + email verify + tạo org mặc định | **Bắt buộc** |
| 9 | Domain gắn tay (Phase 1) | Self-serve add domain + verify quyền sở hữu (xem [04-domain-ssl.md](04-domain-ssl.md)) | **Bắt buộc** |
| 10 | Logs/artifact chung | Tách bucket/prefix theo tenant trên S3 (MinIO/R2), TTL log theo gói | Nên |
| 11 | Không có trang giá | **Pricing page** + plan catalog (Free/Starter/Pro) | **Bắt buộc** |
| 12 | Không có pháp lý | **ToS / Privacy / Acceptable Use Policy**, chặn nội dung cấm | **Bắt buộc** |
| 13 | Hỗ trợ qua Slack | Kênh support (email/Crisp/Plain), status page, docs | Nên |
| 14 | Không "ngủ" app | **Sleep/scale-to-zero** app nhàn rỗi (gói free) để tiết kiệm RAM | **Bắt buộc** cho free |
| 15 | Monitoring nội bộ (Prometheus/Grafana) | Thêm **per-tenant dashboard** + alert vượt quota | Nên |
| 16 | Mobile build chung (Phase 2) | iOS build tốn macOS → **chỉ mở cho gói trả phí**, đếm build-phút riêng | Nên |

> Quy tắc đọc bảng: làm hết cột **Bắt buộc** mới gọi là "có thể bán". Cột **Nên** làm dần sau khi có khách đầu tiên.

---

## 2. Multi-tenancy: mô hình dữ liệu & RBAC

### 2.1 Chọn mô hình cô lập dữ liệu

Có 3 kiểu, ta chọn **Shared DB + Row-Level scoping** cho MVP (rẻ, đủ an toàn nếu kỷ luật query):

| Mô hình | Cô lập | Chi phí | Khi nào dùng |
|---|---|---|---|
| Shared DB, shared schema, cột `organizationId` | Logic (app phải scope) | Thấp nhất | **Chọn cho Phase 3 MVP** |
| Shared DB, schema-per-tenant | Trung bình | Trung bình | Khi khách lớn yêu cầu |
| DB-per-tenant | Vật lý | Cao | Khách enterprise / yêu cầu compliance |

**Quyết định:** dùng **PostgreSQL + Prisma** (theo SPINE) với cột `organizationId` trên mọi bảng tài nguyên, **bật Postgres RLS (Row-Level Security)** làm hàng rào cuối để dù code quên scope cũng không rò chéo.

### 2.2 Sơ đồ thực thể

```
┌──────────────┐      ┌──────────────────┐      ┌─────────────┐
│ Organization │1───* │   Membership     │ *───1│    User     │
│  (tenant)    │      │ (role: OWNER…)   │      │ (1 người)   │
└──────┬───────┘      └──────────────────┘      └─────────────┘
       │ 1
       │ *
   ┌───┴──────┐   ┌────────────┐   ┌──────────────┐
   │   App    │   │  Domain    │   │ Subscription │
   │ (deploy) │   │ (mua/gắn)  │   │  (Stripe)    │
   └───┬──────┘   └────────────┘   └──────────────┘
       │ *
   ┌───┴──────┐   ┌──────────────┐
   │ Build    │   │ UsageRecord  │  ← metering: cpu/ram/egress/build-min
   │ (job)    │   │ (theo kỳ)    │
   └──────────┘   └──────────────┘
```

Một `User` có thể thuộc **nhiều** `Organization` (qua `Membership`) và switch qua lại. Mọi tài nguyên (`App`, `Domain`, `Build`, `UsageRecord`, `Subscription`) **luôn** treo dưới một `Organization`.

### 2.3 Vai trò RBAC (gọn, đủ dùng)

| Role | Tạo/xoá app | Deploy | Quản lý domain | Mời/xoá thành viên | Billing | Đổi gói |
|---|---|---|---|---|---|---|
| **OWNER** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **ADMIN** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **DEVELOPER** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **VIEWER** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

> Chỉ **OWNER** đụng được tiền. `Membership` lưu `role`; có thể đổi owner nhưng org luôn phải có **ít nhất 1 OWNER**.

### 2.4 Prisma schema (trích phần multi-tenant + billing)

```prisma
model Organization {
  id            String         @id @default(cuid())
  name          String
  slug          String         @unique          // dùng cho subdomain: acme.deploybox.app
  planId        String         @default("free")  // free | starter | pro
  stripeCustomerId String?     @unique
  createdAt     DateTime       @default(now())

  memberships   Membership[]
  apps          App[]
  domains       Domain[]
  subscription  Subscription?
  usageRecords  UsageRecord[]
}

model User {
  id           String        @id @default(cuid())
  email        String        @unique
  emailVerified DateTime?
  memberships  Membership[]
}

enum Role { OWNER ADMIN DEVELOPER VIEWER }

model Membership {
  id             String       @id @default(cuid())
  role           Role         @default(DEVELOPER)
  userId         String
  organizationId String
  user           User         @relation(fields: [userId], references: [id])
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])        // 1 user chỉ 1 membership / org
  @@index([organizationId])
}

model App {
  id             String       @id @default(cuid())
  name           String
  organizationId String                                  // ← TENANT KEY
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  // ...repo, buildConfig, runtime limits...
  cpuLimit       Float        @default(0.5)   // số vCPU
  memoryLimitMb  Int          @default(256)   // RAM trần
  sleepAfterMin  Int          @default(15)    // scale-to-zero sau N phút idle (free)

  @@index([organizationId])
}

model Subscription {
  id                   String   @id @default(cuid())
  organizationId       String   @unique
  stripeSubscriptionId String   @unique
  status               String   // active | past_due | canceled | trialing
  currentPeriodEnd     DateTime
  organization         Organization @relation(fields: [organizationId], references: [id])
}

model UsageRecord {
  id             String   @id @default(cuid())
  organizationId String
  metric         String   // "ram_gb_hours" | "cpu_seconds" | "egress_gb" | "build_minutes"
  quantity       Float
  periodStart    DateTime
  periodEnd      DateTime
  reportedToStripe Boolean @default(false)
  organization   Organization @relation(fields: [organizationId], references: [id])

  @@index([organizationId, metric, periodStart])
}
```

### 2.5 Scope tenant trong NestJS (không để rò chéo)

Hai lớp phòng thủ — **đừng chỉ dựa vào một**:

**Lớp A — Guard + context (ứng dụng).** Mỗi request mang `organizationId` (từ JWT hoặc header `x-org-id` đã verify membership). Một `TenantGuard` chặn nếu user không thuộc org đó:

```typescript
// tenant.guard.ts (rút gọn)
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const orgId = req.headers['x-org-id'];
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: req.user.id, organizationId: orgId } },
    });
    if (!membership) throw new ForbiddenException('Not a member of this org');
    req.organizationId = orgId;
    req.role = membership.role;          // dùng tiếp cho RBAC
    return true;
  }
}
```

Mọi truy vấn tài nguyên BẮT BUỘC kèm `where: { organizationId: req.organizationId }`. **Không bao giờ** `findUnique({ where: { id } })` trần cho tài nguyên thuộc tenant.

**Lớp B — Postgres RLS (database).** Set biến phiên `app.current_org` đầu mỗi transaction, policy lọc tự động. Đây là lưới an toàn nếu lập trình viên quên scope:

```sql
ALTER TABLE "App" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "App"
  USING ("organizationId" = current_setting('app.current_org', true));
-- đầu mỗi request/transaction:
-- SELECT set_config('app.current_org', $orgId, true);
```

> Kiểm thử bắt buộc: viết test "user org A gọi API với id tài nguyên của org B → 403/404, KHÔNG bao giờ 200". Đây là test chống rò tenant, phải có trong CI.

---

## 3. Cô lập tài nguyên + Quota (chống cháy túi)

### 3.1 Cô lập bảo mật — chỉ tóm tắt

Khi chạy code lạ, cần **3 tầng** (chi tiết, cấu hình đầy đủ, threat model → [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)):

- **Build-time:** Nixpacks/Dockerfile của user build trong **sandbox** (gVisor `runsc` hoặc Firecracker microVM), rootless Docker, seccomp profile, **không cho network egress** trừ pull base image + push registry. Timeout build cứng.
- **Run-time:** mỗi container chạy với network namespace riêng, không thấy container tenant khác; chặn truy cập metadata VPS (169.254.169.254); drop capabilities; read-only rootfs khi có thể.
- **Host:** 1 VPS ban đầu (theo SPINE) → khi scale, tách **build node** và **run node**; cân nhắc node riêng cho tenant trả phí cao.

### 3.2 Quota: định nghĩa hạn mức theo gói

Hạn mức phải **đo được** và **chặn được tại runtime**. Đề xuất khởi điểm:

| Hạn mức | Free | Starter | Pro |
|---|---|---|---|
| Số app tối đa | 1 | 5 | 20 |
| RAM/app (trần) | 256 MB | 512 MB | 1 GB |
| vCPU/app (trần) | 0.5 | 1 | 2 |
| Build-phút/tháng | 100 | 500 | 2000 |
| Băng thông egress/tháng | 5 GB | 100 GB | 500 GB |
| Custom domain | ❌ (chỉ subdomain) | ✅ 3 | ✅ 25 |
| Scale-to-zero (sleep) | **Bắt buộc** 15' | tuỳ chọn | tắt được |
| iOS build (Phase 2) | ❌ | ❌ | ✅ (đếm riêng) |
| Log retention | 1 ngày | 7 ngày | 30 ngày |

### 3.3 Áp limit tại runtime (cgroup qua Docker)

Container chạy với giới hạn cứng — nếu vượt RAM thì OOM-kill chứ không cho ăn lan sang tenant khác:

```bash
docker run -d \
  --name app_${appId} \
  --memory="256m" --memory-swap="256m" \   # RAM trần, cấm swap (free plan)
  --cpus="0.5" \                            # nửa vCPU
  --pids-limit=256 \                        # chống fork bomb
  --network="tenant_${orgId}_net" \         # network namespace cô lập
  --read-only --tmpfs /tmp \                # rootfs chỉ đọc khi có thể
  --restart=on-failure:3 \
  --label "org=${orgId}" --label "app=${appId}" \
  registry.deploybox.app/${orgId}/${appId}:latest
```

### 3.4 Quota engine: chặn trước khi tốn tiền

Hai loại chặn:

1. **Chặn cứng tại thời điểm hành động** (tạo app, trigger build):

```typescript
// quota.service.ts (rút gọn)
async assertCanCreateApp(orgId: string) {
  const plan = await this.getPlan(orgId);            // free/starter/pro
  const count = await this.prisma.app.count({ where: { organizationId: orgId } });
  if (count >= plan.maxApps)
    throw new ForbiddenException(
      `Đã đạt giới hạn ${plan.maxApps} app của gói ${plan.id}. Nâng cấp để tạo thêm.`);
}

async assertCanBuild(orgId: string) {
  const used = await this.getBuildMinutesThisPeriod(orgId);
  const plan = await this.getPlan(orgId);
  if (used >= plan.buildMinutes)
    throw new ForbiddenException('Hết build-phút tháng này. Nâng cấp hoặc đợi kỳ sau.');
}
```

2. **Chặn theo dõi liên tục** (băng thông, RAM-giờ): job định kỳ (BullMQ repeatable) cộng dồn `UsageRecord`; khi vượt ngưỡng → **degrade** chứ đừng xoá data:
   - Free vượt egress → **throttle / sleep app** + email cảnh báo.
   - Trả phí vượt → tính **overage** (xem 4.4) hoặc chặn build mới, **không** giết app đang chạy của khách đang trả tiền.

### 3.5 Scale-to-zero (ngủ app nhàn rỗi) — sống còn cho gói free

Mỗi container backend chạy 24/7 ăn RAM thật → **đây là cái cháy túi nhanh nhất**. Giải pháp:

```
Request đến app đang ngủ
        │
        ▼
 ┌──────────────┐   miss   ┌──────────────────┐   start   ┌───────────────┐
 │ Caddy/proxy  │────────► │ Activator (Nest) │ ────────► │ docker start  │
 │ (on-demand)  │          │ giữ request chờ  │           │ container app │
 └──────────────┘ ◄────────┴──────────────────┘ ◄───────  └───────────────┘
        ▲           proxy lại khi healthy (vài giây)
        │
 (idle 15') ── watcher đếm 0 request → docker stop → giải phóng RAM
```

- Watcher (BullMQ repeatable job) quét app không có request > `sleepAfterMin` → `docker stop` (giữ nguyên image/volume).
- Request kế tiếp → Activator `docker start` lại (cold start vài giây), giữ request HTTP chờ rồi proxy.
- **Gói free luôn bật sleep**; Pro cho phép tắt (giữ luôn warm). Đây vừa là tính năng vừa là **đòn bẩy nâng cấp**.

---

## 4. Billing với Stripe + đo usage

### 4.1 Mô hình tính tiền: hybrid

Chọn **flat fee theo gói + (tuỳ chọn) overage theo usage**. Đơn giản hơn pure usage-based, dễ dự đoán doanh thu:

| Thành phần | Cách tính | Stripe |
|---|---|---|
| Phí gói cố định | Starter $X/tháng, Pro $Y/tháng | Recurring price (licensed) |
| Vượt hạn mức (overage) | $/GB egress, $/build-phút vượt | Metered price + usage records |
| Free | $0, giới hạn cứng, **không** overage (chặn thẳng) | Không tạo subscription tính tiền |

> Vì sao free **không** overage mà chặn thẳng: để **không bao giờ** một user free làm phát sinh chi phí ngoài tầm. Free = trần cứng, hết thì degrade.

### 4.2 Các đối tượng Stripe cần map

```
Organization ──1:1── Stripe Customer (stripeCustomerId)
        │
        └──1:1── Stripe Subscription
                    ├── item: price_starter_flat   (licensed, qty=1)
                    └── item: price_egress_overage  (metered)  ← report usage
```

### 4.3 Luồng checkout self-serve

```
User bấm "Nâng cấp lên Starter"
   │
   ▼
NestJS tạo Checkout Session ──────────► Stripe Checkout (hosted) ──► user nhập thẻ
   │                                                                      │
   │  ◄──────────────── webhook: checkout.session.completed ─────────────┘
   ▼
Cập nhật org.planId='starter', tạo Subscription, mở quota mới
```

```typescript
// billing.controller.ts (rút gọn) — tạo phiên checkout
@Post('checkout')
@Roles('OWNER')                                   // chỉ OWNER
async createCheckout(@Req() req, @Body() dto: { priceId: string }) {
  const org = await this.orgs.get(req.organizationId);
  const customerId = org.stripeCustomerId
    ?? (await this.billing.ensureCustomer(org));   // tạo Customer nếu chưa có
  const session = await this.stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: dto.priceId, quantity: 1 }],
    success_url: `${APP_URL}/billing?ok=1`,
    cancel_url: `${APP_URL}/billing?canceled=1`,
    subscription_data: { metadata: { organizationId: org.id } },
  });
  return { url: session.url };
}
```

### 4.4 Đo usage → đẩy lên Stripe (metered)

Job BullMQ cuối mỗi kỳ (hoặc hằng giờ) tổng hợp `UsageRecord` và report:

```typescript
// usage-reporter.job.ts (rút gọn)
const overageGb = Math.max(0, egressGbThisPeriod - plan.includedEgressGb);
if (overageGb > 0) {
  await stripe.subscriptionItems.createUsageRecord(subItemEgressId, {
    quantity: Math.ceil(overageGb),
    timestamp: 'now',
    action: 'set',            // hoặc 'increment' tuỳ chiến lược
  });
}
// đánh dấu reportedToStripe=true để không double-count
```

### 4.5 Webhook — nguồn sự thật về trạng thái trả tiền

**Luôn** xác minh chữ ký webhook (`stripe.webhooks.constructEvent`). Các event tối thiểu phải xử lý:

| Event | Hành động trong DeployBox |
|---|---|
| `checkout.session.completed` | Kích hoạt gói, set `org.planId`, mở quota |
| `invoice.paid` | Gia hạn kỳ, `currentPeriodEnd` mới |
| `invoice.payment_failed` | Đánh dấu `past_due`, gửi email, **ân hạn** N ngày |
| `customer.subscription.deleted` | Hạ về `free`, siết quota, **không xoá** app ngay (grace) |
| `customer.subscription.updated` | Đổi gói (up/downgrade) → cập nhật limits |

```typescript
@Post('webhook')
@HttpCode(200)
async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
  const event = this.stripe.webhooks.constructEvent(req.rawBody, sig, WEBHOOK_SECRET); // verify!
  switch (event.type) {
    case 'invoice.payment_failed': await this.billing.markPastDue(event); break;
    case 'customer.subscription.deleted': await this.billing.downgradeToFree(event); break;
    // ...
  }
  return { received: true };
}
```

> **Idempotency:** lưu `event.id` đã xử lý (Redis/DB), bỏ qua nếu trùng — Stripe có thể gửi lại.

### 4.6 Customer Portal

Đừng tự build trang quản lý thẻ/hoá đơn. Dùng **Stripe Customer Portal** (1 link) cho khách tự đổi thẻ, xem hoá đơn, huỷ gói:

```typescript
const portal = await stripe.billingPortal.sessions.create({
  customer: org.stripeCustomerId,
  return_url: `${APP_URL}/billing`,
});
return { url: portal.url };
```

---

## 5. Self-serve onboarding

Mục tiêu: khách **tự đăng ký → deploy app đầu tiên trong < 5 phút**, không cần mình can thiệp.

```
Đăng ký (email + pass / OAuth GitHub)
   │
   ▼
Verify email (token) ──► Tạo Organization mặc định (slug từ tên) + Membership OWNER
   │
   ▼
Wizard onboard:
   1. Kết nối Git (GitHub App) ────────────► chọn repo
   2. Tự nhận diện (Nixpacks) / chọn Dockerfile
   3. Bấm Deploy ─► build trong sandbox ─► container chạy
   4. Cấp subdomain miễn phí: <app>.<org>.deploybox.app  (SSL tự động, xem [04-domain-ssl.md](04-domain-ssl.md))
   ▼
"App của bạn đang chạy!" + gợi ý nâng cấp khi cần custom domain
```

Checklist onboarding:

- [ ] Đăng ký email/password **và** OAuth GitHub (GitHub App để build từ repo riêng).
- [ ] Email verification bắt buộc trước khi build (chống abuse — xem 7.2).
- [ ] Tạo org + OWNER membership tự động sau verify.
- [ ] Subdomain miễn phí `*.deploybox.app` (wildcard cert DNS-01 qua Caddy + Cloudflare — xem [04-domain-ssl.md](04-domain-ssl.md)).
- [ ] Wizard kết nối Git → deploy mẫu (template Next.js/Express) để "wow" nhanh.
- [ ] Mời thành viên qua email (tạo `Membership` role mặc định DEVELOPER).
- [ ] Empty-state có nút "Deploy sample app" để khách thấy giá trị ngay.

---

## 6. Trang giá & gói cước (Pricing)

### 6.1 Ba gói khởi điểm

| | **Free** | **Starter** | **Pro** |
|---|---|---|---|
| Giá | $0 | ~$X/tháng | ~$Y/tháng |
| Số app | 1 | 5 | 20 |
| RAM/app | 256 MB | 512 MB | 1 GB |
| Build-phút/tháng | 100 | 500 | 2000 |
| Egress/tháng | 5 GB | 100 GB | 500 GB |
| Custom domain | ❌ subdomain | ✅ 3 | ✅ 25 |
| App ngủ khi idle | Bắt buộc | Tuỳ chọn | Tắt được |
| Mobile Android build | ✅ giới hạn | ✅ | ✅ |
| iOS build | ❌ | ❌ | ✅ |
| Log retention | 1 ngày | 7 ngày | 30 ngày |
| Hỗ trợ | Community | Email | Email ưu tiên |

> Đặt giá thực tế **sau** khi đo chi phí thật ở [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md). Nguyên tắc: giá gói thấp nhất phải **cover được chi phí RAM + egress + Stripe fee** của một khách trung bình, kèm biên an toàn.

### 6.2 Đòn bẩy nâng cấp (paywall đặt đúng chỗ)

Đặt rào ở những thứ khách **cần** khi nghiêm túc: custom domain, tắt sleep (giữ app warm), nhiều app hơn, iOS build, log retention dài, nhiều thành viên. Hiển thị thông báo nâng cấp **ngay tại điểm chạm** ("Cần custom domain? Nâng lên Starter").

---

## 7. Bẫy kinh doanh (CẢNH BÁO — đọc kỹ)

### 7.1 Bẫy chi phí: mỗi container 24/7 ăn tiền thật

- **Sai lầm chết người:** cho gói free chạy container backend 24/7 không ngủ. 1000 user free × 256 MB = **256 GB RAM** → phá sản.
- **Phòng chống (bắt buộc):**
  - Scale-to-zero cho free (mục 3.5) — app ngủ thì RAM = 0.
  - Giới hạn cứng số app + RAM/app theo gói.
  - **Free chỉ nên ưu ái web tĩnh** (gần như 0 chi phí runtime) và **giới hạn ngặt** app backend, hoặc chỉ cho 1 app backend ngủ aggressive.
  - Egress là chi phí ẩn lớn (DigitalOcean/Hetzner tính tiền băng thông vượt) → đếm egress, chặn free khi vượt.

| Nguồn chi phí | Vì sao đau | Kiểm soát |
|---|---|---|
| RAM container 24/7 | Tuyến tính theo số app, không ngủ = cháy | scale-to-zero + quota RAM |
| Egress băng thông | Vượt gói VPS → tính tiền/GB | metering + chặn free |
| Build CPU | Build nặng (Docker) ngốn CPU build node | build-phút quota + timeout |
| iOS build (Phase 2) | Cần macOS + Apple cert, đắt | chỉ mở Pro, đếm riêng |
| Storage log/artifact | Tích luỹ vô hạn | TTL theo gói (mục 6.1) |

### 7.2 Bẫy lạm dụng gói free (abuse)

Gói free là cửa ngõ cho kẻ xấu: đào coin, spam, host phishing, dùng làm proxy.

- [ ] **Email verify bắt buộc** trước build; chặn email dùng-một-lần (disposable).
- [ ] Giới hạn build đồng thời + build-phút free thấp → đào coin không lời.
- [ ] **Chặn network egress lúc build** (chỉ registry) → khó dùng làm bot.
- [ ] Phát hiện CPU 100% kéo dài trên free → cảnh báo / sleep (đào coin thường ghim CPU).
- [ ] Có thể yêu cầu **thẻ tín dụng** (không charge) cho free để giảm abuse — đánh đổi với conversion.
- [ ] AUP cấm: crypto mining, phishing, malware, spam, nội dung phi pháp → cho phép **khoá tức thì** (mục 8).
- [ ] Rate-limit signup theo IP; chống multi-account farm.

### 7.3 Bẫy multi-tenant: rò dữ liệu chéo

Một bug quên `where organizationId` = lộ data khách này cho khách khác = **sự cố nghiêm trọng**.

- [ ] RLS Postgres làm lưới cuối (mục 2.5 lớp B).
- [ ] Test tự động "cross-tenant access → phải fail" trong CI.
- [ ] Mọi endpoint qua `TenantGuard`; review code mọi query mới.

### 7.4 Bẫy pháp lý & thanh toán

- [ ] Không có ToS/AUP → không có cơ sở khoá kẻ lạm dụng. Phải có **trước** khi mở free.
- [ ] Chargeback / thẻ gian lận → Stripe Radar bật sẵn; theo dõi tỉ lệ dispute.
- [ ] Thuế (VAT/sales tax) → cân nhắc **Stripe Tax** khi bán xuyên biên giới.

---

## 8. ToS / Pháp lý / Acceptable Use

Tối thiểu **trước khi mở đăng ký công khai**:

| Tài liệu | Nội dung cốt lõi |
|---|---|
| **Terms of Service** | Quyền/nghĩa vụ, giới hạn trách nhiệm, quyền **đình chỉ/khoá** tài khoản vi phạm, "as-is", chấm dứt dịch vụ |
| **Privacy Policy** | Thu thập gì (email, logs, usage), lưu ở đâu, GDPR nếu có khách EU, quyền xoá dữ liệu |
| **Acceptable Use Policy (AUP)** | **Cấm**: mining, phishing, malware, spam, DDoS, nội dung phi pháp, vi phạm bản quyền; vi phạm → khoá ngay |
| **DPA** (sau, cho khách lớn) | Cam kết xử lý dữ liệu khi khách doanh nghiệp yêu cầu |

- Checkbox "Tôi đồng ý ToS + Privacy" **bắt buộc** ở bước signup, **lưu mốc thời gian + version** đã đồng ý.
- Cơ chế kỹ thuật để thực thi AUP: nút **suspend org** (dừng mọi container, chặn build, khoá login) + quy trình gỡ nội dung vi phạm.
- Quy định rõ **data retention sau huỷ gói**: giữ N ngày rồi xoá (báo trước qua email).

> Đây là khung kỹ thuật/vận hành, **không phải tư vấn pháp lý** — thuê luật sư review ToS/Privacy trước khi public.

---

## 9. Hỗ trợ khách hàng

Quy mô nhỏ, ưu tiên kênh nhẹ, tự phục vụ trước:

| Hạng mục | Công cụ gợi ý | Ghi chú |
|---|---|---|
| Kênh ticket | Email + Plain/Crisp/Chatwoot (self-host) | Đừng dựng helpdesk nặng sớm |
| Tài liệu | Docs site (Nextra/Mintlify) + template deploy | Giảm ticket lặp lại |
| Status page | Uptime Kuma (đã có ở SPINE) public | Minh bạch sự cố |
| In-app | Empty-state, tooltip, link docs ngay tại lỗi | Self-serve tốt = ít support |
| Phân tầng theo gói | Free=community/docs; Starter=email; Pro=ưu tiên | Khớp bảng giá (6.1) |

- [ ] Trang `/docs` với hướng dẫn theo từng loại app (web tĩnh / backend / mobile — xem [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md)).
- [ ] Thông báo lỗi build/deploy **kèm gợi ý sửa**, link tới [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md) khi liên quan giới hạn sandbox.
- [ ] Status page công khai (Uptime Kuma) + email khi downtime.

---

## 10. Definition of Done — Phase 3

Phase 3 coi như **xong (bán được)** khi toàn bộ checklist sau xanh:

**Multi-tenant & RBAC**
- [ ] `Organization`/`Membership`/`Role` hoạt động; 1 user nhiều org, switch được.
- [ ] Mọi tài nguyên scope theo `organizationId`; `TenantGuard` phủ mọi endpoint.
- [ ] Postgres RLS bật; test cross-tenant trong CI **đỏ khi rò, xanh khi an toàn**.

**Cô lập & Quota**
- [ ] Build chạy trong sandbox (gVisor/Firecracker) — chi tiết & verify ở [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md).
- [ ] Container có `--memory/--cpus/--pids-limit` + network namespace/tenant.
- [ ] Quota engine chặn tạo app vượt số lượng & chặn build khi hết build-phút.
- [ ] Scale-to-zero hoạt động cho gói free (app ngủ → start lại khi có request).
- [ ] Metering ghi `UsageRecord` cho ram-giờ / egress / build-phút.

**Billing**
- [ ] Stripe: Checkout, Customer, Subscription, Customer Portal chạy thật (test mode → live).
- [ ] Webhook verify chữ ký + idempotent; xử lý đủ event ở bảng 4.5.
- [ ] Up/downgrade gói cập nhật quota tức thì; `payment_failed` → past_due + ân hạn.
- [ ] Overage egress report đúng lên Stripe (nếu bật).

**Self-serve & GTM**
- [ ] Signup + email verify + tạo org tự động, **không cần admin can thiệp**.
- [ ] Onboarding wizard: kết nối Git → deploy → subdomain SSL < 5 phút.
- [ ] Pricing page với Free/Starter/Pro; paywall đúng điểm chạm.

**Pháp lý & vận hành**
- [ ] ToS + Privacy + AUP công khai; checkbox đồng ý lưu version + timestamp.
- [ ] Nút suspend org thực thi AUP (dừng container + khoá).
- [ ] Kênh support + status page (Uptime Kuma) + docs cơ bản.
- [ ] Chi phí/gói đã tính khớp [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md); free **không thể** gây chi phí ngoài trần.

---

### Liên kết chéo
- Cô lập bảo mật chi tiết, sandbox, threat model → [09-bao-mat-va-rui-ro.md](09-bao-mat-va-rui-ro.md)
- Domain/subdomain/SSL wildcard tự động → [04-domain-ssl.md](04-domain-ssl.md)
- Chi phí thật & vận hành (đặt giá dựa trên số liệu) → [10-chi-phi-va-van-hanh.md](10-chi-phi-va-van-hanh.md)
- Luồng deploy theo loại app (web tĩnh/backend/mobile) → [03-luong-deploy-theo-loai-app.md](03-luong-deploy-theo-loai-app.md)
- Nền tảng MVP nội bộ mà Phase 3 mở rộng → [06-phase-1-mvp.md](06-phase-1-mvp.md), [07-phase-2-mobile.md](07-phase-2-mobile.md)