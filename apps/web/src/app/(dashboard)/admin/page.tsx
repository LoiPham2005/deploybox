import { redirect } from 'next/navigation';
import { isAdminRole, type UserRole } from '@deploybox/shared';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { serverApi } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { PlanToggle } from './plan-toggle';
import { FeatureFlagsPanel, type Feature } from './feature-flags-panel';

interface AdminStats {
  users: number;
  teams: number;
  projects: number;
}

interface AdminUser {
  id: string;
  email: string;
  name?: string | null;
  role: UserRole;
  createdAt: string;
  memberships: Array<{
    team: { id: string; plan: string };
  }>;
}

export default async function AdminPage() {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/login'));
  if (!isAdminRole(me.user.role)) redirect('/dashboard');

  const [stats, users, features] = await Promise.all([
    serverApi<AdminStats>('/admin/stats').catch(() => ({ users: 0, teams: 0, projects: 0 })),
    serverApi<AdminUser[]>('/admin/users').catch(() => [] as AdminUser[]),
    serverApi<Feature[]>('/admin/features').catch(() => [] as Feature[]),
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

      {/* Tính năng hệ thống */}
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-white/70">Tính năng hệ thống</h2>
        <p className="mb-4 text-xs text-white/40">
          Bật/tắt tính năng toàn hệ thống (áp dụng cho mọi người dùng) — vd tắt tạm khi bảo trì.
        </p>
        <FeatureFlagsPanel features={features} />
      </Card>

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
                    {isAdminRole(u.role) && (
                      <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400">
                        Admin
                      </span>
                    )}
                  </div>
                  {u.name && <p className="text-xs text-white/40">{u.email}</p>}
                  <p className="text-xs text-white/30">
                    {new Date(u.createdAt).toLocaleDateString('vi-VN')}
                    {personalTeam && (
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          personalTeam.plan === 'PRO'
                            ? 'bg-indigo-500/20 text-indigo-300'
                            : 'bg-white/10 text-white/40'
                        }`}
                      >
                        {personalTeam.plan}
                      </span>
                    )}
                  </p>
                </div>
                {personalTeam ? (
                  <PlanToggle
                    teamId={personalTeam.id}
                    currentPlan={personalTeam.plan as 'FREE' | 'PRO'}
                  />
                ) : (
                  <span className="text-xs text-white/20">Chưa có team cá nhân</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
