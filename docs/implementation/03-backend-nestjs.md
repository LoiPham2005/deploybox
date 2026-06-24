# Triển khai Backend (NestJS)

Đây là **bản thiết kế code** cho backend DeployBox — không phải code chạy được, nhưng đủ chi tiết để lập trình viên mở ra là code theo. Backend này là một **orchestrator**: nó không chỉ CRUD mà còn điều phối build (BullMQ + Docker), reverse proxy (Caddy Admin API), DNS (Cloudflare API) và stream log realtime (Socket.IO).

Tài liệu này tuân thủ tuyệt đối các quyết định ở:
- Cấu trúc monorepo & gói `@deploybox/shared`: [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md)
- Mô hình dữ liệu (tên model/field/enum CỐ ĐỊNH): [01-data-model-prisma.md](01-data-model-prisma.md)
- Hợp đồng API (REST + WebSocket): [02-api-contract.md](02-api-contract.md)
- Stack đã chốt: [../02-tech-stack.md](../02-tech-stack.md)
- Phạm vi Phase 1: [../06-phase-1-mvp.md](../06-phase-1-mvp.md)
- Luồng deploy theo loại app: [../03-luong-deploy-theo-loai-app.md](../03-luong-deploy-theo-loai-app.md)
- Domain/SSL/Cloudflare/Caddy: [../04-domain-ssl.md](../04-domain-ssl.md)
- Bảo mật & cô lập build: [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md)

> **Quy ước tên (đọc trước):** tài liệu này dùng đúng các model `User / Team / TeamMember / Project / Deployment / Domain / EnvVar / ApiToken` và enum `ProjectType(STATIC|BACKEND)`, `DeploymentStatus(QUEUED|BUILDING|DEPLOYING|RUNNING|SLEEPING|FAILED|STOPPED|CANCELLED)`, `DeploymentTrigger(MANUAL|GIT_PUSH|REDEPLOY)`, `DomainStatus(PENDING_DNS|VERIFYING|ACTIVE|FAILED)`, `EnvTarget(BUILD|RUNTIME|BOTH)`, `TeamRole(OWNER|ADMIN|MEMBER)`, `GitProvider(GITHUB|GITLAB|BITBUCKET)` từ [01-data-model-prisma.md](01-data-model-prisma.md). Bản [../06-phase-1-mvp.md](../06-phase-1-mvp.md) dùng tên rút gọn `App/DeployStatus` chỉ là minh hoạ sớm — **nguồn sự thật là schema `Project/Deployment`**.

---

## 1. Cấu trúc thư mục `apps/api/src`

Bám theo khung ở [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md) §2 (`modules/`, `jobs/`, `infra/`, `common/`, `prisma/`).

```
apps/api/
├── src/
│   ├── main.ts                      # bootstrap: ValidationPipe, CORS, prefix /api/v1, Socket.IO adapter
│   ├── app.module.ts                # gốc: import mọi feature + infra module
│   ├── worker.ts                    # entrypoint RIÊNG cho build/deploy worker (process tách API)
│   │
│   ├── config/                      # ConfigModule + schema env (zod) + typed config
│   │   ├── config.module.ts
│   │   ├── config.schema.ts         # validate process.env (DATABASE_URL, ENCRYPTION_KEY, CADDY_ADMIN_URL...)
│   │   └── app-config.service.ts    # getter typed: cfg.docker.host, cfg.caddy.adminUrl...
│   │
│   ├── modules/                     # FEATURE modules ↔ resource trong hợp đồng API
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts   # POST /auth/register|login|logout, GET /auth/me
│   │   │   ├── auth.service.ts      # hash argon2, ký/verify JWT, issue ApiToken
│   │   │   ├── jwt.strategy.ts      # passport-jwt: validate token → load User
│   │   │   ├── api-token.strategy.ts# strategy cho header X-Api-Key (CLI/webhook)
│   │   │   └── dto/                 # re-export từ @deploybox/shared
│   │   │
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   └── users.service.ts     # tìm/tạo user, danh sách team của user
│   │   │
│   │   ├── teams/
│   │   │   ├── teams.module.ts
│   │   │   ├── teams.controller.ts  # /teams , /teams/:teamId/members
│   │   │   └── teams.service.ts     # tạo team, mời/đổi role/xoá member
│   │   │
│   │   ├── projects/
│   │   │   ├── projects.module.ts
│   │   │   ├── projects.controller.ts # /teams/:teamId/projects , /projects/:projectId
│   │   │   └── projects.service.ts  # CRUD Project (scope teamId), build ProjectSummary
│   │   │
│   │   ├── deployments/
│   │   │   ├── deployments.module.ts
│   │   │   ├── deployments.controller.ts # /projects/:projectId/deploy|deployments|stop|restart, /deployments/:id/...
│   │   │   ├── deployments.service.ts # tạo Deployment(QUEUED), enqueue job, cancel/redeploy, đọc log
│   │   │   └── deployment-events.service.ts # cầu nối worker → RealtimeGateway (status/log)
│   │   │
│   │   ├── domains/
│   │   │   ├── domains.module.ts
│   │   │   ├── domains.controller.ts # /projects/:projectId/domains , /domains/:domainId/verify|delete
│   │   │   ├── domains.service.ts   # thêm domain, sinh verifyToken, verify TXT, gọi Caddy/Cloudflare
│   │   │   └── caddy-internal.controller.ts # GET /internal/caddy/check-domain (on_demand_tls ask)
│   │   │
│   │   ├── env/
│   │   │   ├── env.module.ts
│   │   │   ├── env.controller.ts    # /projects/:projectId/env (GET/PUT/DELETE)
│   │   │   └── env.service.ts       # set hàng loạt, mã hoá secret, build map env theo EnvTarget
│   │   │
│   │   ├── webhooks/
│   │   │   ├── webhooks.module.ts
│   │   │   ├── webhooks.controller.ts # POST /webhooks/git/:provider
│   │   │   └── webhooks.service.ts  # verify HMAC, parse push → trigger deploy nếu autoDeploy
│   │   │
│   │   └── realtime/
│   │       ├── realtime.module.ts
│   │       └── realtime.gateway.ts  # Socket.IO @WebSocketGateway namespace /realtime
│   │
│   ├── jobs/                        # BullMQ — định nghĩa queue + processor (chạy trong worker.ts)
│   │   ├── queue.constants.ts       # QUEUE_NAMES, JOB_NAMES, kiểu payload job
│   │   ├── build.processor.ts       # clone repo → Nixpacks/Docker build → tag image → lưu log
│   │   ├── deploy.processor.ts      # docker run (limit+env) → đăng ký Caddy → gắn domain/SSL → RUNNING
│   │   ├── sleep-idle.processor.ts  # scale-to-zero: stop container nhàn rỗi (Phase 3-ready)
│   │   ├── cleanup.processor.ts     # prune image/thư mục build cũ, log hết hạn
│   │   ├── domain-verify.processor.ts # retry verify TXT trong 24h (xem [../04-domain-ssl.md](../04-domain-ssl.md) §4)
│   │   └── job-logger.ts            # helper: ghi 1 dòng log → Redis pub + buffer S3
│   │
│   ├── infra/                       # CLIENT hạ tầng (không chứa logic nghiệp vụ)
│   │   ├── prisma/
│   │   │   ├── prisma.module.ts     # @Global
│   │   │   └── prisma.service.ts    # extends PrismaClient, onModuleInit connect
│   │   ├── queue/
│   │   │   ├── queue.module.ts      # @Global, đăng ký BullMQ connection + các Queue
│   │   │   └── queue.service.ts     # enqueueBuild()/enqueueDeploy()/... (API dùng để đẩy job)
│   │   ├── docker/
│   │   │   ├── docker.module.ts
│   │   │   └── docker.service.ts    # dockerode: build/run/stop/remove/logs/scale
│   │   ├── caddy/
│   │   │   ├── caddy.module.ts
│   │   │   └── caddy.service.ts     # Caddy Admin API: upsert/remove route, on_demand
│   │   ├── cloudflare/
│   │   │   ├── cloudflare.module.ts
│   │   │   └── cloudflare.service.ts# Cloudflare API: upsert DNS, resolve TXT verify
│   │   ├── storage/
│   │   │   ├── storage.module.ts
│   │   │   └── storage.service.ts   # S3 client (MinIO/R2): put/get build log + artifact
│   │   └── crypto/
│   │       ├── crypto.module.ts
│   │       └── crypto.service.ts    # AES-256-GCM encrypt/decrypt cho EnvVar.value & token
│   │
│   ├── common/                      # cross-cutting
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts     # JwtAuthGuard (extends AuthGuard('jwt'))
│   │   │   └── team-role.guard.ts    # TeamRoleGuard: membership + role theo resource
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts # @CurrentUser() → req.user
│   │   │   ├── roles.decorator.ts        # @Roles('OWNER','ADMIN')
│   │   │   └── public.decorator.ts       # @Public() bỏ qua JwtAuthGuard (webhook, caddy ask)
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts    # log method+path+ms (KHÔNG log body chứa secret)
│   │   ├── filters/
│   │   │   └── all-exceptions.filter.ts  # chuẩn hoá body lỗi theo hợp đồng §1
│   │   ├── pipes/
│   │   │   └── zod-validation.pipe.ts    # ZodValidationPipe dùng schema từ @deploybox/shared
│   │   └── utils/
│   │       ├── slug.ts                    # slugify name → slug subdomain
│   │       └── hmac.ts                    # verify HMAC webhook (timingSafeEqual)
│   │
│   └── app.module.ts
│
├── prisma/
│   ├── schema.prisma                # xem [01-data-model-prisma.md](01-data-model-prisma.md)
│   ├── migrations/
│   └── seed.ts                      # 1 team "internal" + 1 user OWNER (xem data model §4)
├── test/
│   ├── unit/                        # *.spec.ts cho service (mock Prisma/Docker/Caddy)
│   └── e2e/                         # luồng deploy end-to-end (cần Docker)
├── Dockerfile                       # multi-stage build API + worker
└── package.json
```

