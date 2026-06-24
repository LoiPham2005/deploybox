# Hợp đồng API (REST + WebSocket)

Đây là **giao kèo giữa frontend và backend**. Mọi shape ở đây sống trong `@deploybox/shared` (xem [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md) §3) để hai đầu không lệch. Tham chiếu model ở [01-data-model-prisma.md](01-data-model-prisma.md).

- Base URL: `NEXT_PUBLIC_API_URL` (vd `http://localhost:4000`), tiền tố `/api/v1`.
- Auth: **JWT Bearer** trong header `Authorization: Bearer <token>` (hoặc cookie httpOnly). API token cho CLI/webhook.
- Định dạng: JSON. Mọi list trả `{ data, total, page, pageSize }`.

---

## 1. Quy ước lỗi

```jsonc
// HTTP status chuẩn + body thống nhất
{
  "statusCode": 400,
  "error": "BadRequest",
  "message": "gitRepoUrl phải là URL hợp lệ",
  "details": { "field": "gitRepoUrl" }   // tùy chọn
}
```

| Status | Khi nào |
|---|---|
| 400 | Validate input thất bại (zod) |
| 401 | Thiếu/sai token |
| 403 | Không đủ quyền (RBAC theo `TeamRole`) |
| 404 | Không thấy resource trong team hiện tại |
| 409 | Trùng (vd slug đã tồn tại) |
| 422 | Hợp lệ về cú pháp nhưng không xử lý được (vd repo không clone được) |

---

## 2. Bảng endpoint REST

### Auth & user
| Method | Path | Mô tả | Body / trả về |
|---|---|---|---|
| POST | `/auth/register` | Đăng ký | `{email,password,name}` → `{user, accessToken}` |
| POST | `/auth/login` | Đăng nhập | `{email,password}` → `{user, accessToken}` |
| POST | `/auth/logout` | Đăng xuất | — |
| GET | `/auth/me` | User hiện tại + teams | → `{user, teams[]}` |

### Team (Phase 1 dùng team mặc định; API vẫn tổng quát)
| Method | Path | Mô tả |
|---|---|---|
| GET | `/teams` | Danh sách team của tôi |
| POST | `/teams` | Tạo team `{name}` |
| GET | `/teams/:teamId/members` | Thành viên |
| POST | `/teams/:teamId/members` | Mời `{email, role}` |
| PATCH | `/teams/:teamId/members/:userId` | Đổi role |
| DELETE | `/teams/:teamId/members/:userId` | Xóa thành viên |

### Project
| Method | Path | Mô tả |
|---|---|---|
| GET | `/teams/:teamId/projects` | List project |
| POST | `/teams/:teamId/projects` | Tạo project (`CreateProjectDto`) |
| GET | `/projects/:projectId` | Chi tiết project (kèm deployment mới nhất, domains) |
| PATCH | `/projects/:projectId` | Cập nhật cấu hình build/run, quota |
| DELETE | `/projects/:projectId` | Xóa project (dừng container, gỡ domain) |

### Deployment (lõi)
| Method | Path | Mô tả |
|---|---|---|
| POST | `/projects/:projectId/deploy` | **Trigger deploy** → tạo `Deployment(QUEUED)`, đẩy job build. Trả `{deployment}` |
| GET | `/projects/:projectId/deployments` | Lịch sử deploy (phân trang) |
| GET | `/deployments/:deploymentId` | Chi tiết 1 deployment |
| POST | `/deployments/:deploymentId/cancel` | Hủy khi đang QUEUED/BUILDING |
| POST | `/deployments/:deploymentId/redeploy` | Chạy lại bản này (rollback) |
| GET | `/deployments/:deploymentId/logs` | Build log đã lưu (object storage) — phân trang/stream |
| POST | `/projects/:projectId/stop` | Dừng app đang chạy |
| POST | `/projects/:projectId/restart` | Khởi động lại |

### Domain
| Method | Path | Mô tả |
|---|---|---|
| GET | `/projects/:projectId/domains` | List domain |
| POST | `/projects/:projectId/domains` | Thêm domain `{hostname}` → trả hướng dẫn DNS + `verifyToken` |
| POST | `/domains/:domainId/verify` | Kích hoạt xác minh + xin SSL |
| DELETE | `/domains/:domainId` | Gỡ domain |

