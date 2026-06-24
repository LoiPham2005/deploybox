# Cấu trúc dự án & Monorepo

Tài liệu này định nghĩa **bộ khung code** cho DeployBox: tổ chức thư mục, monorepo, chia sẻ type giữa frontend/backend, công cụ, và môi trường dev. Mọi file triển khai khác ([03-backend-nestjs.md](03-backend-nestjs.md), [04-frontend-nextjs.md](04-frontend-nextjs.md)) đều giả định cấu trúc này.

> Bối cảnh: stack đã chốt ở [../02-tech-stack.md](../02-tech-stack.md) (Next.js + NestJS + Postgres/Prisma + Redis/BullMQ + Docker + Caddy). Phạm vi Phase 1 ở [../06-phase-1-mvp.md](../06-phase-1-mvp.md).

---

## 1. Vì sao MONOREPO

Lợi thế lớn nhất của việc chọn Node/TS cả hai đầu là **chia sẻ type**. Monorepo hiện thực hóa điều đó:

- **Một nguồn sự thật** cho enum (`DeploymentStatus`, `ProjectType`…), DTO request/response, và schema validation (zod). Backend đổi shape API → frontend báo lỗi biên dịch ngay, không lệch âm thầm.
- **Một lần `pnpm install`**, một bộ lint/format/tsconfig.
- Deploy **độc lập**: `apps/api` và `apps/web` vẫn đóng gói Docker riêng — monorepo ở repo, không phải ở runtime.

Công cụ: **pnpm workspaces** (nhẹ, đủ dùng) + tùy chọn **Turborepo** để chạy task song song và cache.

---

## 2. Cây thư mục

```
deploybox/
├── apps/
│   ├── api/                      # Backend — NestJS
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── modules/          # xem 03-backend-nestjs.md
│   │   │   ├── jobs/             # BullMQ processors (build, deploy, sleep…)
│   │   │   ├── infra/            # docker, caddy, cloudflare, storage clients
│   │   │   └── common/           # guards, interceptors, filters, decorators
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # xem 01-data-model-prisma.md
│   │   │   └── migrations/
│   │   ├── test/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── web/                      # Frontend — Next.js (App Router)
│       ├── src/
│       │   ├── app/              # routes — xem 04-frontend-nextjs.md
│       │   ├── components/
│       │   ├── features/         # logic theo domain (projects, deployments…)
│       │   ├── lib/              # api client, query client, ws client
│       │   └── styles/
│       ├── public/
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   ├── shared/                   # ⭐ TYPE & CONTRACT dùng chung FE+BE
│   │   ├── src/
│   │   │   ├── enums.ts          # DeploymentStatus, ProjectType, TeamRole…
│   │   │   ├── dto/              # request/response DTO (interface)
│   │   │   ├── schemas/          # zod schema (validate cả 2 đầu)
│   │   │   ├── events.ts         # tên & payload sự kiện WebSocket
│   │   │   └── index.ts
│   │   └── package.json          # name: "@deploybox/shared"
│   │
│   └── config/                   # tsconfig/eslint/prettier base (tùy chọn)
│       ├── tsconfig.base.json
│       └── eslint-preset.js
│
├── docker-compose.dev.yml        # postgres + redis + minio cho dev local
├── pnpm-workspace.yaml
├── turbo.json                    # tùy chọn
├── package.json                  # root scripts
├── .env.example
└── README.md
```

---

## 3. Gói chia sẻ `@deploybox/shared`

Đây là trái tim của lợi thế "một ngôn ngữ". Quy ước:

