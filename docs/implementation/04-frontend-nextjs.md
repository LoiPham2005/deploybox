# Triển khai Frontend (Next.js)

Tài liệu này là **bản kế hoạch code** cho `apps/web` — dashboard của DeployBox (Next.js App Router). Mục tiêu: lập trình viên mở file ra là dựng được cây thư mục, viết được hook/component, và **không lệch** khỏi hợp đồng API.

> Bối cảnh bắt buộc đọc trước:
> - Cấu trúc monorepo & gói dùng chung: [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md)
> - **Hợp đồng API (REST + WebSocket)** — nguồn sự thật cho endpoint/DTO/sự kiện: [02-api-contract.md](02-api-contract.md)
> - Mô hình dữ liệu & enum hiển thị: [01-data-model-prisma.md](01-data-model-prisma.md)
> - Stack đã chốt (Next.js): [../02-tech-stack.md](../02-tech-stack.md)
> - Phạm vi Phase 1: [../06-phase-1-mvp.md](../06-phase-1-mvp.md)
> - Kiến trúc tổng thể: [../01-kien-truc-tong-the.md](../01-kien-truc-tong-the.md)

**Hai luật bất di bất dịch:**
1. **KHÔNG tự bịa shape API.** Mọi endpoint, DTO, enum, tên sự kiện WS phải import/khớp y hệt `@deploybox/shared` và [02-api-contract.md](02-api-contract.md). Base URL = `NEXT_PUBLIC_API_URL`, tiền tố `/api/v1`. List trả `{ data, total, page, pageSize }`.
2. **Một schema cho cả FE/BE.** Validate form bằng đúng zod schema trong `@deploybox/shared` (vd `createProjectSchema`).

---

## 1. Stack & phiên bản FE

| Hạng mục | Lựa chọn | Ghi chú |
|---|---|---|
| Framework | **Next.js 14+ (App Router)** | RSC mặc định; route group; `loading.tsx`/`error.tsx` |
| Ngôn ngữ | **TypeScript** strict | import type từ `@deploybox/shared` |
| Server-state | **TanStack Query v5** (`@tanstack/react-query`) | mọi REST đi qua đây |
| Realtime | **Socket.IO client** (`socket.io-client`) tới `/realtime` | fallback SSE (xem §5.4) |
| Form | **react-hook-form** + **@hookform/resolvers/zod** | dùng lại schema shared |
| Validation | **zod** (qua `@deploybox/shared`) | KHÔNG khai báo schema mới ở FE |
| UI | **Tailwind CSS** + **shadcn/ui** (Radix) | component nền tảng §8 |
| Client-state | **Zustand** (tối thiểu) | UI state: sidebar, theme, current team |
| Icon | **lucide-react** | đi kèm shadcn |
| Toast | **sonner** (hoặc shadcn `useToast`) | thông báo deploy/lỗi |
| Test | **Vitest** + Testing Library | khớp [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md) §4 |

`apps/web/package.json` (trích dependency chính):

```jsonc
{
  "name": "@deploybox/web",
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@deploybox/shared": "workspace:*",
    "@tanstack/react-query": "^5.0.0",
    "socket.io-client": "^4.7.0",
    "react-hook-form": "^7.52.0",
    "@hookform/resolvers": "^3.6.0",
    "zod": "^3.23.0",
    "zustand": "^4.5.0",
    "lucide-react": "^0.400.0",
    "sonner": "^1.5.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.4.0"
  }
}
```

---

## 2. Cấu trúc `apps/web/src`

Bốn vùng tách bạch theo [00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md): `app/` (routing), `components/` (UI thuần tái dùng), `features/` (logic theo domain), `lib/` (hạ tầng: api/query/ws/auth).

```
apps/web/src
├── app/                              # ROUTE TREE (App Router) — xem §3
│   ├── layout.tsx                    # root: <html>, Providers, font, Toaster
│   ├── globals.css                   # Tailwind + biến theme (§8.3)
│   ├── providers.tsx                 # 'use client': QueryClientProvider, ThemeProvider
│   │
│   ├── (auth)/                       # route group — layout tối giản (không sidebar)
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   │
│   ├── (dashboard)/                  # route group — vỏ dashboard (sidebar + topbar)
│   │   ├── layout.tsx                # AppShell: Sidebar + TeamSwitcher + UserMenu
│   │   ├── page.tsx                  # "/" — danh sách project (SERVER)
│   │   ├── loading.tsx
│   │   ├── error.tsx
│   │   │
│   │   ├── projects/
│   │   │   ├── new/page.tsx          # form tạo project (CLIENT)
│   │   │   └── [id]/
│   │   │       ├── layout.tsx        # nạp project + render Tabs (overview/…)
│   │   │       ├── page.tsx          # tab overview (mặc định, SERVER)
│   │   │       ├── deployments/
│   │   │       │   ├── page.tsx      # lịch sử deploy (SERVER + poll)
│   │   │       │   └── [deploymentId]/
│   │   │       │       └── page.tsx  # LOG REALTIME (CLIENT) — §5
│   │   │       ├── domains/page.tsx
│   │   │       ├── env/page.tsx
│   │   │       └── settings/page.tsx
│   │   │
│   │   ├── team/
│   │   │   └── members/page.tsx
│   │   └── account/page.tsx
│   │
│   └── api/                          # (tuỳ chọn) route handler proxy/refresh cookie
│       └── auth/
│           └── route.ts
│
├── components/                       # UI THUẦN — không biết domain DeployBox
│   ├── ui/                           # shadcn/ui generate vào đây
│   │   ├── button.tsx  input.tsx  table.tsx  tabs.tsx  badge.tsx
│   │   ├── dialog.tsx  dropdown-menu.tsx  card.tsx  skeleton.tsx
│   │   ├── form.tsx    select.tsx  switch.tsx  tooltip.tsx
│   │   └── sonner.tsx
│   ├── layout/
│   │   ├── app-shell.tsx  sidebar.tsx  topbar.tsx
│   │   └── team-switcher.tsx  user-menu.tsx
│   └── common/
│       ├── page-header.tsx  empty-state.tsx  copy-button.tsx
│       └── data-table.tsx            # bọc table + phân trang chung
│
├── features/                         # LOGIC THEO DOMAIN
│   ├── auth/
│   │   ├── hooks.ts                  # useMe, useLogin, useLogout, useRegister
│   │   ├── login-form.tsx  register-form.tsx
│   │   └── current-team.tsx          # hiển thị + đổi team hiện tại
│   ├── projects/
│   │   ├── hooks.ts                  # useProjects, useProject, useCreateProject…
│   │   ├── project-list.tsx  project-card.tsx
│   │   ├── create-project-form.tsx
│   │   └── project-settings-form.tsx
│   ├── deployments/
│   │   ├── hooks.ts                  # useDeployments, useDeployment, useTriggerDeploy…
│   │   ├── use-deployment-logs.ts    # ⭐ hook realtime — §5.3
│   │   ├── deployment-list.tsx
│   │   ├── deployment-status-badge.tsx   # map DeploymentStatus → màu (§8.2)
│   │   ├── log-viewer.tsx            # ⭐ màn log build realtime (§5.5)
│   │   └── deploy-button.tsx         # nút Deploy + optimistic (§4.4)
│   ├── domains/
│   │   ├── hooks.ts                  # useDomains, useAddDomain, useVerifyDomain…
│   │   ├── domain-list.tsx
│   │   ├── add-domain-dialog.tsx
│   │   └── dns-instructions.tsx      # render AddDomainResponse.dnsInstructions
│   ├── env/
│   │   ├── hooks.ts                  # useEnvVars, useSetEnvVars, useDeleteEnvVar
│   │   ├── env-table.tsx             # mask secret, nút reveal
│   │   └── env-editor.tsx            # set hàng loạt {vars:[…]}
│   └── team/
│       ├── hooks.ts                  # useTeams, useMembers, useInviteMember…
│       └── members-table.tsx
│
├── lib/                              # HẠ TẦNG
│   ├── api/
│   │   ├── client.ts                 # ⭐ fetch wrapper mỏng (§4.2) — type DTO từ shared
│   │   ├── endpoints.ts              # hằng path khớp 02-api-contract.md (§4.1)
│   │   ├── server.ts                 # serverFetch: lấy token từ cookie (§3.3)
│   │   └── errors.ts                 # ApiError + parse body lỗi (§4.3)
│   ├── query/
│   │   ├── keys.ts                   # ⭐ query key factory (§4.5)
│   │   ├── client.ts                 # tạo QueryClient (staleTime, retry)
│   │   └── hydrate.ts               # prefetch + dehydrate cho RSC (§3.2)
│   ├── ws/
│   │   └── socket.ts                 # ⭐ getSocket() singleton tới /realtime (§5.2)
│   ├── auth/
│   │   ├── cookies.ts                # tên cookie, đọc/ghi (server)
│   │   └── session.ts                # getSession() phía server
│   └── utils.ts                      # cn(), formatDate, relativeTime…
│
├── stores/
│   └── ui-store.ts                   # Zustand: sidebarOpen, theme, currentTeamId
│
└── styles/                           # (nếu tách khỏi app/globals.css)
    └── tokens.css
```

