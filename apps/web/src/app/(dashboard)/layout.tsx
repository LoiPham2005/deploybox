import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { LogoutButton } from '@/features/auth/logout-button';
import { TeamSwitcher } from '@/features/teams/team-switcher';
import { getSelectedTeam } from '@/lib/team';

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = getToken();
  if (!token) redirect('/login');

  // Lấy thông tin user; token hỏng -> về login
  const me = await authApi.me(token).catch(() => redirect('/login'));
  const currentTeam = getSelectedTeam(me.teams);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/10 p-4">
        <div className="mb-4 text-lg font-semibold">DeployBox</div>

        {/* Team switcher */}
        {me.teams.length > 0 && (
          <div className="mb-4">
            <TeamSwitcher teams={me.teams} currentTeamId={currentTeam?.id ?? ''} />
          </div>
        )}

        <nav className="space-y-1 text-sm">
          <Link href="/dashboard" className="block rounded-md px-3 py-2 hover:bg-white/5">
            Projects
          </Link>
          <Link href="/team" className="block rounded-md px-3 py-2 hover:bg-white/5">
            Team
          </Link>
          <Link href="/servers" className="block rounded-md px-3 py-2 hover:bg-white/5">
            Servers
          </Link>
          <Link href="/settings/tokens" className="block rounded-md px-3 py-2 hover:bg-white/5">
            API Tokens
          </Link>
          <Link href="/account" className="block rounded-md px-3 py-2 hover:bg-white/5">
            Tài khoản
          </Link>
          {me.user.isAdmin && (
            <Link href="/admin" className="block rounded-md px-3 py-2 text-indigo-400 hover:bg-white/5">
              Admin
            </Link>
          )}
        </nav>

        {/* Plan badge ở dưới sidebar */}
        <div className="mt-auto pt-4 border-t border-white/10">
          {currentTeam?.plan === 'PRO' ? (
            <div className="flex items-center gap-2 rounded-md bg-indigo-500/10 px-3 py-2">
              <span className="text-xs font-semibold text-indigo-400">PRO</span>
              <span className="text-xs text-white/40">Không giới hạn</span>
            </div>
          ) : (
            <Link href="/settings/billing" className="block rounded-md bg-white/5 px-3 py-2 hover:bg-white/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/60">FREE</span>
                <span className="text-xs text-indigo-400">Nâng cấp →</span>
              </div>
              <p className="mt-0.5 text-xs text-white/30">2 project · 1 server</p>
            </Link>
          )}
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
          <div className="text-sm text-white/50">
            {currentTeam?.name ?? 'Team'}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-white/70">{me.user.email}</span>
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
