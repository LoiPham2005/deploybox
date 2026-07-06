import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } },
) {
  const token = cookies().get('db_token')?.value;
  if (!token) return new NextResponse('Unauthorized', { status: 401 });

  const hours = req.nextUrl.searchParams.get('hours') ?? '24';
  const res = await fetch(
    `${API}/api/v1/projects/${params.projectId}/metrics/history?hours=${encodeURIComponent(hours)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );

  const data = await res.json().catch(() => null);
  return NextResponse.json(data, { status: res.status });
}
