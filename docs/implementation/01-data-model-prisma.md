# Mô hình dữ liệu (Prisma schema)

Đây là **xương sống dữ liệu** của DeployBox — mọi tài liệu triển khai khác tham chiếu các model và enum ở đây. Schema được thiết kế để **Phase 1 (nội bộ) dùng ngay** nhưng **đã có sẵn `Team`/multi-tenant** để Phase 3 (SaaS) không phải đập đi (xem [../00-tong-quan.md](../00-tong-quan.md) §5 và [../08-phase-3-saas.md](../08-phase-3-saas.md)).

Khớp với mô hình khái niệm ở [../01-kien-truc-tong-the.md](../01-kien-truc-tong-the.md).

---

## 1. Sơ đồ quan hệ

```
User ──< TeamMember >── Team ──< Project ──< Deployment
                                   │   ├──< Domain
                                   │   └──< EnvVar
User ──< ApiToken                  └ (1 Project = 1 app deploy được)
```

- `User` *—* `Team`: nhiều–nhiều qua `TeamMember` (có `role` → RBAC).
- `Team` 1—* `Project`; `Project` 1—* `Deployment` / `Domain` / `EnvVar`.
- Phase 1: mỗi user thực chất làm trong **1 team mặc định**; cấu trúc vẫn tổng quát.

---

## 2. `schema.prisma` đầy đủ

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---------- ENUMS (khớp 1-1 với packages/shared/src/enums.ts) ----------

enum TeamRole {
  OWNER
  ADMIN
  MEMBER
}

enum ProjectType {
  STATIC      // web tĩnh: build → serve file qua Caddy
  BACKEND     // web có backend: container chạy 24/7
}

enum GitProvider {
  GITHUB
  GITLAB
  BITBUCKET
}

enum DeploymentStatus {
  QUEUED      // đang chờ trong hàng đợi build
  BUILDING    // đang build image
  DEPLOYING   // đang khởi chạy container / cập nhật proxy
  RUNNING     // sống & nhận traffic
  SLEEPING    // ngủ (scale-to-zero) — xem 10-chi-phi-va-van-hanh
  FAILED      // build/deploy lỗi
  STOPPED     // dừng có chủ đích
  CANCELLED   // bị hủy giữa chừng
}

enum DeploymentTrigger {
  MANUAL      // bấm Deploy trên dashboard
  GIT_PUSH    // webhook từ git
  REDEPLOY    // chạy lại bản cũ
}

enum DomainStatus {
  PENDING_DNS // chờ user trỏ DNS
  VERIFYING   // đang xác minh + xin cert
  ACTIVE      // đã gắn + có SSL
  FAILED
}

enum EnvTarget {
  BUILD       // chỉ lúc build
  RUNTIME     // chỉ lúc chạy
  BOTH
}

// ---------- MODELS ----------

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  passwordHash String?              // null nếu đăng nhập OAuth
  avatarUrl    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  memberships  TeamMember[]
  apiTokens    ApiToken[]
}

model Team {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())

  members   TeamMember[]
  projects  Project[]
}

model TeamMember {
  id        String   @id @default(cuid())
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  teamId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  role      TeamRole @default(MEMBER)
  createdAt DateTime @default(now())

  @@unique([teamId, userId])
  @@index([userId])
}

model Project {
  id             String       @id @default(cuid())
  team           Team         @relation(fields: [teamId], references: [id], onDelete: Cascade)
  teamId         String
  name           String
  slug           String                          // dùng cho subdomain mặc định: <slug>.<APP_DOMAIN>
  type           ProjectType  @default(BACKEND)

  // Nguồn code
  gitProvider    GitProvider?
  gitRepoUrl     String?
  gitBranch      String       @default("main")
  rootDir        String       @default(".")
  autoDeploy     Boolean      @default(true)      // deploy khi có git push?
  webhookSecret  String?                          // secret HMAC xác thực webhook git (mã hoá at-rest)

  // Cấu hình build/run (override auto-detect của Nixpacks)
  installCommand String?
  buildCommand   String?
  startCommand   String?                          // cho BACKEND
  outputDir      String?                          // cho STATIC (vd "dist", "build")
  internalPort   Int          @default(3000)      // cổng app lắng nghe trong container

  // Vận hành
  sleepEnabled   Boolean      @default(false)     // scale-to-zero khi nhàn rỗi
  memoryMb       Int          @default(512)       // quota RAM container
  cpuLimit       Float        @default(0.5)       // quota CPU (số vCPU)

  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  deployments    Deployment[]
  domains        Domain[]
  envVars        EnvVar[]

  @@unique([teamId, slug])
  @@index([teamId])
}