> Quy ước import: domain logic ở `features/` được render bởi `app/`; `features/` và `app/` dùng `lib/` và `components/`. **`components/ui` không import `features/`** (giữ UI thuần).

---

## 3. Bản đồ route (App Router) ↔ màn hình

### 3.1. Cây route → màn hình

```
app/
├── (auth)                                   [layout: tối giản, căn giữa, không sidebar]
│   ├── /login            → Đăng nhập (POST /auth/login)                       [CLIENT form]
│   └── /register         → Đăng ký   (POST /auth/register)                    [CLIENT form]
│
└── (dashboard)                              [layout: AppShell = Sidebar + Topbar + TeamSwitcher]
    ├── /                 → DANH SÁCH PROJECT (GET /teams/:teamId/projects)    [SERVER list]
    │                       loading.tsx (skeleton card) · error.tsx (retry)
    │
    ├── /projects/new     → Tạo project (POST /teams/:teamId/projects)         [CLIENT form]
    │
    └── /projects/[id]    [layout: nạp GET /projects/:projectId + render Tabs] [SERVER shell]
        ├── (overview)    → /projects/[id]            Tổng quan: domain chính,
        │                    trạng thái, deployment mới nhất, env count          [SERVER]
        ├── /deployments  → Lịch sử deploy (GET /projects/:projectId/deployments)
        │                    bảng + badge trạng thái + poll/WS                   [SERVER+poll]
        │   └── /deployments/[deploymentId]
        │                  → CHI TIẾT + LOG REALTIME (xem build chạy live)       [CLIENT]
        │                    GET /deployments/:deploymentId
        │                    GET /deployments/:deploymentId/logs (lịch sử)
        │                    WS room deployment:<id> (§5)
        ├── /domains      → Domain (GET /projects/:projectId/domains)
        │                    + thêm domain (POST …/domains) + DNS guide          [SERVER+CLIENT]
        ├── /env          → Env vars (GET /projects/:projectId/env)
        │                    + set hàng loạt (PUT …/env)                         [SERVER+CLIENT]
        └── /settings     → Cấu hình build/run (PATCH /projects/:projectId)
                             + Xoá project (DELETE …)                            [CLIENT form]

    /team/members         → Thành viên team (GET /teams/:teamId/members)        [SERVER+CLIENT]
    /account              → Tài khoản (GET /auth/me), đăng xuất                 [SERVER+CLIENT]
```

> **Tabs trong `/projects/[id]`**: `layout.tsx` nạp project một lần (server) và render thanh `<Tabs>` (overview/deployments/domains/env/settings) bằng `next/link`. Mỗi tab là một segment con → chuyển tab không tải lại header project. Tab active suy ra từ `usePathname()` trong một client component nhỏ `ProjectTabsNav`.

### 3.2. Layout & route group — trách nhiệm

| File | Loại | Trách nhiệm |
|---|---|---|
| `app/layout.tsx` | Server | `<html lang>`, font, `<Providers>`, `<Toaster/>` (sonner). |
| `app/providers.tsx` | Client | `QueryClientProvider` (client QueryClient), theme provider. |
| `(auth)/layout.tsx` | Server | Vỏ tối giản. Nếu đã có session → `redirect('/')`. |
| `(dashboard)/layout.tsx` | Server | **Bảo vệ**: `getSession()`, không có → `redirect('/login')`. Render `AppShell` + prefetch `GET /auth/me` (teams) cho TeamSwitcher. |
| `projects/[id]/layout.tsx` | Server | `prefetchQuery(keys.project(id))` rồi `<HydrationBoundary>`; render `ProjectHeader` + `ProjectTabsNav`. 404 → `notFound()`. |
| `loading.tsx` | Server | Skeleton (dùng `components/ui/skeleton`). Mỗi list/chi tiết có riêng. |
| `error.tsx` | Client | `'use client'`, nhận `{ error, reset }`; nút "Thử lại" gọi `reset()`. 401 do middleware lo, ở đây xử lý lỗi mạng/500. |
| `not-found.tsx` | Server | Trang 404 chung. |

### 3.3. Lấy token cho fetch phía server

Token JWT ưu tiên **cookie httpOnly** (§7). Server Component đọc cookie qua `next/headers` rồi gắn `Authorization: Bearer`:

