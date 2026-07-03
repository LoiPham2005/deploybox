import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'db_token';

export function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = req.nextUrl;
  const isAuthPage =
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/forgot-password';

  if (!token && !isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  if (token && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // bỏ qua /api (gồm /api/session), static assets
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