**Hai entrypoint, một codebase** (theo [../06-phase-1-mvp.md](../06-phase-1-mvp.md) §2: API không tự build, worker là process riêng):
- `main.ts` → chạy HTTP API + Socket.IO (KHÔNG đăng ký processor).
- `worker.ts` → chạy `Worker` của BullMQ (build/deploy/...), có quyền gọi Docker + git. Cùng repo, khác lệnh start. Khi cần tách VPS build (xem [../02-tech-stack.md](../02-tech-stack.md) §3) chỉ việc deploy `worker.ts` lên máy khác, nối chung Redis.

```ts
// src/worker.ts (phác) — khởi tạo Nest context KHÔNG mở HTTP, chỉ để DI cho processor
async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // WorkerModule import: ConfigModule, PrismaModule, QueueModule (worker side),
  // DockerModule, CaddyModule, CloudflareModule, StorageModule, CryptoModule,
  // + các *.processor.ts. KHÔNG import controller/gateway.
  app.enableShutdownHooks(); // đóng queue + docker stream gọn khi SIGTERM
}
bootstrapWorker();
```

---

## 2. Bản đồ module NestJS ↔ resource hợp đồng API

Cột "Endpoint" khớp y hệt [02-api-contract.md](02-api-contract.md) §2 (prefix `/api/v1`).

### 2.1. Feature modules

| Module | Controller / Endpoint | Service — trách nhiệm | Phụ thuộc |
|---|---|---|---|
| **AuthModule** | `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me` | Hash argon2; ký JWT (access trong cookie httpOnly + body); `/auth/me` trả `{user, teams[]}`; phát hành `ApiToken` (lưu `tokenHash`) | PrismaModule, ConfigModule, CryptoModule, UsersModule |
| **UsersModule** | (không controller riêng ở Phase 1) | `findByEmail`, `createUser`, `listTeams(userId)` qua `TeamMember` | PrismaModule |
| **TeamsModule** | `GET/POST /teams`, `GET/POST /teams/:teamId/members`, `PATCH/DELETE /teams/:teamId/members/:userId` | Tạo team + gán OWNER; mời member `{email,role}`; đổi role; xoá member. Mọi thao tác qua `TeamRoleGuard` | PrismaModule |
| **ProjectsModule** | `GET/POST /teams/:teamId/projects`, `GET/PATCH/DELETE /projects/:projectId` | CRUD `Project` **luôn `where teamId`**; sinh `slug` (subdomain `<slug>.<APP_DOMAIN>`); DELETE → enqueue dọn (stop container + gỡ route Caddy + xoá DNS) rồi xoá row; build `ProjectSummary` (kèm `latestDeployment`, `primaryDomain`) | PrismaModule, QueueModule, DomainsModule |
| **DeploymentsModule** | `POST /projects/:projectId/deploy`, `GET /projects/:projectId/deployments`, `GET /deployments/:deploymentId`, `POST /deployments/:deploymentId/cancel`, `POST /deployments/:deploymentId/redeploy`, `GET /deployments/:deploymentId/logs`, `POST /projects/:projectId/stop`, `POST /projects/:projectId/restart` | **Lõi**: tạo `Deployment(QUEUED)` → `queue.enqueueBuild()`; phân trang lịch sử; cancel (chỉ khi QUEUED/BUILDING → remove job + status CANCELLED); redeploy (tạo Deployment mới `trigger=REDEPLOY` dùng lại `imageTag` cũ); `logs` đọc từ S3 theo `logKey`; stop/restart gọi DockerService | PrismaModule, QueueModule, DockerModule, StorageModule, RealtimeModule |
| **DomainsModule** | `GET/POST /projects/:projectId/domains`, `POST /domains/:domainId/verify`, `DELETE /domains/:domainId`; + `GET /internal/caddy/check-domain` | Thêm domain → trả `AddDomainResponse` (dnsInstructions + verifyToken); managed subdomain → gọi Cloudflare upsert + đăng ký route Caddy ngay (`status=ACTIVE`); custom → `PENDING_DNS`, verify TXT → `VERIFYING`→`ACTIVE`; endpoint `ask` cho `on_demand_tls` | PrismaModule, CaddyModule, CloudflareModule, QueueModule |
| **EnvModule** | `GET /projects/:projectId/env`, `PUT /projects/:projectId/env`, `DELETE /projects/:projectId/env/:key` | List (che secret); set hàng loạt `{vars:[{key,value,isSecret,target}]}` → mã hoá khi `isSecret`; cung cấp `buildEnvMap(projectId, target)` cho processor | PrismaModule, CryptoModule |
| **WebhooksModule** | `POST /webhooks/git/:provider` (`@Public()`) | Verify HMAC theo provider; parse push → so `gitBranch` + `autoDeploy` → gọi `DeploymentsService.trigger(GIT_PUSH)` | PrismaModule, DeploymentsModule, ConfigModule |
| **RealtimeModule** | Gateway `/realtime` (Socket.IO) — không phải HTTP controller | Room `deployment:<id>` / `project:<id>`; nhận event từ `DeploymentEventsService` → emit `WS_EVENTS` tới room | ConfigModule (Redis adapter cho multi-instance) |

### 2.2. Infra modules (hạ tầng, `@Global` khi hợp lý)

| Module | Provider | Trách nhiệm |
|---|---|---|
| **ConfigModule** | `AppConfigService` | Validate `process.env` bằng zod (`config.schema.ts`); expose typed getter |
| **PrismaModule** | `PrismaService` | `PrismaClient` lifecycle; `@Global` để mọi module inject |
| **QueueModule** | `QueueService` + các `Queue` | Phía API: `enqueueBuild/enqueueDeploy/...`; phía worker: cung cấp connection cho `Worker` |
| **DockerModule** | `DockerService` | dockerode: build/run/stop/remove/logs/scale (xem §4) |
| **CaddyModule** | `CaddyService` | Caddy Admin API: upsert/remove route theo hostname (xem §5) |
| **CloudflareModule** | `CloudflareService` | Cloudflare API: upsert DNS record, resolve TXT verify (xem §6) |
| **StorageModule** | `StorageService` | S3/MinIO: lưu/đọc build log (`logKey`) + artifact static |
| **CryptoModule** | `CryptoService` | AES-256-GCM encrypt/decrypt `EnvVar.value`, git token (xem §8) |

### 2.3. `app.module.ts` (phác)

```ts
@Module({
  imports: [
    ConfigModule,            // @Global typed config (validate env trước hết)
    PrismaModule,            // @Global
    QueueModule,             // @Global (API side: chỉ producer)
    DockerModule, CaddyModule, CloudflareModule, StorageModule, CryptoModule,
    AuthModule, UsersModule, TeamsModule, ProjectsModule,
    DeploymentsModule, DomainsModule, EnvModule, WebhooksModule, RealtimeModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },     // mặc định mọi route cần auth; @Public() để mở
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
```