```ts
// lib/auth/cookies.ts
export const ACCESS_TOKEN_COOKIE = 'db_access_token';

// lib/api/server.ts
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth/cookies';

const BASE = `${process.env.NEXT_PUBLIC_API_URL}/api/v1`;

/** Fetch phía SERVER (RSC / route handler). Tự gắn token từ cookie httpOnly. */
export async function serverFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = cookies().get(ACCESS_TOKEN_COOKIE)?.value;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: 'no-store', // dữ liệu deploy luôn động
  });
  if (res.status === 401) redirect('/login'); // hết hạn → đăng nhập lại
  if (!res.ok) throw await ApiError.fromResponse(res);
  return res.json() as Promise<T>;
}
```

```ts
// lib/auth/session.ts — dùng trong layout để bảo vệ route
import type { MeResponse } from '@deploybox/shared';
import { serverFetch } from '@/lib/api/server';

export async function getSession(): Promise<MeResponse | null> {
  try {
    return await serverFetch<MeResponse>('/auth/me'); // { user, teams[] }
  } catch {
    return null;
  }
}
```

---

## 4. Data fetching — TanStack Query + API client mỏng

### 4.1. Bản đồ endpoint (khớp 1-1 [02-api-contract.md](02-api-contract.md))

```ts
// lib/api/endpoints.ts — KHÔNG hardcode path rải rác; mọi nơi import từ đây.
export const EP = {
  auth: {
    register: () => `/auth/register`,
    login:    () => `/auth/login`,
    logout:   () => `/auth/logout`,
    me:       () => `/auth/me`,
  },
  teams: {
    list:    () => `/teams`,
    create:  () => `/teams`,
    members: (teamId: string) => `/teams/${teamId}/members`,
    member:  (teamId: string, userId: string) => `/teams/${teamId}/members/${userId}`,
  },
  projects: {
    listByTeam: (teamId: string) => `/teams/${teamId}/projects`,
    createInTeam: (teamId: string) => `/teams/${teamId}/projects`,
    detail: (projectId: string) => `/projects/${projectId}`,
    update: (projectId: string) => `/projects/${projectId}`,
    remove: (projectId: string) => `/projects/${projectId}`,
  },
  deployments: {
    trigger:    (projectId: string) => `/projects/${projectId}/deploy`,
    history:    (projectId: string) => `/projects/${projectId}/deployments`,
    detail:     (deploymentId: string) => `/deployments/${deploymentId}`,
    cancel:     (deploymentId: string) => `/deployments/${deploymentId}/cancel`,
    redeploy:   (deploymentId: string) => `/deployments/${deploymentId}/redeploy`,
    logs:       (deploymentId: string) => `/deployments/${deploymentId}/logs`,
    stopApp:    (projectId: string) => `/projects/${projectId}/stop`,
    restartApp: (projectId: string) => `/projects/${projectId}/restart`,
  },
  domains: {
    list:   (projectId: string) => `/projects/${projectId}/domains`,
    add:    (projectId: string) => `/projects/${projectId}/domains`,
    verify: (domainId: string) => `/domains/${domainId}/verify`,
    remove: (domainId: string) => `/domains/${domainId}`,
  },
  env: {
    list:      (projectId: string) => `/projects/${projectId}/env`,
    setBulk:   (projectId: string) => `/projects/${projectId}/env`, // PUT
    removeKey: (projectId: string, key: string) => `/projects/${projectId}/env/${key}`,
  },
} as const;
```

### 4.2. API client mỏng (client-side)

Bọc `fetch`, gắn header, parse lỗi thống nhất. **Type tham số & trả về luôn là DTO từ `@deploybox/shared`.**

```ts
// lib/api/client.ts  ('use client' an toàn vì chỉ chạy ở trình duyệt qua React Query)
import { ApiError } from './errors';

const BASE = `${process.env.NEXT_PUBLIC_API_URL}/api/v1`;

type Options = Omit<RequestInit, 'body'> & { body?: unknown };

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { body, headers, ...rest } = opts;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: 'include',           // gửi cookie httpOnly (auth) — §7
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // hết hạn token ở client → đẩy về login (giữ trang đích để quay lại)
    if (typeof window !== 'undefined') {
      window.location.href = `/login?from=${encodeURIComponent(location.pathname)}`;
    }
    throw new ApiError(401, 'Unauthorized', 'Phiên đăng nhập đã hết hạn');
  }
  if (!res.ok) throw await ApiError.fromResponse(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get:  <T>(p: string) => request<T>(p, { method: 'GET' }),
  post: <T>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body }),
  put:  <T>(p: string, body?: unknown) => request<T>(p, { method: 'PUT', body }),
  patch:<T>(p: string, body?: unknown) => request<T>(p, { method: 'PATCH', body }),
  del:  <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};
```

```ts
// lib/api/errors.ts — khớp "Quy ước lỗi" §1 của 02-api-contract.md
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public error: string,
    message: string,
    public details?: Record<string, unknown>,
  ) { super(message); }

  static async fromResponse(res: Response): Promise<ApiError> {
    const b = await res.json().catch(() => ({}));
    return new ApiError(
      b.statusCode ?? res.status,
      b.error ?? res.statusText,
      b.message ?? 'Đã có lỗi xảy ra',
      b.details,
    );
  }
}
```

### 4.3. List response & DTO dùng chung

Mọi list theo §0 của hợp đồng trả `{ data, total, page, pageSize }`. Khai báo type này trong shared và FE chỉ import:

```ts
// import từ @deploybox/shared (KHÔNG định nghĩa lại ở FE)
import type {
  Paginated, MeResponse, ProjectSummary, ProjectDetail, CreateProjectDto,
  DeploymentDetail, DeploymentStatus, AddDomainResponse, EnvVarDto, SetEnvVarsDto,
  TeamMemberDto,
} from '@deploybox/shared';
// Paginated<T> = { data: T[]; total: number; page: number; pageSize: number }
```

### 4.4. Query client & cấu hình cache

```ts
// lib/query/client.ts
import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,          // 30s — list/chi tiết coi như fresh ngắn
        retry: (count, err: any) => (err?.statusCode >= 500 ? count < 2 : false),
        refetchOnWindowFocus: false,
      },
    },
  });
}
```

| Dữ liệu | staleTime | Làm tươi bằng |
|---|---|---|
| Danh sách project | 30s | invalidate khi tạo/xoá; `PROJECT_UPDATED` (WS) |
| Chi tiết project | 30s | invalidate sau PATCH/deploy |
| Lịch sử deployment | 10s | `refetchInterval` khi có bản đang chạy + `DEPLOYMENT_STATUS` |
| Chi tiết deployment | 5s khi đang chạy | `DEPLOYMENT_STATUS` (WS) cập nhật cache trực tiếp |
| Env vars | 60s | invalidate sau PUT/DELETE |
| Domains | 30s | invalidate sau add/verify/remove; poll khi `VERIFYING` |

### 4.5. Query key factory

