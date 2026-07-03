import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

/**
 * Xoá cookie phiên rồi đưa về /login (điều hướng được bằng GET).
 * Dùng khi token còn trong cookie nhưng không còn hợp lệ (user bị xoá, token hết hạn):
 * nếu chỉ redirect('/login') mà không xoá cookie, middleware thấy "có cookie" sẽ đá
 * ngược về /dashboard → lặp vô hạn → trang đen.
 */
export async function GET(req: Request) {
  cookies().delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL('/login', req.url));
}