```ts
// src/main.ts (phác)
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.setGlobalPrefix('api/v1');                 // hợp đồng §0
app.enableCors({ origin: cfg.web.url, credentials: true });
app.use(cookieParser());
app.useWebSocketAdapter(new RedisIoAdapter(app)); // Socket.IO + Redis adapter (xem §9)
await app.listen(cfg.api.port);                 // 4000
```

---

## 3. LUỒNG DEPLOY END-TO-END (phần quan trọng nhất)

Hiện thực đúng luồng ở [../03-luong-deploy-theo-loai-app.md](../03-luong-deploy-theo-loai-app.md) §1 (STATIC) và §2 (BACKEND). Trạng thái đi đúng enum `DeploymentStatus`: `QUEUED → BUILDING → DEPLOYING → RUNNING` (lỗi → `FAILED`).

### 3.1. Sơ đồ tổng

```
 Client / Webhook
      │  POST /api/v1/projects/:id/deploy
      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ DeploymentsController.deploy()                                       │
│   → DeploymentsService.trigger(projectId, MANUAL|GIT_PUSH, by)      │
│       1. tạo Deployment(status=QUEUED)                              │
│       2. queue.enqueueBuild({ deploymentId, projectId })           │
│       3. emit WS deployment:status QUEUED                           │
│       4. trả { deployment }                                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ Redis (BullMQ "build")
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ BuildProcessor  (worker.ts)                                         │
│   status=BUILDING, startedAt=now                                   │
│   git clone --depth 1 -b <branch>  /tmp/build/<deployId>           │
│   commitSha = rev-parse HEAD;  commitMsg                            │
│   ┌── STATIC ────────────────────┐  ┌── BACKEND ─────────────────┐ │
│   │ build static (Nixpacks/preset│  │ có Dockerfile? docker build │ │
│   │ caddy) → image static OR copy│  │ else nixpacks build         │ │
│   │ output ra artifact storage   │  │ → imageTag deploybox/..:sha │ │
│   └──────────────────────────────┘  └─────────────────────────────┘ │
│   stream stdout/stderr → job-logger (Redis pub + buffer)           │
│   build xong: lưu full log lên S3 (logKey)                         │
│   set imageTag (BACKEND) | staticPath (STATIC)                     │
│   → queue.enqueueDeploy({ deploymentId })                          │
│   (fail bất kỳ bước → status=FAILED, errorMessage, dọn /tmp)       │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ Redis (BullMQ "deploy")
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ DeployProcessor (worker.ts)                                        │
│   status=DEPLOYING                                                 │
│   envMap = EnvService.buildEnvMap(projectId, RUNTIME)             │
│   ┌── STATIC ───────────────────┐ ┌── BACKEND ──────────────────┐ │
│   │ DockerService.run image tĩnh│ │ DockerService.run(image,    │ │
│   │ (caddy serve) HOẶC chỉ trỏ  │ │   memoryMb,cpuLimit,env,    │ │
│   │ Caddy file_server staticPath│ │   non-root,restart)         │ │
│   │                             │ │ healthcheck chờ healthy     │ │
│   └─────────────┬───────────────┘ └────────────┬────────────────┘ │
│                 └─────────────┬─────────────────┘                  │
│   CaddyService.upsertRoute(hostname → container:internalPort)     │
│   DomainsService.ensurePrimaryDomain(project) (subdomain+SSL)     │
│   set containerId, status=RUNNING, finishedAt                     │
│   (rm container cũ của project — blue/green tối giản)             │
│   emit WS deployment:status RUNNING + project:updated            │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2. Bước 1 — Trigger (API): tạo Deployment + enqueue

```ts
// modules/deployments/deployments.service.ts
@Injectable()
export class DeploymentsService {
  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
    private events: DeploymentEventsService,
  ) {}

  async trigger(
    projectId: string,
    teamId: string,
    trigger: DeploymentTrigger,
    opts: { createdBy?: string; commitSha?: string; commitMsg?: string } = {},
  ): Promise<Deployment> {
    // team scoping: chắc chắn project thuộc team hiện tại
    const project = await this.prisma.project.findFirstOrThrow({
      where: { id: projectId, teamId },
    });

    const deployment = await this.prisma.deployment.create({
      data: {
        projectId: project.id,
        status: DeploymentStatus.QUEUED,
        trigger,
        commitSha: opts.commitSha,
        commitMsg: opts.commitMsg,
        createdBy: opts.createdBy,
      },
    });

    // đẩy job build; jobId = deploymentId để cancel dễ (remove theo id)
    await this.queue.enqueueBuild(
      { deploymentId: deployment.id, projectId: project.id },
      { jobId: deployment.id },
    );

    this.events.emitStatus(deployment.id, DeploymentStatus.QUEUED);
    return deployment;
  }
}
```

```ts
// modules/deployments/deployments.controller.ts
@Controller()
@UseGuards(TeamRoleGuard) // JwtAuthGuard là global; thêm role check theo project→team
export class DeploymentsController {
  constructor(private deployments: DeploymentsService) {}

  @Post('projects/:projectId/deploy')
  @Roles('OWNER', 'ADMIN', 'MEMBER')
  async deploy(
    @Param('projectId') projectId: string,
    @TeamCtx() teamId: string,            // bơm bởi TeamRoleGuard sau khi resolve resource
    @CurrentUser() user: AuthUser,
  ) {
    const deployment = await this.deployments.trigger(
      projectId, teamId, DeploymentTrigger.MANUAL, { createdBy: user.id },
    );
    return { deployment }; // khớp hợp đồng: trả { deployment }
  }
}
```

### 3.3. Bước 2 — BuildProcessor (clone → build → tag → log)

```ts
// jobs/build.processor.ts  (chạy trong worker.ts)
export interface BuildJobData { deploymentId: string; projectId: string }

@Processor(QUEUE_NAMES.BUILD, { concurrency: 2 }) // giới hạn để không sập RAM 1 VPS
export class BuildProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private docker: DockerService,
    private storage: StorageService,
    private env: EnvService,
    private queue: QueueService,
    private events: DeploymentEventsService,
  ) { super(); }

  async process(job: Job<BuildJobData>): Promise<void> {
    const { deploymentId, projectId } = job.data;
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const log = new JobLogger(deploymentId, this.events, this.storage); // §7

    await this.setStatus(deploymentId, DeploymentStatus.BUILDING, { startedAt: new Date() });

    const workdir = `/tmp/build/${deploymentId}`;
    try {
      // 1) clone shallow đúng branch
      await log.run(`git clone --depth 1 -b ${project.gitBranch} ${project.gitRepoUrl} ${workdir}`);
      const commitSha = (await log.capture(`git -C ${workdir} rev-parse HEAD`)).trim();
      const commitMsg = (await log.capture(`git -C ${workdir} log -1 --pretty=%s`)).trim();
      await this.prisma.deployment.update({ where: { id: deploymentId }, data: { commitSha, commitMsg } });

      const imageTag = `deploybox/${project.slug}:${commitSha.slice(0, 12)}`;

      // 2) build env: chỉ BUILD + BOTH được inject lúc build
      const buildEnv = await this.env.buildEnvMap(projectId, EnvTarget.BUILD);

      if (project.type === ProjectType.STATIC) {
        // STATIC: ưu tiên Nixpacks; nếu không, preset image caddy serve thư mục output
        await this.buildStatic(project, workdir, imageTag, buildEnv, log);
        // STATIC vẫn ra 1 image nhỏ (caddy) — "một code path duy nhất" ([../06-phase-1-mvp.md](../06-phase-1-mvp.md) §1.1)
      } else {
        // BACKEND: Dockerfile nếu có, ngược lại Nixpacks
        const hasDockerfile = await fileExists(`${workdir}/Dockerfile`);
        if (hasDockerfile) {
          await this.docker.buildImage({ contextDir: workdir, dockerfile: 'Dockerfile', tag: imageTag, buildArgs: buildEnv, onLog: log.line });
        } else {
          await this.docker.buildWithNixpacks({ contextDir: workdir, tag: imageTag, env: buildEnv, onLog: log.line });
        }
      }

      // 3) lưu full log lên S3 + set imageTag, chuyển sang deploy
      const logKey = await log.flushToStorage(); // trả "logs/<deploymentId>.log"
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { imageTag, logKey },
      });

      await this.queue.enqueueDeploy({ deploymentId }, { jobId: `deploy-${deploymentId}` });
    } catch (err) {
      const logKey = await log.flushToStorage();
      await this.setStatus(deploymentId, DeploymentStatus.FAILED, {
        finishedAt: new Date(), errorMessage: String(err?.message ?? err), logKey,
      });
      throw err; // để BullMQ ghi nhận fail (đã set status, không retry build lỗi compile)
    } finally {
      await rm(workdir, { recursive: true, force: true }); // dọn /tmp
    }
  }

  private async buildStatic(project, workdir, tag, env, log) {
    // Nếu repo tự build static (Vite/CRA/Flutter web) → Nixpacks tạo image serve.
    // Trường hợp đơn giản nhất (preset): build app rồi đóng vào image caddy:
    //   1) chạy install+build trong builder (Nixpacks) HOẶC theo project.buildCommand
    //   2) COPY <project.outputDir|dist> vào caddy:2-alpine /usr/share/caddy
    // → image tĩnh chạy file_server + SPA fallback (try_files /index.html)
    await this.docker.buildStaticImage({
      contextDir: workdir,
      outputDir: project.outputDir ?? 'dist',
      installCommand: project.installCommand,
      buildCommand: project.buildCommand,
      tag, env, onLog: log.line,
    });
  }

  private setStatus(id: string, status: DeploymentStatus, extra: Partial<Deployment> = {}) {
    this.events.emitStatus(id, status);
    return this.prisma.deployment.update({ where: { id }, data: { status, ...extra } });
  }
}
```

> **Phân biệt STATIC vs BACKEND ở build:** STATIC luôn kết thúc bằng một image `caddy:2-alpine` (hoặc image Nixpacks serve static) — runtime ~0 RAM, có thể nhiều bản chạy song song. BACKEND ra image app chạy 24/7. Cả hai **đều là Docker image** để giữ "một code path duy nhất" ([../06-phase-1-mvp.md](../06-phase-1-mvp.md) §1.1). Khác biệt duy nhất nằm ở hàm build; bước run/route giống nhau.

### 3.4. Bước 3 — DeployProcessor (run → Caddy → domain/SSL → RUNNING)

```ts
// jobs/deploy.processor.ts
export interface DeployJobData { deploymentId: string }

