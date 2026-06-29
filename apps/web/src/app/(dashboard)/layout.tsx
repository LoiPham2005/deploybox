import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { LogoutButton } from '@/features/auth/logout-button';
import { TeamSwitcher } from '@/features/teams/team-switcher';
import { getSelectedTeam } from '@/lib/team';
import { SidebarNav, PlanBadge } from '@/components/sidebar-nav';
import { MobileSidebarTrigger } from '@/components/mobile-sidebar';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const token = getToken();
  if (!token) redirect('/login');

  const me = await authApi.me(token).catch(() => redirect('/login'));
  const currentTeam = getSelectedTeam(me.teams);

  const initials = (me.user.name ?? me.user.email)
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-[#09090b] text-white">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-[220px] shrink-0 flex-col border-r border-white/[0.07]">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/[0.07]">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 shadow-lg shadow-indigo-900/50">
            <span className="text-[11px] font-black text-white">D</span>
          </div>
          <span className="text-sm font-bold tracking-tight">DeployBox</span>
        </div>

        {/* Team Switcher */}
        <div className="border-b border-white/[0.07] px-3 py-2.5">
          <TeamSwitcher teams={me.teams} currentTeamId={currentTeam?.id ?? ''} />
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav user={me.user} currentTeam={currentTeam ?? null} />
        </div>

        {/* Bottom */}
        <div className="border-t border-white/[0.07] px-3 py-3 space-y-2.5">
          {currentTeam && (
            <PlanBadge
              plan={currentTeam.plan}
              teamName={currentTeam.name}
              isAdmin={me.user.isAdmin}
            />
          )}
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-[10px] font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] text-white/40">{me.user.email}</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3 lg:px-6">
          {/* Mobile: hamburger */}
          <MobileSidebarTrigger
            user={me.user}
            teams={me.teams}
            currentTeamId={currentTeam?.id ?? ''}
          />

          {/* Mobile: logo (lg= hidden since sidebar shows it) */}
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600">
              <span className="text-[11px] font-black text-white">D</span>
            </div>
            <span className="text-sm font-bold">DeployBox</span>
          </div>

          {/* Desktop: team name */}
          <div className="hidden lg:flex items-center gap-2 text-sm text-white/40">
            <span>{currentTeam?.name}</span>
            {currentTeam?.isPersonal && (
              <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-white/25">
                Cá nhân
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {currentTeam?.plan === 'PRO' && (
              <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-400">
                PRO
              </span>
            )}
            {/* Mobile logout */}
            <div className="lg:hidden">
              <LogoutButton />
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
