import { redirect } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { serverGet, serverApi } from '@/lib/api-server';
import { getSelectedTeam } from '@/lib/team';
import { Card } from '@/components/ui/card';
import { TeamMembersManager } from '@/features/teams/team-members-manager';

interface ProjectAccess {
  projects: { id: string; name: string }[];
  access: Record<string, string[]>;
}

export default async function TeamPage() {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/login'));
  const team = getSelectedTeam(me.teams);
  if (!team) redirect('/dashboard');

  const members = await serverGet.members(team.id).catch(() => []);

  // Ma trận quyền project — chỉ OWNER mới lấy được
  let projectAccess: ProjectAccess = { projects: [], access: {} };
  if (team.role === 'OWNER') {
    projectAccess = await serverApi<ProjectAccess>(
      `/teams/${team.id}/members/project-access`,
    ).catch(() => ({ projects: [], access: {} }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{team.name}</h1>
        <p className="mt-1 text-sm text-white/40">
          Quản lý thành viên và quyền xem từng project
        </p>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white/70">Thành viên</h2>
        <TeamMembersManager
          teamId={team.id}
          myRole={team.role}
          initialMembers={members}
          plan={team.plan}
          projects={projectAccess.projects}
          initialAccess={projectAccess.access}
        />
      </Card>
    </div>
  );
}