```ts
// lib/query/keys.ts
export const keys = {
  me: () => ['me'] as const,
  teams: () => ['teams'] as const,
  members: (teamId: string) => ['teams', teamId, 'members'] as const,

  projects: (teamId: string) => ['teams', teamId, 'projects'] as const,
  project: (projectId: string) => ['projects', projectId] as const,

  deployments: (projectId: string) => ['projects', projectId, 'deployments'] as const,
  deployment: (deploymentId: string) => ['deployments', deploymentId] as const,
  deploymentLogs: (deploymentId: string) => ['deployments', deploymentId, 'logs'] as const,

  domains: (projectId: string) => ['projects', projectId, 'domains'] as const,
  env: (projectId: string) => ['projects', projectId, 'env'] as const,
} as const;
```

### 4.6. Hook phác — projects

```ts
// features/projects/hooks.ts
'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated, ProjectSummary, ProjectDetail, CreateProjectDto } from '@deploybox/shared';
import { api } from '@/lib/api/client';
import { EP } from '@/lib/api/endpoints';
import { keys } from '@/lib/query/keys';

export function useProjects(teamId: string) {
  return useQuery({
    queryKey: keys.projects(teamId),
    queryFn: () => api.get<Paginated<ProjectSummary>>(EP.projects.listByTeam(teamId)),
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: keys.project(projectId),
    queryFn: () => api.get<ProjectDetail>(EP.projects.detail(projectId)),
  });
}

export function useCreateProject(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateProjectDto) =>
      api.post<ProjectDetail>(EP.projects.createInTeam(teamId), dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects(teamId) }),
  });
}
```

### 4.7. Hook phác — deployments + **optimistic update khi deploy**

```ts
// features/deployments/hooks.ts
'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated, DeploymentDetail } from '@deploybox/shared';
import { api } from '@/lib/api/client';
import { EP } from '@/lib/api/endpoints';
import { keys } from '@/lib/query/keys';

export function useDeployments(projectId: string) {
  return useQuery({
    queryKey: keys.deployments(projectId),
    queryFn: () => api.get<Paginated<DeploymentDetail>>(EP.deployments.history(projectId)),
    // còn bản đang chạy thì poll như lưới an toàn ngoài WS
    refetchInterval: (q) => {
      const live = q.state.data?.data.some((d) =>
        ['QUEUED', 'BUILDING', 'DEPLOYING'].includes(d.status));
      return live ? 5_000 : false;
    },
  });
}

export function useDeployment(deploymentId: string) {
  return useQuery({
    queryKey: keys.deployment(deploymentId),
    queryFn: () => api.get<DeploymentDetail>(EP.deployments.detail(deploymentId)),
  });
}

/** Bấm "Deploy" → tạo Deployment(QUEUED). Optimistic: chèn hàng QUEUED tạm vào lịch sử. */
export function useTriggerDeploy(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ deployment: DeploymentDetail }>(EP.deployments.trigger(projectId)),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: keys.deployments(projectId) });
      const prev = qc.getQueryData<Paginated<DeploymentDetail>>(keys.deployments(projectId));
      const optimistic: DeploymentDetail = {
        id: `optimistic-${Date.now()}`,
        projectId,
        status: 'QUEUED',
        trigger: 'MANUAL',
        queuedAt: new Date().toISOString(),
      } as DeploymentDetail;
      qc.setQueryData<Paginated<DeploymentDetail>>(keys.deployments(projectId), (old) =>
        old ? { ...old, data: [optimistic, ...old.data], total: old.total + 1 } : old);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.deployments(projectId), ctx.prev); // rollback
    },
    onSettled: (res) => {
      qc.invalidateQueries({ queryKey: keys.deployments(projectId) });
      qc.invalidateQueries({ queryKey: keys.project(projectId) }); // latestDeployment đổi
    },
  });
}

export function useCancelDeploy(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deploymentId: string) => api.post(EP.deployments.cancel(deploymentId)),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.deployments(projectId) }),
  });
}

export function useRedeploy(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deploymentId: string) => api.post(EP.deployments.redeploy(deploymentId)),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.deployments(projectId) }),
  });
}
```

### 4.8. Prefetch ở Server Component (hydrate React Query)

Danh sách/chi tiết tĩnh prefetch phía server rồi truyền cache xuống client để tránh nháy loading:

```tsx
// app/(dashboard)/projects/[id]/layout.tsx  (SERVER)
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { makeQueryClient } from '@/lib/query/client';
import { keys } from '@/lib/query/keys';
import { serverFetch } from '@/lib/api/server';
import { EP } from '@/lib/api/endpoints';
import { ProjectHeader } from '@/features/projects/project-header';
import { ProjectTabsNav } from '@/features/projects/project-tabs-nav';

export default async function ProjectLayout(
  { children, params }: { children: React.ReactNode; params: { id: string } },
) {
  const qc = makeQueryClient();
  await qc.prefetchQuery({
    queryKey: keys.project(params.id),
    queryFn: () => serverFetch(EP.projects.detail(params.id)),
  });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProjectHeader projectId={params.id} />
      <ProjectTabsNav projectId={params.id} />
      {children}
    </HydrationBoundary>
  );
}
```

---

## 5. Realtime — log build chạy live + badge trạng thái

Đây là điểm cốt lõi (lý do chọn Node). Frontend kết nối **Socket.IO** tới `/realtime`, **subscribe room** `deployment:<id>`, nhận đúng `WS_EVENTS` và đẩy vào UI + cache React Query. Tên sự kiện/ payload phải khớp y hệt [02-api-contract.md](02-api-contract.md) §4.

### 5.1. Hợp đồng sự kiện (import, không bịa)

```ts
// từ @deploybox/shared (định nghĩa gốc trong 02-api-contract.md)
import {
  WS_EVENTS,                 // { DEPLOYMENT_STATUS:'deployment:status', DEPLOYMENT_LOG:'deployment:log',
                             //   PROJECT_UPDATED:'project:updated', SUBSCRIBE:'subscribe', UNSUBSCRIBE:'unsubscribe' }
  type DeploymentLogEvent,   // { deploymentId, line, ts, stream:'stdout'|'stderr' }
  type DeploymentStatusEvent,// { deploymentId, status, at }
} from '@deploybox/shared';
```

### 5.2. Socket singleton

```ts
// lib/ws/socket.ts
'use client';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** Một kết nối dùng chung tới /realtime. Cookie httpOnly tự đính kèm để server auth. */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${process.env.NEXT_PUBLIC_API_URL}/realtime`, {
      withCredentials: true,         // gửi cookie JWT — §7
      transports: ['websocket'],
      autoConnect: true,
    });
  }
  return socket;
}
```

### 5.3. Hook `useDeploymentLogs` (⭐)

Trả về `lines` (cộng dồn), `status` (sống), và cờ kết nối. Nạp **log lịch sử** từ REST (`GET /deployments/:id/logs`) trước, rồi **nối tiếp** dòng realtime từ WS. Cập nhật trực tiếp cache `keys.deployment(id)` để badge mọi nơi đổi tức thì.

```ts
// features/deployments/use-deployment-logs.ts
'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WS_EVENTS, type DeploymentLogEvent, type DeploymentStatusEvent,
  type DeploymentDetail, type DeploymentStatus,
} from '@deploybox/shared';
import { getSocket } from '@/lib/ws/socket';
import { api } from '@/lib/api/client';
import { EP } from '@/lib/api/endpoints';
import { keys } from '@/lib/query/keys';