- **enums.ts** — enum khớp 1-1 với enum Prisma (xem [01-data-model-prisma.md](01-data-model-prisma.md)). FE và BE import cùng một chỗ.
- **schemas/** — zod schema cho mọi input. Backend dùng để validate (qua `nestjs-zod`); frontend dùng để validate form (qua `react-hook-form` + `@hookform/resolvers/zod`).
- **dto/** — type suy ra từ zod (`z.infer`) hoặc interface thuần cho response.
- **events.ts** — hằng tên sự kiện WS + type payload (xem [02-api-contract.md](02-api-contract.md) §WebSocket).

```ts
// packages/shared/src/schemas/project.ts
import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(['STATIC', 'BACKEND']),
  gitRepoUrl: z.string().url().optional(),
  gitBranch: z.string().default('main'),
  rootDir: z.string().default('.'),
});
export type CreateProjectDto = z.infer<typeof createProjectSchema>;
```

```ts
// Backend dùng để validate
@Post()
create(@Body(new ZodValidationPipe(createProjectSchema)) dto: CreateProjectDto) {}

// Frontend dùng cho form — CÙNG một schema
const form = useForm<CreateProjectDto>({ resolver: zodResolver(createProjectSchema) });
```

> Nguyên tắc vàng: **không định nghĩa shape API ở hai nơi**. Mọi DTO bắt nguồn từ `@deploybox/shared`.

---

## 4. Công cụ & quy ước

| Hạng mục | Lựa chọn |
|---|---|
| Trình quản lý gói | **pnpm** (workspaces) |
| Ngôn ngữ | **TypeScript** strict mode khắp nơi |
| Task runner | **Turborepo** (`turbo run build/lint/test`) — tùy chọn |
| Lint/format | ESLint + Prettier, preset chung ở `packages/config` |
| Test | **Vitest** (FE + shared), **Jest** (NestJS mặc định) |
| Git hooks | Husky + lint-staged (chạy lint/format trước commit) |
| Commit | Conventional Commits (tùy chọn, hỗ trợ changelog) |

Root `package.json` scripts gợi ý:

```jsonc
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "db:migrate": "pnpm --filter api prisma migrate dev",
    "db:studio": "pnpm --filter api prisma studio"
  }
}
```

---

## 5. Môi trường dev local

Hạ tầng phụ thuộc chạy bằng Docker Compose; còn `api` và `web` chạy trực tiếp để hot-reload nhanh.

```yaml
# docker-compose.dev.yml
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_PASSWORD: dev, POSTGRES_DB: deploybox }
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
  minio:                          # giả lập object storage S3 cho dev
    image: minio/minio
    command: server /data --console-address ":9001"
    environment: { MINIO_ROOT_USER: dev, MINIO_ROOT_PASSWORD: devsecret }
    ports: ["9000:9000", "9001:9001"]
volumes: { pgdata: {} }
```

Luồng khởi động dev:

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres + redis + minio
pnpm install
pnpm db:migrate                                   # tạo bảng
pnpm dev                                           # chạy api (:4000) + web (:3000)
```

> Lưu ý quan trọng: chính DeployBox cần nói chuyện với **Docker daemon** để build/chạy app của user. Ở dev, backend trỏ tới Docker của máy (`/var/run/docker.sock`). Ở production, đây là điểm bảo mật cốt tử — xem [../09-bao-mat-va-rui-ro.md](../09-bao-mat-va-rui-ro.md).

---

## 6. Biến môi trường (khung)

```bash
# .env.example
# --- API ---
DATABASE_URL=postgresql://postgres:dev@localhost:5432/deploybox
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me
ENCRYPTION_KEY=32-byte-key-cho-ma-hoa-secret      # mã hoá EnvVar (xem data model §EnvVar)

# --- Hạ tầng deploy ---
DOCKER_HOST=unix:///var/run/docker.sock
CADDY_ADMIN_URL=http://localhost:2019              # Caddy admin API
CLOUDFLARE_API_TOKEN=...                           # tự động hoá DNS
CLOUDFLARE_ZONE_ID=...
APP_DOMAIN=deploybox.app                           # gốc cho subdomain *.deploybox.app

# --- Object storage (artifact + build log) ---
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=dev
S3_SECRET_KEY=devsecret
S3_BUCKET=deploybox

# --- Web ---
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## 7. Ranh giới module (ai gọi ai)

```
   apps/web (Next.js)
        │  HTTP (REST) + WebSocket
        ▼
   apps/api (NestJS)  ──Prisma──▶  Postgres
        │  ├──BullMQ──▶ Redis ──▶ jobs/ (build, deploy worker)
        │  ├── infra/docker   ──▶ Docker daemon (build image, run container)
        │  ├── infra/caddy    ──▶ Caddy Admin API (proxy + domain + SSL)
        │  ├── infra/cloudflare ─▶ Cloudflare API (DNS)
        │  └── infra/storage  ──▶ S3/MinIO (artifact, log)
        │
   packages/shared  ◀── import bởi cả web và api
```

Bước tiếp theo: [01-data-model-prisma.md](01-data-model-prisma.md) (schema dữ liệu) → [02-api-contract.md](02-api-contract.md) (hợp đồng API) → bản triển khai [03-backend-nestjs.md](03-backend-nestjs.md) và [04-frontend-nextjs.md](04-frontend-nextjs.md).
