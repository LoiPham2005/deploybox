import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

// Proxy /overview để trang Tổng quan tự làm mới (cookie httpOnly đọc server-side).
export async function GET() {
  const token = cookies().get('db_token')?.value;
  if (!token) return new NextResponse('Unauthorized', { status: 401 });
  const res = await fetch(`${API}/overview`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => []);
  return NextResponse.json(data, { status: res.status });
}
