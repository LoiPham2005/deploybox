import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

/**
 * Bắt đầu "Kết nối GitHub…" từ trang Tài khoản: cần JWT (cookie httpOnly web),
 * nên web server gọi API lấy URL authorize (state gắn userId) rồi redirect browser.
 */
/** Origin THẬT của web sau proxy — req.nextUrl.origin trả localhost:3000 khi self-host sau Caddy. */
function realOrigin(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } },
) {
  const to = (path: string) => NextResponse.redirect(new URL(path, realOrigin(req)));
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return to('/login');

  try {
    const res = await fetch(`${API}/auth/oauth/${params.provider}/start-connect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
    if (!res.ok || !body.url) {
      return to('/account?oauth_error=' + encodeURIComponent(body.message ?? 'Không bắt đầu được'));
    }
    return NextResponse.redirect(body.url);
  } catch {
    return to('/account?oauth_error=' + encodeURIComponent('Không gọi được API'));
  }
}
