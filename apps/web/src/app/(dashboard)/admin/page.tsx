import { redirect } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { serverApi } from '@/lib/api-server';
import { Card } from '@/components/ui/card';

interface AdminStats {
  users: number;
  teams: number;
  projects: number;
}

interface AdminUser {
  id: string;
  email: string;
  name?: string | null;
  isAdmin: boolean;
  createdAt: string;
  memberships: Array<{
    team: { id: string; plan: string };
  }>;
}

export default async function AdminPage() {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/login'));
  if (!me.user.isAdmin) redirect('/dashboard');

  const [stats, users] = await Promise.all([
    serverApi<AdminStats>('/admin/stats').catch(() => ({ users: 0, teams: 0, projects: 0 })),
    serverApi<AdminUser[]>('/admin/users').catch(() => [] as AdminUser[]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Admin Panel</h1>
        <p className="mt-1 text-sm text-white/40">Quản lý toàn bộ hệ thống DeployBox</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-xs text-white/40">Tổng người dùng</p>
          <p className="mt-1 text-3xl font-bold">{stats.users}</p>
        </Card>
        <Card>
          <p className="text-xs text-white/40">Teams cá nhân</p>
          <p className="mt-1 text-3xl font-bold">{stats.teams}</p>
        </Card>
        <Card>
          <p className="text-xs text-white/40">Tổng project</p>
          <p className="mt-1 text-3xl font-bold">{stats.projects}</p>
        </Card>
      </div>

      {/* Users list */}
      <Card>
        <h2 className="mb-4 text-sm font-semibold text-white/70">Danh sách người dùng</h2>
        <div className="divide-y divide-white/5">
          {users.map((u) => {
            const personalTeam = u.memberships[0]?.team;
            return (
              <div key={u.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{u.name ?? u.email}</p>
                    {u.isAdmin && (
                      <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400">
                        Admin
                      </span>
                    )}
                  </div>
                  {u.name && <p className="text-xs text-white/40">{u.email}</p>}
                  <p className="text-xs text-white/30">
                    {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                    {personalTeam && ` · ${personalTeam.plan}`}
                  </p>
                </div>
                {personalTeam && (
                  <form action={async () => {
                    'use server';
                    // Plan upgrade handled via API call below
                  }}>
                    <UpgradePlanButton
                      teamId={personalTeam.id}
                      currentPlan={personalTeam.plan as 'FREE' | 'PRO'}
                    />
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function UpgradePlanButton({ teamId, currentPlan }: { teamId: string; currentPlan: 'FREE' | 'PRO' }) {
  const newPlan = currentPlan === 'PRO' ? 'FREE' : 'PRO';
  return (
    <form action={`/api/admin/teams/${teamId}/plan`} method="POST">
      <input type="hidden" name="plan" value={newPlan} />
      <button
        type="submit"
        className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
          currentPlan === 'PRO'
            ? 'bg-white/10 text-white/60 hover:bg-white/20'
            : 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30'
        }`}
      >
        {currentPlan === 'PRO' ? 'Hạ về FREE' : 'Nâng lên PRO'}
      </button>
    </form>
  );
}
