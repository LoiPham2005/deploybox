import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'db_token';

/** Đọc JWT từ cookie httpOnly (dùng trong Server Component / Route Handler). */
export function getToken(): string | undefined {
  return cookies().get(SESSION_COOKIE)?.value;
}
