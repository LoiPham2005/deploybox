import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { LogoutButton } from '@/features/auth/logout-button';
import { TeamSwitcher } from '@/features/teams/team-switcher';
import { getSelectedTeam } from '@/lib/team';
import { SidebarNav, PlanBadge } from '@/components/sidebar-nav';

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/login'));
  const currentTeam = getSelectedTeam(me.teams);

  return (
    <div className="flex min-h-screen bg-[#0a0a0b]">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/8">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/8">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600">
            <span className="text-xs font-black text-white">D</span>
          </div>
          <span className="text-sm font-bold tracking-tight text-white">DeployBox</span>
        </div>

        {/* Team Switcher */}
        {me.teams.length > 0 && (
          <div className="border-b border-white/8 px-3 py-3">
            <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest text-white/25">
              Team
            </p>
            <TeamSwitcher teams={me.teams} currentTeamId={currentTeam?.id ?? ''} />
          </div>
        )}

        {/* Nav */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <SidebarNav user={me.user} currentTeam={currentTeam ?? null} />
        </div>

        {/* Plan Badge + User */}
        <div className="border-t border-white/8 px-3 py-3 space-y-2">
          {currentTeam && (
            <PlanBadge
              plan={currentTeam.plan}
              teamName={currentTeam.name}
            />
          )}
          <div className="flex items-center gap-2 px-1 py-1">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white/60">
              {(me.user.name ?? me.user.email)[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-white/60">{me.user.email}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/8 px-6 py-3">
          <div className="text-sm font-medium text-white/50">
            {currentTeam?.name ?? 'DeployBox'}
            {currentTeam?.isPersonal && (
              <span className="ml-2 rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] text-white/30">
                Cá nhân
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentTeam?.plan === 'PRO' && (
              <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-400">
                PRO
              </span>
            )}
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
