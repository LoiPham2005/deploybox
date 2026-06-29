'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, FolderOpen, Users, Server, Key, User, ShieldCheck, Check, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TeamDto, UserDto } from '@deploybox/shared';

type NavItem = { href: string; label: string; icon: React.ReactNode; exact?: boolean };

function MobileNavLink({ href, label, icon, exact, onClose }: NavItem & { onClose: () => void }) {
  const pathname = usePathname();
  const isActive = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      onClick={onClose}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
        isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/80',
      )}
    >
      <span className={cn('shrink-0', isActive ? 'text-white' : 'text-white/35')}>{icon}</span>
      {label}
    </Link>
  );
}

export function MobileSidebarTrigger({
  user,
  teams,
  currentTeamId,
}: {
  user: UserDto;
  teams: TeamDto[];
  currentTeamId: string;
}) {
  const [open, setOpen] = useState(false);
  const currentTeam = teams.find((t) => t.id === currentTeamId) ?? teams[0];
  const pathname = usePathname();

  // Close on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const navSections: Array<{ title: string; items: NavItem[] }> = [
    {
      title: 'Workspace',
      items: [{ href: '/dashboard', label: 'Projects', icon: <FolderOpen size={16} />, exact: true }],
    },
    {
      title: 'Infrastructure',
      items: [
        { href: '/team', label: 'Team', icon: <Users size={16} /> },
        { href: '/servers', label: 'Servers', icon: <Server size={16} /> },
      ],
    },
    {
      title: 'Developer',
      items: [
        { href: '/settings/tokens', label: 'API Tokens', icon: <Key size={16} /> },
        { href: '/account', label: 'Tài khoản', icon: <User size={16} /> },
      ],
    },
  ];

  function switchTeam(teamId: string) {
    document.cookie = `db_team=${teamId};path=/;max-age=31536000`;
    setOpen(false);
    window.location.reload();
  }

  const initials = (user.name ?? user.email).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      {/* Hamburger button */}
      <button
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 hover:bg-white/8 hover:text-white lg:hidden"
        aria-label="Mở menu"
      >
        <Menu size={18} />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-[#09090b] border-r border-white/[0.07] transition-transform duration-300 ease-in-out lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.07]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600">
              <span className="text-[11px] font-black text-white">D</span>
            </div>
            <span className="text-sm font-bold">DeployBox</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/40 hover:bg-white/8 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        {/* Team info */}
        <div className="border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10">
              <Building2 size={13} className="text-white/50" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white/80">{currentTeam?.name}</p>
              <p className="text-[10px] text-white/30">
                {currentTeam?.isPersonal ? 'Cá nhân' : currentTeam?.plan === 'PRO' ? 'PRO Team' : 'Free Team'}
              </p>
            </div>
          </div>
          {teams.length > 1 && (
            <div className="mt-2 space-y-0.5">
              {teams.map((t) => (
                <button
                  key={t.id}
                  onClick={() => switchTeam(t.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5',
                    t.id === currentTeamId ? 'text-white' : 'text-white/40',
                  )}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/10 text-[10px] font-bold">
                    {t.name[0].toUpperCase()}
                  </span>
                  <span className="truncate">{t.name}</span>
                  {t.id === currentTeamId && <Check size={11} className="ml-auto shrink-0 text-indigo-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          {navSections.map((section) => (
            <div key={section.title}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-white/20">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <MobileNavLink {...item} onClose={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {user.isAdmin && (
            <div>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-indigo-400/50">
                System
              </p>
              <ul>
                <li>
                  <MobileNavLink href="/admin" label="Admin Panel" icon={<ShieldCheck size={16} />} onClose={() => setOpen(false)} />
                </li>
              </ul>
            </div>
          )}
        </div>

        {/* Bottom */}
        <div className="border-t border-white/[0.07] px-3 py-3">
          {currentTeam?.plan === 'FREE' && (
            <Link
              href="/settings/billing"
              onClick={() => setOpen(false)}
              className="mb-2 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 hover:border-indigo-500/30"
            >
              <span className="text-xs font-semibold text-white/40">FREE</span>
              <span className="ml-auto text-xs text-indigo-400">Nâng cấp →</span>
            </Link>
          )}
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-[10px] font-bold text-white">
              {initials}
            </div>
            <p className="truncate text-[11px] text-white/40">{user.email}</p>
          </div>
        </div>
      </div>
    </>
  );
}