export interface LogLine { line: string; ts: number; stream: 'stdout' | 'stderr'; }

export function useDeploymentLogs(deploymentId: string, initialStatus: DeploymentStatus) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<DeploymentStatus>(initialStatus);
  const [connected, setConnected] = useState(false);
  const seeded = useRef(false);

  // 1) Log lịch sử đã lưu (object storage) — chỉ một lần
  const history = useQuery({
    queryKey: keys.deploymentLogs(deploymentId),
    queryFn: () => api.get<LogLine[]>(EP.deployments.logs(deploymentId)),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (history.data && !seeded.current) { setLines(history.data); seeded.current = true; }
  }, [history.data]);

  // 2) Realtime qua Socket.IO room deployment:<id>
  useEffect(() => {
    const socket = getSocket();
    const room = `deployment:${deploymentId}`;
    const onConnect = () => { setConnected(true); socket.emit(WS_EVENTS.SUBSCRIBE, { room }); };
    const onDisconnect = () => setConnected(false);

    const onLog = (e: DeploymentLogEvent) => {
      if (e.deploymentId !== deploymentId) return;
      setLines((prev) => [...prev, { line: e.line, ts: e.ts, stream: e.stream }]);
    };
    const onStatus = (e: DeploymentStatusEvent) => {
      if (e.deploymentId !== deploymentId) return;
      setStatus(e.status);
      // đẩy vào cache để badge ở list/overview đổi ngay
      qc.setQueryData<DeploymentDetail>(keys.deployment(deploymentId),
        (old) => (old ? { ...old, status: e.status } : old));
    };

    if (socket.connected) onConnect();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(WS_EVENTS.DEPLOYMENT_LOG, onLog);
    socket.on(WS_EVENTS.DEPLOYMENT_STATUS, onStatus);

    return () => {
      socket.emit(WS_EVENTS.UNSUBSCRIBE, { room });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(WS_EVENTS.DEPLOYMENT_LOG, onLog);
      socket.off(WS_EVENTS.DEPLOYMENT_STATUS, onStatus);
    };
  }, [deploymentId, qc]);

  const isLive = ['QUEUED', 'BUILDING', 'DEPLOYING'].includes(status);
  return { lines, status, connected, isLive, isLoadingHistory: history.isLoading };
}
```

### 5.4. Phương án thay thế: SSE (Phase 1 có thể bắt đầu)

Hợp đồng cho phép bắt đầu bằng **SSE** cho log một chiều ([02-api-contract.md](02-api-contract.md) §4). Nếu chọn SSE, đổi nội bộ §5.3 sang `EventSource`, **giữ nguyên signature** `useDeploymentLogs` để UI không phải sửa:

```ts
// biến thể SSE — chỉ thay phần "2) Realtime"
const es = new EventSource(`${BASE}${EP.deployments.logs(deploymentId)}?stream=sse`, { withCredentials: true });
es.addEventListener(WS_EVENTS.DEPLOYMENT_LOG, (ev) => onLog(JSON.parse((ev as MessageEvent).data)));
es.addEventListener(WS_EVENTS.DEPLOYMENT_STATUS, (ev) => onStatus(JSON.parse((ev as MessageEvent).data)));
// cleanup: es.close()
```

> Khuyến nghị: Socket.IO cho Phase 1 vì cần thêm `PROJECT_UPDATED` (cập nhật list) và mở rộng runtime log hai chiều sau này.

### 5.5. `LogViewer` — màn log build realtime

Auto-scroll khi đang ở đáy, **màu phân biệt stdout/stderr**, badge trạng thái cập nhật tức thì.

```tsx
// features/deployments/log-viewer.tsx
'use client';
import { useEffect, useRef } from 'react';
import { useDeploymentLogs } from './use-deployment-logs';
import { DeploymentStatusBadge } from './deployment-status-badge';
import type { DeploymentStatus } from '@deploybox/shared';

