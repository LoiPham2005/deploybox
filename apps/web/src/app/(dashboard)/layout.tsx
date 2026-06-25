import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { authApi } from '@/lib/api';
import { LogoutButton } from '@/features/auth/logout-button';

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = getToken();
  if (!token) redirect('/login');

  // Lấy thông tin user; token hỏng -> về login
  const me = await authApi.me(token).catch(() => redirect('/login'));

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-white/10 p-4">
        <div className="mb-6 text-lg font-semibold">DeployBox</div>
        <nav className="space-y-1 text-sm">
          <Link href="/dashboard" className="block rounded-md px-3 py-2 hover:bg-white/5">
            Projects
          </Link>
          <Link href="/team" className="block rounded-md px-3 py-2 hover:bg-white/5">
            Team
          </Link>
          <Link href="/settings/tokens" className="block rounded-md px-3 py-2 hover:bg-white/5">
            API Tokens
          </Link>
          <Link href="/account" className="block rounded-md px-3 py-2 hover:bg-white/5">
            Tài khoản
          </Link>
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
          <div className="text-sm text-white/50">
            {me.teams[0]?.name ?? 'Team'}
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
