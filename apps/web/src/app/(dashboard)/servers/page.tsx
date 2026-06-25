import { redirect } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { serverGet } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { ServersManager } from '@/features/servers/servers-manager';

export default async function ServersPage() {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/login'));
  const team = me.teams[0];
  if (!team) redirect('/dashboard');

  const servers = await serverGet.servers(team.id).catch(() => []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Servers</h1>
        <p className="mt-1 text-sm text-white/40">
          Quản lý máy chủ deploy — Local (máy này) hoặc Remote (VPS qua SSH).
        </p>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white/70">Danh sách server</h2>
        <ServersManager
          teamId={team.id}
          myRole={team.role}
          initialServers={servers}
        />
      </Card>
    </div>
  );
}