export function LogViewer(
  { deploymentId, initialStatus }: { deploymentId: string; initialStatus: DeploymentStatus },
) {
  const { lines, status, connected, isLive } = useDeploymentLogs(deploymentId, initialStatus);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // còn dính đáy?

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="rounded-lg border bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <DeploymentStatusBadge status={status} />
          {isLive && <span className="text-xs text-zinc-400">đang chạy…</span>}
        </div>
        <span className={connected ? 'text-emerald-400 text-xs' : 'text-amber-400 text-xs'}>
          {connected ? '● realtime' : '○ mất kết nối'}
        </span>
      </div>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="h-[60vh] overflow-auto p-3 font-mono text-xs leading-relaxed"
      >
        {lines.map((l, i) => (
          <div key={i} className={l.stream === 'stderr' ? 'text-red-400' : 'text-zinc-200'}>
            <span className="select-none pr-2 text-zinc-600">
              {new Date(l.ts).toLocaleTimeString()}
            </span>
            {l.line}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Trang dùng nó (client, vì cần WS):

```tsx
// app/(dashboard)/projects/[id]/deployments/[deploymentId]/page.tsx
'use client';
import { useDeployment } from '@/features/deployments/hooks';
import { LogViewer } from '@/features/deployments/log-viewer';

export default function DeploymentPage(
  { params }: { params: { deploymentId: string } },
) {
  const { data, isLoading } = useDeployment(params.deploymentId);
  if (isLoading || !data) return <div>Đang tải…</div>;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">
          Deploy {data.commitSha?.slice(0, 7) ?? data.id.slice(0, 7)}
        </h1>
        {data.commitMsg && <p className="text-sm text-muted-foreground">{data.commitMsg}</p>}
      </header>
      <LogViewer deploymentId={data.id} initialStatus={data.status} />
    </div>
  );
}
```

---

## 6. Form + validation — dùng lại zod schema từ `@deploybox/shared`

Một schema validate cả FE & BE ([00-monorepo-va-cau-truc.md](00-monorepo-va-cau-truc.md) §3). FE **không** khai báo schema mới; chỉ `import { createProjectSchema }` và bọc `zodResolver`.

### 6.1. Form tạo project

```tsx
// features/projects/create-project-form.tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createProjectSchema, type CreateProjectDto } from '@deploybox/shared';
import { useCreateProject } from './hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export function CreateProjectForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const create = useCreateProject(teamId);
  const form = useForm<CreateProjectDto>({
    resolver: zodResolver(createProjectSchema), // ⭐ schema chung
    defaultValues: { type: 'BACKEND', gitBranch: 'main', rootDir: '.' },
  });

  function onSubmit(values: CreateProjectDto) {
    create.mutate(values, {
      onSuccess: (project) => {
        toast.success('Đã tạo project');
        router.push(`/projects/${project.id}`); // sang overview, sẵn sàng deploy lần đầu
      },
      onError: (e: any) => {
        // map lỗi 400 field về form (details.field theo §1 hợp đồng)
        if (e.details?.field) form.setError(e.details.field, { message: e.message });
        else toast.error(e.message);
      },
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-lg space-y-4">
        <FormField name="name" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>Tên project</FormLabel>
            <FormControl><Input placeholder="my-app" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField name="type" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>Loại</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="STATIC">Web tĩnh (STATIC)</SelectItem>
                <SelectItem value="BACKEND">Web có backend (BACKEND)</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        <FormField name="gitRepoUrl" control={form.control} render={({ field }) => (
          <FormItem>
            <FormLabel>Git repo URL</FormLabel>
            <FormControl><Input placeholder="https://github.com/org/repo" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="grid grid-cols-2 gap-3">
          <FormField name="gitBranch" control={form.control} render={({ field }) => (
            <FormItem><FormLabel>Branch</FormLabel>
              <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField name="rootDir" control={form.control} render={({ field }) => (
            <FormItem><FormLabel>Root dir</FormLabel>
              <FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Đang tạo…' : 'Tạo project'}
        </Button>
      </form>
    </Form>
  );
}
```

### 6.2. Form thêm env var (set hàng loạt)

Body khớp hợp đồng: `PUT /projects/:projectId/env` với `{ vars: [{ key, value, isSecret, target }] }` (`target` ∈ `EnvTarget` = `BUILD | RUNTIME | BOTH`). Schema `setEnvVarsSchema` cũng nằm trong `@deploybox/shared`.

```tsx
// features/env/env-editor.tsx
'use client';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { setEnvVarsSchema, type SetEnvVarsDto } from '@deploybox/shared';
import { useSetEnvVars } from './hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

export function EnvEditor({ projectId, initial }: { projectId: string; initial: SetEnvVarsDto }) {
  const setEnv = useSetEnvVars(projectId);
  const form = useForm<SetEnvVarsDto>({
    resolver: zodResolver(setEnvVarsSchema),    // ⭐ schema chung
    defaultValues: initial.vars.length ? initial : { vars: [{ key: '', value: '', isSecret: false, target: 'RUNTIME' }] },
  });
  const fields = useFieldArray({ control: form.control, name: 'vars' });

  return (
    <form
      onSubmit={form.handleSubmit((v) => setEnv.mutate(v))}
      className="space-y-2"
    >
      {fields.fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
          <Input placeholder="KEY" {...form.register(`vars.${i}.key`)} />
          <Input placeholder="value"
            type={form.watch(`vars.${i}.isSecret`) ? 'password' : 'text'}
            {...form.register(`vars.${i}.value`)} />
          <label className="flex items-center gap-1 text-xs">
            <Switch checked={form.watch(`vars.${i}.isSecret`)}
              onCheckedChange={(c) => form.setValue(`vars.${i}.isSecret`, c)} /> secret
          </label>
          <Button type="button" variant="ghost" onClick={() => fields.remove(i)}>Xoá</Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="button" variant="outline"
          onClick={() => fields.append({ key: '', value: '', isSecret: false, target: 'RUNTIME' })}>
          + Thêm biến
        </Button>
        <Button type="submit" disabled={setEnv.isPending}>Lưu</Button>
      </div>
      <p className="text-xs text-amber-600">Đổi env cần <strong>redeploy</strong> mới có hiệu lực.</p>
    </form>
  );
}
```

> Hook `useSetEnvVars` dùng **optimistic update** trên `keys.env(projectId)` (logic giống §4.7) để bảng phản hồi tức thì, rollback nếu lỗi, và hiện banner "Env changed → redeploy".

---

## 7. Auth phía FE

### 7.1. Lưu token — ưu tiên cookie httpOnly

- BE (login/register) **set cookie httpOnly** `db_access_token` (SameSite=Lax, Secure ở prod). FE không đọc/ghi token trong JS → chống XSS đánh cắp token.
- Mọi request client đi kèm `credentials: 'include'` (§4.2); request server đọc cookie qua `next/headers` (§3.3); Socket.IO `withCredentials: true` (§5.2).
- Nếu BE buộc trả token trong body (`accessToken`) thay vì set-cookie, FE gọi route handler nội bộ `POST /api/auth` để ghi cookie httpOnly từ phía server (Next.js `cookies().set`). **Không** lưu vào `localStorage`.

### 7.2. Middleware bảo vệ route

```ts
// apps/web/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth/cookies';

const PUBLIC = ['/login', '/register'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasToken = Boolean(req.cookies.get(ACCESS_TOKEN_COOKIE)?.value);
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));

  if (!hasToken && !isPublic) {
    const url = new URL('/login', req.url);
    url.searchParams.set('from', pathname);       // quay lại sau khi đăng nhập
    return NextResponse.redirect(url);
  }
  if (hasToken && isPublic) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico)).*)'],
};
```

> Middleware chỉ kiểm tra **có cookie hay không** (rẻ). Xác thực token thật do BE làm: nếu token hết hạn, `serverFetch`/`api` nhận 401 và đẩy về `/login` (§3.3, §4.2).

### 7.3. Hook auth + đăng xuất

```ts
// features/auth/hooks.ts
'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@deploybox/shared';
import { api } from '@/lib/api/client';
import { EP } from '@/lib/api/endpoints';
import { keys } from '@/lib/query/keys';

export function useMe() {
  return useQuery({ queryKey: keys.me(), queryFn: () => api.get<MeResponse>(EP.auth.me()) });
}
export function useLogin() {
  return useMutation({
    mutationFn: (b: { email: string; password: string }) => api.post(EP.auth.login(), b),
  });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(EP.auth.logout()),
    onSuccess: () => { qc.clear(); window.location.href = '/login'; },
  });
}
```

### 7.4. Team hiện tại (hiển thị + chọn)

Phase 1 dùng **1 team mặc định** ([01-data-model-prisma.md](01-data-model-prisma.md) §1) nhưng API tổng quát theo `teamId`. Vì vậy:

- `GET /auth/me` trả `{ user, teams[] }`. Lưu `currentTeamId` vào Zustand (`stores/ui-store.ts`), mặc định `teams[0].id`, persist `localStorage`.
- `TeamSwitcher` (topbar) hiển thị team hiện tại; đổi team → set `currentTeamId` → các hook nhận `teamId` (vd `useProjects(currentTeamId)`) tự refetch theo key mới.

```ts
// stores/ui-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  currentTeamId: string | null;
  setCurrentTeam: (id: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
}
export const useUiStore = create<UiState>()(persist((set) => ({
  currentTeamId: null,
  setCurrentTeam: (id) => set({ currentTeamId: id }),
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  theme: 'light',
  setTheme: (theme) => set({ theme }),
}), { name: 'deploybox-ui' }));
```

---

## 8. Design system — Tailwind + shadcn/ui (Radix)

### 8.1. Bảng component nền tảng

| Component | Nguồn | Dùng ở |
|---|---|---|
| `Button` | shadcn | mọi nơi (Deploy, Lưu, Xoá…) |
| `Input` / `Form` / `Select` / `Switch` | shadcn + RHF | form tạo project, env editor, settings |
| `Table` / `DataTable` | shadcn (TanStack Table) | list deployment, env, members |
| `Tabs` | shadcn (Radix) | `/projects/[id]` overview/deployments/domains/env/settings |
| `Badge` → **`DeploymentStatusBadge`** | shadcn `Badge` bọc lại | trạng thái deployment (§8.2) |
| `Dialog` | shadcn (Radix) | thêm domain, xác nhận xoá |
| `DropdownMenu` | shadcn (Radix) | UserMenu, action trên hàng (•••) |
| `Toast` (`sonner`) | sonner | báo deploy thành công/lỗi |
| `Skeleton` | shadcn | `loading.tsx` |
| `Card` | shadcn | project card, ô thông tin overview |
| `Tooltip` | shadcn (Radix) | giải thích trạng thái, copy DNS |
| **`LogViewer`** | tự viết (§5.5) | màn log build realtime |
| `CopyButton` | tự viết | copy DNS value, webhook URL |

### 8.2. `DeploymentStatusBadge` — map enum → màu

Map **đúng** enum `DeploymentStatus` của [01-data-model-prisma.md](01-data-model-prisma.md): `QUEUED, BUILDING, DEPLOYING, RUNNING, SLEEPING, FAILED, STOPPED, CANCELLED`.

```tsx
// features/deployments/deployment-status-badge.tsx
import { Badge } from '@/components/ui/badge';
import type { DeploymentStatus } from '@deploybox/shared';

const MAP: Record<DeploymentStatus, { label: string; cls: string; pulse?: boolean }> = {
  QUEUED:    { label: 'Đang chờ',   cls: 'bg-zinc-200 text-zinc-800' },
  BUILDING:  { label: 'Đang build', cls: 'bg-blue-100 text-blue-700', pulse: true },
  DEPLOYING: { label: 'Đang deploy',cls: 'bg-indigo-100 text-indigo-700', pulse: true },
  RUNNING:   { label: 'Đang chạy',  cls: 'bg-emerald-100 text-emerald-700' },
  SLEEPING:  { label: 'Ngủ',        cls: 'bg-amber-100 text-amber-700' },
  FAILED:    { label: 'Lỗi',        cls: 'bg-red-100 text-red-700' },
  STOPPED:   { label: 'Đã dừng',    cls: 'bg-zinc-200 text-zinc-600' },
  CANCELLED: { label: 'Đã huỷ',     cls: 'bg-zinc-200 text-zinc-500' },
};

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }) {
  const s = MAP[status];
  return (
    <Badge className={s.cls}>
      {s.pulse && <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-current" />}
      {s.label}
    </Badge>
  );
}
```

> Tương tự có `DomainStatusBadge` cho `DomainStatus` (`PENDING_DNS, VERIFYING, ACTIVE, FAILED`).

### 8.3. Theme & dark mode

- Tailwind `darkMode: 'class'`. Biến màu HSL trong `app/globals.css` theo chuẩn shadcn (`--background`, `--foreground`, `--primary`, `--destructive`, `--muted`…), block `:root` (light) và `.dark` (dark).
- Toggle: `useUiStore.theme` → gắn class `dark` lên `<html>` trong `providers.tsx` (đọc store + set `document.documentElement.classList`). Persist qua Zustand (§7.4) tránh nhấp nháy.
- Quy ước: **không hardcode màu** trong component nghiệp vụ — dùng token (`bg-background`, `text-muted-foreground`). Ngoại lệ: `LogViewer` cố tình dùng nền tối (terminal) và màu stdout/stderr cố định.

---

## 9. State management

| Loại state | Giải pháp | Ví dụ |
|---|---|---|
| **Server-state** (chủ đạo) | **TanStack Query** | project, deployment, domain, env, members, me |
| **Realtime patch vào cache** | WS handler `qc.setQueryData` | badge trạng thái (§5.3), `PROJECT_UPDATED` cập nhật list |
| **Client/UI-state** (tối thiểu) | **Zustand** (`stores/ui-store.ts`) | `currentTeamId`, `sidebarOpen`, `theme` |
| **Form-state** | react-hook-form | mọi form (§6) |
| **URL-state** | App Router (segment) + `searchParams` | tab đang mở, `?from=`, phân trang `?page=` |

Nguyên tắc: **không** nhân bản server-state vào Zustand. Zustand chỉ giữ state UI thuần không đến từ server.

`PROJECT_UPDATED` (server → client) cập nhật trực tiếp danh sách project mà không cần refetch:

```ts
// trong một provider client lắng nghe toàn cục (vd app shell)
socket.on(WS_EVENTS.PROJECT_UPDATED, (p /* ProjectSummary */) => {
  qc.setQueryData<Paginated<ProjectSummary>>(keys.projects(currentTeamId), (old) =>
    old ? { ...old, data: old.data.map((x) => (x.id === p.id ? { ...x, ...p } : x)) } : old);
});
```

---

## 10. Các UX flow then chốt

### (a) Tạo project từ Git → xem lần deploy đầu chạy live

```
/projects/new  ──submit createProjectSchema──►  POST /teams/:teamId/projects
        │                                              │ trả ProjectDetail
        ▼                                              ▼
  router.push(/projects/:id)  ◄──────────────  (tab overview)
        │
        │ overview: chưa có deployment → nút "Deploy ngay"
        ▼
  bấm Deploy ──► useTriggerDeploy ──► POST /projects/:id/deploy  (Deployment QUEUED)
        │           (optimistic: hàng QUEUED hiện ngay ở lịch sử)
        ▼
  router.push(/projects/:id/deployments/:deploymentId)
        │
        ▼  LogViewer mount → useDeploymentLogs:
            1. GET /deployments/:id/logs (lịch sử, thường rỗng cho bản mới)
            2. WS SUBSCRIBE room deployment:<id>
            3. nhận DEPLOYMENT_LOG từng dòng → log chảy realtime (auto-scroll)
            4. nhận DEPLOYMENT_STATUS: QUEUED→BUILDING→DEPLOYING→RUNNING
               → badge đổi tức thì; xong RUNNING → link tới domain
```

### (b) Thêm custom domain → hướng dẫn DNS → trạng thái cấp SSL

```
/projects/:id/domains ──"Thêm domain"──► AddDomainDialog (nhập hostname)
        │
        ▼  useAddDomain ──► POST /projects/:id/domains  { hostname }
                              │ trả AddDomainResponse:
                              │   { domain{id,hostname,status:PENDING_DNS},
                              │     dnsInstructions{type:'A'|'CNAME', name, value},
                              │     verification?{type:'TXT', name, value} }
        ▼
  DnsInstructions: bảng record cần tạo (type/name/value) + CopyButton mỗi giá trị
  Badge domain = PENDING_DNS ("Chờ trỏ DNS")
        │
        │ user tạo record ở nhà cung cấp DNS, rồi bấm "Tôi đã trỏ DNS"
        ▼
  useVerifyDomain ──► POST /domains/:domainId/verify
        │  status → VERIFYING ("Đang xác minh + xin SSL")
        ▼  poll keys.domains(projectId) mỗi 5s khi còn VERIFYING
            (hoặc nhận cập nhật qua WS nếu BE phát)
        ▼
  status → ACTIVE  → badge xanh "Đã gắn + SSL", hiện link https://<hostname>
            FAILED → badge đỏ + lý do, nút "Thử lại"
```

### (c) Sửa env var → redeploy

```
/projects/:id/env ──► EnvEditor (table key/value, secret mask = ••••, nút reveal)
        │ sửa giá trị / thêm biến
        ▼ useSetEnvVars ──► PUT /projects/:id/env  { vars:[{key,value,isSecret,target}] }
        │   (optimistic cập nhật bảng; xoá 1 biến → DELETE /projects/:id/env/:key)
        ▼
  Banner cảnh báo: "Env đã đổi — cần redeploy để áp dụng"  [nút Redeploy]
        │
        ▼ Redeploy ──► useTriggerDeploy(projectId)  (hoặc redeploy bản mới nhất)
        ▼ điều hướng sang trang deployment → xem build mới chạy live (như flow (a))
```

---

## 11. Bản đồ công việc Phase 1 (thứ tự dựng)

Mục tiêu: có **vertical slice** sớm — bám đúng thứ tự "khoá cửa sau" của [../06-phase-1-mvp.md](../06-phase-1-mvp.md) §7 nhưng cho phần FE. Mỗi bước nên chạy thật, không chờ làm xong hết mới ghép.

```
F0. Khởi tạo
    - create-next-app (App Router, TS, Tailwind) trong apps/web; cài deps §1.
    - shadcn init → generate: button,input,form,select,table,tabs,badge,dialog,
      dropdown-menu,card,skeleton,switch,tooltip,sonner.
    - lib/: api/client.ts, api/server.ts, api/endpoints.ts, api/errors.ts,
      query/{client,keys}.ts, ws/socket.ts, auth/{cookies,session}.ts, utils.ts.
    - app/providers.tsx + app/layout.tsx (QueryClient + Toaster).
    => Done: app chạy, gọi thử GET /auth/me ra dữ liệu (hoặc 401).

F1. Auth + vỏ dashboard           [mở khoá mọi trang]
    - (auth)/login + register (RHF, login/register schema từ shared).
    - middleware.ts bảo vệ route; (dashboard)/layout.tsx getSession()→redirect.
    - AppShell: Sidebar + Topbar + TeamSwitcher (useMe → currentTeamId vào Zustand).
    => Done: chưa login→/login; login xong vào "/", thấy team hiện tại.

F2. Danh sách + tạo project       [đối tượng làm việc chính]
    - "/" : useProjects(teamId) (SERVER prefetch + hydrate) → ProjectCard + status.
    - /projects/new : CreateProjectForm (createProjectSchema) → POST → push detail.
    - /projects/[id]/layout.tsx : Tabs + ProjectHeader (useProject).
    - tab overview: domain chính, latestDeployment + DeploymentStatusBadge.
    => Done: tạo được project, vào được overview.

F3. ⭐ Màn deploy + log realtime  [trái tim — chứng minh WS]
    - DeployButton (useTriggerDeploy, optimistic).
    - /deployments + DeploymentList (poll khi có bản live).
    - /deployments/[deploymentId] : LogViewer + useDeploymentLogs:
        GET .../logs (lịch sử) + Socket.IO room deployment:<id>
        + DEPLOYMENT_LOG (màu stdout/stderr, auto-scroll)
        + DEPLOYMENT_STATUS (badge tức thì).
    => Done: bấm Deploy → xem build chảy live → badge chạy tới RUNNING.

F4. Domain + Env                  [bồi quanh xương sống]
    - /env : EnvEditor (setEnvVarsSchema) + mask secret + banner redeploy.
    - /domains : AddDomainDialog + DnsInstructions (render AddDomainResponse)
        + verify + poll VERIFYING→ACTIVE + DomainStatusBadge.
    - /settings : project-settings-form (PATCH) + Xoá project (DELETE + confirm Dialog).
    => Done: đủ 3 UX flow §10 (a)(b)(c).

F5. Team & account + đánh bóng    [hoàn thiện]
    - /team/members : MembersTable (list/mời/đổi role/xoá — RBAC theo TeamRole).
    - /account : thông tin user + đăng xuất.
    - loading.tsx/error.tsx cho mọi list; empty-state; dark mode toggle;
      PROJECT_UPDATED cập nhật list realtime (§9).
    => Done: dùng trọn dashboard bằng tay, không cần CLI.
```

Thứ tự ưu tiên: **F0→F1→F2→F3** tạo ra vertical slice "đăng nhập → tạo project → xem deploy chạy live" sớm nhất; F4–F5 bồi thêm. Khớp tinh thần "vertical slice trước" của Phase 1.

> Lưu ý phạm vi: SaaS (multi-tenant thật, billing, quota) và mobile **không** thuộc Phase 1 ([../06-phase-1-mvp.md](../06-phase-1-mvp.md) §1.2). FE chỉ cần `currentTeamId` (một team mặc định) là đủ; cấu trúc theo `teamId` đã sẵn cho Phase 3 mà không phải viết lại.

---

## 12. Checklist khớp hợp đồng (tự kiểm trước khi merge)

- [ ] Mọi path gọi từ `lib/api/endpoints.ts`, khớp bảng REST [02-api-contract.md](02-api-contract.md) §2 (tiền tố `/api/v1`).
- [ ] Mọi DTO/enum import từ `@deploybox/shared` — **không** khai báo lại ở FE.
- [ ] List đọc đúng `{ data, total, page, pageSize }`.
- [ ] Form validate bằng zod schema **shared** (`createProjectSchema`, `setEnvVarsSchema`, …).
- [ ] WS dùng đúng `WS_EVENTS` (`deployment:status`, `deployment:log`, `project:updated`, `subscribe`, `unsubscribe`) và payload `DeploymentLogEvent` / `DeploymentStatusEvent`.
- [ ] Subscribe đúng room `deployment:<id>`; unsubscribe khi unmount.
- [ ] 401 ở server → `redirect('/login')`; ở client → chuyển `/login?from=`.
- [ ] Badge map đủ 8 giá trị `DeploymentStatus`.
- [ ] Lỗi đọc theo body chuẩn `{ statusCode, error, message, details }`.
