import { redirect } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { serverGet } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { TeamMembersManager } from '@/features/teams/team-members-manager';

export default async function TeamPage() {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/login'));
  const team = me.teams[0];
  if (!team) redirect('/dashboard');

  const members = await serverGet.members(team.id).catch(() => []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{team.name}</h1>
        <p className="mt-1 text-sm text-white/40">Quản lý thành viên team</p>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white/70">Thành viên</h2>
        <TeamMembersManager
          teamId={team.id}
          myRole={team.role}
          initialMembers={members}
        />
      </Card>
    </div>
  );
}