model Deployment {
  id           String            @id @default(cuid())
  project      Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId    String
  status       DeploymentStatus  @default(QUEUED)
  trigger      DeploymentTrigger @default(MANUAL)

  commitSha    String?
  commitMsg    String?
  imageTag     String?                            // image build ra (BACKEND) — vd "deploybox/<proj>:<sha>"
  containerId  String?                            // container đang chạy (BACKEND)
  staticPath   String?                            // đường dẫn file tĩnh đã publish (STATIC)
  logKey       String?                            // key build log trên object storage
  errorMessage String?

  queuedAt     DateTime          @default(now())
  startedAt    DateTime?
  finishedAt   DateTime?
  createdBy    String?                            // userId người trigger

  @@index([projectId, queuedAt(sort: Desc)])
  @@index([status])
}

model Domain {
  id          String       @id @default(cuid())
  project     Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId   String
  hostname    String       @unique                // vd "myapp.com" hoặc "app.deploybox.app"
  isPrimary   Boolean      @default(false)
  isManaged   Boolean      @default(false)        // true = subdomain *.deploybox.app (ta tự quản DNS)
  status      DomainStatus @default(PENDING_DNS)
  verifyToken String?                             // giá trị TXT record để xác minh sở hữu
  createdAt   DateTime     @default(now())

  @@index([projectId])
}

model EnvVar {
  id        String    @id @default(cuid())
  project   Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId String
  key       String
  value     String                                // MÃ HOÁ at-rest nếu isSecret (AES-256-GCM, ENCRYPTION_KEY)
  isSecret  Boolean   @default(false)
  target    EnvTarget @default(RUNTIME)

  @@unique([projectId, key])
}

model ApiToken {
  id         String    @id @default(cuid())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     String
  name       String
  tokenHash  String    @unique                    // chỉ lưu HASH, không lưu token thô
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
}
```

---

## 3. Ghi chú thiết kế (quan trọng khi triển khai)

| Chủ đề | Quyết định | Vì sao |
|---|---|---|
| **Multi-tenant từ đầu** | Mọi truy vấn lọc theo `teamId`; Phase 1 chỉ 1 team | Để Phase 3 SaaS không phải migrate cấu trúc |
| **`Project` = 1 app** | Mỗi project deploy độc lập, có subdomain `<slug>.<APP_DOMAIN>` | Đơn giản hóa Phase 1; "service" phức tạp để sau |
| **`Deployment` là immutable record** | Mỗi lần deploy tạo bản ghi mới; rollback = redeploy bản cũ | Lịch sử + audit + rollback dễ |
| **Secret mã hoá at-rest** | `EnvVar.value` mã hoá AES-256-GCM khi `isSecret=true`, key từ `ENCRYPTION_KEY` | Không để secret plaintext trong DB; xem [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md) §9 |
| **Token chỉ lưu hash** | `ApiToken.tokenHash` | Lộ DB không lộ token |
| **Quota nằm trên `Project`** | `memoryMb`, `cpuLimit`, `sleepEnabled` | Áp trực tiếp lúc `docker run`; nền cho billing Phase 3 |
| **Log KHÔNG lưu trong Postgres** | Chỉ lưu `logKey` trỏ object storage; log stream realtime qua WS | Tránh phình DB; xem [02-api-contract.md](02-api-contract.md) §WebSocket |

---

## 4. Migration & seed

```bash
# Tạo migration đầu tiên
pnpm --filter api prisma migrate dev --name init

# Seed: tạo 1 team mặc định + 1 user admin cho Phase 1 nội bộ
pnpm --filter api prisma db seed
```

```ts
// apps/api/prisma/seed.ts (rút gọn)
const team = await prisma.team.create({ data: { name: 'Internal', slug: 'internal' } });
const user = await prisma.user.create({
  data: { email: 'admin@local', name: 'Admin', passwordHash: await hash('changeme') },
});
await prisma.teamMember.create({ data: { teamId: team.id, userId: user.id, role: 'OWNER' } });
```

> Khi lên SaaS, bổ sung model `Subscription`/`UsageRecord` cho billing và (tùy chọn) **Row-Level Security** trong Postgres — xem [../08-phase-3-saas.md](../08-phase-3-saas.md). Không cần ở Phase 1.

Tiếp theo: [02-api-contract.md](02-api-contract.md).