### EnvVar
| Method | Path | Mô tả |
|---|---|---|
| GET | `/projects/:projectId/env` | List (secret bị che giá trị) |
| PUT | `/projects/:projectId/env` | Set hàng loạt `{vars: [{key,value,isSecret,target}]}` |
| DELETE | `/projects/:projectId/env/:key` | Xóa 1 biến |

### Webhook (git → tự deploy)
| Method | Path | Mô tả |
|---|---|---|
| POST | `/webhooks/git/:provider` | Nhận push event → nếu khớp branch & `autoDeploy` → trigger deploy. Xác thực chữ ký HMAC. |

---

## 3. DTO chính (trích — sống trong `@deploybox/shared`)

```ts
// Tạo project
export interface CreateProjectDto {
  name: string;
  type: 'STATIC' | 'BACKEND';
  gitRepoUrl?: string;
  gitBranch?: string;        // default "main"
  rootDir?: string;          // default "."
  buildCommand?: string;
  startCommand?: string;     // BACKEND
  outputDir?: string;        // STATIC
  internalPort?: number;     // BACKEND, default 3000
}

// Tóm tắt project trả cho FE (list)
export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  type: ProjectType;
  primaryDomain?: string;
  latestDeployment?: {
    id: string;
    status: DeploymentStatus;
    createdAt: string;
  };
}

// Chi tiết deployment
export interface DeploymentDetail {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  commitSha?: string;
  commitMsg?: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
}

// Thêm domain → hướng dẫn cho user
export interface AddDomainResponse {
  domain: { id: string; hostname: string; status: DomainStatus };
  dnsInstructions: {
    type: 'A' | 'CNAME';
    name: string;
    value: string;            // IP server hoặc target CNAME
  };
  verification?: { type: 'TXT'; name: string; value: string };
}
```

> Toàn bộ enum (`ProjectType`, `DeploymentStatus`…) import từ `@deploybox/shared` — định nghĩa khớp Prisma ở [01-data-model-prisma.md](01-data-model-prisma.md).

---

## 4. WebSocket / Realtime

Build log và đổi trạng thái deployment **phải realtime** (đây là lý do chọn Node — xem [../02-tech-stack.md](../02-tech-stack.md)). Dùng **Socket.IO** (hoặc WS thuần) cho kênh `/realtime`.

Client subscribe theo phòng (room) `deployment:<id>` hoặc `project:<id>`.

```ts
// packages/shared/src/events.ts
export const WS_EVENTS = {
  // server → client
  DEPLOYMENT_STATUS: 'deployment:status',   // payload: { deploymentId, status, at }
  DEPLOYMENT_LOG:    'deployment:log',      // payload: { deploymentId, line, ts, stream:'stdout'|'stderr' }
  PROJECT_UPDATED:   'project:updated',     // payload: ProjectSummary
  // client → server
  SUBSCRIBE:         'subscribe',           // payload: { room: `deployment:${id}` }
  UNSUBSCRIBE:       'unsubscribe',
} as const;

export interface DeploymentLogEvent {
  deploymentId: string;
  line: string;
  ts: number;
  stream: 'stdout' | 'stderr';
}
export interface DeploymentStatusEvent {
  deploymentId: string;
  status: DeploymentStatus;
  at: number;
}
```

Luồng: BullMQ worker build app → emit `DEPLOYMENT_LOG` từng dòng + `DEPLOYMENT_STATUS` khi chuyển trạng thái → backend đẩy qua Socket.IO tới room → frontend hiển thị log chạy realtime + cập nhật badge trạng thái. Đồng thời build log đầy đủ được ghi vào object storage (`logKey`) để xem lại sau.

> Lựa chọn thay thế nếu muốn đơn giản: **SSE** (Server-Sent Events) cho log một chiều — đủ cho việc stream log; WebSocket cần khi có tương tác hai chiều. Phase 1 có thể bắt đầu bằng SSE.

---

## 5. Authnz tóm tắt

- **Guard `JwtAuthGuard`**: xác thực token, gắn `req.user`.
- **Guard `TeamRoleGuard` + decorator `@Roles('ADMIN')`**: kiểm tra membership + role trong team của resource.
- **Team scoping**: mọi service nhận `teamId` từ context; truy vấn Prisma luôn kèm `where: { teamId }` → một team không thấy dữ liệu team khác (nền tảng cô lập tenant cho Phase 3).

Chi tiết hiện thực ở [03-backend-nestjs.md](03-backend-nestjs.md). Cách frontend tiêu thụ hợp đồng này ở [04-frontend-nextjs.md](04-frontend-nextjs.md).
