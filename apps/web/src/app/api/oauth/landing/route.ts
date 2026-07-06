import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

/**
 * Đích redirect sau khi OAuth login thành công:
 * đổi one-time code lấy JWT (server-to-server) → set cookie httpOnly → vào dashboard.
 * (JWT không bao giờ xuất hiện trên URL.)
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const to = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin));
  if (!code) return to('/login?oauth_error=' + encodeURIComponent('Thiếu code'));

  try {
    const res = await fetch(`${API}/auth/oauth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as {
      accessToken?: string;
      message?: string;
    };
    if (!res.ok || !body.accessToken) {
      return to('/login?oauth_error=' + encodeURIComponent(body.message ?? 'Đổi code thất bại'));
    }
    cookies().set(SESSION_COOKIE, body.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return to('/dashboard');
  } catch {
    return to('/login?oauth_error=' + encodeURIComponent('Không gọi được API'));
  }
}