@Processor(QUEUE_NAMES.DEPLOY, { concurrency: 3 })
export class DeployProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private docker: DockerService,
    private caddy: CaddyService,
    private domains: DomainsService,
    private env: EnvService,
    private events: DeploymentEventsService,
  ) { super(); }

  async process(job: Job<DeployJobData>): Promise<void> {
    const { deploymentId } = job.data;
    const deployment = await this.prisma.deployment.findUniqueOrThrow({
      where: { id: deploymentId }, include: { project: { include: { domains: true } } },
    });
    const project = deployment.project;
    const containerName = `app-${project.slug}`;

    await this.setStatus(deploymentId, DeploymentStatus.DEPLOYING);

    try {
      // 1) env runtime (RUNTIME + BOTH), giải mã secret ngay trước khi run
      const runtimeEnv = await this.env.buildEnvMap(project.id, EnvTarget.RUNTIME);

      // 2) run container mới (đặt tên kèm deployId để blue/green)
      const newContainer = `${containerName}-${deploymentId.slice(0, 8)}`;
      const containerId = await this.docker.runContainer({
        name: newContainer,
        image: deployment.imageTag!,           // STATIC & BACKEND đều có image
        env: runtimeEnv,
        network: 'deploybox',
        memoryMb: project.memoryMb,            // quota từ Project
        cpuLimit: project.cpuLimit,
        internalPort: project.internalPort,
        restartPolicy: 'unless-stopped',
        nonRoot: true,
      });

      // 3) healthcheck: chờ container healthy/running trước khi cắt traffic
      await this.docker.waitHealthy(containerId, { timeoutMs: 30_000 });

      // 4) đăng ký/đổi upstream trong Caddy → KHÔNG downtime
      const hostname = `${project.slug}.${this.cfg.appDomain}`; // <slug>.deploybox.app
      await this.caddy.upsertRoute({
        hostname,
        upstream: `${newContainer}:${project.internalPort}`,
      });

      // 5) đảm bảo subdomain managed + SSL (wildcard *.deploybox.app đã phủ — xem [../04-domain-ssl.md](../04-domain-ssl.md) §2)
      await this.domains.ensureManagedSubdomain(project); // upsert Domain(isManaged, ACTIVE)

      // 6) chốt trạng thái + dọn container cũ
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: DeploymentStatus.RUNNING, containerId, finishedAt: new Date(),
                staticPath: project.type === ProjectType.STATIC ? `srv/apps/${project.slug}` : null },
      });
      this.events.emitStatus(deploymentId, DeploymentStatus.RUNNING);
      this.events.emitProjectUpdated(project.id);

      // blue/green tối giản: gỡ các container cũ khác của project
      await this.docker.removeStaleContainers(containerName, { keep: newContainer });
    } catch (err) {
      await this.setStatus(deploymentId, DeploymentStatus.FAILED, {
        finishedAt: new Date(), errorMessage: String(err?.message ?? err),
      });
      // KHÔNG cắt traffic container cũ khi deploy mới fail (rollback an toàn — [../03-luong-deploy-theo-loai-app.md](../03-luong-deploy-theo-loai-app.md) §2)
      throw err;
    }
  }
}
```

> **STATIC vs BACKEND ở deploy:** vì cả hai cùng ra image, bước run gần như giống nhau. Khác biệt: STATIC image chạy caddy `file_server` (không cần healthcheck HTTP sâu, chỉ cần container `running`), `internalPort` thường là 80; BACKEND cần `waitHealthy` chờ app mở cổng `internalPort`. Nếu chọn phương án STATIC "không container" (Caddy `file_server` trỏ thẳng `staticPath` — [../03-luong-deploy-theo-loai-app.md](../03-luong-deploy-theo-loai-app.md) §1), thì DeployProcessor bỏ bước run và chỉ copy artifact + `caddy.upsertFileServer(hostname, staticPath)`. **Phase 1 dùng image caddy cho đồng nhất.**

---

## 4. DockerService (dockerode)

Bao bọc `dockerode`. Áp đúng resource limit (`memoryMb`, `cpuLimit` từ `Project`), chạy non-root, restart policy, stream log, scale-to-zero (start/stop). Tham chiếu lệnh `docker run` mẫu ở [../03-luong-deploy-theo-loai-app.md](../03-luong-deploy-theo-loai-app.md) §2.

```ts
// infra/docker/docker.service.ts
import Docker from 'dockerode';

@Injectable()
export class DockerService {
  private docker = new Docker({ socketPath: '/var/run/docker.sock' }); // hoặc DOCKER_HOST

  /** Build từ Dockerfile của user (BACKEND). */
  async buildImage(opts: {
    contextDir: string; dockerfile: string; tag: string;
    buildArgs?: Record<string, string>; onLog: (line: string) => void;
  }): Promise<void> {
    const stream = await this.docker.buildImage(
      { context: opts.contextDir, src: ['.'] },
      { t: opts.tag, dockerfile: opts.dockerfile, buildargs: opts.buildArgs },
    );
    await this.followBuildStream(stream, opts.onLog);
  }

  /** Build qua Nixpacks (BACKEND không Dockerfile) — gọi CLI nixpacks rồi build. */
  async buildWithNixpacks(opts: {
    contextDir: string; tag: string; env?: Record<string, string>; onLog: (l: string) => void;
  }): Promise<void> {
    // nixpacks build <ctx> --name <tag> [--env KEY=VAL ...]; stream stdout/stderr → onLog
    await spawnStreaming('nixpacks', ['build', opts.contextDir, '--name', opts.tag,
      ...envToArgs(opts.env)], opts.onLog);
  }

  /** STATIC: build app rồi đóng output vào image caddy:2-alpine. */
  async buildStaticImage(opts: {
    contextDir: string; outputDir: string; installCommand?: string; buildCommand?: string;
    tag: string; env?: Record<string, string>; onLog: (l: string) => void;
  }): Promise<void> { /* sinh Dockerfile tạm (builder + caddy) hoặc dùng Nixpacks static plan */ }

