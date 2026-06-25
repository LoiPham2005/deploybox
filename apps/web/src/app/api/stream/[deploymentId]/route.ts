import { type NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function GET(
  req: NextRequest,
  { params }: { params: { deploymentId: string } },
) {
  const token = cookies().get('db_token')?.value;
  if (!token) return new NextResponse('Unauthorized', { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') === 'runtime' ? 'runtime-logs' : 'logs/stream';

  const upstream = await fetch(
    `${API}/api/v1/deployments/${params.deploymentId}/${type}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
