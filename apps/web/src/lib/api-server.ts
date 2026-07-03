// Client API phía SERVER — đọc JWT từ cookie httpOnly rồi gọi NestJS.
// CHỈ import trong Server Component / Server Action / Route Handler.
import type {
  ApiTokenDto,
  CronJobDto,
  DeploymentView,
  EnvVarDto,
  MeResponse,
  Paginated,
  ProjectDetailDto,
  ProjectSummary,
  ServerDto,
  TeamMemberDto,
  WebhookEventDto,
} from '@deploybox/shared';
import { getToken } from './auth';

const BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

export async function serverApi<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `API ${res.status}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export const serverGet = {
  me: () => serverApi<MeResponse>('/auth/me'),
  projects: (teamId: string) =>
    serverApi<Paginated<ProjectSummary>>(`/teams/${teamId}/projects`),
  project: (id: string) => serverApi<ProjectDetailDto>(`/projects/${id}`),
  deployment: (id: string) => serverApi<DeploymentView>(`/deployments/${id}`),
  env: (projectId: string) =>
    serverApi<EnvVarDto[]>(`/projects/${projectId}/env`),
  members: (teamId: string) =>
    serverApi<TeamMemberDto[]>(`/teams/${teamId}/members`),
  tokens: () => serverApi<ApiTokenDto[]>('/auth/tokens'),
  webhookEvents: (projectId: string) =>
    serverApi<WebhookEventDto[]>(`/projects/${projectId}/webhook-events`),
  cron: (projectId: string) =>
    serverApi<CronJobDto[]>(`/projects/${projectId}/cron`),
  servers: (teamId: string) =>
    serverApi<ServerDto[]>(`/teams/${teamId}/servers`),
};