  /** docker run với quota + non-root + restart policy. Trả containerId. */
  async runContainer(opts: {
    name: string; image: string; env: Record<string, string>; network: string;
    memoryMb: number; cpuLimit: number; internalPort: number;
    restartPolicy: 'unless-stopped' | 'no'; nonRoot: boolean;
  }): Promise<string> {
    const container = await this.docker.createContainer({
      name: opts.name,
      Image: opts.image,
      Env: Object.entries(opts.env).map(([k, v]) => `${k}=${v}`),
      User: opts.nonRoot ? '1000:1000' : undefined,     // chạy non-root
      ExposedPorts: { [`${opts.internalPort}/tcp`]: {} },
      HostConfig: {
        NetworkMode: opts.network,                       // network "deploybox" để Caddy gọi theo tên
        Memory: opts.memoryMb * 1024 * 1024,             // RAM hard limit
        NanoCpus: Math.round(opts.cpuLimit * 1e9),       // CPU limit = cpuLimit vCPU
        PidsLimit: 256,                                  // chặn fork bomb
        RestartPolicy: { Name: opts.restartPolicy },
        ReadonlyRootfs: false,                           // Phase 1 nới; Phase 3 siết (xem [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md))
        CapDrop: ['ALL'],                                // bỏ mọi Linux capability thừa
        SecurityOpt: ['no-new-privileges:true'],
      },
    });
    await container.start();
    return container.id;
  }

  /** Chờ container healthy (nếu có HEALTHCHECK) hoặc running + cổng mở. */
  async waitHealthy(containerId: string, o: { timeoutMs: number }): Promise<void> { /* poll inspect.State.Health */ }

  /** Stream log container (runtime log) qua callback — dùng cho /logs runtime. */
  async streamLogs(containerName: string, onLine: (l: string) => void): Promise<() => void> {
    const c = this.docker.getContainer(containerName);
    const stream = await c.logs({ follow: true, stdout: true, stderr: true, tail: 200 });
    // demux stdout/stderr của dockerode rồi gọi onLine từng dòng; trả hàm hủy
  }

  async stopContainer(name: string): Promise<void>  { await this.docker.getContainer(name).stop().catch(noop); }
  async removeContainer(name: string): Promise<void>{ await this.docker.getContainer(name).remove({ force: true }).catch(noop); }
  async restartContainer(name: string): Promise<void>{ await this.docker.getContainer(name).restart(); }

  /** scale-to-zero: dừng container nhàn rỗi (giữ, không xoá) — SLEEPING. */
  async sleep(name: string): Promise<void>  { await this.docker.getContainer(name).stop(); }
  /** đánh thức khi có request (cold start). */
  async wake(name: string): Promise<void>   { await this.docker.getContainer(name).start(); }

  async removeStaleContainers(baseName: string, o: { keep: string }): Promise<void> { /* list theo prefix, rm trừ keep */ }
}
```

> **Ghi chú quota:** `memoryMb`/`cpuLimit` lấy thẳng từ `Project` ([01-data-model-prisma.md](01-data-model-prisma.md)). `PidsLimit`, `CapDrop: ALL`, `no-new-privileges` là mức tối thiểu hợp lý ngay cả Phase 1; cô lập sâu (rootless/gVisor/seccomp) để Phase 3 — xem [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md).

---

## 5. CaddyService (Caddy Admin API)

Cập nhật route runtime qua Caddy Admin API (`CADDY_ADMIN_URL`, mặc định `http://localhost:2019`) — **không sửa Caddyfile tay**. Auto-TLS: wildcard `*.deploybox.app` (DNS-01) đã cấp sẵn cho subdomain; custom domain dùng `on_demand_tls` có chốt `ask`. Tham chiếu [../04-domain-ssl.md](../04-domain-ssl.md) §2.3, §3.2 và ví dụ Admin API ở [../02-tech-stack.md](../02-tech-stack.md) §4.

