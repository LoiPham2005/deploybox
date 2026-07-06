import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

// Đặt cookie httpOnly chứa JWT sau khi đăng nhập/đăng ký
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token) {
    return NextResponse.json({ error: 'Thiếu token' }, { status: 400 });
  }
  cookies().set(SESSION_COOKIE, body.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 ngày
  });
  return NextResponse.json({ ok: true });
}

// Đăng xuất: thu hồi phiên phía API (best-effort) rồi xoá cookie
export async function DELETE() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    const base =
      (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';
    await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined);
  }
  cookies().delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
