// API client mỏng — dùng type DTO từ @deploybox/shared (một nguồn sự thật).
import type {
  AuthResponse,
  LoginDto,
  MeResponse,
  RegisterDto,
} from '@deploybox/shared';

const BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

interface ApiError {
  message?: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(body.message ?? `Yêu cầu thất bại (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return handle<T>(res);
}

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store',
  });
  return handle<T>(res);
}

export const authApi = {
  login: (dto: LoginDto) => apiPost<AuthResponse>('/auth/login', dto),
  register: (dto: RegisterDto) => apiPost<AuthResponse>('/auth/register', dto),
  me: (token: string) => apiGet<MeResponse>('/auth/me', token),
};