```ts
// infra/caddy/caddy.service.ts
@Injectable()
export class CaddyService {
  constructor(private cfg: AppConfigService) {}
  private get base() { return this.cfg.caddy.adminUrl; } // http://localhost:2019

  /** Thêm/đổi route reverse_proxy theo hostname → upstream container:port.
   *  Dùng @id để PATCH/DELETE idempotent thay vì append trùng. */
  async upsertRoute(opts: { hostname: string; upstream: string }): Promise<void> {
    const routeId = this.routeId(opts.hostname);
    const route = {
      '@id': routeId,
      match: [{ host: [opts.hostname] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: opts.upstream }] }],
    };
    // thử PATCH route đã tồn tại theo @id; nếu 404 → POST thêm vào danh sách routes
    const patched = await this.fetch('PUT', `/id/${routeId}`, route).catch(() => null);
    if (!patched) {
      await this.fetch('POST', '/config/apps/http/servers/srv0/routes', route);
    }
  }

  /** STATIC kiểu file_server (nếu chọn phương án không container). */
  async upsertFileServer(opts: { hostname: string; root: string }): Promise<void> {
    const route = {
      '@id': this.routeId(opts.hostname),
      match: [{ host: [opts.hostname] }],
      handle: [{
        handler: 'subroute',
        routes: [{
          handle: [
            { handler: 'vars', root: opts.root },
            { handler: 'file_server', try_files: ['{http.request.uri.path}', '/index.html'] }, // SPA fallback
          ],
        }],
      }],
    };
    await this.fetch('PUT', `/id/${this.routeId(opts.hostname)}`, route)
      .catch(() => this.fetch('POST', '/config/apps/http/servers/srv0/routes', route));
  }

  async removeRoute(hostname: string): Promise<void> {
    await this.fetch('DELETE', `/id/${this.routeId(hostname)}`).catch(noop);
  }

  private routeId(host: string) { return `route_${host.replace(/[^a-z0-9]/gi, '_')}`; }

  private async fetch(method: string, path: string, body?: unknown) {
    const res = await fetch(`${this.base}${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Caddy ${method} ${path} → ${res.status} ${await res.text()}`);
    return res;
  }
}
```

Ví dụ JSON route nạp qua Admin API (tương đương ví dụ curl ở [../02-tech-stack.md](../02-tech-stack.md) §4):

```jsonc
// POST http://localhost:2019/config/apps/http/servers/srv0/routes
{
  "@id": "route_myapp_deploybox_app",
  "match": [{ "host": ["myapp.deploybox.app"] }],
  "handle": [{ "handler": "reverse_proxy", "upstreams": [{ "dial": "app-myapp:3000" }] }]
}
```

Cấu hình `on_demand_tls` (chỉ làm 1 lần khi setup, trỏ `ask` về backend) — xem chốt chặn ở §11 và [../04-domain-ssl.md](../04-domain-ssl.md) §3.2:

```jsonc
// nằm trong apps.tls.automation; "ask" gọi GET /internal/caddy/check-domain?domain=<host>
{ "on_demand": { "permission": { "module": "http", "endpoint": "http://localhost:4000/api/v1/internal/caddy/check-domain" } } }
```

---

## 6. CloudflareService

Tạo/sửa DNS record cho subdomain managed (`*.deploybox.app` đã có sẵn từ setup, nhưng vẫn cần upsert record riêng cho vài trường hợp) và resolve TXT để verify custom domain. Tham chiếu [../04-domain-ssl.md](../04-domain-ssl.md) §6 (upsert DNS) và §4.2 (verify TXT).

```ts
// infra/cloudflare/cloudflare.service.ts
import { promises as dns } from 'node:dns';

@Injectable()
export class CloudflareService {
  constructor(private cfg: AppConfigService) {}

  /** Upsert A/CNAME/TXT trong zone deploybox.app (zone của TA). proxied=false (DNS-only). */
  async upsertDnsRecord(input: {
    type: 'A' | 'CNAME' | 'TXT'; name: string; content: string;
  }): Promise<{ id: string }> {
    const { zoneId, apiToken } = this.cfg.cloudflare;
    // 1) tìm record sẵn có theo name+type
    const list = await this.cf(`/zones/${zoneId}/dns_records?type=${input.type}&name=${input.name}`, 'GET');
    const existing = list.result?.[0];
    const body = { ...input, ttl: 300, proxied: false };
    // 2) PUT (update) nếu có, POST (create) nếu chưa
    const res = existing
      ? await this.cf(`/zones/${zoneId}/dns_records/${existing.id}`, 'PUT', body)
      : await this.cf(`/zones/${zoneId}/dns_records`, 'POST', body);
    if (!res.success) throw new Error(JSON.stringify(res.errors));
    return { id: res.result.id };
  }

  /** Verify quyền sở hữu custom domain: resolve TXT _deploybox-challenge.<domain>. */
  async verifyTxt(domain: string, expectedToken: string): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(`_deploybox-challenge.${domain}`); // string[][]
      const flat = records.map((chunks) => chunks.join(''));
      return flat.some((v) => v === `deploybox-verify=${expectedToken}`);
    } catch {
      return false; // NXDOMAIN / chưa propagate
    }
  }

  private async cf(path: string, method: string, body?: unknown) {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.cfg.cloudflare.apiToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }
}
```

> **Lưu ý:** với subdomain managed thông thường, wildcard `*.deploybox.app` đã phủ DNS → KHÔNG cần gọi Cloudflare mỗi lần deploy (chỉ cần Caddy biết route). `upsertDnsRecord` dùng khi setup (`ingress`, wildcard) hoặc khi cần record đặc biệt. `verifyTxt` là phần chạy mỗi lần verify custom domain (xem `domain-verify.processor.ts`).

---

## 7. Queue / Jobs (BullMQ)

Tham chiếu lựa chọn BullMQ ở [../02-tech-stack.md](../02-tech-stack.md) §2.5 và cảnh báo cô lập build ở [../03-luong-deploy-theo-loai-app.md](../03-luong-deploy-theo-loai-app.md) §0 / [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md).

### 7.1. Danh sách queue

| Queue (`QUEUE_NAMES`) | Job | Concurrency | Retry / backoff | Mục đích |
|---|---|---|---|---|
| `build` | `build` | **2** (giới hạn cứng để không sập RAM 1 VPS) | `attempts: 1` cho lỗi compile; chỉ retry lỗi hạ tầng (network/registry) `attempts: 3, backoff exponential 5s` | clone → build image → log |
| `deploy` | `deploy` | 3 | `attempts: 2, backoff 3s` | run container + Caddy + domain |
| `sleep-idle` | `check-idle` | 1 (repeatable cron mỗi 1 phút) | — | scale-to-zero app `sleepEnabled` (Phase 3-ready) |
| `cleanup` | `prune` | 1 (cron giờ/ngày) | — | `docker image prune`, xoá `/tmp/build/*` mồ côi, log hết hạn |
| `domain-verify` | `verify` | 5 | `attempts: ~288` (mỗi 5', tối đa 24h) | retry verify TXT custom domain ([../04-domain-ssl.md](../04-domain-ssl.md) §4) |

```ts
// jobs/queue.constants.ts
export const QUEUE_NAMES = {
  BUILD: 'build', DEPLOY: 'deploy', SLEEP_IDLE: 'sleep-idle',
  CLEANUP: 'cleanup', DOMAIN_VERIFY: 'domain-verify',
} as const;
```

### 7.2. QueueService (phía API — producer)

```ts
// infra/queue/queue.service.ts
@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUE_NAMES.BUILD)  private buildQ: Queue,
    @InjectQueue(QUEUE_NAMES.DEPLOY) private deployQ: Queue,
    @InjectQueue(QUEUE_NAMES.DOMAIN_VERIFY) private verifyQ: Queue,
  ) {}

  enqueueBuild(data: BuildJobData, opts?: JobsOptions) {
    return this.buildQ.add('build', data, { removeOnComplete: 50, removeOnFail: 100, ...opts });
  }
  enqueueDeploy(data: DeployJobData, opts?: JobsOptions) {
    return this.deployQ.add('deploy', data, { removeOnComplete: 50, ...opts });
  }
  enqueueDomainVerify(data: { domainId: string }) {
    return this.verifyQ.add('verify', data, {
      attempts: 288, backoff: { type: 'fixed', delay: 5 * 60_000 }, // 5' × 288 ≈ 24h
    });
  }
  /** cancel khi QUEUED/BUILDING: remove job theo jobId = deploymentId. */
  async cancelBuild(deploymentId: string) {
    const job = await this.buildQ.getJob(deploymentId);
    await job?.remove();
  }
}
```

### 7.3. Worker emit tiến độ

Mỗi processor ghi log/đổi trạng thái qua `JobLogger` + `DeploymentEventsService`:

```ts
// jobs/job-logger.ts — emit từng dòng + buffer để flush S3
export class JobLogger {
  private buffer: string[] = [];
  constructor(private deploymentId: string, private events: DeploymentEventsService, private storage: StorageService) {}

  line = (text: string, stream: 'stdout' | 'stderr' = 'stdout') => {
    this.buffer.push(text);
    // KHÔNG log nếu chứa secret (xem §8) — caller chịu trách nhiệm không truyền secret vào đây
    this.events.emitLog(this.deploymentId, { line: text, ts: Date.now(), stream }); // → WS deployment:log
  };

  async run(cmd: string)     { /* spawn shell, pipe stdout/stderr → this.line */ }
  async capture(cmd: string) { /* spawn, gom stdout trả về (vd rev-parse) */ return ''; }
  async flushToStorage(): Promise<string> {
    const key = `logs/${this.deploymentId}.log`;
    await this.storage.put(key, this.buffer.join('\n'), 'text/plain');
    return key; // gán vào Deployment.logKey
  }
}
```

> **Cô lập build (bảo mật):** ở Phase 1 build chạy thẳng (tin user). Đây là điểm phải gia cố ở Phase 3 — đánh dấu trong [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md): rootless Docker / BuildKit `--secret` cho build-arg nhạy cảm / network isolation cho job build. `concurrency: 2` ở queue `build` là biện pháp bảo vệ tài nguyên 1 VPS ([../02-tech-stack.md](../02-tech-stack.md) §2.5).

---

## 8. Env / Secret

Tuân thủ [01-data-model-prisma.md](01-data-model-prisma.md) (`EnvVar.value` mã hoá AES-256-GCM khi `isSecret`) và [../06-phase-1-mvp.md](../06-phase-1-mvp.md) §9. Inject theo `EnvTarget`: `BUILD` lúc build, `RUNTIME` lúc run, `BOTH` cả hai. **Không log secret.**

```ts
// infra/crypto/crypto.service.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class CryptoService {
  private key: Buffer; // 32 byte từ ENCRYPTION_KEY (xem [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md) §6)
  constructor(cfg: AppConfigService) { this.key = Buffer.from(cfg.encryptionKey, 'hex'); }

  /** Trả "iv:authTag:ciphertext" (hex) — định dạng ở [../06-phase-1-mvp.md](../06-phase-1-mvp.md) §9. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), ct.toString('hex')].join(':');
  }
  decrypt(packed: string): string {
    const [ivHex, tagHex, ctHex] = packed.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
  }
}
```

```ts
// modules/env/env.service.ts
@Injectable()
export class EnvService {
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  /** PUT /projects/:id/env — set hàng loạt; mã hoá khi isSecret. */
  async setMany(projectId: string, teamId: string, vars: SetEnvVarDto[]) {
    await this.assertProjectInTeam(projectId, teamId);
    for (const v of vars) {
      const stored = v.isSecret ? this.crypto.encrypt(v.value) : v.value;
      await this.prisma.envVar.upsert({
        where: { projectId_key: { projectId, key: v.key } },
        create: { projectId, key: v.key, value: stored, isSecret: v.isSecret, target: v.target ?? EnvTarget.RUNTIME },
        update: { value: stored, isSecret: v.isSecret, target: v.target ?? EnvTarget.RUNTIME },
      });
    }
  }

  /** GET /projects/:id/env — che giá trị secret (••••), không giải mã. */
  async list(projectId: string, teamId: string) {
    await this.assertProjectInTeam(projectId, teamId);
    const rows = await this.prisma.envVar.findMany({ where: { projectId } });
    return rows.map((r) => ({ key: r.key, isSecret: r.isSecret, target: r.target,
      value: r.isSecret ? '••••••••' : r.value }));
  }

  /** Dùng bởi processor: build map env theo target (giải mã secret tại đây, ngay trước khi inject). */
  async buildEnvMap(projectId: string, target: EnvTarget): Promise<Record<string, string>> {
    const rows = await this.prisma.envVar.findMany({ where: { projectId } });
    const wanted = (t: EnvTarget) => t === target || t === EnvTarget.BOTH;
    const map: Record<string, string> = {};
    for (const r of rows) {
      if (!wanted(r.target)) continue;
      map[r.key] = r.isSecret ? this.crypto.decrypt(r.value) : r.value;
    }
    // BACKEND: thêm PORT = internalPort nếu chưa có (app đọc process.env.PORT)
    return map;
  }
}
```

Quy tắc bắt buộc (từ [../03-luong-deploy-theo-loai-app.md](../03-luong-deploy-theo-loai-app.md) §2 + [../06-phase-1-mvp.md](../06-phase-1-mvp.md) §9):
- **BUILD-time secret** (vd token registry) → dùng BuildKit `--secret`, KHÔNG bake vào layer (`docker history` không lộ).
- **RUNTIME** → inject qua `Env` lúc `docker run` (hoặc `--env-file` tạm quyền `0600`, xoá ngay sau run).
- `LoggingInterceptor` và `JobLogger` **không in giá trị env**; value chỉ giải mã trong `buildEnvMap` ngay trước khi đưa vào Docker.

---

## 9. RealtimeGateway (Socket.IO)

Dùng **đúng `WS_EVENTS`** ở [02-api-contract.md](02-api-contract.md) §4 (`deployment:status`, `deployment:log`, `project:updated`, `subscribe`, `unsubscribe`). Namespace `/realtime`, room `deployment:<id>` / `project:<id>`.

```ts
// modules/realtime/realtime.gateway.ts
import { WS_EVENTS, DeploymentLogEvent, DeploymentStatusEvent } from '@deploybox/shared';

@WebSocketGateway({ namespace: '/realtime', cors: { credentials: true } })
export class RealtimeGateway {
  @WebSocketServer() server: Server;

  @SubscribeMessage(WS_EVENTS.SUBSCRIBE)       // 'subscribe'
  onSubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { room: string }) {
    // body.room dạng `deployment:${id}` | `project:${id}` — TODO: kiểm quyền team trước khi join
    client.join(body.room);
  }

  @SubscribeMessage(WS_EVENTS.UNSUBSCRIBE)     // 'unsubscribe'
  onUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { room: string }) {
    client.leave(body.room);
  }

  emitStatus(deploymentId: string, status: DeploymentStatus) {
    const payload: DeploymentStatusEvent = { deploymentId, status, at: Date.now() };
    this.server.to(`deployment:${deploymentId}`).emit(WS_EVENTS.DEPLOYMENT_STATUS, payload);
  }
  emitLog(deploymentId: string, e: Omit<DeploymentLogEvent, 'deploymentId'>) {
    const payload: DeploymentLogEvent = { deploymentId, ...e };
    this.server.to(`deployment:${deploymentId}`).emit(WS_EVENTS.DEPLOYMENT_LOG, payload);
  }
  emitProjectUpdated(projectId: string, summary?: unknown) {
    this.server.to(`project:${projectId}`).emit(WS_EVENTS.PROJECT_UPDATED, summary);
  }
}
```

**Cầu nối worker → gateway** (vấn đề: worker là process riêng, không cùng instance Socket.IO với API):

```ts
// modules/deployments/deployment-events.service.ts
// API process: emit thẳng qua RealtimeGateway.
// Worker process: KHÔNG có gateway → publish vào Redis; API subscribe rồi forward.
@Injectable()
export class DeploymentEventsService {
  constructor(@Optional() private gateway: RealtimeGateway, private redis: RedisPub) {}

  emitStatus(deploymentId: string, status: DeploymentStatus) {
    if (this.gateway) return this.gateway.emitStatus(deploymentId, status);
    return this.redis.publish('ws:deployment', JSON.stringify({ kind: 'status', deploymentId, status }));
  }
  emitLog(deploymentId: string, e: { line: string; ts: number; stream: 'stdout' | 'stderr' }) {
    if (this.gateway) return this.gateway.emitLog(deploymentId, e);
    return this.redis.publish('ws:deployment', JSON.stringify({ kind: 'log', deploymentId, ...e }));
  }
  emitProjectUpdated(projectId: string) {
    if (this.gateway) return this.gateway.emitProjectUpdated(projectId);
    return this.redis.publish('ws:deployment', JSON.stringify({ kind: 'project', projectId }));
  }
}
```

- API dùng **`RedisIoAdapter`** (`@socket.io/redis-adapter`) để emit tới room hoạt động kể cả khi chạy nhiều instance API.
- API có một **subscriber** lắng `ws:deployment` → gọi `gateway.emit*` tương ứng (forward từ worker).
- (Theo [02-api-contract.md](02-api-contract.md) §4) có thể dùng **SSE** đơn giản hơn cho log một chiều; Phase 1 chọn Socket.IO để thống nhất status + log + project trong một kênh.

---

## 10. Auth & RBAC

Theo [02-api-contract.md](02-api-contract.md) §5: `JwtAuthGuard` (global), `TeamRoleGuard` + `@Roles(...)`, **team scoping** (mọi truy vấn Prisma kèm `where teamId`).

```ts
// common/guards/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }
  canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride('isPublic', [ctx.getHandler(), ctx.getClass()])) return true; // @Public()
    return super.canActivate(ctx); // gắn req.user từ jwt.strategy
  }
}
```

```ts
// common/guards/team-role.guard.ts
@Injectable()
export class TeamRoleGuard implements CanActivate {
  constructor(private prisma: PrismaService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser = req.user;
    const required = this.reflector.get<TeamRole[]>('roles', ctx.getHandler()) ?? [];

    // Resolve teamId từ route: trực tiếp :teamId, hoặc gián tiếp qua :projectId / :deploymentId / :domainId
    const teamId = await this.resolveTeamId(req.params);
    if (!teamId) throw new NotFoundException();

    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: user.id } },
    });
    if (!membership) throw new NotFoundException();          // không thấy team khác (cô lập tenant)
    if (required.length && !required.includes(membership.role)) throw new ForbiddenException();

    req.teamId = teamId;          // @TeamCtx() đọc lại
    req.teamRole = membership.role;
    return true;
  }

  /** :projectId → project.teamId; :deploymentId → deployment.project.teamId; :domainId → domain.project.teamId */
  private async resolveTeamId(params: Record<string, string>): Promise<string | null> { /* ... */ return null; }
}
```

```ts
// common/decorators/roles.decorator.ts
export const Roles = (...roles: TeamRole[]) => SetMetadata('roles', roles);
// common/decorators/public.decorator.ts
export const Public = () => SetMetadata('isPublic', true);
```

**Team scoping — bất biến:** mọi service nhận `teamId` từ context và truy vấn Prisma **luôn** kèm `where: { teamId }` (hoặc lọc gián tiếp qua `project.teamId`). Một team không bao giờ thấy dữ liệu team khác — nền tảng cô lập tenant cho Phase 3 ([01-data-model-prisma.md](01-data-model-prisma.md) §3). Phase 1 chỉ có 1 team mặc định nhưng code vẫn viết tổng quát.

```ts
// ví dụ scoping ở ProjectsService
findOne(projectId: string, teamId: string) {
  return this.prisma.project.findFirstOrThrow({ where: { id: projectId, teamId } }); // KHÔNG findUnique theo mỗi id
}
```

---

## 11. Webhook git

Theo [02-api-contract.md](02-api-contract.md) (`POST /webhooks/git/:provider`) + ví dụ HMAC ở [../06-phase-1-mvp.md](../06-phase-1-mvp.md) §M2. Endpoint `@Public()` (không JWT) nhưng **bắt buộc verify chữ ký HMAC**.

```ts
// modules/webhooks/webhooks.controller.ts
@Controller('webhooks')
export class WebhooksController {
  constructor(private webhooks: WebhooksService) {}

  @Post('git/:provider')
  @Public()
  @HttpCode(202)
  async git(
    @Param('provider') provider: 'github' | 'gitlab' | 'bitbucket',
    @Headers() headers: Record<string, string>,
    @RawBody() raw: Buffer,                 // cần raw body để tính HMAC → bật rawBody trong main.ts
  ) {
    await this.webhooks.handlePush(provider, headers, raw);
    return { accepted: true };
  }
}
```

```ts
// modules/webhooks/webhooks.service.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class WebhooksService {
  constructor(private prisma: PrismaService, private deployments: DeploymentsService) {}

  async handlePush(provider: string, headers: Record<string, string>, raw: Buffer) {
    const { repoUrl, branch, sha, msg } = this.parse(provider, headers, raw);

    // tìm project khớp repo + branch (Phase 1: 1 repo = 1 project)
    const project = await this.prisma.project.findFirst({
      where: { gitRepoUrl: repoUrl, gitBranch: branch },
    });
    if (!project) return;                       // không có project khớp → bỏ qua
    if (!project.autoDeploy) return;            // autoDeploy tắt → bỏ qua

    // verify HMAC bằng secret của project (lưu mã hoá; xem ghi chú dưới)
    if (!this.verifySignature(provider, headers, raw, project)) {
      throw new UnauthorizedException();        // 401, KHÔNG tạo job
    }

    await this.deployments.trigger(project.id, project.teamId, DeploymentTrigger.GIT_PUSH, {
      commitSha: sha, commitMsg: msg,
    });
  }

  private verifySignature(provider: string, h: Record<string, string>, raw: Buffer, project: Project): boolean {
    const secret = this.getWebhookSecret(project);            // giải mã secret của project
    if (provider === 'github') {
      const sig = h['x-hub-signature-256'] ?? '';
      const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
      return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    }
    if (provider === 'gitlab') return h['x-gitlab-token'] === secret;   // GitLab dùng token thẳng
    /* bitbucket... */
    return false;
  }
}
```

> **Ghi chú:** model `Project` ở [01-data-model-prisma.md](01-data-model-prisma.md) chưa có field `webhookSecret` (bản rút gọn ở [../06-phase-1-mvp.md](../06-phase-1-mvp.md) §3 có). Khi triển khai, thêm `webhookSecret String?` vào `Project` (mã hoá qua `CryptoService` như mọi secret) hoặc dùng một secret toàn cục theo team — đây là điều chỉnh schema duy nhất cần thống nhất, không phá tên model. Map push → `DeploymentTrigger.GIT_PUSH`.

---

## 12. Config, lỗi, logging, testing & bản đồ Phase 1

### 12.1. Config (ConfigModule)

```ts
// config/config.schema.ts — validate process.env ngay khi boot (fail fast)
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z.string().length(64),          // 32 byte hex (AES-256)
  DOCKER_HOST: z.string().default('unix:///var/run/docker.sock'),
  CADDY_ADMIN_URL: z.string().url().default('http://localhost:2019'),
  CLOUDFLARE_API_TOKEN: z.string(),
  CLOUDFLARE_ZONE_ID: z.string(),
  APP_DOMAIN: z.string().default('deploybox.app'),
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string(), S3_SECRET_KEY: z.string(), S3_BUCKET: z.string(),
});
```

Tên biến khớp [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md) §6. `AppConfigService` expose getter typed (`cfg.appDomain`, `cfg.caddy.adminUrl`, `cfg.cloudflare.zoneId`…).

### 12.2. Exception filter (chuẩn body lỗi)

```ts
// common/filters/all-exceptions.filter.ts — body theo hợp đồng §1
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(ex: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const status = ex instanceof HttpException ? ex.getStatus() : 500;
    const base = ex instanceof HttpException ? ex.getResponse() : { message: 'Internal error' };
    res.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',     // "BadRequest", "Forbidden"...
      message: typeof base === 'string' ? base : (base as any).message,
      details: (base as any).details,
    });
  }
}
```

Bảng map status giữ đúng hợp đồng §1: 400 (zod), 401, 403 (RBAC), 404 (không thấy trong team), 409 (trùng slug), 422 (repo không clone được).

### 12.3. Logging

`LoggingInterceptor` log `method path status ms` (pino/nestjs-pino). **Tuyệt đối không log body env/secret/token.** Build log đi riêng qua `JobLogger` (Redis pub + S3), không lẫn vào application log.

### 12.4. Testing

| Loại | Phạm vi | Cách |
|---|---|---|
| **Unit (Jest)** | từng service, mock phụ thuộc | `DeploymentsService` (mock Prisma + Queue → assert tạo `Deployment(QUEUED)` + gọi `enqueueBuild`); `CryptoService` (encrypt→decrypt round-trip); `EnvService.buildEnvMap` (lọc đúng `EnvTarget`, giải mã secret); `WebhooksService.verifySignature` (HMAC đúng/sai); `CaddyService.upsertRoute` (mock fetch → assert JSON payload); `TeamRoleGuard` (membership/role) |
| **e2e luồng deploy (Jest + Docker)** | từ `POST /projects/:id/deploy` đến `RUNNING` | Cần Docker thật + Caddy (Testcontainers/CI). Repo mẫu static nhỏ → assert: tạo Deployment QUEUED → BuildProcessor ra image → DeployProcessor run container + Caddy có route → `GET https://<slug>...` trả 200 → status `RUNNING`. Test fail-path: build lỗi compile → `FAILED` + có `logKey`; deploy fail → giữ container cũ |
| **Contract** | DTO khớp `@deploybox/shared` | type-check FE/BE dùng chung schema zod |

### 12.5. Bản đồ công việc Phase 1 (thứ tự build — vertical slice trước)

Bám sát thứ tự ở [../06-phase-1-mvp.md](../06-phase-1-mvp.md) §6–§7 (deploy được web tĩnh sớm nhất), nhưng theo ngôn ngữ module backend:

```
B0. Nền tảng (1 lần):
    ConfigModule + PrismaModule (+ schema.prisma, migrate, seed 1 team/1 user OWNER)
    QueueModule (Redis) · StorageModule (MinIO) · CryptoModule
    Hạ tầng host: Docker network "deploybox", Caddy bật Admin API (:2019),
      Cloudflare wildcard *.deploybox.app + ingress (xem [../04-domain-ssl.md](../04-domain-ssl.md) §9)

B1. ⭐ VERTICAL SLICE (ưu tiên số 1) — chưa Auth, chưa UI, gọi API tay:
    DockerService(build static + run) + CaddyService(upsertRoute)
    + DeploymentsService.trigger + BuildProcessor + DeployProcessor (chỉ nhánh STATIC)
    => Mốc M1: POST /projects/:id/deploy 1 repo static public → https://<slug>.deploybox.app sống, SSL hợp lệ

B2. BACKEND path: BuildProcessor (Nixpacks/Dockerfile) + DeployProcessor healthcheck + blue/green
    => Backend Node chạy 24/7 có URL

B3. EnvModule + CryptoService wiring (buildEnvMap BUILD vs RUNTIME)
    => Mốc M2: backend đọc DATABASE_URL từ secret mã hoá

B4. WebhooksModule (HMAC) → trigger GIT_PUSH  (+ manual đã có từ B1)
    => Mốc M3: git push = auto deploy

B5. RealtimeModule (gateway + Redis bridge) + JobLogger hoàn chỉnh (WS log realtime + lưu S3)
    + DeploymentsController còn lại (logs, cancel, redeploy, stop, restart) + DockerService.streamLogs
    DomainsModule (custom domain: verify TXT + on_demand_tls ask + domain-verify.processor)
    CleanupProcessor (prune)

B6. AuthModule (JwtAuthGuard global, argon2, /auth/*) + TeamRoleGuard + TeamsModule/UsersModule
    => "khoá cửa" toàn bộ API sau khi slice đã chạy thông
    (SLEEPING/sleep-idle.processor: chừa sẵn, kích hoạt khi cần — Phase 3)
```

Lý do để **AuthModule gần cuối** (dù là dependency lý thuyết): dev nội bộ sau firewall/VPN, làm slice trước cho nhanh thấy kết quả rồi mới bọc guard — đúng tinh thần [../06-phase-1-mvp.md](../06-phase-1-mvp.md) §7. `JwtAuthGuard` đăng ký global ngay từ B0 nhưng các route nghiệp vụ tạm `@Public()` cho tới B6.

---

## 13. Liên kết chéo

- Cấu trúc & shared types: [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md)
- Schema dữ liệu (model/enum nguồn sự thật): [01-data-model-prisma.md](01-data-model-prisma.md)
- Hợp đồng REST + WS_EVENTS: [02-api-contract.md](02-api-contract.md)
- Frontend tiêu thụ hợp đồng: [04-frontend-nextjs.md](04-frontend-nextjs.md)
- Stack & lý do chọn: [../02-tech-stack.md](../02-tech-stack.md)
- Phạm vi & thứ tự Phase 1: [../06-phase-1-mvp.md](../06-phase-1-mvp.md)
- Luồng deploy STATIC/BACKEND: [../03-luong-deploy-theo-loai-app.md](../03-luong-deploy-theo-loai-app.md)
- Domain/SSL/Cloudflare/Caddy: [../04-domain-ssl.md](../04-domain-ssl.md)
- Bảo mật, cô lập build/run: [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md)
